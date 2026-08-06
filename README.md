# 투자 리밸런싱 체커

해외주식 포트폴리오를 두 가지 전략으로 관리하고, 매달 마지막날 리밸런싱 여부를 자동으로 점검하는 도구입니다.

- **① 듀얼모멘텀**: 표준 GEM(Global Equities Momentum) 방식. 미국주식(SPY) vs 해외선진국주식(EFA) 중 12개월 상대모멘텀 승자를 고르고, 그 자산의 절대모멘텀이 안전자산(BIL)보다 낮으면 안전자산으로 대피합니다.
- **② 배당주**: 워치리스트 종목의 배당수익률을 계산하고, 목표비중 대비 현재비중 드리프트를 확인해 리밸런싱 여부를 제안합니다.

이 도구는 **매매를 실행하지 않습니다.** 목표배분 대비 매수/매도 제안 수량만 계산해서 보여주며, 실제 주문은 사용자가 증권사에서 직접 실행합니다.

## 동작 방식

1. GitHub Actions가 평일마다 자동 실행되어 Yahoo Finance(yfinance)에서 시세/배당 데이터를 가져와 계산하고, 결과를 `docs/data/latest/*.json`에 커밋합니다.
2. 매달 **마지막날**에는 그 결과를 `docs/data/history/<tab>/YYYY-MM.json`으로도 저장해 리밸런싱 기록을 영구 보관합니다.
3. GitHub Pages로 배포된 정적 웹앱(`docs/`)이 이 JSON 파일들을 읽어 탭별로 현황과 리밸런싱 제안을 보여줍니다.
4. 종목/보유수량을 웹앱에서 추가·수정하면, 사용자의 GitHub 개인 토큰(PAT)으로 `docs/data/config/*.json`을 브라우저에서 직접 커밋합니다. 별도 서버나 DB는 없습니다.

## 최초 설정 (1회)

### 1. 코드를 저장소에 push

```bash
git init
git add .
git commit -m "init: investment rebalancing checker"
git branch -M main
git remote add origin https://github.com/jeawon83-stack/moneyrebalance.git
git push -u origin main
```

### 2. GitHub Pages 활성화

GitHub 저장소 → **Settings → Pages** → Source를 `Deploy from a branch`로 설정 → Branch: `main`, Folder: `/docs` 선택 → Save.

몇 분 후 `https://jeawon83-stack.github.io/moneyrebalance/` 에서 접속할 수 있습니다.

### 3. GitHub Actions 확인

저장소 → **Actions** 탭에서 `Update rebalancing data` 워크플로가 보이는지 확인하세요. 처음에는 `Run workflow` 버튼으로 수동 실행해 데이터가 정상적으로 커밋되는지 확인하는 것을 권장합니다 (`force_rebalance_day`를 체크하면 월말이 아니어도 기록(history)까지 생성됩니다).

### 4. 종목 추가용 GitHub 토큰(PAT) 발급

1. GitHub 우측 상단 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. Repository access: **Only select repositories** → `moneyrebalance` 선택
3. Permissions → **Contents: Read and write** 로 설정 (다른 권한은 불필요)
4. 생성된 토큰을 복사해 웹앱 상단 "GitHub 연결" 패널에 붙여넣고 저장

토큰은 브라우저의 `localStorage`에만 저장되며, `api.github.com`으로만 전송됩니다.

## 로컬에서 스크립트 실행하기

```bash
cd scripts
pip install -r requirements.txt
python dual_momentum.py --force-rebalance-day
python dividend.py --force-rebalance-day
```

`docs/data/latest/*.json`과 `docs/data/history/<tab>/*.json`이 갱신됩니다.

## 폴더 구조

```
docs/                       # GitHub Pages로 배포되는 정적 웹앱 + 데이터
  index.html app.js style.css config.js
  data/
    config/                 # 유니버스, 워치리스트, 보유종목 (웹앱에서 수정)
    latest/                 # 최신 계산 결과 (Action이 갱신)
    history/<tab>/YYYY-MM.json  # 월말 리밸런싱 기록
scripts/                    # 시세 계산 (Python + yfinance)
.github/workflows/          # 자동 실행 워크플로
```

## 유의사항

- Yahoo Finance 비공식 API를 사용하므로 드물게 일시적으로 데이터를 가져오지 못할 수 있습니다. Actions 탭에서 실행 로그를 확인하세요.
- 목표비중/유니버스/보유수량은 언제든 웹앱에서 수정할 수 있으며, 다음 Actions 실행 시 반영됩니다.
