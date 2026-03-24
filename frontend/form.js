// ── Version B: フォーム → チャット形式 ──

const formPhase = document.getElementById("form-phase");
const chatPhase = document.getElementById("chat-phase");
const chatFooter = document.getElementById("chat-footer");
const giftForm = document.getElementById("gift-form");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const resetBtn = document.getElementById("reset-btn");

let sessionId = localStorage.getItem("gc-session-form") || crypto.randomUUID();
localStorage.setItem("gc-session-form", sessionId);

let sending = false;

// 海外選択時に国名フィールド表示
document.getElementById("location").addEventListener("change", (e) => {
  document.getElementById("country-row").style.display =
    e.target.value === "海外" ? "" : "none";
});

// フォーム送信 → チャットに遷移
giftForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const relationship = document.getElementById("relationship").value;
  const gender = document.querySelector('input[name="gender"]:checked')?.value || "";
  const age = document.getElementById("age").value;
  const budget = document.getElementById("budget").value;
  const location = document.getElementById("location").value;
  const country = document.getElementById("country").value.trim();
  const recipientDetail = document.getElementById("recipient-detail").value.trim();
  const senderDetail = document.getElementById("sender-detail").value.trim();
  const situation = document.getElementById("situation").value.trim();

  const locationText = location === "海外" && country ? `海外（${country}）` : location;

  // 構造化 + 自由テキストを1メッセージに変換
  const parts = [
    `【相手】${relationship}`,
    gender ? `${gender}` : "",
    age ? `${age}` : "",
    `【予算】${budget}`,
    `【購入場所】${locationText}`,
    recipientDetail ? `【相手の人物像】${recipientDetail}` : "",
    senderDetail ? `【自分について】${senderDetail}` : "",
    situation ? `【きっかけ・気持ち】${situation}` : "",
  ].filter(Boolean);

  // 相手の基本情報をまとめる
  const line1Parts = [relationship];
  if (age) line1Parts.push(age);
  if (gender && gender !== "未回答") line1Parts.push(gender);
  const message = [
    `【相手】${line1Parts.join("の")}`,
    `【予算】${budget}`,
    `【購入場所】${locationText}`,
    recipientDetail ? `【相手の人物像】${recipientDetail}` : "",
    senderDetail ? `【自分について】${senderDetail}` : "",
    situation ? `【きっかけ・気持ち】${situation}` : "",
  ].filter(Boolean).join("\n\n");

  // フォーム非表示 → チャット表示
  formPhase.style.display = "none";
  chatPhase.style.display = "";
  chatFooter.style.display = "";

  // ユーザーの入力内容をチャットに表示
  addMessage(chatPhase, "user", message);
  const thinkingEl = addThinking(chatPhase);

  try {
    const data = await sendChat(sessionId, message);
    thinkingEl.remove();

    if (data.session_id) {
      sessionId = data.session_id;
      localStorage.setItem("gc-session-form", sessionId);
    }

    addMessage(chatPhase, "ai", data.reply, data.items);
  } catch (err) {
    thinkingEl.remove();
    addMessage(chatPhase, "error", err.message);
  }

  userInput.focus();
});

// チャット入力（Phase 2: リファインメント対話）
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
  sendBtn.disabled = !userInput.value.trim();
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (userInput.value.trim() && !sending) {
      chatForm.dispatchEvent(new Event("submit"));
    }
  }
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text || sending) return;

  addMessage(chatPhase, "user", text);
  userInput.value = "";
  userInput.style.height = "auto";
  sendBtn.disabled = true;
  sending = true;

  const thinkingEl = addThinking(chatPhase);

  try {
    const data = await sendChat(sessionId, text);
    thinkingEl.remove();

    if (data.session_id) {
      sessionId = data.session_id;
      localStorage.setItem("gc-session-form", sessionId);
    }

    addMessage(chatPhase, "ai", data.reply, data.items);
  } catch (err) {
    thinkingEl.remove();
    addMessage(chatPhase, "error", err.message);
  } finally {
    sending = false;
    sendBtn.disabled = !userInput.value.trim();
    userInput.focus();
  }
});

// リセット → フォームに戻る
resetBtn.addEventListener("click", async () => {
  await resetSession(sessionId);
  sessionId = crypto.randomUUID();
  localStorage.setItem("gc-session-form", sessionId);

  chatPhase.innerHTML = "";
  chatPhase.style.display = "none";
  chatFooter.style.display = "none";
  formPhase.style.display = "";
  giftForm.reset();
  document.getElementById("country-row").style.display = "none";
});
