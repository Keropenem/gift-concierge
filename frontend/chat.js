// ── Version A: チャット形式 ──

const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const resetBtn = document.getElementById("reset-btn");

let sessionId = localStorage.getItem("gc-session") || crypto.randomUUID();
localStorage.setItem("gc-session", sessionId);

let sending = false;

// 初回挨拶
addMessage(messagesEl, "ai", "こんにちは。ギフトコンシェルジュです。どなたに、どんなきっかけで贈り物をお考えですか？");

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

  addMessage(messagesEl, "user", text);
  userInput.value = "";
  userInput.style.height = "auto";
  sendBtn.disabled = true;
  sending = true;

  const thinkingEl = addThinking(messagesEl);

  try {
    const data = await sendChat(sessionId, text);
    thinkingEl.remove();

    if (data.session_id) {
      sessionId = data.session_id;
      localStorage.setItem("gc-session", sessionId);
    }

    addMessage(messagesEl, "ai", data.reply, data.items, data._debug);
  } catch (err) {
    thinkingEl.remove();
    addMessage(messagesEl, "error", err.message);
  } finally {
    sending = false;
    sendBtn.disabled = !userInput.value.trim();
    userInput.focus();
  }
});

// リセット
resetBtn.addEventListener("click", async () => {
  await resetSession(sessionId);
  sessionId = crypto.randomUUID();
  localStorage.setItem("gc-session", sessionId);
  messagesEl.innerHTML = "";
  addMessage(messagesEl, "ai", "こんにちは。ギフトコンシェルジュです。どなたに、どんなきっかけで贈り物をお考えですか？");
});
