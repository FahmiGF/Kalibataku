import test from "node:test";
import assert from "node:assert/strict";

import {
  BEST_PREFIX,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  OPERATIONS,
  OPERATION_ORDER,
  OPERATION_SYMBOLS,
  ROUND_SIZE,
  checkAnswer,
  createQuestion,
  createRound,
  createRng,
  generateOptions,
  getBestKey,
  getPerformanceMessage,
  scoreRound,
  shuffle,
} from "../src/game.js";

const SINGLE_OPERATIONS = OPERATION_ORDER.filter((operation) => operation !== OPERATIONS.MIXED);

function assertValidQuestion(question, expectedOperation) {
  assert.ok(OPERATION_ORDER.includes(question.operation), `operasi tidak valid: ${question.operation}`);
  assert.ok(DIFFICULTY_ORDER.includes(question.difficulty), "tingkat tidak valid");
  if (expectedOperation !== OPERATIONS.MIXED) {
    assert.equal(question.operation, expectedOperation);
  }

  assert.ok(Number.isInteger(question.a), "a harus bilangan bulat");
  assert.ok(Number.isInteger(question.b), "b harus bilangan bulat");
  assert.ok(Number.isInteger(question.answer), "jawaban harus bilangan bulat");
  assert.ok(question.answer >= 0, "jawaban tidak boleh negatif");

  const symbol = OPERATION_SYMBOLS[question.operation];
  assert.equal(question.text, `${question.a} ${symbol} ${question.b} = ?`);

  switch (question.operation) {
    case OPERATIONS.ADD:
      assert.equal(question.answer, question.a + question.b);
      break;
    case OPERATIONS.SUB:
      assert.equal(question.answer, question.a - question.b);
      assert.ok(question.a >= question.b, "pengurangan tidak boleh negatif");
      break;
    case OPERATIONS.MUL:
      assert.equal(question.answer, question.a * question.b);
      break;
    case OPERATIONS.DIV:
      assert.equal(question.a, question.b * question.answer);
      assert.ok(question.b >= 2, "pembagi minimal 2");
      break;
    default:
      assert.fail(`operasi tak terduga: ${question.operation}`);
  }

  assert.equal(question.options.length, 4, "harus ada empat pilihan");
  assert.equal(new Set(question.options).size, 4, "pilihan harus unik");
  assert.ok(question.options.includes(question.answer), "pilihan harus memuat jawaban benar");
  for (const option of question.options) {
    assert.ok(Number.isInteger(option), "pilihan harus bilangan bulat");
    assert.ok(option >= 0, "pilihan tidak boleh negatif");
  }

  assert.equal(question.key, `${question.operation}:${question.a}:${question.b}`);
  assert.ok(question.explanation.includes(String(question.answer)), "penjelasan memuat jawaban");
}

test("konstanta permainan memakai nilai dan urutan yang disepakati", () => {
  assert.deepEqual(OPERATION_ORDER, ["campur", "tambah", "kurang", "kali", "bagi"]);
  assert.deepEqual(DIFFICULTY_ORDER, ["mudah", "sedang", "sulit"]);
  assert.equal(ROUND_SIZE, 10);
  assert.deepEqual(OPERATIONS, {
    MIXED: "campur",
    ADD: "tambah",
    SUB: "kurang",
    MUL: "kali",
    DIV: "bagi",
  });
  assert.deepEqual(DIFFICULTIES, { EASY: "mudah", MEDIUM: "sedang", HARD: "sulit" });
  assert.ok(Object.isFrozen(OPERATIONS));
  assert.ok(Object.isFrozen(DIFFICULTY_ORDER));
});

test("createRng menghasilkan urutan deterministik", () => {
  const first = createRng(12345);
  const second = createRng(12345);
  const valuesA = Array.from({ length: 8 }, () => first());
  const valuesB = Array.from({ length: 8 }, () => second());

  assert.deepEqual(valuesA, valuesB);
  assert.ok(valuesA.every((value) => value >= 0 && value < 1));
});

test("shuffle menyalin array, mempertahankan isi, dan deterministik dengan seed", () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  const shuffled = shuffle(original, createRng(42));

  assert.deepEqual(original, [1, 2, 3, 4, 5, 6, 7, 8], "array asal tidak berubah");
  assert.notEqual(shuffled, original, "harus berupa array baru");
  assert.deepEqual([...shuffled].sort((a, b) => a - b), original);
  assert.deepEqual(shuffled, shuffle(original, createRng(42)), "seed sama, hasil sama");
  assert.deepEqual(shuffle([], createRng(1)), []);
  assert.deepEqual(shuffle(["x"], createRng(1)), ["x"]);
});

test("generateOptions selalu memberi empat pilihan unik dan tidak negatif", () => {
  for (const answer of [0, 1, 2, 5, 9, 13, 27, 58, 100, 144]) {
    for (let seed = 1; seed <= 25; seed += 1) {
      const options = generateOptions(answer, createRng(seed));
      assert.equal(options.length, 4);
      assert.equal(new Set(options).size, 4, `pilihan duplikat untuk jawaban ${answer}`);
      assert.ok(options.includes(answer), `jawaban ${answer} hilang`);
      assert.ok(options.every((value) => Number.isInteger(value) && value >= 0));
    }
  }

  assert.deepEqual(generateOptions(7, createRng(9)), generateOptions(7, createRng(9)));
  assert.deepEqual(generateOptions(7, createRng(9), 1), [7]);
  assert.throws(() => generateOptions(-1), RangeError);
  assert.throws(() => generateOptions(1.5), RangeError);
  assert.throws(() => generateOptions(5, Math.random, 0), RangeError);
});

test("createQuestion menghasilkan soal valid untuk semua operasi dan tingkat", () => {
  for (const operation of SINGLE_OPERATIONS) {
    for (const difficulty of DIFFICULTY_ORDER) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const question = createQuestion(operation, difficulty, createRng(seed * 17));
        assertValidQuestion(question, operation);
        assert.equal(question.difficulty, difficulty);
      }
    }
  }
});

test("rentang angka mengikuti panduan tingkat kesulitan", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const easyAdd = createQuestion(OPERATIONS.ADD, DIFFICULTIES.EASY, createRng(seed));
    assert.ok(easyAdd.a >= 1 && easyAdd.a <= 10);
    assert.ok(easyAdd.b >= 1 && easyAdd.b <= 10);

    const hardAdd = createQuestion(OPERATIONS.ADD, DIFFICULTIES.HARD, createRng(seed));
    assert.ok(hardAdd.a >= 10 && hardAdd.a <= 50);
    assert.ok(hardAdd.b >= 10 && hardAdd.b <= 50);

    const mediumMul = createQuestion(OPERATIONS.MUL, DIFFICULTIES.MEDIUM, createRng(seed));
    assert.ok(mediumMul.a >= 2 && mediumMul.a <= 12);
    assert.ok(mediumMul.b >= 2 && mediumMul.b <= 12);

    const hardMul = createQuestion(OPERATIONS.MUL, DIFFICULTIES.HARD, createRng(seed));
    assert.ok(hardMul.a >= 2 && hardMul.a <= 15);
    assert.ok(hardMul.b >= 2 && hardMul.b <= 15);

    const easyDiv = createQuestion(OPERATIONS.DIV, DIFFICULTIES.EASY, createRng(seed));
    assert.ok(easyDiv.b >= 2);
    assert.ok(easyDiv.answer >= 1 && easyDiv.answer <= 10);

    const hardDiv = createQuestion(OPERATIONS.DIV, DIFFICULTIES.HARD, createRng(seed));
    assert.ok(hardDiv.b >= 2);
    assert.ok(hardDiv.answer >= 3 && hardDiv.answer <= 15);
  }
});

test("mode campur memilih operasi nyata secara acak", () => {
  const operations = new Set();
  for (let seed = 1; seed <= 60; seed += 1) {
    const question = createQuestion(OPERATIONS.MIXED, DIFFICULTIES.MEDIUM, createRng(seed));
    assert.ok(SINGLE_OPERATIONS.includes(question.operation));
    operations.add(question.operation);
  }
  assert.equal(operations.size, 4, "semua operasi muncul pada sampel");
});

test("createQuestion deterministik dengan seed yang sama", () => {
  const first = createQuestion(OPERATIONS.MUL, DIFFICULTIES.HARD, createRng(777));
  const second = createQuestion(OPERATIONS.MUL, DIFFICULTIES.HARD, createRng(777));
  assert.deepEqual(first, second);
});

test("createQuestion menolak operasi atau tingkat yang tidak dikenal", () => {
  assert.throws(() => createQuestion("akar", DIFFICULTIES.EASY), RangeError);
  assert.throws(() => createQuestion(OPERATIONS.ADD, "mustahil"), RangeError);
});

test("createRound menghasilkan 10 soal unik untuk setiap mode", () => {
  for (const operation of OPERATION_ORDER) {
    for (const difficulty of DIFFICULTY_ORDER) {
      const round = createRound({ operation, difficulty, rng: createRng(2024) });

      assert.equal(round.operation, operation);
      assert.equal(round.difficulty, difficulty);
      assert.equal(round.questions.length, 10, `${operation}/${difficulty} tidak berisi 10 soal`);
      assert.equal(new Set(round.questions.map((question) => question.key)).size, 10);

      for (const question of round.questions) {
        assertValidQuestion(question, operation);
      }

      const repeated = createRound({ operation, difficulty, rng: createRng(2024) });
      assert.deepEqual(repeated, round, "babak dengan seed sama harus identik");
    }
  }
});

test("createRound mode campur memakai lebih dari satu operasi", () => {
  const round = createRound({
    operation: OPERATIONS.MIXED,
    difficulty: DIFFICULTIES.MEDIUM,
    rng: createRng(99),
  });
  const used = new Set(round.questions.map((question) => question.operation));
  assert.ok(used.size >= 2, `operasi yang muncul: ${[...used].join(", ")}`);
});

test("createRound mendukung jumlah khusus dan menolak input tidak valid", () => {
  const round = createRound({
    operation: OPERATIONS.ADD,
    difficulty: DIFFICULTIES.EASY,
    count: 4,
    rng: createRng(5),
  });
  assert.equal(round.questions.length, 4);
  assert.equal(new Set(round.questions.map((question) => question.key)).size, 4);

  assert.throws(() => createRound({ operation: "akar" }), RangeError);
  assert.throws(() => createRound({ difficulty: "mustahil" }), RangeError);
  assert.throws(() => createRound({ count: 0 }), RangeError);
  assert.throws(() => createRound({ count: 2.5 }), RangeError);
});

test("createRound melempar error saat kombinasi soal tidak cukup", () => {
  assert.throws(
    () =>
      createRound({
        operation: OPERATIONS.MUL,
        difficulty: DIFFICULTIES.EASY,
        count: 37,
        rng: createRng(1),
      }),
    /Tidak dapat membuat 37 soal unik/,
  );
});

test("scoreRound menghitung skor, persentase, dan runtutan terbaik", () => {
  const questions = [4, 5, 6, 7].map((answer) => ({ answer }));
  const result = scoreRound(questions, [4, 0, 6, 7]);

  assert.equal(result.correct, 3);
  assert.equal(result.total, 4);
  assert.equal(result.percentage, 75);
  assert.equal(result.bestStreak, 2);
  assert.equal(result.message, getPerformanceMessage(75));
});

test("scoreRound menangani jawaban kosong, salah, dan sempurna", () => {
  const questions = Array.from({ length: 10 }, (_, index) => ({ answer: index + 1 }));

  const perfect = scoreRound(
    questions,
    questions.map((question) => question.answer),
  );
  assert.equal(perfect.correct, 10);
  assert.equal(perfect.percentage, 100);
  assert.equal(perfect.bestStreak, 10);
  assert.match(perfect.message, /Sempurna/);

  const empty = scoreRound(questions, []);
  assert.equal(empty.correct, 0);
  assert.equal(empty.percentage, 0);
  assert.equal(empty.bestStreak, 0);

  const wrong = scoreRound(questions, questions.map(() => 999));
  assert.equal(wrong.correct, 0);
  assert.equal(wrong.percentage, 0);

  assert.deepEqual(scoreRound([], []), {
    correct: 0,
    total: 0,
    percentage: 0,
    bestStreak: 0,
    message: getPerformanceMessage(0),
  });
});

test("scoreRound menghitung runtutan yang terputus dengan benar", () => {
  const questions = [1, 2, 3, 4, 5, 6].map((answer) => ({ answer }));
  const result = scoreRound(questions, [1, 2, 0, 4, 5, 6]);
  assert.equal(result.correct, 5);
  assert.equal(result.bestStreak, 3);
});

test("jawaban kosong tidak dihitung benar saat jawaban soal nol", () => {
  const questions = Array.from({ length: 3 }, () => ({ answer: 0 }));
  const result = scoreRound(questions, [null, "", undefined]);

  assert.equal(result.correct, 0);
  assert.equal(result.bestStreak, 0);
  assert.equal(checkAnswer({ answer: 0 }, null), false);
  assert.equal(checkAnswer({ answer: 0 }, ""), false);
  assert.equal(checkAnswer({ answer: 0 }, false), false);
  assert.equal(checkAnswer({ answer: 0 }, "0"), true);
  assert.equal(checkAnswer({ answer: 0 }, 0), true);
});

test("getPerformanceMessage berubah pada setiap batas nilai", () => {
  assert.match(getPerformanceMessage(100), /Sempurna/);
  assert.match(getPerformanceMessage(80), /Hebat/);
  assert.match(getPerformanceMessage(60), /Bagus/);
  assert.match(getPerformanceMessage(40), /Cukup baik/);
  assert.match(getPerformanceMessage(0), /Jangan menyerah/);

  assert.equal(getPerformanceMessage(79), getPerformanceMessage(60));
  assert.equal(getPerformanceMessage(59), getPerformanceMessage(40));
  assert.equal(getPerformanceMessage(39), getPerformanceMessage(0));
  assert.notEqual(getPerformanceMessage(100), getPerformanceMessage(80));
});

test("getBestKey memisahkan rekor per mode dan tingkat", () => {
  const key = getBestKey(OPERATIONS.MUL, DIFFICULTIES.HARD);
  assert.equal(key, `${BEST_PREFIX}:kali:sulit`);
  assert.notEqual(key, getBestKey(OPERATIONS.MUL, DIFFICULTIES.EASY));
  assert.notEqual(key, getBestKey(OPERATIONS.DIV, DIFFICULTIES.HARD));
  assert.throws(() => getBestKey("akar", DIFFICULTIES.EASY), RangeError);
  assert.throws(() => getBestKey(OPERATIONS.ADD, "mustahil"), RangeError);
});

test("checkAnswer membandingkan nilai dengan jawaban soal", () => {
  const question = { answer: 42 };
  assert.equal(checkAnswer(question, 42), true);
  assert.equal(checkAnswer(question, 41), false);
  assert.equal(checkAnswer(question, "42"), true);
});
