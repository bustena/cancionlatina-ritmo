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

let started = false;
let startTime = 0;
let pausedOffset = 0;
let duration = 0;

function getId() {
  return new URLSearchParams(location.search).get("id");
}

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

async function load() {
  const id = getId();
  if (!id) return status.textContent = "Falta ?id=";

  const res = await fetch(CSV_URL);
  const txt = await res.text();
  const rows = parseCSV(txt);

  const row = rows.find(r => r.identificador === id);
  if (!row) return status.textContent = "ID no encontrado";

  // contenido
  titleEl.textContent = row["título"];
  textEl.textContent = row["texto"];

  if (row["imagen"]) {
    imageEl.src = row["imagen"];
    imageEl.classList.remove("hidden");
  }

  content.classList.remove("hidden");
  status.classList.add("hidden");

  await setupAudio(row);
}

async function setupAudio(row) {
  ctx = new AudioContext();

  const urls = [row.audio_01, row.audio_02, row.audio_03];

  buffers = await Promise.all(
    urls.map(async url => {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
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

  bindButtons();
}

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
  sources.forEach(s => s.stop());
  sources = [];
  started = false;
}

function currentOffset() {
  return (ctx.currentTime - startTime) % duration;
}

function toggle(i, button) {
  if (!started) {
    startAll(pausedOffset);
  }

  const g = gains[i];
  const active = g.gain.value > 0;

  if (active) {
    g.gain.value = 0;
    button.classList.remove("active");
  } else {
    g.gain.value = 1;
    button.classList.add("active");
  }

  // si todas apagadas → parar
  if (gains.every(g => g.gain.value === 0)) {
    pausedOffset = currentOffset();
    stopAll();
  }
}

function bindButtons() {
  b1.onclick = () => toggle(0, b1);
  b2.onclick = () => toggle(1, b2);
  b3.onclick = () => toggle(2, b3);
}

load();
