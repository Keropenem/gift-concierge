// ── 共通関数（Version A / Version B 共用） ──

// ── デバッグモード管理 ──
let _debugMode = false;

async function toggleDebugMode() {
  const res = await fetch("/api/debug", { method: "POST" });
  const data = await res.json();
  _debugMode = data.debug;
  const btn = document.getElementById("debug-toggle");
  if (btn) {
    btn.textContent = _debugMode ? "Debug: ON" : "Debug: OFF";
    btn.classList.toggle("debug-on", _debugMode);
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
  } catch {}
}

function renderDebugPanel(debugData) {
  if (!debugData || !debugData.length) return;

  // 既存パネルがあれば削除
  const existing = document.getElementById("debug-panel");
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.id = "debug-panel";
  panel.className = "debug-panel";

  let html = '<div class="debug-header"><span>Debug Trace</span><button onclick="this.parentElement.parentElement.remove()">✕</button></div>';
  html += '<div class="debug-body">';

  debugData.forEach((step, i) => {
    const stepName = step.step || "unknown";
    const elapsed = step.elapsed_sec || 0;

    // ステップ名をカラーコード
    let color = "#888";
    if (stepName.includes("error") || stepName.includes("fail")) color = "#e74c3c";
    else if (stepName.includes("done") || stepName.includes("result") || stepName.includes("success")) color = "#27ae60";
    else if (stepName.includes("start") || stepName.includes("try")) color = "#3498db";
    else if (stepName.includes("skip") || stepName.includes("reject")) color = "#f39c12";

    // ステップの詳細データ（step, elapsed_sec以外）
    const details = {};
    for (const [k, v] of Object.entries(step)) {
      if (k !== "step" && k !== "elapsed_sec") details[k] = v;
    }

    html += `<div class="debug-step">`;
    html += `<div class="debug-step-header" onclick="this.nextElementSibling.classList.toggle('open')">`;
    html += `<span class="debug-step-num">${i + 1}</span>`;
    html += `<span class="debug-step-name" style="color:${color}">${escapeHtml(stepName)}</span>`;
    html += `<span class="debug-step-time">${elapsed}s</span>`;

    // 主要な値のプレビュー
    const preview = _debugPreview(stepName, details);
    if (preview) html += `<span class="debug-step-preview">${escapeHtml(preview)}</span>`;

    html += `</div>`;
    html += `<pre class="debug-step-detail">${escapeHtml(JSON.stringify(details, null, 2))}</pre>`;
    html += `</div>`;
  });

  html += '</div>';
  panel.innerHTML = html;
  document.body.appendChild(panel);
}

function _debugPreview(stepName, details) {
  if (stepName === "generation_done") {
    const urls = details.urls_in_text || [];
    return `${details.reply_length || 0} chars, ${urls.length} URLs, delim=${details.has_items_delimiter}`;
  }
  if (stepName === "parse_response") {
    return `${details.items_found || 0} items: ${(details.item_names || []).join(", ")}`;
  }
  if (stepName === "extraction_done") {
    return `${details.items_found || 0} items, URLs: [${(details.item_urls || []).map(u => u || "EMPTY").join(", ")}]`;
  }
  if (stepName === "url_injection") {
    return `raw: ${details.raw_urls_found || 0}, filtered: ${(details.filtered_urls || []).length}`;
  }
  if (stepName === "url_finder_start") {
    return `${details.target_count || 0} targets`;
  }
  if (stepName === "url_finder_result") {
    return `assigned: ${(details.assigned || []).length}`;
  }
  if (stepName === "url_finder_error") {
    return details.error || "";
  }
  if (stepName === "verify_start") {
    return `${details.items_with_url || 0} URLs to verify`;
  }
  if (stepName === "verify_result") {
    const d = details.details || [];
    return d.map(x => `${x.name}: ${x.result}`).join(", ");
  }
  if (stepName === "retry_decision") {
    return `broken=${details.broken_count}, no_url=${details.no_url_count}, retry=${details.will_retry}`;
  }
  return "";
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

  // デバッグデータがあればパネル表示
  if (debugData && debugData.length) {
    renderDebugPanel(debugData);
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
