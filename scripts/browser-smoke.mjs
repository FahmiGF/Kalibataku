/**
 * Uji asap browser untuk Kalibataku.
 *
 * Menjalankan server statis, membuka Chrome headless melalui Chrome DevTools
 * Protocol, lalu memeriksa alur desktop dan mobile. Tidak memakai dependensi
 * npm. Pada Node 18 (tanpa WebSocket global) dipakai klien WebSocket minimal.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/* ---------- Klien WebSocket minimal untuk Node 18 ---------- */

class MinimalWebSocket {
  #socket = null;
  #buffer = Buffer.alloc(0);
  #fragments = [];
  #fragmentOpcode = 0;
  #listeners = new Map();

  constructor(url) {
    this.url = url;
    this.#connect();
  }

  addEventListener(type, callback, options = {}) {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push({ callback, once: Boolean(options?.once) });
    this.#listeners.set(type, listeners);
  }

  #emit(type, event) {
    const listeners = this.#listeners.get(type) ?? [];
    for (const entry of [...listeners]) {
      if (entry.once) {
        const index = listeners.indexOf(entry);
        if (index >= 0) listeners.splice(index, 1);
      }
      entry.callback.call(this, event);
    }
  }

  #connect() {
    const target = new URL(this.url);
    const key = randomBytes(16).toString("base64");
    const expectedAccept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    const client = request({
      hostname: target.hostname,
      port: Number(target.port) || 80,
      path: `${target.pathname}${target.search}`,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
      },
    });

    client.on("upgrade", (response, socket, head) => {
      if (response.headers["sec-websocket-accept"] !== expectedAccept) {
        socket.destroy();
        this.#emit("error", new Error("Handshake WebSocket tidak valid"));
        return;
      }

      this.#socket = socket;
      socket.setNoDelay(true);
      socket.on("data", (chunk) => this.#onData(chunk));
      socket.on("error", (error) => this.#emit("error", error));
      socket.on("close", () => this.#emit("close", {}));
      this.#emit("open", {});
      if (head?.length) this.#onData(head);
    });

    client.on("response", (response) => {
      this.#emit("error", new Error(`WebSocket ditolak dengan status ${response.statusCode}`));
      response.resume();
    });

    client.on("error", (error) => this.#emit("error", error));
    client.end();
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    while (this.#buffer.length >= 2) {
      const first = this.#buffer[0];
      const second = this.#buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.#buffer.length < 4) return;
        length = this.#buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.#buffer.length < 10) return;
        length = Number(this.#buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let mask = null;
      if (masked) {
        if (this.#buffer.length < offset + 4) return;
        mask = this.#buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.#buffer.length < offset + length) return;

      let payload = this.#buffer.subarray(offset, offset + length);
      if (masked) {
        const unmasked = Buffer.from(payload);
        for (let index = 0; index < unmasked.length; index += 1) {
          unmasked[index] ^= mask[index % 4];
        }
        payload = unmasked;
      }

      this.#buffer = this.#buffer.subarray(offset + length);
      this.#handleFrame(fin, opcode, payload);
    }
  }

  #handleFrame(fin, opcode, payload) {
    if (opcode === 0x9) {
      this.#sendFrame(0x0a, payload);
      return;
    }
    if (opcode === 0x0a) return;
    if (opcode === 0x08) {
      this.close();
      return;
    }

    if (opcode === 0x00) {
      this.#fragments.push(payload);
      if (!fin) return;
      const complete = Buffer.concat(this.#fragments);
      const messageOpcode = this.#fragmentOpcode;
      this.#fragments = [];
      this.#fragmentOpcode = 0;
      this.#deliver(messageOpcode, complete);
      return;
    }

    if (opcode === 0x01 || opcode === 0x02) {
      if (!fin) {
        this.#fragmentOpcode = opcode;
        this.#fragments = [payload];
        return;
      }
      this.#deliver(opcode, payload);
    }
  }

  #deliver(opcode, payload) {
    this.#emit("message", {
      data: opcode === 0x01 ? payload.toString("utf8") : payload,
    });
  }

  send(text) {
    this.#sendFrame(0x01, Buffer.from(String(text), "utf8"));
  }

  #sendFrame(opcode, payload) {
    if (!this.#socket) throw new Error("WebSocket belum terhubung");
    const length = payload.length;
    let header;

    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    header[0] = 0x80 | opcode;
    const mask = randomBytes(4);
    const masked = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
      masked[index] = payload[index] ^ mask[index % 4];
    }
    this.#socket.write(Buffer.concat([header, mask, masked]));
  }

  close() {
    if (!this.#socket) return;
    const socket = this.#socket;
    this.#socket = null;
    try {
      socket.end();
      socket.destroy();
    } catch {
      // Socket mungkin sudah tertutup.
    }
  }
}

const WebSocketImpl =
  process.env.KALIBATAKU_FORCE_WS_FALLBACK === "1" ? MinimalWebSocket : (globalThis.WebSocket ?? MinimalWebSocket);

/* ---------- Utilitas proses ---------- */

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Proses masih mulai.
    }
    await sleep(120);
  }
  throw new Error(`Batas waktu menunggu ${url}`);
}

async function waitForJson(url, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Chrome masih mulai.
    }
    await sleep(120);
  }
  throw new Error(`Batas waktu menunggu ${url}`);
}

async function openTarget(url, debugPort, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`,
        { method: "PUT" },
      );
      if (response.ok) return await response.json();
    } catch {
      // Chrome belum menerima target baru.
    }
    await sleep(120);
  }
  throw new Error("Batas waktu membuka tab Chrome");
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.socket = new WebSocketImpl(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          "Evaluasi di browser gagal",
      );
    }
    return response.result?.value;
  }

  close() {
    this.socket?.close();
  }
}

async function waitForExpression(cdp, expression, predicate, label, attempts = 80) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await cdp.evaluate(expression).catch(() => undefined);
    if (predicate(last)) return last;
    await sleep(100);
  }
  throw new Error(`Batas waktu menunggu ${label}; nilai terakhir: ${JSON.stringify(last)}`);
}

async function pressKey(cdp, key, code, windowsVirtualKeyCode, text) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    text,
    unmodifiedText: text,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let server;
let chrome;
let cdp;
const profileDirectory = mkdtempSync(join(tmpdir(), "kalibataku-smoke-"));

try {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      "Chrome/Chromium tidak ditemukan. Pasang Chrome atau atur variabel CHROME_PATH.",
    );
  }

  const appPort = await findFreePort();
  const debugPort = await findFreePort();
  const appUrl = `http://127.0.0.1:${appPort}/`;

  server = spawn(process.execPath, ["server.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(appPort) },
    stdio: "ignore",
  });
  await waitForHttp(appUrl);

  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDirectory}`,
      "--window-size=1440,1000",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await openTarget(appUrl, debugPort);
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");

  await waitForExpression(
    cdp,
    "Boolean(window.kalibataku && window.kalibataku.version)",
    (value) => value === true,
    "API Kalibataku siap",
  );

  const initial = await cdp.evaluate(`(() => {
    const start = document.getElementById("screen-start");
    return {
      title: document.title,
      lang: document.documentElement.lang,
      startVisible: !start.hidden,
      operations: document.querySelectorAll("button[data-operation]").length,
      difficulties: document.querySelectorAll("button[data-difficulty]").length,
      startLabel: document.getElementById("start-button").textContent.trim(),
      best: document.getElementById("best-value").textContent.trim(),
      apiVersion: window.kalibataku.version,
      overflow: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  })()`);

  assert(initial.lang === "id", `Bahasa dokumen salah: ${initial.lang}`);
  assert(initial.startVisible, "Layar mulai tidak tampil");
  assert(initial.operations === 5, `Jumlah tombol operasi salah: ${initial.operations}`);
  assert(initial.difficulties === 3, `Jumlah tombol tingkat salah: ${initial.difficulties}`);
  assert(initial.startLabel === "Mulai latihan", `Label tombol mulai salah: ${initial.startLabel}`);
  assert(initial.best.length > 0, "Catatan rekor kosong");
  assert(initial.overflow, "Layar mulai meluap secara horizontal di desktop");

  const selection = await cdp.evaluate(`(() => {
    document.querySelector('button[data-operation="tambah"]').click();
    document.querySelector('button[data-difficulty="mudah"]').click();
    const state = window.kalibataku.getState();
    return {
      operation: state.operation,
      difficulty: state.difficulty,
      operationPressed: document.querySelector('button[data-operation="tambah"]').getAttribute("aria-pressed"),
      difficultyPressed: document.querySelector('button[data-difficulty="mudah"]').getAttribute("aria-pressed"),
      bodyOperation: document.body.dataset.operation,
    };
  })()`);
  assert(selection.operation === "tambah", "Pemilihan operasi gagal");
  assert(selection.difficulty === "mudah", "Pemilihan tingkat gagal");
  assert(selection.operationPressed === "true", "aria-pressed operasi tidak diperbarui");
  assert(selection.difficultyPressed === "true", "aria-pressed tingkat tidak diperbarui");
  assert(selection.bodyOperation === "tambah", "Warna operasi tidak diterapkan");

  await cdp.evaluate('document.getElementById("start-button").click(); true');
  await waitForExpression(
    cdp,
    "window.kalibataku.getState().screen",
    (value) => value === "quiz",
    "layar kuis",
  );

  const quiz = await cdp.evaluate(`(() => {
    const state = window.kalibataku.getState();
    return {
      screen: state.screen,
      total: state.total,
      index: state.index,
      score: state.score,
      progress: document.getElementById("progress-label").textContent.trim(),
      answerButtons: document.querySelectorAll(".answer-btn").length,
      question: document.getElementById("question-text").textContent.trim(),
      ariaLive: document.getElementById("feedback").getAttribute("aria-live"),
      mode: document.getElementById("mode-label").textContent.trim(),
    };
  })()`);

  assert(quiz.screen === "quiz", "Layar kuis tidak aktif");
  assert(quiz.total === 10, `Jumlah soal salah: ${quiz.total}`);
  assert(quiz.index === 0, "Indeks soal awal salah");
  assert(quiz.progress === "Soal 1 / 10", `Progres awal salah: ${quiz.progress}`);
  assert(quiz.answerButtons === 4, `Jumlah tombol jawaban salah: ${quiz.answerButtons}`);
  assert(quiz.question.endsWith("= ?"), `Teks soal tidak valid: ${quiz.question}`);
  assert(quiz.ariaLive === "polite", "Umpan balik tidak memakai aria-live polite");
  assert(quiz.mode.includes("Tambah") && quiz.mode.includes("Mudah"), `Label mode salah: ${quiz.mode}`);

  const correctAnswer = await cdp.evaluate(`(() => {
    const question = window.kalibataku.getCurrentQuestion();
    const buttons = [...document.querySelectorAll(".answer-btn")];
    const button = buttons.find((item) => Number(item.dataset.value) === question.answer);
    button.click();
    const state = window.kalibataku.getState();
    const feedback = document.getElementById("feedback");
    return {
      answer: question.answer,
      score: state.score,
      answered: state.answered,
      allDisabled: [...document.querySelectorAll(".answer-btn")].every((item) => item.disabled),
      verdict: feedback.querySelector(".feedback-verdict")?.textContent.trim(),
      feedbackText: feedback.textContent.trim(),
      positive: feedback.classList.contains("feedback-correct"),
      correctMarked: button.classList.contains("is-correct"),
      nextVisible: !document.getElementById("feedback-actions").hidden,
      liveRegion: feedback.getAttribute("aria-live"),
    };
  })()`);

  assert(correctAnswer.score === 1, `Skor tidak naik setelah jawaban benar: ${correctAnswer.score}`);
  assert(correctAnswer.answered, "Status jawaban tidak terkunci");
  assert(correctAnswer.allDisabled, "Tombol jawaban tidak terkunci");
  assert(correctAnswer.verdict?.includes("Benar"), `Umpan balik positif tidak muncul: ${correctAnswer.verdict}`);
  assert(correctAnswer.positive, "Kelas umpan balik benar tidak diterapkan");
  assert(correctAnswer.correctMarked, "Jawaban benar tidak ditandai");
  assert(correctAnswer.nextVisible, "Tombol lanjut tidak muncul setelah umpan balik");
  assert(correctAnswer.liveRegion === "polite", "Wilayah umpan balik kehilangan aria-live");

  await cdp.evaluate('document.getElementById("next-button").click(); true');
  await waitForExpression(
    cdp,
    "window.kalibataku.getState().index",
    (value) => value === 1,
    "soal kedua",
  );

  const progressTwo = await cdp.evaluate(
    'document.getElementById("progress-label").textContent.trim()',
  );
  assert(progressTwo === "Soal 2 / 10", `Progres soal kedua salah: ${progressTwo}`);

  const wrongAnswer = await cdp.evaluate(`(() => {
    const question = window.kalibataku.getCurrentQuestion();
    const buttons = [...document.querySelectorAll(".answer-btn")];
    const button = buttons.find((item) => Number(item.dataset.value) !== question.answer);
    button.click();
    const state = window.kalibataku.getState();
    const feedback = document.getElementById("feedback");
    return {
      answer: question.answer,
      chosen: Number(button.dataset.value),
      score: state.score,
      answered: state.answered,
      verdict: feedback.querySelector(".feedback-verdict")?.textContent.trim(),
      answerLine: feedback.querySelector(".feedback-answer")?.textContent.trim(),
      negative: feedback.classList.contains("feedback-incorrect"),
      incorrectMarked: button.classList.contains("is-incorrect"),
      correctVisible: [...document.querySelectorAll(".answer-btn")].some(
        (item) => Number(item.dataset.value) === question.answer && item.classList.contains("is-correct"),
      ),
      allDisabled: [...document.querySelectorAll(".answer-btn")].every((item) => item.disabled),
    };
  })()`);

  assert(wrongAnswer.chosen !== wrongAnswer.answer, "Jawaban salah tidak ditemukan");
  assert(wrongAnswer.score === 1, `Skor berubah setelah jawaban salah: ${wrongAnswer.score}`);
  assert(wrongAnswer.answered, "Jawaban salah tidak terkunci");
  assert(wrongAnswer.allDisabled, "Tombol tidak terkunci setelah jawaban salah");
  assert(wrongAnswer.verdict?.includes("Belum tepat"), `Umpan balik salah tidak muncul: ${wrongAnswer.verdict}`);
  assert(wrongAnswer.negative, "Kelas umpan balik salah tidak diterapkan");
  assert(wrongAnswer.incorrectMarked, "Pilihan salah tidak ditandai");
  assert(wrongAnswer.correctVisible, "Jawaban benar tidak ditampilkan");
  assert(
    wrongAnswer.answerLine?.includes(`Jawaban benar: ${wrongAnswer.answer}`),
    `Teks jawaban benar tidak muncul: ${wrongAnswer.answerLine}`,
  );

  const finished = await cdp.evaluate(`(() => {
    for (let step = 0; step < 40; step += 1) {
      const current = window.kalibataku.getState();
      if (current.screen === "result") break;
      if (current.screen !== "quiz") throw new Error("Layar tak terduga saat menyelesaikan babak");
      if (!current.answered) {
        const answer = current.question.answer;
        const button = [...document.querySelectorAll(".answer-btn")].find(
          (item) => Number(item.dataset.value) === answer,
        );
        button.click();
      } else {
        document.getElementById("next-button").click();
      }
    }
    const state = window.kalibataku.getState();
    return {
      screen: state.screen,
      answeredCount: state.answers.filter((value) => value !== undefined).length,
      result: state.result,
    };
  })()`);

  assert(finished.screen === "result", `Layar hasil tidak muncul: ${finished.screen}`);
  assert(finished.answeredCount === 10, `Jumlah jawaban tersimpan salah: ${finished.answeredCount}`);

  const result = await cdp.evaluate(`(() => {
    const state = window.kalibataku.getState();
    return {
      visible: !document.getElementById("screen-result").hidden,
      scoreText: document.getElementById("result-score").textContent.trim(),
      percentage: document.getElementById("result-percentage").textContent.trim(),
      streakText: document.getElementById("result-streak").textContent.trim(),
      bestText: document.getElementById("result-best").textContent.trim(),
      recordText: document.getElementById("result-record").textContent.trim(),
      recordVisible: !document.getElementById("result-record").hidden,
      title: document.getElementById("result-title").textContent.trim(),
      playAgain: document.getElementById("play-again").textContent.trim(),
      changeMode: document.getElementById("change-mode").textContent.trim(),
      storedBest: localStorage.getItem("kalibataku:best:tambah:mudah"),
      result: state.result,
      overflow: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  })()`);

  assert(result.visible, "Layar hasil tersembunyi");
  assert(result.scoreText === "9", `Skor hasil salah: ${result.scoreText}`);
  assert(result.percentage === "90%", `Persentase hasil salah: ${result.percentage}`);
  assert(result.streakText === "8", `Runtutan terbaik salah: ${result.streakText}`);
  assert(result.bestText === "9 / 10", `Rekor hasil salah: ${result.bestText}`);
  assert(result.recordVisible && result.recordText.includes("Rekor baru"), "Rekor baru tidak diumumkan");
  assert(result.playAgain === "Main lagi", "Label tombol main lagi salah");
  assert(result.changeMode === "Ganti mode", "Label tombol ganti mode salah");
  assert(result.storedBest === "9", `Rekor tidak tersimpan di localStorage: ${result.storedBest}`);
  assert(result.overflow, "Layar hasil meluap di desktop");
  assert(result.result?.correct === 9, "Ringkasan hasil tidak konsisten");

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await sleep(300);

  const mobileResult = await cdp.evaluate(`(() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth <= innerWidth + 1,
    playAgainInside: (() => {
      const rect = document.getElementById("play-again").getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth + 0.5;
    })(),
  }))()`);
  assert(mobileResult.width === 360, `Lebar mobile salah: ${mobileResult.width}`);
  assert(mobileResult.overflow, "Layar hasil meluap di mobile");
  assert(mobileResult.playAgainInside, "Tombol main lagi keluar layar mobile");

  await cdp.evaluate('document.getElementById("change-mode").click(); true');
  await waitForExpression(
    cdp,
    "window.kalibataku.getState().screen",
    (value) => value === "start",
    "layar mulai mobile",
  );

  const mobileStart = await cdp.evaluate(`(() => {
    const card = document.querySelector(".setup-card").getBoundingClientRect();
    const start = document.getElementById("start-button").getBoundingClientRect();
    const chips = [...document.querySelectorAll("button[data-operation], button[data-difficulty]")].map(
      (button) => {
        const rect = button.getBoundingClientRect();
        return { left: Math.round(rect.left), right: Math.round(rect.right) };
      },
    );
    return {
      width: innerWidth,
      overflow: document.documentElement.scrollWidth <= innerWidth + 1,
      cardInside: card.left >= 0 && card.right <= innerWidth + 0.5,
      startInside: start.left >= 0 && start.right <= innerWidth + 0.5,
      chipsInside: chips.every((chip) => chip.left >= 0 && chip.right <= innerWidth + 0.5),
      chips,
    };
  })()`);

  assert(mobileStart.width === 360, `Lebar mulai mobile salah: ${mobileStart.width}`);
  assert(mobileStart.overflow, "Layar mulai meluap secara horizontal di 360 px");
  assert(mobileStart.cardInside, "Kartu pengaturan keluar layar mobile");
  assert(mobileStart.startInside, "Tombol mulai keluar layar mobile");
  assert(mobileStart.chipsInside, `Chip mode keluar layar: ${JSON.stringify(mobileStart.chips)}`);

  await cdp.evaluate('document.getElementById("start-button").click(); true');
  await waitForExpression(
    cdp,
    "window.kalibataku.getState().screen",
    (value) => value === "quiz",
    "kuis mobile",
  );

  const mobileQuiz = await cdp.evaluate(`(() => {
    const buttons = [...document.querySelectorAll(".answer-btn")];
    const grid = document.getElementById("answer-grid");
    return {
      width: innerWidth,
      overflow: document.documentElement.scrollWidth <= innerWidth + 1,
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
      buttons: buttons.length,
      enabled: buttons.every((button) => !button.disabled && !button.hidden),
      sizes: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      }),
      total: window.kalibataku.getState().total,
      index: window.kalibataku.getState().index,
      score: window.kalibataku.getState().score,
    };
  })()`);

  assert(mobileQuiz.overflow, "Kuis meluap secara horizontal di 360 px");
  assert(mobileQuiz.columns === 2, `Grid jawaban bukan 2 kolom: ${mobileQuiz.columns}`);
  assert(mobileQuiz.buttons === 4, "Tombol jawaban mobile tidak lengkap");
  assert(mobileQuiz.enabled, "Tombol jawaban mobile tidak dapat dipakai");
  assert(mobileQuiz.total === 10 && mobileQuiz.index === 0 && mobileQuiz.score === 0, "Babak baru tidak dimulai bersih");
  for (const size of mobileQuiz.sizes) {
    assert(size.width >= 120, `Tombol jawaban terlalu sempit: ${size.width}`);
    assert(size.height >= 44, `Tombol jawaban terlalu pendek: ${size.height}`);
    assert(size.left >= 0 && size.right <= 360.5, `Tombol jawaban keluar layar: ${JSON.stringify(size)}`);
  }

  await pressKey(cdp, "1", "Digit1", 49, "1");
  const keyboardAnswer = await waitForExpression(
    cdp,
    "({ answered: window.kalibataku.getState().answered, feedback: document.getElementById('feedback').textContent.trim() })",
    (value) => value?.answered === true,
    "jawaban lewat keyboard",
  );
  assert(keyboardAnswer.feedback.length > 0, "Umpan balik keyboard kosong");

  await pressKey(cdp, "Enter", "Enter", 13, "\r");
  await waitForExpression(
    cdp,
    "({ index: window.kalibataku.getState().index, answered: window.kalibataku.getState().answered })",
    (value) => value?.index === 1 && value?.answered === false,
    "lanjut lewat Enter",
  );

  const mobileAfterAdvance = await cdp.evaluate(`(() => {
    const button = document.querySelector(".answer-btn");
    button.click();
    const feedback = document.getElementById("feedback");
    return {
      overflow: document.documentElement.scrollWidth <= innerWidth + 1,
      answered: window.kalibataku.getState().answered,
      disabled: [...document.querySelectorAll(".answer-btn")].every((item) => item.disabled),
      feedbackVisible: feedback.classList.contains("is-visible") && feedback.textContent.trim().length > 0,
      nextWidth: Math.round(document.getElementById("next-button").getBoundingClientRect().width),
    };
  })()`);
  assert(mobileAfterAdvance.overflow, "Kuis dengan umpan balik meluap di mobile");
  assert(mobileAfterAdvance.answered && mobileAfterAdvance.disabled, "Tombol mobile tidak terkunci setelah menjawab");
  assert(mobileAfterAdvance.feedbackVisible, "Umpan balik mobile tidak tampil");
  assert(mobileAfterAdvance.nextWidth > 150, `Tombol lanjut mobile terlalu sempit: ${mobileAfterAdvance.nextWidth}`);

  const errors = cdp.events.filter((event) => {
    if (event.method === "Runtime.exceptionThrown") return true;
    if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") return true;
    if (event.method === "Log.entryAdded" && event.params.entry.level === "error") return true;
    return false;
  });
  if (errors.length) {
    throw new Error(`Error konsol browser: ${JSON.stringify(errors.slice(0, 3))}`);
  }

  console.log(
    "SMOKE_OK",
    JSON.stringify({
      initial,
      quiz,
      correctAnswer,
      wrongAnswer,
      result,
      mobileQuiz,
      platform: process.platform,
      node: process.version,
    }),
  );
} catch (error) {
  console.error("SMOKE_FAIL", error?.message ?? error);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (chrome?.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      chrome.kill("SIGKILL");
    }
  }
  if (server?.pid) server.kill();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      rmSync(profileDirectory, { recursive: true, force: true });
      break;
    } catch {
      await sleep(200);
    }
  }
}
