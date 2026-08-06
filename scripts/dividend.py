"""배당주 전략: 배당수익률 계산 및 목표비중 대비 리밸런싱 제안 생성."""
import argparse

from common import (
    DATA_DIR,
    fetch_current_price,
    fetch_trailing_dividends,
    is_last_day_of_month,
    load_json,
    round_shares,
    save_json,
    today_utc,
)

CONFIG_PATH = DATA_DIR / "config" / "dividend.json"
LATEST_PATH = DATA_DIR / "latest" / "dividend.json"
HISTORY_DIR = DATA_DIR / "history" / "dividend"

ACTION_EPSILON = 1.0  # 이 금액(달러) 미만 차이는 HOLD 처리


def compute(config: dict) -> dict:
    watchlist = config.get("watchlist", [])
    holdings = {h["ticker"]: h["shares"] for h in config.get("holdings", [])}
    cash = config.get("cash", 0.0)
    drift_threshold = config.get("drift_threshold", 0.05)

    all_tickers = set(watchlist_tickers(watchlist)) | set(holdings.keys())

    holdings_out = []
    values_by_ticker = {}
    for ticker in all_tickers:
        price = fetch_current_price(ticker)
        trailing_div = fetch_trailing_dividends(ticker, months=12)
        shares = holdings.get(ticker, 0.0)
        value = price * shares
        values_by_ticker[ticker] = value
        holdings_out.append(
            {
                "ticker": ticker,
                "shares": shares,
                "price": round(price, 2),
                "value": round(value, 2),
                "trailing_dividend": round(trailing_div, 4),
                "dividend_yield": round(trailing_div / price, 4) if price else 0.0,
            }
        )
    holdings_out.sort(key=lambda h: h["ticker"])

    total_value = sum(values_by_ticker.values()) + cash

    target_weight_by_ticker = {w["ticker"]: w.get("target_weight", 0.0) for w in watchlist}
    for h in holdings_out:
        h["current_weight"] = round(values_by_ticker[h["ticker"]] / total_value, 4) if total_value else 0.0
        h["target_weight"] = target_weight_by_ticker.get(h["ticker"], 0.0)

    target_vs_current = []
    rebalance_actions = []
    for h in holdings_out:
        ticker = h["ticker"]
        target_weight = h["target_weight"]
        current_weight = h["current_weight"]
        drift = round(current_weight - target_weight, 4)
        needs_rebalance = abs(drift) > drift_threshold
        target_vs_current.append(
            {
                "ticker": ticker,
                "target_weight": target_weight,
                "current_weight": current_weight,
                "drift": drift,
                "needs_rebalance": needs_rebalance,
            }
        )

        target_value = total_value * target_weight
        current_value = values_by_ticker[ticker]
        delta_value = target_value - current_value
        price = h["price"]
        if abs(delta_value) < ACTION_EPSILON or price == 0:
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
                "ticker": ticker,
                "action": action,
                "shares_delta": shares_delta,
                "target_value": round(target_value, 2),
                "current_value": round(current_value, 2),
            }
        )

    return {
        "drift_threshold": drift_threshold,
        "holdings": holdings_out,
        "total_value": round(total_value, 2),
        "cash": cash,
        "target_vs_current": target_vs_current,
        "rebalance_actions": rebalance_actions,
    }


def watchlist_tickers(watchlist):
    return [w["ticker"] for w in watchlist]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-rebalance-day", action="store_true")
    args = parser.parse_args()

    config = load_json(CONFIG_PATH)
    today = today_utc()
    is_rebalance_day = args.force_rebalance_day or is_last_day_of_month(today)

    result = {
        "as_of": today.isoformat(),
        "is_rebalance_day": is_rebalance_day,
        **compute(config),
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
