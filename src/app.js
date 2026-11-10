import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DIFFICULTY_ORDER,
  OPERATIONS,
  OPERATION_LABELS,
  OPERATION_ORDER,
  ROUND_SIZE,
  createRound,
  getBestKey,
  getPerformanceMessage,
  scoreRound,
} from "./game.js";

const screenElements = {
  start: document.getElementById("screen-start"),
  quiz: document.getElementById("screen-quiz"),
  result: document.getElementById("screen-result"),
};

const startForm = document.getElementById("start-form");
const startButton = document.getElementById("start-button");
const bestValue = document.getElementById("best-value");

const progressLabel = document.getElementById("progress-label");
const progressTrack = document.getElementById("progress-track");
const progressFill = document.getElementById("progress-fill");
const modeLabel = document.getElementById("mode-label");
const scoreValue = document.getElementById("score-value");
const streakValue = document.getElementById("streak-value");

const questionKicker = document.getElementById("question-kicker");
const questionText = document.getElementById("question-text");
const answerGrid = document.getElementById("answer-grid");
const feedback = document.getElementById("feedback");
const feedbackActions = document.getElementById("feedback-actions");
const nextButton = document.getElementById("next-button");

const scoreRing = document.getElementById("score-ring");
const resultScore = document.getElementById("result-score");
const resultTitle = document.getElementById("result-title");
const resultMessage = document.getElementById("result-message");
const resultPercentage = document.getElementById("result-percentage");
const resultStreak = document.getElementById("result-streak");
const resultBest = document.getElementById("result-best");
const resultRecord = document.getElementById("result-record");
const playAgainButton = document.getElementById("play-again");
const changeModeButton = document.getElementById("change-mode");

const state = {
  screen: "start",
  operation: OPERATIONS.MIXED,
  difficulty: DIFFICULTIES.EASY,
  questions: [],
  index: 0,
  answers: [],
  score: 0,
  streak: 0,
  answered: false,
  result: null,
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- Penyimpanan rekor ---------- */

function readBest(operation, difficulty) {
  try {
    const raw = window.localStorage.getItem(getBestKey(operation, difficulty));
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 0) return null;
    return Math.min(value, ROUND_SIZE);
  } catch {
    return null;
  }
}

function writeBest(operation, difficulty, score) {
  try {
    window.localStorage.setItem(getBestKey(operation, difficulty), String(score));
  } catch {
    // Mode privat atau localStorage penuh: rekor cukup ditampilkan untuk sesi ini.
  }
}

function updateBestNote() {
  const best = readBest(state.operation, state.difficulty);
  bestValue.textContent = best === null ? "Belum ada" : `${best} / ${ROUND_SIZE}`;
}

/* ---------- Pemilihan mode ---------- */

function syncSelection() {
  document.querySelectorAll("button[data-operation]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.operation === state.operation));
  });
  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.difficulty === state.difficulty));
  });
}

function selectOperation(operation) {
  if (!OPERATION_ORDER.includes(operation)) return;
  state.operation = operation;
  document.body.dataset.operation = operation;
  syncSelection();
  updateBestNote();
}

function selectDifficulty(difficulty) {
  if (!DIFFICULTY_ORDER.includes(difficulty)) return;
  state.difficulty = difficulty;
  syncSelection();
  updateBestNote();
}

/* ---------- Perpindahan layar ---------- */

function showScreen(name, { focus = true } = {}) {
  Object.entries(screenElements).forEach(([key, section]) => {
    const active = key === name;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
  });
  state.screen = name;
  document.body.dataset.screen = name;

  if (!focus) return;
  if (name === "start") startButton.focus({ preventScroll: true });
  if (name === "result") resultTitle.focus({ preventScroll: true });
}

function startRound() {
  const round = createRound({
    operation: state.operation,
    difficulty: state.difficulty,
    count: ROUND_SIZE,
  });

  state.questions = round.questions;
  state.index = 0;
  state.answers = [];
  state.score = 0;
  state.streak = 0;
  state.answered = false;
  state.result = null;

  showScreen("quiz", { focus: false });
  renderQuestion();
}

/* ---------- Kuis ---------- */

function currentQuestion() {
  return state.questions[state.index] ?? null;
}

function renderQuestion() {
  const question = currentQuestion();
  if (!question) return;

  const total = state.questions.length;
  const number = state.index + 1;

  progressLabel.textContent = `Soal ${number} / ${total}`;
  progressTrack.setAttribute("aria-valuemax", String(total));
  progressTrack.setAttribute("aria-valuenow", String(number));
  progressFill.style.width = `${(number / total) * 100}%`;
  modeLabel.textContent = `${OPERATION_LABELS[state.operation]} · ${DIFFICULTY_LABELS[state.difficulty]}`;

  scoreValue.textContent = String(state.score);
  streakValue.textContent = String(state.streak);
  questionKicker.textContent = `Soal ${number}`;
  questionText.textContent = question.text;

  feedback.className = "feedback";
  feedback.replaceChildren();
  feedbackActions.hidden = true;
  nextButton.textContent = "Lanjut";

  const buttons = question.options.map((value, index) => {
    const button = element("button", "answer-btn");
    button.type = "button";
    button.dataset.index = String(index);
    button.dataset.value = String(value);
    button.setAttribute("aria-label", `Pilihan ${index + 1}: ${value}`);

    const key = element("span", "answer-key", String(index + 1));
    key.setAttribute("aria-hidden", "true");
    const numberNode = element("span", "answer-number", String(value));
    const mark = element("span", "answer-mark", "");
    mark.setAttribute("aria-hidden", "true");

    button.append(key, numberNode, mark);
    button.addEventListener("click", () => chooseAnswer(index));
    return button;
  });

  answerGrid.replaceChildren(...buttons);
  state.answered = false;

  questionText.focus({ preventScroll: true });
}

function bumpStat(node) {
  node.classList.remove("is-bumped");
  // Memaksa reflow singkat agar animasi dapat diputar ulang.
  void node.offsetWidth;
  node.classList.add("is-bumped");
}

function chooseAnswer(index) {
  if (state.screen !== "quiz" || state.answered) return;

  const question = currentQuestion();
  const buttons = [...answerGrid.querySelectorAll(".answer-btn")];
  const chosenButton = buttons[index];
  if (!question || !chosenButton) return;

  const chosenValue = Number(chosenButton.dataset.value);
  const correct = chosenValue === question.answer;

  state.answered = true;
  state.answers[state.index] = chosenValue;

  if (correct) {
    state.score += 1;
    state.streak += 1;
    bumpStat(scoreValue);
    bumpStat(streakValue);
  } else {
    state.streak = 0;
  }

  buttons.forEach((button, buttonIndex) => {
    const optionValue = Number(button.dataset.value);
    button.disabled = true;

    if (optionValue === question.answer) {
      button.classList.add("is-correct");
      button.querySelector(".answer-mark").textContent = "✓";
      button.setAttribute(
        "aria-label",
        `Pilihan ${buttonIndex + 1}: ${optionValue}, jawaban benar`,
      );
    }

    if (buttonIndex === index && !correct) {
      button.classList.add("is-incorrect");
      button.querySelector(".answer-mark").textContent = "✕";
      button.setAttribute("aria-label", `Pilihan ${buttonIndex + 1}: ${optionValue}, jawabanmu`);
    }
  });

  scoreValue.textContent = String(state.score);
  streakValue.textContent = String(state.streak);
  renderFeedback(question, correct, chosenValue);
}

function renderFeedback(question, correct, chosenValue) {
  const isLast = state.index === state.questions.length - 1;

  feedback.className = `feedback is-visible ${correct ? "feedback-correct" : "feedback-incorrect"}`;

  const main = element("div", "feedback-main");
  const verdict = element("p", "feedback-verdict");
  const icon = element("span", "feedback-icon", correct ? "✓" : "!");
  icon.setAttribute("aria-hidden", "true");
  verdict.append(icon, document.createTextNode(correct ? "Benar!" : "Belum tepat."));

  const answerLine = element("p", "feedback-answer");
  if (correct) {
    answerLine.textContent = `Jawabanmu ${chosenValue} tepat.`;
  } else {
    const strong = element("strong", "", String(question.answer));
    answerLine.append(document.createTextNode("Jawaban benar: "), strong, document.createTextNode("."));
  }

  const explanation = element("p", "feedback-explanation", question.explanation);
  main.append(verdict, answerLine, explanation);

  feedback.replaceChildren(main);
  nextButton.textContent = isLast ? "Lihat hasil" : "Lanjut";
  feedbackActions.hidden = false;
}

function advance() {
  if (state.screen !== "quiz" || !state.answered) return;

  if (state.index < state.questions.length - 1) {
    state.index += 1;
    state.answered = false;
    renderQuestion();
    return;
  }

  finishRound();
}

/* ---------- Hasil ---------- */

function getResultTitle(percentage) {
  if (percentage >= 100) return "Sempurna!";
  if (percentage >= 80) return "Hebat sekali!";
  if (percentage >= 60) return "Kerja bagus!";
  if (percentage >= 40) return "Terus berlatih!";
  return "Jangan menyerah!";
}

function finishRound() {
  const summary = scoreRound(state.questions, state.answers);
  const previousBest = readBest(state.operation, state.difficulty);
  const isNewBest = previousBest === null || summary.correct > previousBest;
  const best = isNewBest ? summary.correct : previousBest;

  if (isNewBest) {
    writeBest(state.operation, state.difficulty, summary.correct);
  }

  state.result = {
    ...summary,
    message: summary.message || getPerformanceMessage(summary.percentage),
    previousBest,
    best,
    isNewBest,
  };

  renderResult();
  showScreen("result");
}

function renderResult() {
  const result = state.result;
  if (!result) return;

  resultScore.textContent = String(result.correct);
  resultPercentage.textContent = `${result.percentage}%`;
  resultStreak.textContent = String(result.bestStreak);
  resultBest.textContent = `${result.best} / ${result.total}`;
  resultTitle.textContent = getResultTitle(result.percentage);
  resultMessage.textContent = result.message;
  scoreRing.style.setProperty("--score-pct", String(result.percentage));

  resultRecord.hidden = false;
  if (result.isNewBest) {
    resultRecord.textContent = `Rekor baru! Skor terbaik untuk ${OPERATION_LABELS[state.operation]} · ${DIFFICULTY_LABELS[state.difficulty]} sekarang ${result.best}/${result.total}.`;
  } else {
    resultRecord.textContent = `Rekor tersimpan ${result.best}/${result.total} belum terpecahkan. Ayo coba lagi!`;
  }

  updateBestNote();
}

/* ---------- Interaksi ---------- */

document.querySelectorAll("button[data-operation]").forEach((button) => {
  button.addEventListener("click", () => selectOperation(button.dataset.operation));
});

document.querySelectorAll("[data-difficulty]").forEach((button) => {
  button.addEventListener("click", () => selectDifficulty(button.dataset.difficulty));
});

startForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startRound();
});

playAgainButton.addEventListener("click", startRound);
nextButton.addEventListener("click", advance);

changeModeButton.addEventListener("click", () => {
  updateBestNote();
  showScreen("start");
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (state.screen !== "quiz") return;

  if (!state.answered && /^[1-4]$/.test(event.key)) {
    event.preventDefault();
    chooseAnswer(Number(event.key) - 1);
    return;
  }

  if (state.answered && event.key === "Enter") {
    event.preventDefault();
    advance();
  }
});

/* ---------- Inisialisasi ---------- */

document.body.dataset.operation = state.operation;
syncSelection();
updateBestNote();
showScreen("start", { focus: false });

function cloneQuestion(question) {
  return { ...question, options: [...question.options] };
}

window.kalibataku = Object.freeze({
  version: "1.0.0",
  getState() {
    return {
      screen: state.screen,
      operation: state.operation,
      difficulty: state.difficulty,
      index: state.index,
      total: state.questions.length,
      score: state.score,
      streak: state.streak,
      answered: state.answered,
      question: currentQuestion() ? cloneQuestion(currentQuestion()) : null,
      questions: state.questions.map(cloneQuestion),
      answers: [...state.answers],
      result: state.result ? { ...state.result } : null,
    };
  },
  getCurrentQuestion() {
    const question = currentQuestion();
    return question ? cloneQuestion(question) : null;
  },
});
