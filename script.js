const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJM_fPxtlc5UEyNf0DHLNg5B4tGIm8Qbba3k78kbQDRj9a9jGpSDRHwz_UOgAz4jbpcRJKHEUe1eNY/pub?gid=1431457859&single=true&output=csv";

const status = document.getElementById("status");
const content = document.getElementById("content");

const titleEl = document.getElementById("title");
const textEl = document.getElementById("text");
const imageEl = document.getElementById("image");

const b1 = document.getElementById("b1");
const b2 = document.getElementById("b2");
const b3 = document.getElementById("b3");

let ctx = null;
let buffers = [null, null, null];
let gains = [];
let sources = [];

let started = false;
let startTime = 0;
let pausedOffset = 0;
let duration = 0;
let rowData = null;
let audioReady = false;

function setStatus(message) {
  status.textContent = message;
  status.classList.remove("hidden");
}

function hideStatus() {
  status.classList.add("hidden");
}

function getId() {
  return (new URLSearchParams(location.search).get("id") || "").trim();
}

function parseCSVLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  out.push(current);
  return out;
}

function parseCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter(line => line.trim() !== "");
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.trim());

  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = (cols[i] || "").trim();
    });
    return row;
  });
}

async function loadCSVRow() {
  const id = getId();
  if (!id) {
    throw new Error("Falta el parámetro ?id=id_01");
  }

  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("No se pudo leer el CSV");
  }

  const txt = await res.text();
  const rows = parseCSV(txt);

  const row = rows.find(r => (r.identificador || "").trim() === id);
  if (!row) {
    throw new Error(`No se encontró la fila con identificador ${id}`);
  }

  return row;
}

function renderRow(row) {
  titleEl.textContent = row["título"] || "";
  textEl.textContent = row["texto"] || "";

  if (row["imagen"]) {
    imageEl.src = row["imagen"];
    imageEl.alt = row["título"] || "Imagen";
    imageEl.classList.remove("hidden");
  } else {
    imageEl.classList.add("hidden");
    imageEl.removeAttribute("src");
  }

  content.classList.remove("hidden");
}

async function ensureAudioContext() {
  if (!ctx) {
    ctx = new AudioContext();
  }

  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  if (gains.length === 0) {
    gains = [0, 1, 2].map(() => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(ctx.destination);
      return g;
    });
  }
}

async function fetchBuffer(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`No se pudo descargar el audio: ${url}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("audio") && !url.match(/\.(mp3|wav|ogg|m4a)(\?|$)/i)) {
    console.warn("La URL no parece devolver audio directamente:", url, contentType);
  }

  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}

async function prepareAudioOnce() {
  if (audioReady) return;

  await ensureAudioContext();

  const urls = [
    rowData.audio_01,
    rowData.audio_02,
    rowData.audio_03
  ];

  if (urls.some(url => !url)) {
    throw new Error("Falta alguna URL de audio en el CSV");
  }

  setStatus("Cargando audios...");

  buffers = await Promise.all(urls.map(fetchBuffer));
  duration = Math.min(...buffers.map(b => b.duration));

  if (!duration || !isFinite(duration)) {
    throw new Error("No se pudo calcular la duración de los audios");
  }

  audioReady = true;
  hideStatus();
}

function startAll(offset = 0) {
  stopAll();

  sources = buffers.map((buffer, i) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = duration;
    source.connect(gains[i]);
    source.start(0, offset);
    return source;
  });

  startTime = ctx.currentTime - offset;
  started = true;
}

function stopAll() {
  sources.forEach(source => {
    try {
      source.stop();
    } catch (_) {}
    try {
      source.disconnect();
    } catch (_) {}
  });

  sources = [];
  started = false;
}

function currentOffset() {
  if (!started) return pausedOffset;
  return (ctx.currentTime - startTime) % duration;
}

function anyTrackOn() {
  return gains.some(g => g.gain.value > 0);
}

function updateButtonStates() {
  [b1, b2, b3].forEach((button, i) => {
    const active = gains[i] && gains[i].gain.value > 0;
    button.classList.toggle("active", active);
  });
}

async function toggleTrack(index) {
  try {
    await prepareAudioOnce();

    if (!started) {
      startAll(pausedOffset);
    }

    const gain = gains[index];
    const isOn = gain.gain.value > 0;

    gain.gain.value = isOn ? 0 : 1;
    updateButtonStates();

    if (!anyTrackOn()) {
      pausedOffset = currentOffset();
      stopAll();
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Error de audio");
  }
}

function bindButtons() {
  b1.addEventListener("click", () => toggleTrack(0));
  b2.addEventListener("click", () => toggleTrack(1));
  b3.addEventListener("click", () => toggleTrack(2));
}

async function init() {
  try {
    setStatus("Cargando datos...");
    rowData = await loadCSVRow();
    renderRow(rowData);
    bindButtons();
    setStatus("Pulsa un botón para activar el audio");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Error al iniciar");
  }
}

init();
