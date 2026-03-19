const messages = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const resetBtn = document.getElementById("reset-btn");

let sessionId = localStorage.getItem("gc-session") || crypto.randomUUID();
localStorage.setItem("gc-session", sessionId);

let sending = false;

// 初回挨拶
addMessage("ai", "こんにちは。ギフトコンシェルジュです。どなたに、どんなきっかけで贈り物をお考えですか？");

// 入力欄の自動リサイズ & 送信ボタン制御
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
  sendBtn.disabled = !userInput.value.trim();
});

// Enter で送信（Shift+Enter で改行）
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (userInput.value.trim() && !sending) {
      chatForm.dispatchEvent(new Event("submit"));
    }
  }
});

// 送信
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text || sending) return;

  addMessage("user", text);
  userInput.value = "";
  userInput.style.height = "auto";
  sendBtn.disabled = true;
  sending = true;

  const thinkingEl = addThinking();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": sessionId,
      },
      body: JSON.stringify({ message: text }),
    });

    thinkingEl.remove();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `エラー [${res.status}]`);
    }

    const data = await res.json();

    if (data.session_id) {
      sessionId = data.session_id;
      localStorage.setItem("gc-session", sessionId);
    }

    addMessage("ai", data.reply, data.items);
  } catch (err) {
    thinkingEl.remove();
    addMessage("error", err.message);
  } finally {
    sending = false;
    sendBtn.disabled = !userInput.value.trim();
    userInput.focus();
  }
});

// リセット
resetBtn.addEventListener("click", async () => {
  await fetch("/api/reset", {
    method: "POST",
    headers: { "X-Session-Id": sessionId },
  }).catch(() => {});

  sessionId = crypto.randomUUID();
  localStorage.setItem("gc-session", sessionId);
  messages.innerHTML = "";
  addMessage("ai", "こんにちは。ギフトコンシェルジュです。どなたに、どんなきっかけで贈り物をお考えですか？");
});

// メッセージ追加
function addMessage(role, text, items) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg msg-${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  // 商品カード
  if (items && items.length > 0) {
    const cardsContainer = document.createElement("div");
    cardsContainer.className = "item-cards";

    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "item-card";

      const priceText =
        item.price_min && item.price_max
          ? `${Number(item.price_min).toLocaleString()}円〜${Number(item.price_max).toLocaleString()}円`
          : "";

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

  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
  return wrapper;
}

// 思考中インジケーター
function addThinking() {
  const wrapper = document.createElement("div");
  wrapper.className = "msg msg-ai";
  wrapper.innerHTML = '<div class="bubble thinking"><span></span><span></span><span></span></div>';
  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
  return wrapper;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
