// ── 共通関数（Version A / Version B 共用） ──

// ── デバッグモード管理 ──
let _debugMode = false;
let _lastDebugData = null;
let _debugSSE = null;
let _debugEntries = [];

async function toggleDebugMode() {
  const res = await fetch("/api/debug", { method: "POST" });
  const data = await res.json();
  _debugMode = data.debug;
  const btn = document.getElementById("debug-toggle");
  if (btn) {
    btn.textContent = _debugMode ? "Debug: ON" : "Debug: OFF";
    btn.classList.toggle("debug-on", _debugMode);
  }
  // パネル表示切り替え
  const panel = document.getElementById("debug-panel");
  if (panel) {
    panel.style.display = _debugMode ? "" : "none";
  }
  // デバッグON時はSSE接続開始
  if (_debugMode) {
    connectDebugSSE();
  } else {
    disconnectDebugSSE();
  }
  return _debugMode;
}

async function checkDebugMode() {
  try {
    const res = await fetch("/api/debug");
    const data = await res.json();
    _debugMode = data.debug;
    const btn = document.getElementById("debug-toggle");
    if (btn) {
      btn.textContent = _debugMode ? "Debug: ON" : "Debug: OFF";
      btn.classList.toggle("debug-on", _debugMode);
    }
    const panel = document.getElementById("debug-panel");
    if (panel) {
      panel.style.display = _debugMode ? "" : "none";
    }
    if (_debugMode) {
      connectDebugSSE();
    }
  } catch {}
}

function getSessionId() {
  // chat.js / form.js がグローバルに sessionId を持っている
  return typeof sessionId !== "undefined" ? sessionId : "";
}

function connectDebugSSE() {
  disconnectDebugSSE();
  const sid = getSessionId();
  if (!sid) return;
  _debugSSE = new EventSource(`/api/debug/stream?session_id=${encodeURIComponent(sid)}`);
  _debugSSE.addEventListener("debug", (e) => {
    try {
      const entry = JSON.parse(e.data);
      _debugEntries.push(entry);
      appendDebugEntry(entry);
    } catch {}
  });
  _debugSSE.onerror = () => {
    // 自動再接続はEventSourceがやる
  };
}

function disconnectDebugSSE() {
  if (_debugSSE) {
    _debugSSE.close();
    _debugSSE = null;
  }
}

function appendDebugEntry(entry) {
  const log = document.getElementById("debug-log");
  if (!log) return;
  const line = document.createElement("div");
  line.className = "debug-entry";

  const elapsed = entry.elapsed_sec != null ? `${entry.elapsed_sec}s` : "";
  const duration = entry.duration_sec != null && entry.duration_sec >= 0.1 ? `+${entry.duration_sec}s` : "";
  const stepName = entry.step || "?";

  // ステップ名と経過時間
  const header = document.createElement("span");
  header.className = "debug-entry-header";
  header.textContent = `[${elapsed}] ${stepName}`;

  // 所要時間バッジ（0.1秒以上のみ表示）
  if (duration) {
    const badge = document.createElement("span");
    badge.className = "debug-duration";
    badge.textContent = duration;
    header.appendChild(document.createTextNode(" "));
    header.appendChild(badge);
  }
  line.appendChild(header);

  // データ部分（step, elapsed_sec, duration_sec以外）- クリックで展開
  const extra = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k !== "step" && k !== "elapsed_sec" && k !== "duration_sec") extra[k] = v;
  }
  if (Object.keys(extra).length > 0) {
    // 短いサマリーをヘッダー横に表示
    const keys = Object.keys(extra);
    const summary = keys.slice(0, 3).map(k => {
      const v = extra[k];
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${s.length > 30 ? s.slice(0, 30) + "…" : s}`;
    }).join(", ");
    const summarySpan = document.createElement("span");
    summarySpan.className = "debug-entry-summary";
    summarySpan.textContent = ` ${summary}`;
    header.appendChild(summarySpan);

    const detail = document.createElement("pre");
    detail.className = "debug-entry-data";
    detail.style.display = "none";
    detail.textContent = JSON.stringify(extra, null, 2);
    line.appendChild(detail);

    // クリックで展開/折りたたみ
    header.style.cursor = "pointer";
    header.addEventListener("click", () => {
      detail.style.display = detail.style.display === "none" ? "" : "none";
    });
  }

  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function clearDebugLog() {
  _debugEntries = [];
  const log = document.getElementById("debug-log");
  if (log) log.innerHTML = "";
}

function copyDebugTrace() {
  const data = _debugEntries.length ? _debugEntries : _lastDebugData;
  if (!data || !data.length) return;
  const text = data.map(step => JSON.stringify(step, null, 2)).join("\n");
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("debug-copy");
    if (btn) {
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy Trace"; }, 1500);
    }
  });
}


function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatPrice(item) {
  const min = item.price_min;
  const max = item.price_max;
  if (!min) return "";

  const currency = (item.actual_currency || "").toUpperCase();
  const symbols = { JPY: "¥", USD: "$", AUD: "A$", EUR: "€", GBP: "£", KRW: "₩", CNY: "¥" };
  const sym = symbols[currency] || (currency ? currency + " " : "¥");
  const isYen = !currency || currency === "JPY";

  const fmtNum = (n) => Number(n).toLocaleString();

  if (min === max || !max) {
    return isYen ? `${fmtNum(min)}円` : `${sym}${fmtNum(min)}`;
  }
  return isYen
    ? `${fmtNum(min)}円〜${fmtNum(max)}円`
    : `${sym}${fmtNum(min)}〜${sym}${fmtNum(max)}`;
}

function addMessage(messagesEl, role, text, items, debugData) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg msg-${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  if (items && items.length > 0) {
    const cardsContainer = document.createElement("div");
    cardsContainer.className = "item-cards";

    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "item-card";

      const priceText = formatPrice(item);

      const imageHtml = item.image_url
        ? `<div class="item-image"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name || "")}" onerror="this.parentElement.style.display='none'"></div>`
        : "";

      card.innerHTML = `
        ${imageHtml}
        <div class="item-body">
          <div class="item-name">${escapeHtml(item.name || "")}</div>
          <div class="item-reasoning">${escapeHtml(item.reasoning || "")}</div>
          ${priceText ? `<div class="item-price">${priceText}</div>` : ""}
          ${item.tip ? `<div class="item-tip">${escapeHtml(item.tip)}</div>` : ""}
          <div class="item-actions">
            ${item.product_url ? `<a href="${escapeHtml(item.product_url)}" target="_blank" rel="noopener" class="item-link">${item.url_type === "official" ? "公式サイト" : "商品を見る"}</a>` : ""}
            ${item.search_keyword ? `<a href="https://www.google.com/search?q=${encodeURIComponent(item.search_keyword)}" target="_blank" rel="noopener" class="item-search">検索する</a>` : ""}
          </div>
        </div>
      `;
      cardsContainer.appendChild(card);
    });

    wrapper.appendChild(cardsContainer);
  }

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // デバッグデータを保存
  if (debugData && debugData.length) {
    _lastDebugData = debugData;
  }

  return wrapper;
}

function addThinking(messagesEl) {
  const wrapper = document.createElement("div");
  wrapper.className = "msg msg-ai";
  wrapper.innerHTML = '<div class="bubble thinking"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrapper;
}

async function sendChat(sessionId, message) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Id": sessionId,
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `エラー [${res.status}]`);
  }

  return await res.json();
}

async function resetSession(sessionId) {
  await fetch("/api/reset", {
    method: "POST",
    headers: { "X-Session-Id": sessionId },
  }).catch(() => {});
}

// 初期化時にデバッグ状態を確認
checkDebugMode();
