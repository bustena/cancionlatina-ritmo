const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJM_fPxtlc5UEyNf0DHLNg5B4tGIm8Qbba3k78kbQDRj9a9jGpSDRHwz_UOgAz4jbpcRJKHEUe1eNY/pub?gid=1431457859&single=true&output=csv";

const status = document.getElementById("status");
const content = document.getElementById("content");

const titleEl = document.getElementById("title");
const textEl = document.getElementById("text");
const imageEl = document.getElementById("image");

const b1 = document.getElementById("b1");
const b2 = document.getElementById("b2");
const b3 = document.getElementById("b3");

let ctx;
let buffers = [];
let gains = [];
let sources = [];

let rowData;
let duration = 0;

let started = false;
let startTime = 0;
let pausedOffset = 0;

let ready = false;

function setStatus(t) {
  status.textContent = t;
}

function getId() {
  return new URLSearchParams(location.search).get("id");
}

/* ---------- CSV ---------- */

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");

  return lines.slice(1).map(line => {
    const values = line.split(",");
    let obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (values[i] || "").trim());
    return obj;
  });
}

async function loadData() {
  setStatus("Cargando datos...");

  const id = getId();
  if (!id) throw "Falta ?id=id_01";

  const res = await fetch(CSV_URL);
  const txt = await res.text();

  const rows = parseCSV(txt);
  const row = rows.find(r => r.identificador === id);

  if (!row) throw "ID no encontrado";

  return row;
}

/* ---------- RENDER ---------- */

function render(row) {
  titleEl.textContent = row["título"] || "";
  textEl.textContent = row["texto"] || "";

  if (row["imagen"]) {
    imageEl.src = row["imagen"];
    imageEl.classList.remove("hidden");
  }

  content.classList.remove("hidden");
}

/* ---------- AUDIO ---------- */

async function initAudio(row) {
  setStatus("Cargando audios...");

  ctx = new AudioContext();

  const urls = [row.audio_01, row.audio_02, row.audio_03];

  buffers = await Promise.all(
    urls.map(async url => {
      const r = await fetch(url);
      const arr = await r.arrayBuffer();
      return await ctx.decodeAudioData(arr);
    })
  );

  duration = Math.min(...buffers.map(b => b.duration));

  gains = buffers.map(() => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(ctx.destination);
    return g;
  });

  ready = true;
  setStatus("Listo");

  enableButtons();
}

function enableButtons() {
  [b1, b2, b3].forEach(b => b.disabled = false);
}

/* ---------- MOTOR ---------- */

function startAll(offset = 0) {
  sources = buffers.map((buf, i) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopEnd = duration;
    s.connect(gains[i]);
    s.start(0, offset);
    return s;
  });

  startTime = ctx.currentTime - offset;
  started = true;
}

function stopAll() {
  sources.forEach(s => {
    try { s.stop(); } catch {}
  });
  sources = [];
  started = false;
}

function currentOffset() {
  return (ctx.currentTime - startTime) % duration;
}

function anyOn() {
  return gains.some(g => g.gain.value > 0);
}

function updateButtons() {
  [b1, b2, b3].forEach((b, i) => {
    b.classList.toggle("active", gains[i].gain.value > 0);
  });
}

/* ---------- INTERACCIÓN ---------- */

async function toggle(i) {
  if (!ready) return;

  // primer gesto → activar audio
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  if (!started) {
    startAll(pausedOffset);
  }

  const g = gains[i];
  g.gain.value = g.gain.value > 0 ? 0 : 1;

  updateButtons();

  if (!anyOn()) {
    pausedOffset = currentOffset();
    stopAll();
    setStatus("Pausa");
  } else {
    setStatus("Reproduciendo");
  }
}

function bind() {
  b1.onclick = () => toggle(0);
  b2.onclick = () => toggle(1);
  b3.onclick = () => toggle(2);
}

/* ---------- INIT ---------- */

async function init() {
  try {
    disableButtons();

    rowData = await loadData();
    render(rowData);
    bind();

    await initAudio(rowData);

  } catch (e) {
    console.error(e);
    setStatus(e);
  }
}

function disableButtons() {
  [b1, b2, b3].forEach(b => b.disabled = true);
}

init();
