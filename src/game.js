/**
 * Kalibataku — logika permainan murni.
 *
 * Modul ini tidak menyentuh DOM, localStorage, atau API browser apa pun,
 * sehingga seluruh perilakunya dapat diuji di Node.js.
 */

export const ROUND_SIZE = 10;
export const OPTION_COUNT = 4;

export const OPERATIONS = Object.freeze({
  MIXED: "campur",
  ADD: "tambah",
  SUB: "kurang",
  MUL: "kali",
  DIV: "bagi",
});

export const DIFFICULTIES = Object.freeze({
  EASY: "mudah",
  MEDIUM: "sedang",
  HARD: "sulit",
});

export const OPERATION_ORDER = Object.freeze([
  OPERATIONS.MIXED,
  OPERATIONS.ADD,
  OPERATIONS.SUB,
  OPERATIONS.MUL,
  OPERATIONS.DIV,
]);

export const DIFFICULTY_ORDER = Object.freeze([
  DIFFICULTIES.EASY,
  DIFFICULTIES.MEDIUM,
  DIFFICULTIES.HARD,
]);

export const OPERATION_LABELS = Object.freeze({
  [OPERATIONS.MIXED]: "Campur",
  [OPERATIONS.ADD]: "Tambah",
  [OPERATIONS.SUB]: "Kurang",
  [OPERATIONS.MUL]: "Kali",
  [OPERATIONS.DIV]: "Bagi",
});

export const OPERATION_SYMBOLS = Object.freeze({
  [OPERATIONS.ADD]: "+",
  [OPERATIONS.SUB]: "−",
  [OPERATIONS.MUL]: "×",
  [OPERATIONS.DIV]: "÷",
});

export const DIFFICULTY_LABELS = Object.freeze({
  [DIFFICULTIES.EASY]: "Mudah",
  [DIFFICULTIES.MEDIUM]: "Sedang",
  [DIFFICULTIES.HARD]: "Sulit",
});

export const BEST_PREFIX = "kalibataku:best";

const MIXED_OPERATIONS = Object.freeze([
  OPERATIONS.ADD,
  OPERATIONS.SUB,
  OPERATIONS.MUL,
  OPERATIONS.DIV,
]);

/**
 * Rentang operand per tingkat kesulitan. Semua nilai inklusif.
 * "divQ" adalah rentang hasil bagi, "divB" adalah rentang pembagi.
 */
const RANGES = Object.freeze({
  [DIFFICULTIES.EASY]: {
    add: [1, 10],
    sub: [1, 10],
    mul: [1, 6],
    divQ: [1, 10],
    divB: [2, 6],
  },
  [DIFFICULTIES.MEDIUM]: {
    add: [2, 20],
    sub: [2, 20],
    mul: [2, 12],
    divQ: [2, 12],
    divB: [2, 9],
  },
  [DIFFICULTIES.HARD]: {
    add: [10, 50],
    sub: [10, 50],
    mul: [2, 15],
    divQ: [3, 15],
    divB: [3, 12],
  },
});

/**
 * Generator angka acak deterministik (mulberry32).
 * @param {number} seed
 * @returns {() => number} nilai pada rentang [0, 1)
 */
export function createRng(seed = Date.now()) {
  let state = Number(seed) >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(min, max, rng) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Mengacak salinan array tanpa mengubah array asal.
 * @template T
 * @param {T[]} items
 * @param {() => number} rng
 * @returns {T[]}
 */
export function shuffle(items, rng = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function assertOperation(operation) {
  if (!OPERATION_ORDER.includes(operation)) {
    throw new RangeError(`Operasi tidak dikenal: ${operation}`);
  }
}

function assertDifficulty(difficulty) {
  if (!DIFFICULTY_ORDER.includes(difficulty)) {
    throw new RangeError(`Tingkat kesulitan tidak dikenal: ${difficulty}`);
  }
}

/**
 * Membuat empat pilihan jawaban unik dan tidak negatif.
 * Pengecoh diambil dari sekitar jawaban agar tetap masuk akal.
 * @param {number} answer
 * @param {() => number} rng
 * @param {number} count
 * @returns {number[]}
 */
export function generateOptions(answer, rng = Math.random, count = OPTION_COUNT) {
  if (!Number.isInteger(answer) || answer < 0) {
    throw new RangeError("Jawaban harus bilangan bulat tidak negatif.");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("Jumlah pilihan harus minimal 1.");
  }
  if (count === 1) return [answer];

  const spread = answer < 10 ? 6 : answer < 40 ? 12 : 16;
  const candidates = new Set();

  for (let distance = 1; distance <= spread; distance += 1) {
    if (answer - distance >= 0) candidates.add(answer - distance);
    candidates.add(answer + distance);
  }
  candidates.delete(answer);

  const chosen = shuffle([...candidates], rng).slice(0, count - 1);

  // Jaring pengaman untuk jawaban sangat kecil atau jumlah pilihan besar.
  let filler = 0;
  while (chosen.length < count - 1) {
    if (filler !== answer && !chosen.includes(filler)) chosen.push(filler);
    filler += 1;
  }

  return shuffle([answer, ...chosen], rng);
}

function makeExplanation(operation, a, b, answer) {
  switch (operation) {
    case OPERATIONS.ADD:
      return `${a} + ${b} = ${answer}. Hitung maju dari ${a} sebanyak ${b} langkah.`;
    case OPERATIONS.SUB:
      return `${a} − ${b} = ${answer}. Mundur ${b} langkah dari ${a} menghasilkan ${answer}.`;
    case OPERATIONS.MUL:
      return `${a} × ${b} = ${answer}. ${b} kelompok berisi ${a} sama dengan ${answer}.`;
    case OPERATIONS.DIV:
      return `${a} ÷ ${b} = ${answer}, karena ${b} × ${answer} = ${a}.`;
    default:
      return `${a} dan ${b} menghasilkan ${answer}.`;
  }
}

/**
 * Membuat satu soal beserta pilihan jawabannya.
 * @param {string} operation salah satu nilai OPERATIONS
 * @param {string} difficulty salah satu nilai DIFFICULTIES
 * @param {() => number} rng
 * @returns {{
 *   operation: string,
 *   difficulty: string,
 *   a: number,
 *   b: number,
 *   answer: number,
 *   text: string,
 *   options: number[],
 *   explanation: string,
 *   key: string
 * }}
 */
export function createQuestion(operation = OPERATIONS.MIXED, difficulty = DIFFICULTIES.EASY, rng = Math.random) {
  assertOperation(operation);
  assertDifficulty(difficulty);

  const resolvedOperation =
    operation === OPERATIONS.MIXED
      ? MIXED_OPERATIONS[Math.floor(rng() * MIXED_OPERATIONS.length)]
      : operation;
  const range = RANGES[difficulty];

  let a;
  let b;
  let answer;

  switch (resolvedOperation) {
    case OPERATIONS.ADD: {
      [a, b] = [randomInt(range.add[0], range.add[1], rng), randomInt(range.add[0], range.add[1], rng)];
      answer = a + b;
      break;
    }
    case OPERATIONS.SUB: {
      a = randomInt(range.sub[0], range.sub[1], rng);
      b = randomInt(range.sub[0], range.sub[1], rng);
      if (a < b) [a, b] = [b, a];
      answer = a - b;
      break;
    }
    case OPERATIONS.MUL: {
      [a, b] = [randomInt(range.mul[0], range.mul[1], rng), randomInt(range.mul[0], range.mul[1], rng)];
      answer = a * b;
      break;
    }
    case OPERATIONS.DIV: {
      answer = randomInt(range.divQ[0], range.divQ[1], rng);
      b = randomInt(range.divB[0], range.divB[1], rng);
      a = answer * b;
      break;
    }
    default:
      throw new Error(`Operasi tidak dapat dibuat: ${resolvedOperation}`);
  }

  const symbol = OPERATION_SYMBOLS[resolvedOperation];

  return {
    operation: resolvedOperation,
    difficulty,
    a,
    b,
    answer,
    text: `${a} ${symbol} ${b} = ?`,
    options: generateOptions(answer, rng),
    explanation: makeExplanation(resolvedOperation, a, b, answer),
    key: `${resolvedOperation}:${a}:${b}`,
  };
}

/**
 * Membuat satu babak berisi soal unik.
 * Mengembalikan objek agar mode dan tingkat kesulitan ikut tersimpan.
 * @param {{
 *   operation?: string,
 *   difficulty?: string,
 *   count?: number,
 *   rng?: () => number
 * }} options
 * @returns {{ operation: string, difficulty: string, questions: Array<object> }}
 */
export function createRound({
  operation = OPERATIONS.MIXED,
  difficulty = DIFFICULTIES.EASY,
  count = ROUND_SIZE,
  rng = Math.random,
} = {}) {
  assertOperation(operation);
  assertDifficulty(difficulty);
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("Jumlah soal harus bilangan bulat positif.");
  }

  const questions = [];
  const seen = new Set();
  const maxAttempts = Math.max(600, count * 180);
  let attempts = 0;

  while (questions.length < count && attempts < maxAttempts) {
    attempts += 1;
    const question = createQuestion(operation, difficulty, rng);
    if (seen.has(question.key)) continue;
    seen.add(question.key);
    questions.push(question);
  }

  if (questions.length < count) {
    throw new Error(
      `Tidak dapat membuat ${count} soal unik untuk mode ${operation} tingkat ${difficulty}.`,
    );
  }

  return { operation, difficulty, questions };
}

function toAnswerNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.NaN;
  }
  return Number.NaN;
}

/**
 * Menghitung hasil satu babak.
 * @param {Array<{answer:number}>} questions
 * @param {Array<number|null|undefined>} answers
 * @returns {{
 *   correct: number,
 *   total: number,
 *   percentage: number,
 *   bestStreak: number,
 *   message: string
 * }}
 */
export function scoreRound(questions, answers) {
  const list = Array.isArray(questions) ? questions : [];
  const given = Array.isArray(answers) ? answers : [];
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;

  list.forEach((question, index) => {
    if (toAnswerNumber(given[index]) === question.answer) {
      correct += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
  });

  const total = list.length;
  const percentage = total === 0 ? 0 : Math.round((correct / total) * 100);

  return {
    correct,
    total,
    percentage,
    bestStreak,
    message: getPerformanceMessage(percentage),
  };
}

/**
 * @param {number} percentage
 * @returns {string}
 */
export function getPerformanceMessage(percentage) {
  if (percentage >= 100) return "Sempurna! Semua jawaban benar. Pertahankan, ya!";
  if (percentage >= 80) return "Hebat! Kamu sudah sangat menguasai latihan ini.";
  if (percentage >= 60) return "Bagus! Sedikit lagi menuju sempurna.";
  if (percentage >= 40) return "Cukup baik. Pelajari lagi soal yang salah, ya.";
  return "Jangan menyerah. Ulangi latihan dengan mode yang lebih mudah.";
}

/**
 * Kunci localStorage untuk rekor per mode dan tingkat kesulitan.
 * @param {string} operation
 * @param {string} difficulty
 * @returns {string}
 */
export function getBestKey(operation, difficulty) {
  assertOperation(operation);
  assertDifficulty(difficulty);
  return `${BEST_PREFIX}:${operation}:${difficulty}`;
}

/**
 * @param {{answer:number}} question
 * @param {unknown} value
 * @returns {boolean}
 */
export function checkAnswer(question, value) {
  return toAnswerNumber(value) === question.answer;
}
