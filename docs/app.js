const TOKEN_KEY = "moneyrebalance_pat";
const CONFIG_PATHS = {
  dual_momentum: "docs/data/config/dual_momentum.json",
  dividend: "docs/data/config/dividend.json",
};

const state = {
  dmConfig: null,
  dvConfig: null,
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
  const stats = [
    ["기준일", latest.as_of || "-"],
    ["월말 리밸런싱", latest.is_rebalance_day ? "예" : "아니오"],
    ["선택 자산", latest.selected_asset || "-"],
    ["시장 진입 여부", latest.in_market === null || latest.in_market === undefined ? "-" : latest.in_market ? "위험자산 편입" : "안전자산 대피"],
    ["조회 기간", latest.lookback_months ? `${latest.lookback_months}개월` : "-"],
    ["총 평가금액", fmtMoney(latest.total_value)],
  ];
  for (const [label, value] of stats) {
    grid.appendChild(el("div", { class: "stat" }, [el("span", { class: "label", text: label }), el("span", { class: "value", text: value })]));
  }
}

function renderDmSignals(latest) {
  const tbody = document.querySelector("#dm-signals-table tbody");
  tbody.innerHTML = "";
  (latest.signals || []).forEach((s) => {
    const isSelected = s.ticker === latest.selected_asset;
    const isSafe = s.ticker === latest.safe_asset;
    const tag = isSelected ? "선택됨" : isSafe ? "안전자산" : "";
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: `${s.ticker} ${isSelected ? "★" : ""}` }),
        el("td", { text: tag || s.label || "-" }),
        el("td", { text: fmtPercent(s.return_lookback) }),
      ])
    );
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
    renderDmSignals(latest);
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
    ["총 평가금액", fmtMoney(latest.total_value)],
    ["현금", fmtMoney(latest.cash)],
    ["리밸런싱 임계값", fmtPercent(latest.drift_threshold)],
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
  wrap.appendChild(el("p", { text: `선택 자산: ${data.selected_asset || "-"} (${data.in_market ? "위험자산 편입" : "안전자산 대피"}) · 총 평가금액: ${fmtMoney(data.total_value)}` }));
  const table = el("table");
  const thead = el("thead", {}, [el("tr", {}, [el("th", { text: "자산" }), el("th", { text: "수익률" })])]);
  const tbody = el("tbody");
  (data.signals || []).forEach((s) => {
    tbody.appendChild(el("tr", {}, [el("td", { text: s.ticker }), el("td", { text: fmtPercent(s.return_lookback) })]));
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

function renderDmUniverseList() {
  const container = document.getElementById("dm-universe-list");
  container.innerHTML = "";
  state.dmConfig.universe.forEach((u, idx) => {
    const isSafe = u.ticker === state.dmConfig.safe_asset;
    container.appendChild(
      el("div", { class: "list-row" }, [
        el("span", { text: `${u.ticker} — ${u.label || ""} ${isSafe ? "(안전자산)" : ""}` }),
        el("button", { class: "danger", text: "삭제" }).also((btn) =>
          btn.addEventListener("click", () => {
            state.dmConfig.universe.splice(idx, 1);
            if (isSafe) state.dmConfig.safe_asset = state.dmConfig.universe[0]?.ticker || "";
            renderDmUniverseList();
          })
        ),
      ])
    );
  });
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
  document.getElementById("dm-lookback").value = state.dmConfig.lookback_months;
  document.getElementById("dm-cash").value = state.dmConfig.cash;
  renderDmUniverseList();
  renderDmHoldingsList();
}

function initDmManage() {
  document.getElementById("dm-universe-add").addEventListener("click", () => {
    const ticker = document.getElementById("dm-universe-ticker").value.trim().toUpperCase();
    const label = document.getElementById("dm-universe-label").value.trim();
    const isSafe = document.getElementById("dm-universe-safe").checked;
    if (!ticker) return;
    state.dmConfig.universe.push({ ticker, label });
    if (isSafe) state.dmConfig.safe_asset = ticker;
    document.getElementById("dm-universe-ticker").value = "";
    document.getElementById("dm-universe-label").value = "";
    document.getElementById("dm-universe-safe").checked = false;
    renderDmUniverseList();
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
}

document.addEventListener("DOMContentLoaded", init);
