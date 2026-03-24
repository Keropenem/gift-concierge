// ── 共通関数（Version A / Version B 共用） ──

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

function addMessage(messagesEl, role, text, items) {
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
            ${item.product_url ? `<a href="${escapeHtml(item.product_url)}" target="_blank" rel="noopener" class="item-link">商品を見る</a>` : ""}
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
