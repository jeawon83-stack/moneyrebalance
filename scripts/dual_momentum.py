"""종합 듀얼모멘텀 전략: 자산군별 독립 시그널 계산 및 리밸런싱 제안 생성.

여러 자산군(미국주식/선진국주식/채권/리츠 등)을 각각 독립적으로 듀얼모멘텀 판단한다.
자산군마다 후보종목 중 상대모멘텀 1위를 고르고(relative momentum), 그 종목의 수익률이
공통 안전자산의 수익률보다 높으면(absolute momentum) 그 자산군 비중만큼 해당 종목에,
아니면 안전자산에 배분한다. 여러 자산군이 동시에 안전자산으로 대피하면 안전자산 비중은
합산된다.
"""
import argparse
import math

from common import (
    DATA_DIR,
    fetch_current_price,
    fetch_trailing_return,
    fetch_usd_krw_rate,
    is_last_day_of_month,
    load_json,
    save_json,
    today_utc,
)

CONFIG_PATH = DATA_DIR / "config" / "dual_momentum.json"
LATEST_PATH = DATA_DIR / "latest" / "dual_momentum.json"
HISTORY_DIR = DATA_DIR / "history" / "dual_momentum"

ACTION_EPSILON = 1.0  # 이 금액(달러) 미만 차이는 HOLD 처리


def compute_signals(config: dict) -> dict:
    safe_asset = config.get("safe_asset", "BIL")
    lookback_months = config.get("lookback_months", 12)
    asset_classes = config.get("asset_classes", [])
    if not asset_classes:
        raise ValueError("asset_classes가 비어있습니다. 자산군을 하나 이상 추가하세요.")

    tickers_needed = {safe_asset}
    for cls in asset_classes:
        tickers_needed.update(cls.get("candidates", []))

    returns = {ticker: fetch_trailing_return(ticker, lookback_months) for ticker in tickers_needed}
    safe_return = returns[safe_asset]

    classes_out = []
    weight_by_ticker = {}
    for cls in asset_classes:
        candidates = cls.get("candidates", [])
        if not candidates:
            continue
        candidate_returns = [{"ticker": t, "return_lookback": returns[t]} for t in candidates]
        best = max(candidate_returns, key=lambda c: c["return_lookback"])
        weight = cls.get("weight", 0.0)
        in_market = best["return_lookback"] > safe_return
        selected_asset = best["ticker"] if in_market else safe_asset

        weight_by_ticker[selected_asset] = weight_by_ticker.get(selected_asset, 0.0) + weight
        classes_out.append(
            {
                "name": cls.get("name", ""),
                "weight": weight,
                "candidates": candidate_returns,
                "selected_asset": selected_asset,
                "in_market": in_market,
            }
        )

    target_allocation = [
        {"ticker": ticker, "weight": round(weight, 6)} for ticker, weight in weight_by_ticker.items() if weight > 0
    ]

    return {
        "classes": classes_out,
        "safe_asset": safe_asset,
        "safe_asset_return": safe_return,
        "lookback_months": lookback_months,
        "target_allocation": target_allocation,
    }


def compute_portfolio(config: dict, target_allocation: list) -> dict:
    holdings = config.get("holdings", [])
    cash = config.get("cash", 0.0)
    target_weight_by_ticker = {t["ticker"]: t["weight"] for t in target_allocation}

    tickers_needed = {h["ticker"] for h in holdings} | set(target_weight_by_ticker.keys())
    prices = {ticker: fetch_current_price(ticker) for ticker in tickers_needed}

    current_holdings_value = []
    holdings_value_by_ticker = {}
    for h in holdings:
        ticker = h["ticker"]
        price = prices[ticker]
        value = price * h["shares"]
        holdings_value_by_ticker[ticker] = value
        current_holdings_value.append(
            {"ticker": ticker, "shares": h["shares"], "price": price, "value": round(value, 2)}
        )

    total_value = sum(holdings_value_by_ticker.values()) + cash

    rebalance_actions = []
    all_tickers = set(target_weight_by_ticker) | set(holdings_value_by_ticker)
    for ticker in sorted(all_tickers):
        target_weight = target_weight_by_ticker.get(ticker, 0.0)
        target_value = total_value * target_weight
        current_value = holdings_value_by_ticker.get(ticker, 0.0)
        delta_value = target_value - current_value
        price = prices[ticker]

        shares_delta = math.trunc(delta_value / price) if price else 0
        if abs(delta_value) < ACTION_EPSILON or price == 0 or shares_delta == 0:
            action = "HOLD"
            shares_delta = 0
        elif delta_value > 0:
            action = "BUY"
        else:
            action = "SELL"

        rebalance_actions.append(
            {
                "ticker": ticker,
                "action": action,
                "shares_delta": shares_delta,
                "target_value": round(target_value, 2),
                "current_value": round(current_value, 2),
            }
        )

    return {
        "current_holdings_value": current_holdings_value,
        "total_value": round(total_value, 2),
        "cash": cash,
        "rebalance_actions": rebalance_actions,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-rebalance-day", action="store_true")
    args = parser.parse_args()

    config = load_json(CONFIG_PATH)
    today = today_utc()
    is_rebalance_day = args.force_rebalance_day or is_last_day_of_month(today)

    signal_result = compute_signals(config)
    portfolio_result = compute_portfolio(config, signal_result["target_allocation"])

    try:
        usd_krw_rate = fetch_usd_krw_rate()
    except ValueError:
        usd_krw_rate = None

    result = {
        "as_of": today.isoformat(),
        "is_rebalance_day": is_rebalance_day,
        "usd_krw_rate": usd_krw_rate,
        **signal_result,
        **portfolio_result,
    }

    save_json(LATEST_PATH, result)
    print(f"Wrote {LATEST_PATH}")

    if is_rebalance_day:
        month_key = today.strftime("%Y-%m")
        history_path = HISTORY_DIR / f"{month_key}.json"
        save_json(history_path, result)
        print(f"Wrote {history_path}")

        index_path = HISTORY_DIR / "index.json"
        index = load_json(index_path) if index_path.exists() else {"months": []}
        if month_key not in index["months"]:
            index["months"].append(month_key)
            index["months"].sort()
        save_json(index_path, index)
        print(f"Updated {index_path}")


if __name__ == "__main__":
    main()
