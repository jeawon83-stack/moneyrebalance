import calendar
import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"


def load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


def is_last_day_of_month(d: date) -> bool:
    last_day = calendar.monthrange(d.year, d.month)[1]
    return d.day == last_day


def determine_rebalance_month(today: date, history_dir: Path, grace_days: int = 3) -> str | None:
    """오늘이 이번 달 월말이면 이번 달을 반환한다.

    GitHub Actions의 예약 실행(cron)은 부하가 많을 때 건너뛸 수 있어, 월말 당일에
    실행이 누락될 수 있다. 이를 보정하기 위해 월말이 아니어도 이번 달 초
    grace_days일 이내이면서 지난달 기록이 아직 없으면 지난달을 리밸런싱 대상으로
    간주해 자동으로 보정 기록한다.
    """
    if is_last_day_of_month(today):
        return today.strftime("%Y-%m")
    if today.day <= grace_days:
        prev_last_day = today.replace(day=1) - timedelta(days=1)
        prev_key = prev_last_day.strftime("%Y-%m")
        if not (history_dir / f"{prev_key}.json").exists():
            return prev_key
    return None


def fetch_current_price(ticker: str) -> float:
    hist = yf.Ticker(ticker).history(period="5d", auto_adjust=True)
    if hist.empty:
        raise ValueError(f"'{ticker}' 가격 데이터를 가져오지 못했습니다.")
    return float(hist["Close"].dropna().iloc[-1])


def fetch_usd_krw_rate() -> float:
    """당일 기준 원/달러 환율 (1달러 = N원)."""
    hist = yf.Ticker("KRW=X").history(period="5d")
    closes = hist["Close"].dropna()
    if closes.empty:
        raise ValueError("원/달러 환율 데이터를 가져오지 못했습니다.")
    return float(closes.iloc[-1])


def fetch_trailing_return(ticker: str, months: int) -> float:
    """lookback 개월 전 종가 대비 현재 종가의 총수익률."""
    period_days = months * 31 + 10
    hist = yf.Ticker(ticker).history(period=f"{period_days}d", auto_adjust=True)
    closes = hist["Close"].dropna()
    if closes.empty:
        raise ValueError(f"'{ticker}' 가격 데이터를 가져오지 못했습니다.")

    end_price = float(closes.iloc[-1])
    target_date = closes.index[-1] - timedelta(days=months * 30.44)
    start_series = closes[closes.index <= target_date]
    start_price = float(start_series.iloc[-1]) if not start_series.empty else float(closes.iloc[0])

    if start_price <= 0:
        raise ValueError(f"'{ticker}' 시작 가격이 유효하지 않습니다.")
    return (end_price / start_price) - 1.0


def fetch_trailing_dividends(ticker: str, months: int = 12) -> float:
    """최근 N개월 동안 지급된 주당 배당금 합계."""
    divs = yf.Ticker(ticker).dividends
    if divs.empty:
        return 0.0
    cutoff = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=months * 30.44)
    index = divs.index
    if index.tz is not None:
        cutoff = cutoff.tz_convert(index.tz)
    else:
        cutoff = cutoff.tz_localize(None)
    recent = divs[index >= cutoff]
    return float(recent.sum())


def round_shares(value: float) -> float:
    """소수점 4자리까지 반올림 (해외주식 소수점 매매 지원 고려)."""
    return round(value + 0.0, 4) if not math.isnan(value) else 0.0
