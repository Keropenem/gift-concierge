const form = document.getElementById("gift-form");
const submitBtn = document.getElementById("submit-btn");
const btnText = submitBtn.querySelector(".btn-text");
const btnLoading = submitBtn.querySelector(".btn-loading");
const resultsSection = document.getElementById("results");
const resultsList = document.getElementById("results-list");
const resultsMessage = document.getElementById("results-message");
const errorSection = document.getElementById("error-section");
const errorMessage = document.getElementById("error-message");
const retryBtn = document.getElementById("retry-btn");
const errorCloseBtn = document.getElementById("error-close-btn");
const freeText = document.getElementById("free_text");
const charCount = document.getElementById("char-count");
const budgetMin = document.getElementById("budget_min");
const budgetMax = document.getElementById("budget_max");
const budgetMinDisplay = document.getElementById("budget-min-display");
const budgetMaxDisplay = document.getElementById("budget-max-display");

// 予算スライダーの連動
function formatYen(value) {
  return Number(value).toLocaleString() + "円";
}

function updateBudgetDisplay() {
  let min = Number(budgetMin.value);
  let max = Number(budgetMax.value);
  if (min > max) {
    budgetMin.value = max;
    min = max;
  }
  budgetMinDisplay.textContent = formatYen(min);
  budgetMaxDisplay.textContent = formatYen(max);
}

budgetMin.addEventListener("input", updateBudgetDisplay);
budgetMax.addEventListener("input", updateBudgetDisplay);

// 文字数カウント
freeText.addEventListener("input", () => {
  charCount.textContent = freeText.value.length;
});

// フォーム送信
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitForm();
});

retryBtn.addEventListener("click", async () => {
  await submitForm();
});

errorCloseBtn.addEventListener("click", () => {
  errorSection.hidden = true;
});

async function submitForm() {
  const interests = Array.from(
    form.querySelectorAll('input[name="interests"]:checked')
  ).map((el) => el.value);

  const data = {
    relationship: form.relationship.value,
    age_range: form.age_range.value,
    gender: form.gender.value,
    budget_min: Number(budgetMin.value),
    budget_max: Number(budgetMax.value),
    occasion: form.occasion.value,
    interests,
    free_text: freeText.value.trim(),
  };

  setLoading(true);
  resultsSection.hidden = true;
  errorSection.hidden = true;

  try {
    const res = await fetch("/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "サーバーエラーが発生しました。");
    }

    const result = await res.json();
    renderResults(result);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  btnText.hidden = loading;
  btnLoading.hidden = !loading;
}

function renderResults(data) {
  resultsMessage.textContent = data.message || "";
  resultsList.innerHTML = "";

  if (!data.suggestions || data.suggestions.length === 0) {
    resultsList.innerHTML = '<p class="no-results">提案が見つかりませんでした。条件を変えてお試しください。</p>';
    resultsSection.hidden = false;
    return;
  }

  data.suggestions.forEach((item, i) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.style.animationDelay = `${i * 0.1}s`;
    card.innerHTML = `
      <div class="card-header">
        <span class="card-number">${i + 1}</span>
        <h3 class="card-title">${escapeHtml(item.name)}</h3>
      </div>
      <p class="card-reason">${escapeHtml(item.reason)}</p>
      <div class="card-meta">
        <span class="tag price">${escapeHtml(item.price_range)}</span>
        <span class="tag category">${escapeHtml(item.category)}</span>
        <span class="tag where">${escapeHtml(item.where_to_buy)}</span>
      </div>
    `;
    resultsList.appendChild(card);
  });

  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorSection.hidden = false;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
