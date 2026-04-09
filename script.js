const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJM_fPxtlc5UEyNf0DHLNg5B4tGIm8Qbba3k78kbQDRj9a9jGpSDRHwz_UOgAz4jbpcRJKHEUe1eNY/pub?gid=1431457859&single=true&output=csv";

const statusEl = document.getElementById("status");
const contentEl = document.getElementById("content");
const titleEl = document.getElementById("title");
const textEl = document.getElementById("text");
const imageEl = document.getElementById("image");
const debugEl = document.getElementById("debug");

const b1 = document.getElementById("b1");
const b2 = document.getElementById("b2");
const b3 = document.getElementById("b3");

let audioContext = null;
let buffers = [null, null, null];
let gains = [];
let sources = [];

let rowData = null;
let duration = 0;
let started = false;
let startTime = 0;
let pausedOffset = 0;
let audioPrepared = false;

function getRequestedId() {
  return (new URLSearchParams(window.location.search).get("id") || "").trim();
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.classList.remove("hidden");
}

function showContent() {
  contentEl.classList.remove("hidden");
}

function debug(obj) {
  debugEl.textContent =
    typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

async function loadRowFromCSV() {
  const requestedId = getRequestedId();

  if (!requestedId) {
    throw new Error("Falta ?id=id_01");
  }

  const response = await fetch(CSV_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo cargar el CSV");
  }

  const csvText = await response.text();

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true
  });

  if (parsed.errors.length) {
    console.warn(parsed.errors);
  }

  const rows = parsed.data.map(row => {
    const clean = {};
    for (const key in row) {
      clean[key.trim()] = typeof row[key] === "string" ? row[key].trim() : row[key];
    }
    return clean;
  });

  const row = rows.find(r => (r.identificador || "") === requestedId);

  if (!row) {
    throw new Error(`No existe la fila ${requestedId}`);
  }

  return row;
}

function renderRow(row) {
  titleEl.textContent = row["título"] || "";
  textEl.textContent = row["texto"] || "";

  if (row["imagen"]) {
    imageEl.src = row["imagen"];
    imageEl.classList.remove("hidden");
  }

  debug({
    identificador: row["identificador"],
    audio_01: row["audio_01"],
    audio_02: row["audio_02"],
    audio_03: row["audio_03"]
  });
}

async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  if (gains.length === 0) {
    gains = [0, 1, 2].map(() => {
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      gain.connect(audioContext.destination);
      return gain;
    });
  }
}

async function fetchBuffer(url) {
  const response = await fetch(url, { cache: "no-store", mode: "cors" });
  if (!response.ok) {
    throw new Error(`No se pudo cargar audio: ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

async function prepareAudio() {
  if (audioPrepared) return;

  await ensureAudioContext();

  const urls = [
    rowData["audio_01"],
    rowData["audio_02"],
    rowData["audio_03"]
  ];

  debug({
    identificador: rowData["identificador"],
    audio_01: urls[0],
    audio_02: urls[1],
    audio_03: urls[2]
  });

  buffers = await Promise.all(urls.map(fetchBuffer));
  duration = Math.min(...buffers.map(b => b.duration));

  audioPrepared = true;

  b1.disabled = false;
  b2.disabled = false;
  b3.disabled = false;
}

function stopAll() {
  sources.forEach(source => {
    try { source.stop(); } catch (_) {}
    try { source.disconnect(); } catch (_) {}
  });
  sources = [];
  started = false;
}

function startAll(offset) {
  stopAll();

  sources = buffers.map((buffer, i) => {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = duration;
    source.connect(gains[i]);
    source.start(0, offset);
    return source;
  });

  startTime = audioContext.currentTime - offset;
  started = true;
}

function currentOffset() {
  if (!started) return pausedOffset;
  return (audioContext.currentTime - startTime) % duration;
}

function anyOn() {
  return gains.some(g => g.gain.value > 0);
}

function updateButtons() {
  [b1, b2, b3].forEach((button, i) => {
    button.classList.toggle("active", gains[i].gain.value > 0);
  });
}

async function toggleTrack(index) {
  try {
    await prepareAudio();

    if (!started) {
      startAll(pausedOffset);
    }

    const gain = gains[index];
    gain.gain.value = gain.gain.value > 0 ? 0 : 1;

    updateButtons();

    if (!anyOn()) {
      pausedOffset = currentOffset();
      stopAll();
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Error de audio");
  }
}

function bindEvents() {
  b1.addEventListener("click", () => toggleTrack(0));
  b2.addEventListener("click", () => toggleTrack(1));
  b3.addEventListener("click", () => toggleTrack(2));
}

async function init() {
  try {
    setStatus("Cargando datos...");
    rowData = await loadRowFromCSV();
    renderRow(rowData);
    bindEvents();
    showContent();
    setStatus("Pulsa un botón");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Error");
  }
}

init();
