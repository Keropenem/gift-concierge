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

// 「その他」選択時に自由記載欄を表示
document.getElementById("relationship").addEventListener("change", (e) => {
  document.getElementById("relationship-other").style.display =
    e.target.value === "その他" ? "" : "none";
});

document.getElementById("occasion").addEventListener("change", (e) => {
  document.getElementById("occasion-other").style.display =
    e.target.value === "その他" ? "" : "none";
});

// 予算：選択肢と自由入力を排他的にする
document.getElementById("budget-select").addEventListener("change", (e) => {
  if (e.target.value) document.getElementById("budget-free").value = "";
});
document.getElementById("budget-free").addEventListener("input", (e) => {
  if (e.target.value) document.getElementById("budget-select").value = "";
});

// フォーム送信 → チャットに遷移
giftForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  let relationship = document.getElementById("relationship").value;
  if (relationship === "その他") {
    const other = document.getElementById("relationship-other").value.trim();
    relationship = other || "その他";
  }

  const gender = document.querySelector('input[name="gender"]:checked')?.value || "";
  const age = document.getElementById("age").value;

  let occasion = document.getElementById("occasion").value;
  if (occasion === "その他") {
    const other = document.getElementById("occasion-other").value.trim();
    occasion = other || "その他";
  }
  const occasionContext = document.getElementById("occasion-context").value.trim();

  const budgetSelect = document.getElementById("budget-select").value;
  const budgetFree = document.getElementById("budget-free").value.trim();
  const budget = budgetFree
    ? `${Number(budgetFree).toLocaleString()}円くらい`
    : budgetSelect;

  if (!budget) {
    alert("予算を選択または入力してください");
    return;
  }

  const recipientDetail = document.getElementById("recipient-detail").value.trim();
  const senderDetail = document.getElementById("sender-detail").value.trim();
  const situation = document.getElementById("situation").value.trim();

  // 相手の基本情報をまとめる
  const line1Parts = [relationship];
  if (age) line1Parts.push(age);
  if (gender && gender !== "未回答") line1Parts.push(gender);
  const message = [
    `【相手】${line1Parts.join("の")}`,
    `【目的】${occasion}${occasionContext ? "（" + occasionContext + "）" : ""}`,
    `【予算】${budget}`,
    recipientDetail ? `【相手の人物像】${recipientDetail}` : "",
    senderDetail ? `【自分について】${senderDetail}` : "",
    situation ? `【伝えたい気持ち】${situation}` : "",
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
  document.getElementById("relationship-other").style.display = "none";
  document.getElementById("occasion-other").style.display = "none";
});
