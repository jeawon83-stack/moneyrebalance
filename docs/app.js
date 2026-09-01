const TOKEN_KEY = "moneyrebalance_pat";
const CONFIG_PATHS = {
  dual_momentum: "docs/data/config/dual_momentum.json",
  dividend: "docs/data/config/dividend.json",
  dashboard: "docs/data/dashboard/config.json",
};

const state = {
  dmConfig: null,
  dvConfig: null,
  dashboardConfig: null,
  dashboardYear: new Date().getFullYear(),
};

// ---------- utils ----------

function fmtPercent(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  return (x * 100).toFixed(2) + "%";
}

function fmtMoney(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  return "$" + Number(x).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWon(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  return "₩" + Math.round(x).toLocaleString();
}

function fmtMoneyKRW(usdAmount, rate) {
  const usdText = fmtMoney(usdAmount);
  if (usdAmount === null || usdAmount === undefined || Number.isNaN(usdAmount) || !rate) return usdText;
  return `${usdText} (${fmtWon(usdAmount * rate)})`;
}

function fmtNumber(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

function badge(action) {
  const cls = action === "BUY" ? "buy" : action === "SELL" ? "sell" : "hold";
  const labelMap = { BUY: "매수", SELL: "매도", HOLD: "유지" };
  return el("span", { class: `badge ${cls}`, text: labelMap[action] || action });
}

async function fetchJSON(path) {
  // GitHub Pages는 CDN을 통해 서빙되므로 fetch의 cache 옵션만으로는 CDN 캐시를 우회할 수 없다.
  // 매 요청마다 고유한 쿼리 파라미터를 붙여 항상 최신 파일을 받아온다.
  const bustedUrl = path + (path.includes("?") ? "&" : "?") + "_=" + Date.now();
  const res = await fetch(bustedUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} 로드 실패 (${res.status})`);
  return res.json();
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

// ---------- GitHub commit ----------

async function commitJsonFile(path, dataObj, message) {
  const token = getToken();
  if (!token) throw new Error("먼저 GitHub 토큰을 저장하세요.");
  const apiBase = `https://api.github.com/repos/${SITE_CONFIG.owner}/${SITE_CONFIG.repo}/contents/${path}`;

  let sha;
  const getRes = await fetch(`${apiBase}?ref=${SITE_CONFIG.branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (getRes.ok) {
    const getJson = await getRes.json();
    sha = getJson.sha;
  } else if (getRes.status !== 404) {
    throw new Error(`파일 조회 실패 (${getRes.status})`);
  }

  const jsonText = JSON.stringify(dataObj, null, 2) + "\n";
  const content = btoa(unescape(encodeURIComponent(jsonText)));

  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, content, sha, branch: SITE_CONFIG.branch }),
  });
  if (!putRes.ok) {
    const errBody = await putRes.json().catch(() => ({}));
    throw new Error(`커밋 실패 (${putRes.status}): ${errBody.message || ""}`);
  }
  return putRes.json();
}

// ---------- token panel ----------

function initTokenPanel() {
  document.getElementById("repo-name").textContent = `${SITE_CONFIG.owner}/${SITE_CONFIG.repo}`;
  const statusEl = document.getElementById("pat-status");
  const input = document.getElementById("pat-input");

  function refreshStatus() {
    statusEl.textContent = getToken() ? "연결됨 (이 브라우저에만 저장됨)" : "연결 안 됨";
  }

  document.getElementById("pat-save").addEventListener("click", () => {
    const val = input.value.trim();
    if (!val) return;
    localStorage.setItem(TOKEN_KEY, val);
    input.value = "";
    refreshStatus();
  });

  document.getElementById("pat-clear").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    refreshStatus();
  });

  refreshStatus();
}

// ---------- tabs ----------

function initTabs() {
  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

// ---------- dual momentum rendering ----------

function renderDmStatus(latest) {
  const grid = document.getElementById("dm-status-grid");
  grid.innerHTML = "";
  const classes = latest.classes || [];
  const inMarketCount = classes.filter((c) => c.in_market).length;
  const stats = [
    ["기준일", latest.as_of || "-"],
    ["월말 리밸런싱", latest.is_rebalance_day ? "예" : "아니오"],
    ["안전자산", latest.safe_asset || "-"],
    ["위험자산 편입 자산군", classes.length ? `${inMarketCount} / ${classes.length}` : "-"],
    ["조회 기간", latest.lookback_months ? `${latest.lookback_months}개월` : "-"],
    ["총 평가금액", fmtMoneyKRW(latest.total_value, latest.usd_krw_rate)],
    ["환율(USD/KRW)", latest.usd_krw_rate ? fmtWon(latest.usd_krw_rate) : "-"],
  ];
  for (const [label, value] of stats) {
    grid.appendChild(el("div", { class: "stat" }, [el("span", { class: "label", text: label }), el("span", { class: "value", text: value })]));
  }
}

function renderDmClasses(latest) {
  const tbody = document.querySelector("#dm-classes-table tbody");
  tbody.innerHTML = "";
  (latest.classes || []).forEach((c) => {
    const candidateText = (c.candidates || [])
      .map((cand) => `${cand.ticker}(${fmtPercent(cand.return_lookback)})`)
      .join(", ");
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: c.name || "-" }),
        el("td", { text: fmtPercent(c.weight) }),
        el("td", { text: candidateText || "-" }),
        el("td", { text: c.selected_asset || "-" }),
        el("td", {}, [el("span", { class: `badge ${c.in_market ? "buy" : "hold"}`, text: c.in_market ? "편입" : "안전자산" })]),
      ])
    );
  });
}

function renderDmTargetAllocation(latest) {
  const tbody = document.querySelector("#dm-target-table tbody");
  tbody.innerHTML = "";
  (latest.target_allocation || []).forEach((t) => {
    tbody.appendChild(el("tr", {}, [el("td", { text: t.ticker }), el("td", { text: fmtPercent(t.weight) })]));
  });
}

function renderDmHoldings(latest) {
  const tbody = document.querySelector("#dm-holdings-table tbody");
  tbody.innerHTML = "";
  (latest.current_holdings_value || []).forEach((h) => {
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: h.ticker }),
        el("td", { text: fmtNumber(h.shares) }),
        el("td", { text: fmtMoney(h.price) }),
        el("td", { text: fmtMoney(h.value) }),
      ])
    );
  });
}

function renderDmActions(latest) {
  const tbody = document.querySelector("#dm-actions-table tbody");
  tbody.innerHTML = "";
  (latest.rebalance_actions || []).forEach((a) => {
    const tr = el("tr", {}, [
      el("td", { text: a.ticker }),
      el("td", {}, [badge(a.action)]),
      el("td", { text: fmtNumber(a.shares_delta) }),
      el("td", { text: fmtMoney(a.target_value) }),
      el("td", { text: fmtMoney(a.current_value) }),
    ]);
    tbody.appendChild(tr);
  });
}

async function loadDualMomentumLatest() {
  try {
    const latest = await fetchJSON("data/latest/dual_momentum.json");
    renderDmStatus(latest);
    renderDmClasses(latest);
    renderDmTargetAllocation(latest);
    renderDmHoldings(latest);
    renderDmActions(latest);
  } catch (e) {
    console.error(e);
  }
}

// ---------- dividend rendering ----------

function renderDvStatus(latest) {
  const grid = document.getElementById("dv-status-grid");
  grid.innerHTML = "";
  const stats = [
    ["기준일", latest.as_of || "-"],
    ["월말 리밸런싱", latest.is_rebalance_day ? "예" : "아니오"],
    ["총 평가금액", fmtMoneyKRW(latest.total_value, latest.usd_krw_rate)],
    ["현금", fmtMoneyKRW(latest.cash, latest.usd_krw_rate)],
    ["리밸런싱 임계값", fmtPercent(latest.drift_threshold)],
    ["환율(USD/KRW)", latest.usd_krw_rate ? fmtWon(latest.usd_krw_rate) : "-"],
  ];
  for (const [label, value] of stats) {
    grid.appendChild(el("div", { class: "stat" }, [el("span", { class: "label", text: label }), el("span", { class: "value", text: value })]));
  }
}

function renderDvHoldings(latest) {
  const tbody = document.querySelector("#dv-holdings-table tbody");
  tbody.innerHTML = "";
  (latest.holdings || []).forEach((h) => {
    const drift = (latest.target_vs_current || []).find((t) => t.ticker === h.ticker);
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: h.ticker }),
        el("td", { text: fmtNumber(h.shares) }),
        el("td", { text: h.avg_cost ? fmtMoney(h.avg_cost) : "-" }),
        el("td", { text: fmtMoney(h.price) }),
        el("td", { text: fmtMoney(h.value) }),
        el("td", { text: h.price_return === null || h.price_return === undefined ? "-" : fmtPercent(h.price_return) }),
        el("td", { text: fmtPercent(h.dividend_yield) }),
        el("td", { text: fmtPercent(h.current_weight) }),
        el("td", { text: fmtPercent(h.target_weight) }),
        el("td", { text: drift ? fmtPercent(drift.drift) : "-" }),
      ])
    );
  });
}

function renderDvActions(latest) {
  const tbody = document.querySelector("#dv-actions-table tbody");
  tbody.innerHTML = "";
  (latest.rebalance_actions || []).forEach((a) => {
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: a.ticker }),
        el("td", {}, [badge(a.action)]),
        el("td", { text: fmtNumber(a.shares_delta) }),
        el("td", { text: fmtMoney(a.target_value) }),
        el("td", { text: fmtMoney(a.current_value) }),
      ])
    );
  });
}

async function loadDividendLatest() {
  try {
    const latest = await fetchJSON("data/latest/dividend.json");
    renderDvStatus(latest);
    renderDvHoldings(latest);
    renderDvActions(latest);
  } catch (e) {
    console.error(e);
  }
}

// ---------- history ----------

async function initHistory(tab, selectId, detailId, renderFn) {
  const select = document.getElementById(selectId);
  try {
    const index = await fetchJSON(`data/history/${tab}/index.json`);
    const months = (index.months || []).slice().sort().reverse();
    months.forEach((m) => {
      const opt = el("option", { value: m, text: m });
      select.appendChild(opt);
    });
  } catch (e) {
    console.error(e);
  }

  select.addEventListener("change", async () => {
    const detail = document.getElementById(detailId);
    if (!select.value) {
      detail.textContent = "기록을 선택하세요.";
      return;
    }
    try {
      const data = await fetchJSON(`data/history/${tab}/${select.value}.json`);
      detail.innerHTML = "";
      detail.appendChild(renderFn(data));
    } catch (e) {
      detail.textContent = "기록을 불러오지 못했습니다.";
    }
  });
}

function renderDmHistoryDetail(data) {
  const wrap = el("div");
  wrap.appendChild(el("p", { text: `총 평가금액: ${fmtMoney(data.total_value)} · 안전자산: ${data.safe_asset || "-"}` }));
  const table = el("table");
  const thead = el("thead", {}, [el("tr", {}, [el("th", { text: "자산군" }), el("th", { text: "선택자산" }), el("th", { text: "비중" }), el("th", { text: "편입여부" })])]);
  const tbody = el("tbody");
  (data.classes || []).forEach((c) => {
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: c.name || "-" }),
        el("td", { text: c.selected_asset || "-" }),
        el("td", { text: fmtPercent(c.weight) }),
        el("td", { text: c.in_market ? "편입" : "안전자산" }),
      ])
    );
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderDvHistoryDetail(data) {
  const wrap = el("div");
  wrap.appendChild(el("p", { text: `총 평가금액: ${fmtMoney(data.total_value)} · 현금: ${fmtMoney(data.cash)}` }));
  const table = el("table");
  const thead = el("thead", {}, [el("tr", {}, [el("th", { text: "종목" }), el("th", { text: "현재비중" }), el("th", { text: "목표비중" }), el("th", { text: "드리프트" })])]);
  const tbody = el("tbody");
  (data.target_vs_current || []).forEach((t) => {
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: t.ticker }),
        el("td", { text: fmtPercent(t.current_weight) }),
        el("td", { text: fmtPercent(t.target_weight) }),
        el("td", { text: fmtPercent(t.drift) }),
      ])
    );
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ---------- config management: dual momentum ----------

function renderDmClassesList() {
  const container = document.getElementById("dm-classes-list");
  container.innerHTML = "";
  let sum = 0;
  state.dmConfig.asset_classes.forEach((c, idx) => {
    sum += c.weight || 0;
    container.appendChild(
      el("div", { class: "list-row" }, [
        el("span", { text: `${c.name} — 비중 ${fmtPercent(c.weight)} — 후보: ${(c.candidates || []).join(", ")}` }),
        el("button", { class: "danger", text: "삭제" }).also((btn) =>
          btn.addEventListener("click", () => {
            state.dmConfig.asset_classes.splice(idx, 1);
            renderDmClassesList();
          })
        ),
      ])
    );
  });
  const msgEl = document.getElementById("dm-weight-sum-msg");
  msgEl.textContent = `비중 합계: ${fmtPercent(sum)}` + (Math.abs(sum - 1) > 0.001 ? " (100%가 되도록 조정하세요)" : "");
}

function renderDmHoldingsList() {
  const container = document.getElementById("dm-holdings-list");
  container.innerHTML = "";
  state.dmConfig.holdings.forEach((h, idx) => {
    container.appendChild(
      el("div", { class: "list-row" }, [
        el("span", { text: `${h.ticker} — ${fmtNumber(h.shares)}주 @ ${fmtMoney(h.avg_cost)}` }),
        el("button", { class: "danger", text: "삭제" }).also((btn) =>
          btn.addEventListener("click", () => {
            state.dmConfig.holdings.splice(idx, 1);
            renderDmHoldingsList();
          })
        ),
      ])
    );
  });
}

function fillDmForm() {
  document.getElementById("dm-safe-asset").value = state.dmConfig.safe_asset || "";
  document.getElementById("dm-lookback").value = state.dmConfig.lookback_months;
  document.getElementById("dm-cash").value = state.dmConfig.cash;
  renderDmClassesList();
  renderDmHoldingsList();
}

function initDmManage() {
  document.getElementById("dm-class-add").addEventListener("click", () => {
    const name = document.getElementById("dm-class-name").value.trim();
    const weightPct = parseFloat(document.getElementById("dm-class-weight").value);
    const candidate1 = document.getElementById("dm-class-candidate1").value.trim().toUpperCase();
    const candidate2 = document.getElementById("dm-class-candidate2").value.trim().toUpperCase();
    const candidates = [candidate1, candidate2].filter(Boolean);
    if (!name || Number.isNaN(weightPct) || candidates.length === 0) return;
    state.dmConfig.asset_classes.push({ name, weight: weightPct / 100, candidates });
    document.getElementById("dm-class-name").value = "";
    document.getElementById("dm-class-weight").value = "";
    document.getElementById("dm-class-candidate1").value = "";
    document.getElementById("dm-class-candidate2").value = "";
    renderDmClassesList();
  });

  document.getElementById("dm-holding-add").addEventListener("click", () => {
    const ticker = document.getElementById("dm-holding-ticker").value.trim().toUpperCase();
    const shares = parseFloat(document.getElementById("dm-holding-shares").value);
    const avgCost = parseFloat(document.getElementById("dm-holding-cost").value) || 0;
    if (!ticker || Number.isNaN(shares)) return;
    state.dmConfig.holdings.push({ ticker, shares, avg_cost: avgCost });
    document.getElementById("dm-holding-ticker").value = "";
    document.getElementById("dm-holding-shares").value = "";
    document.getElementById("dm-holding-cost").value = "";
    renderDmHoldingsList();
  });

  document.getElementById("dm-save").addEventListener("click", async () => {
    const msgEl = document.getElementById("dm-save-msg");
    msgEl.textContent = "";
    msgEl.className = "";
    state.dmConfig.safe_asset = document.getElementById("dm-safe-asset").value.trim().toUpperCase() || "BIL";
    state.dmConfig.lookback_months = parseInt(document.getElementById("dm-lookback").value, 10) || 12;
    state.dmConfig.cash = parseFloat(document.getElementById("dm-cash").value) || 0;
    try {
      await commitJsonFile(CONFIG_PATHS.dual_momentum, state.dmConfig, "chore: update dual momentum config via web UI");
      msgEl.textContent = "저장되었습니다. 다음 Action 실행 시 최신 시세로 반영됩니다.";
      msgEl.className = "success-msg";
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "error-msg";
    }
  });
}

// ---------- config management: dividend ----------

function renderDvWatchlist() {
  const container = document.getElementById("dv-watchlist-list");
  container.innerHTML = "";
  let sum = 0;
  state.dvConfig.watchlist.forEach((w, idx) => {
    sum += w.target_weight || 0;
    container.appendChild(
      el("div", { class: "list-row" }, [
        el("span", { text: `${w.ticker} — 목표 ${fmtPercent(w.target_weight)}` }),
        el("button", { class: "danger", text: "삭제" }).also((btn) =>
          btn.addEventListener("click", () => {
            state.dvConfig.watchlist.splice(idx, 1);
            renderDvWatchlist();
          })
        ),
      ])
    );
  });
  const msgEl = document.getElementById("dv-weight-sum-msg");
  msgEl.textContent = `목표비중 합계: ${fmtPercent(sum)}` + (Math.abs(sum - 1) > 0.001 ? " (100%가 되도록 조정하세요)" : "");
}

function renderDvHoldingsList() {
  const container = document.getElementById("dv-holdings-list");
  container.innerHTML = "";
  state.dvConfig.holdings.forEach((h, idx) => {
    container.appendChild(
      el("div", { class: "list-row" }, [
        el("span", { text: `${h.ticker} — ${fmtNumber(h.shares)}주 @ ${fmtMoney(h.avg_cost)}` }),
        el("button", { class: "danger", text: "삭제" }).also((btn) =>
          btn.addEventListener("click", () => {
            state.dvConfig.holdings.splice(idx, 1);
            renderDvHoldingsList();
          })
        ),
      ])
    );
  });
}

function fillDvForm() {
  document.getElementById("dv-cash").value = state.dvConfig.cash;
  document.getElementById("dv-drift-threshold").value = (state.dvConfig.drift_threshold || 0) * 100;
  renderDvWatchlist();
  renderDvHoldingsList();
}

function initDvManage() {
  document.getElementById("dv-watch-add").addEventListener("click", () => {
    const ticker = document.getElementById("dv-watch-ticker").value.trim().toUpperCase();
    const weightPct = parseFloat(document.getElementById("dv-watch-weight").value);
    if (!ticker || Number.isNaN(weightPct)) return;
    state.dvConfig.watchlist.push({ ticker, target_weight: weightPct / 100 });
    document.getElementById("dv-watch-ticker").value = "";
    document.getElementById("dv-watch-weight").value = "";
    renderDvWatchlist();
  });

  document.getElementById("dv-holding-add").addEventListener("click", () => {
    const ticker = document.getElementById("dv-holding-ticker").value.trim().toUpperCase();
    const shares = parseFloat(document.getElementById("dv-holding-shares").value);
    const avgCost = parseFloat(document.getElementById("dv-holding-cost").value) || 0;
    if (!ticker || Number.isNaN(shares)) return;
    state.dvConfig.holdings.push({ ticker, shares, avg_cost: avgCost });
    document.getElementById("dv-holding-ticker").value = "";
    document.getElementById("dv-holding-shares").value = "";
    document.getElementById("dv-holding-cost").value = "";
    renderDvHoldingsList();
  });

  document.getElementById("dv-save").addEventListener("click", async () => {
    const msgEl = document.getElementById("dv-save-msg");
    msgEl.textContent = "";
    msgEl.className = "";
    state.dvConfig.cash = parseFloat(document.getElementById("dv-cash").value) || 0;
    state.dvConfig.drift_threshold = (parseFloat(document.getElementById("dv-drift-threshold").value) || 5) / 100;
    try {
      await commitJsonFile(CONFIG_PATHS.dividend, state.dvConfig, "chore: update dividend config via web UI");
      msgEl.textContent = "저장되었습니다. 다음 Action 실행 시 최신 시세로 반영됩니다.";
      msgEl.className = "success-msg";
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "error-msg";
    }
  });
}

// small helper to allow chaining .also() on elements built via el()
Element.prototype.also = function (fn) {
  fn(this);
  return this;
};

// ---------- dashboard ----------

const DASHBOARD_STRATEGIES = [
  { key: "dual_momentum", label: "듀얼모멘텀", color: "var(--accent)", autoBalance: true },
  { key: "dividend", label: "배당주", color: "#f59e0b", autoBalance: true },
  { key: "trend_following", label: "추세추종", color: "#8b5cf6", autoBalance: false },
];
const TOTAL_LABEL = "합계(원화환산)";
const TOTAL_COLOR = "#10b981";

function readOptionalNumber(id) {
  const inputEl = document.getElementById(id);
  if (!inputEl || inputEl.value === "") return undefined;
  const v = parseFloat(inputEl.value);
  return Number.isNaN(v) ? undefined : v;
}

async function loadYearHistoryMap(tab, year) {
  const map = {};
  try {
    const index = await fetchJSON(`data/history/${tab}/index.json`);
    const months = (index.months || []).filter((m) => m.startsWith(`${year}-`));
    await Promise.all(
      months.map(async (m) => {
        try {
          const data = await fetchJSON(`data/history/${tab}/${m}.json`);
          const monthNum = parseInt(m.split("-")[1], 10);
          map[monthNum] = { total_value: data.total_value, usd_krw_rate: data.usd_krw_rate };
        } catch (e) {
          // 해당 월 기록을 못 읽으면 무시하고 넘어감
        }
      })
    );
  } catch (e) {
    // index.json이 없으면 그냥 빈 맵 반환
  }
  return map;
}

function computeMonthReturn(balance, prevBalance, contribution) {
  if (balance === undefined || balance === null) return null;
  if (!prevBalance) return null;
  return (balance - prevBalance - (contribution || 0)) / prevBalance;
}

function defaultStrategyConfig(strategy) {
  return strategy.autoBalance ? { carryover: 0, contributions: {} } : { carryover: 0, contributions: {}, balances: {} };
}

function ensureYearConfig(year) {
  if (!state.dashboardConfig[year]) {
    state.dashboardConfig[year] = {};
  }
  const yearCfg = state.dashboardConfig[year];
  DASHBOARD_STRATEGIES.forEach((s) => {
    if (!yearCfg[s.key]) yearCfg[s.key] = defaultStrategyConfig(s);
  });
  return yearCfg;
}

function balanceForMonth(strategy, m) {
  if (strategy.autoBalance) {
    const entry = state.dashboardHistory[strategy.key][m];
    return entry ? entry.total_value : undefined;
  }
  return readOptionalNumber(`db-${strategy.key}-balance-${m}`);
}

function rateForMonth(strategy, m) {
  if (!strategy.autoBalance) return undefined;
  const entry = state.dashboardHistory[strategy.key][m];
  return entry ? entry.usd_krw_rate : undefined;
}

function firstAvailableRate(strategy) {
  for (let m = 1; m <= 12; m++) {
    const rate = rateForMonth(strategy, m);
    if (rate) return rate;
  }
  return undefined;
}

function krwBalanceForMonth(strategy, m) {
  const balance = balanceForMonth(strategy, m);
  if (balance === undefined) return undefined;
  if (!strategy.autoBalance) return balance;
  const rate = rateForMonth(strategy, m) || firstAvailableRate(strategy);
  return rate ? balance * rate : undefined;
}

function krwContributionForMonth(strategy, m) {
  const contribInput = document.getElementById(`db-${strategy.key}-contrib-${m}`);
  const contribution = parseFloat(contribInput?.value) || 0;
  if (!strategy.autoBalance) return contribution;
  const rate = rateForMonth(strategy, m) || firstAvailableRate(strategy);
  return rate ? contribution * rate : 0;
}

function combinedCarryoverKRW() {
  let total = 0;
  DASHBOARD_STRATEGIES.forEach((s) => {
    const carryoverInput = document.getElementById(`db-${s.key}-carryover`);
    const carryover = parseFloat(carryoverInput.value) || 0;
    if (!s.autoBalance) {
      total += carryover;
    } else {
      const rate = firstAvailableRate(s);
      if (rate) total += carryover * rate;
    }
  });
  return total;
}

function collectCombinedReturns() {
  let prevBalance = combinedCarryoverKRW();
  const returns = [];
  for (let m = 1; m <= 12; m++) {
    const parts = DASHBOARD_STRATEGIES.map((s) => krwBalanceForMonth(s, m));
    const anyDefined = parts.some((v) => v !== undefined);
    const balance = anyDefined ? parts.reduce((sum, v) => sum + (v || 0), 0) : undefined;
    const contribution = DASHBOARD_STRATEGIES.reduce((sum, s) => sum + krwContributionForMonth(s, m), 0);
    returns.push(computeMonthReturn(balance, prevBalance, contribution));
    if (balance !== undefined) prevBalance = balance;
  }
  return returns;
}

function updateDashboardReturns() {
  const year = state.dashboardYear;
  ensureYearConfig(year);
  DASHBOARD_STRATEGIES.forEach((s) => {
    const carryoverInput = document.getElementById(`db-${s.key}-carryover`);
    const carryover = parseFloat(carryoverInput.value) || 0;
    let prevBalance = carryover;
    for (let m = 1; m <= 12; m++) {
      const balance = balanceForMonth(s, m);
      const contribInput = document.getElementById(`db-${s.key}-contrib-${m}`);
      const contribution = parseFloat(contribInput.value) || 0;
      const returnEl = document.getElementById(`db-${s.key}-return-${m}`);
      const ret = computeMonthReturn(balance, prevBalance, contribution);
      returnEl.textContent = ret === null ? "-" : fmtPercent(ret);
      returnEl.style.color = ret === null ? "" : ret >= 0 ? "var(--positive)" : "var(--negative)";
      if (balance !== undefined) prevBalance = balance;
    }
  });

  document.getElementById("db-total-carryover-display").textContent = fmtWon(combinedCarryoverKRW());
  let prevTotalBalance = combinedCarryoverKRW();
  for (let m = 1; m <= 12; m++) {
    const parts = DASHBOARD_STRATEGIES.map((s) => krwBalanceForMonth(s, m));
    const anyDefined = parts.some((v) => v !== undefined);
    const totalBalance = anyDefined ? parts.reduce((sum, v) => sum + (v || 0), 0) : undefined;
    const totalContribution = DASHBOARD_STRATEGIES.reduce((sum, s) => sum + krwContributionForMonth(s, m), 0);

    document.getElementById(`db-total-balance-${m}`).textContent = totalBalance !== undefined ? fmtWon(totalBalance) : "-";
    document.getElementById(`db-total-contrib-${m}`).textContent = fmtWon(totalContribution);

    const returnEl = document.getElementById(`db-total-return-${m}`);
    const ret = computeMonthReturn(totalBalance, prevTotalBalance, totalContribution);
    returnEl.textContent = ret === null ? "-" : fmtPercent(ret);
    returnEl.style.color = ret === null ? "" : ret >= 0 ? "var(--positive)" : "var(--negative)";
    if (totalBalance !== undefined) prevTotalBalance = totalBalance;
  }

  renderDashboardChart();
}

function collectMonthReturns(strategy) {
  const yearCfg = ensureYearConfig(state.dashboardYear);
  const carryoverInput = document.getElementById(`db-${strategy.key}-carryover`);
  const carryover = parseFloat(carryoverInput?.value) || yearCfg[strategy.key].carryover || 0;
  let prevBalance = carryover;
  const returns = [];
  for (let m = 1; m <= 12; m++) {
    const balance = balanceForMonth(strategy, m);
    const contribInput = document.getElementById(`db-${strategy.key}-contrib-${m}`);
    const contribution = parseFloat(contribInput?.value) || yearCfg[strategy.key].contributions[m] || 0;
    returns.push(computeMonthReturn(balance, prevBalance, contribution));
    if (balance !== undefined) prevBalance = balance;
  }
  return returns;
}

function renderDashboardChart() {
  const seriesList = DASHBOARD_STRATEGIES.map((s) => ({ label: s.label, color: s.color, values: collectMonthReturns(s) }));
  seriesList.push({ label: TOTAL_LABEL, color: TOTAL_COLOR, values: collectCombinedReturns() });
  document.getElementById("db-chart").innerHTML = buildReturnChartSVG(seriesList);
}

function buildReturnChartSVG(seriesList) {
  const width = 640;
  const height = 220;
  const padL = 44;
  const padR = 16;
  const padT = 20;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allValues = seriesList.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  if (allValues.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="var(--text-muted)" font-size="13">아직 표시할 데이터가 없습니다.</text></svg>`;
  }

  let minV = Math.min(0, ...allValues);
  let maxV = Math.max(0, ...allValues);
  if (minV === maxV) {
    minV -= 0.01;
    maxV += 0.01;
  }
  const pad = (maxV - minV) * 0.15;
  minV -= pad;
  maxV += pad;

  const xFor = (i) => padL + (plotW * i) / 11;
  const yFor = (v) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;

  const buildPath = (values) => {
    let d = "";
    values.forEach((v, i) => {
      if (v === null || v === undefined) return;
      d += `${d === "" ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)} `;
    });
    return d.trim();
  };

  const buildDots = (values, color) =>
    values
      .map((v, i) => (v === null || v === undefined ? "" : `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="3" fill="${color}" />`))
      .join("");

  const zeroY = yFor(0).toFixed(1);
  const monthLabels = Array.from({ length: 12 }, (_, i) => `<text x="${xFor(i).toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${i + 1}월</text>`).join("");

  const lines = seriesList
    .map((s) => `<path d="${buildPath(s.values)}" fill="none" stroke="${s.color}" stroke-width="2" />${buildDots(s.values, s.color)}`)
    .join("");

  let legendX = 0;
  const legend = seriesList
    .map((s) => {
      const item = `<circle cx="${legendX}" cy="0" r="3" fill="${s.color}" /><text x="${legendX + 8}" y="4" font-size="10" fill="var(--text)">${s.label}</text>`;
      legendX += 20 + s.label.length * 11;
      return item;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">
      <line x1="${padL}" y1="${zeroY}" x2="${width - padR}" y2="${zeroY}" stroke="var(--border)" stroke-width="1" stroke-dasharray="4 3" />
      <text x="${padL - 6}" y="${(parseFloat(zeroY) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted)">0%</text>
      ${monthLabels}
      ${lines}
      <g transform="translate(${padL},10)">
        ${legend}
      </g>
    </svg>`;
}

async function renderDashboardTable() {
  const year = state.dashboardYear;
  const yearCfg = ensureYearConfig(year);

  const autoStrategies = DASHBOARD_STRATEGIES.filter((s) => s.autoBalance);
  const historyResults = await Promise.all(autoStrategies.map((s) => loadYearHistoryMap(s.key, year)));
  state.dashboardHistory = {};
  autoStrategies.forEach((s, i) => {
    state.dashboardHistory[s.key] = historyResults[i];
  });

  const tbody = document.getElementById("db-table-body");
  tbody.innerHTML = "";

  const carryoverCells = [el("td", { text: "이월금액" })];
  DASHBOARD_STRATEGIES.forEach((s) => {
    carryoverCells.push(
      el("td", {}, [el("input", { type: "number", id: `db-${s.key}-carryover`, value: String(yearCfg[s.key].carryover || 0), step: "0.01" })])
    );
    carryoverCells.push(el("td", { text: "-" }));
    carryoverCells.push(el("td", { text: "-" }));
  });
  carryoverCells.push(el("td", { id: "db-total-carryover-display", text: "-" }));
  carryoverCells.push(el("td", { text: "-" }));
  carryoverCells.push(el("td", { text: "-" }));
  tbody.appendChild(el("tr", {}, carryoverCells));

  for (let m = 1; m <= 12; m++) {
    const rowCells = [el("td", { text: `${m}월` })];
    DASHBOARD_STRATEGIES.forEach((s) => {
      if (s.autoBalance) {
        const entry = state.dashboardHistory[s.key][m];
        rowCells.push(el("td", { id: `db-${s.key}-balance-${m}`, text: entry !== undefined ? fmtMoney(entry.total_value) : "-" }));
      } else {
        const stored = (yearCfg[s.key].balances || {})[m];
        rowCells.push(
          el("td", {}, [
            el("input", {
              type: "number",
              id: `db-${s.key}-balance-${m}`,
              value: stored !== undefined ? String(stored) : "",
              placeholder: "금액",
              step: "0.01",
            }),
          ])
        );
      }
      rowCells.push(
        el("td", {}, [
          el("input", {
            type: "number",
            id: `db-${s.key}-contrib-${m}`,
            value: String((yearCfg[s.key].contributions || {})[m] || 0),
            step: "0.01",
          }),
        ])
      );
      rowCells.push(el("td", { id: `db-${s.key}-return-${m}`, text: "-" }));
    });
    rowCells.push(el("td", { id: `db-total-balance-${m}`, text: "-" }));
    rowCells.push(el("td", { id: `db-total-contrib-${m}`, text: "-" }));
    rowCells.push(el("td", { id: `db-total-return-${m}`, text: "-" }));
    tbody.appendChild(el("tr", {}, rowCells));
  }

  tbody.addEventListener("input", updateDashboardReturns);
  updateDashboardReturns();
}

function collectDashboardFormIntoConfig() {
  const year = state.dashboardYear;
  const yearCfg = ensureYearConfig(year);
  DASHBOARD_STRATEGIES.forEach((s) => {
    yearCfg[s.key].carryover = parseFloat(document.getElementById(`db-${s.key}-carryover`).value) || 0;
    const contributions = {};
    for (let m = 1; m <= 12; m++) {
      const val = parseFloat(document.getElementById(`db-${s.key}-contrib-${m}`).value) || 0;
      if (val) contributions[m] = val;
    }
    yearCfg[s.key].contributions = contributions;

    if (!s.autoBalance) {
      const balances = {};
      for (let m = 1; m <= 12; m++) {
        const v = readOptionalNumber(`db-${s.key}-balance-${m}`);
        if (v !== undefined) balances[m] = v;
      }
      yearCfg[s.key].balances = balances;
    }
  });
}

function initDashboard() {
  document.getElementById("db-year").value = state.dashboardYear;

  document.getElementById("db-load-year").addEventListener("click", async () => {
    const year = parseInt(document.getElementById("db-year").value, 10) || new Date().getFullYear();
    state.dashboardYear = year;
    await renderDashboardTable();
  });

  document.getElementById("db-save").addEventListener("click", async () => {
    const msgEl = document.getElementById("db-save-msg");
    msgEl.textContent = "";
    msgEl.className = "";
    collectDashboardFormIntoConfig();
    try {
      await commitJsonFile(CONFIG_PATHS.dashboard, state.dashboardConfig, "chore: update dashboard contributions via web UI");
      msgEl.textContent = "저장되었습니다.";
      msgEl.className = "success-msg";
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "error-msg";
    }
  });
}

// ---------- init ----------

async function init() {
  initTokenPanel();
  initTabs();

  await Promise.all([loadDualMomentumLatest(), loadDividendLatest()]);

  initHistory("dual_momentum", "dm-history-select", "dm-history-detail", renderDmHistoryDetail);
  initHistory("dividend", "dv-history-select", "dv-history-detail", renderDvHistoryDetail);

  try {
    state.dmConfig = await fetchJSON(CONFIG_PATHS.dual_momentum.replace("docs/", ""));
    fillDmForm();
    initDmManage();
  } catch (e) {
    console.error(e);
  }

  try {
    state.dvConfig = await fetchJSON(CONFIG_PATHS.dividend.replace("docs/", ""));
    fillDvForm();
    initDvManage();
  } catch (e) {
    console.error(e);
  }

  try {
    state.dashboardConfig = await fetchJSON(CONFIG_PATHS.dashboard.replace("docs/", ""));
  } catch (e) {
    state.dashboardConfig = {};
  }
  initDashboard();
  await renderDashboardTable();
}

document.addEventListener("DOMContentLoaded", init);
