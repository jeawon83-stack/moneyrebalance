"""듀얼모멘텀(GEM) 전략 시그널 계산 및 리밸런싱 제안 생성."""
import argparse

from common import (
    DATA_DIR,
    fetch_current_price,
    fetch_trailing_return,
    is_last_day_of_month,
    load_json,
    round_shares,
    save_json,
    today_utc,
)

CONFIG_PATH = DATA_DIR / "config" / "dual_momentum.json"
LATEST_PATH = DATA_DIR / "latest" / "dual_momentum.json"
HISTORY_DIR = DATA_DIR / "history" / "dual_momentum"

ACTION_EPSILON = 1.0  # 이 금액(달러) 미만 차이는 HOLD 처리


def compute_signals(config: dict) -> dict:
    universe = config["universe"]
    safe_asset = config.get("safe_asset") or universe[-1]["ticker"]
    lookback_months = config.get("lookback_months", 12)

    signals = []
    for asset in universe:
        ticker = asset["ticker"]
        ret = fetch_trailing_return(ticker, lookback_months)
        signals.append({"ticker": ticker, "label": asset.get("label", ticker), "return_lookback": ret})

    signal_by_ticker = {s["ticker"]: s for s in signals}
    risk_signals = [s for s in signals if s["ticker"] != safe_asset]
    if not risk_signals:
        raise ValueError("safe_asset을 제외한 위험자산이 유니버스에 없습니다.")

    best_risk = max(risk_signals, key=lambda s: s["return_lookback"])
    safe_signal = signal_by_ticker.get(safe_asset)
    if safe_signal is None:
        raise ValueError(f"safe_asset '{safe_asset}'이 유니버스에 없습니다.")

    in_market = best_risk["return_lookback"] > safe_signal["return_lookback"]
    selected_asset = best_risk["ticker"] if in_market else safe_asset

    return {
        "signals": signals,
        "safe_asset": safe_asset,
        "selected_asset": selected_asset,
        "in_market": in_market,
        "lookback_months": lookback_months,
    }


def compute_portfolio(config: dict, selected_asset: str) -> dict:
    holdings = config.get("holdings", [])
    cash = config.get("cash", 0.0)

    prices = {}
    tickers_needed = {h["ticker"] for h in holdings} | {selected_asset}
    for ticker in tickers_needed:
        prices[ticker] = fetch_current_price(ticker)

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
    target_allocation = [{"ticker": selected_asset, "weight": 1.0}]

    rebalance_actions = []
    target_value = total_value * 1.0
    current_value = holdings_value_by_ticker.get(selected_asset, 0.0)
    delta_value = target_value - current_value
    price = prices[selected_asset]
    if abs(delta_value) < ACTION_EPSILON:
        action = "HOLD"
        shares_delta = 0.0
    elif delta_value > 0:
        action = "BUY"
        shares_delta = round_shares(delta_value / price)
    else:
        action = "SELL"
        shares_delta = round_shares(delta_value / price)
    rebalance_actions.append(
        {
            "ticker": selected_asset,
            "action": action,
            "shares_delta": shares_delta,
            "target_value": round(target_value, 2),
            "current_value": round(current_value, 2),
        }
    )

    # 목표자산이 아닌 종목을 보유 중이면 전량 매도 제안
    for ticker, value in holdings_value_by_ticker.items():
        if ticker == selected_asset:
            continue
        if value < ACTION_EPSILON:
            continue
        rebalance_actions.append(
            {
                "ticker": ticker,
                "action": "SELL",
                "shares_delta": -next(h["shares"] for h in holdings if h["ticker"] == ticker),
                "target_value": 0.0,
                "current_value": round(value, 2),
            }
        )

    return {
        "current_holdings_value": current_holdings_value,
        "total_value": round(total_value, 2),
        "cash": cash,
        "target_allocation": target_allocation,
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
    portfolio_result = compute_portfolio(config, signal_result["selected_asset"])

    result = {
        "as_of": today.isoformat(),
        "is_rebalance_day": is_rebalance_day,
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
