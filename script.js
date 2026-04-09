const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJM_fPxtlc5UEyNf0DHLNg5B4tGIm8Qbba3k78kbQDRj9a9jGpSDRHwz_UOgAz4jbpcRJKHEUe1eNY/pub?gid=1431457859&single=true&output=csv";

const statusEl = document.getElementById("status");
const contentEl = document.getElementById("content");
const titleEl = document.getElementById("title");
const textEl = document.getElementById("text");
const imageEl = document.getElementById("image");

const buttons = {
  audio_01: document.getElementById("btn-audio-1"),
  audio_02: document.getElementById("btn-audio-2"),
  audio_03: document.getElementById("btn-audio-3")
};

let audioContext = null;
let audioBuffers = {
  audio_01: null,
  audio_02: null,
  audio_03: null
};

let trackState = {
  audio_01: { active: false, source: null },
  audio_02: { active: false, source: null },
  audio_03: { active: false, source: null }
};

let masterClock = {
  isRunning: false,
  startContextTime: 0,
  pausedOffset: 0,
  duration: 0
};

function getRequestedId() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("id") || "").trim();
}

function normalize(value) {
  return (value || "").trim().toLowerCase();
}

function parseCSVLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== "");

  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.trim());

  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = (cols[index] || "").trim();
    });

    return row;
  });
}

function showError(message) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
  contentEl.classList.add("hidden");
}

function showContent() {
  statusEl.classList.add("hidden");
  contentEl.classList.remove("hidden");
}

function setButtonsDisabled(disabled) {
  Object.values(buttons).forEach(button => {
    button.disabled = disabled;
  });
}

function updateButtonStates() {
  Object.entries(buttons).forEach(([key, button]) => {
    button.classList.toggle("active", trackState[key].active);
  });
}

function getHeaders(row) {
  return Object.keys(row || {});
}

function getRowValue(row, candidateNames) {
  const headers = getHeaders(row);

  for (const name of candidateNames) {
    const found = headers.find(key => normalize(key) === normalize(name));
    if (found) return row[found];
  }

  return "";
}

function findRowById(rows, requestedId) {
  if (!rows.length) return null;

  return rows.find(
    row => normalize(row["Vals peruano"]) === normalize(requestedId)
  ) || null;
}

function fillContent(row) {
  const title = getRowValue(row, ["título", "titulo"]);
  const text = getRowValue(row, ["texto"]);
  const image = getRowValue(row, ["imagen"]);

  titleEl.textContent = title || "";
  textEl.textContent = text || "";

  if (image) {
    imageEl.src = image;
    imageEl.alt = title || text || "Imagen";
    imageEl.classList.remove("hidden");
  } else {
    imageEl.classList.add("hidden");
    imageEl.removeAttribute("src");
  }
}

async function fetchCSVRows() {
  const response = await fetch(CSV_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("No se pudo cargar el CSV");
  }

  const csvText = await response.text();
  return parseCSV(csvText);
}

async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

async function fetchAudioBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo cargar el audio: ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

async function loadAudioBuffers(row) {
  const audioUrls = {
    audio_01: getRowValue(row, ["audio_01"]),
    audio_02: getRowValue(row, ["audio_02"]),
    audio_03: getRowValue(row, ["audio_03"])
  };

  for (const [key, url] of Object.entries(audioUrls)) {
    if (!url) {
      throw new Error(`Falta la URL de ${key}`);
    }
  }

  const [buffer1, buffer2, buffer3] = await Promise.all([
    fetchAudioBuffer(audioUrls.audio_01),
    fetchAudioBuffer(audioUrls.audio_02),
    fetchAudioBuffer(audioUrls.audio_03)
  ]);

  audioBuffers.audio_01 = buffer1;
  audioBuffers.audio_02 = buffer2;
  audioBuffers.audio_03 = buffer3;

  const durations = [buffer1.duration, buffer2.duration, buffer3.duration];
  masterClock.duration = Math.min(...durations);
}

function getCurrentMasterOffset() {
  if (!masterClock.duration) return 0;

  if (!masterClock.isRunning) {
    return masterClock.pausedOffset % masterClock.duration;
  }

  const elapsed = audioContext.currentTime - masterClock.startContextTime;
  return (masterClock.pausedOffset + elapsed) % masterClock.duration;
}

function startMasterClock() {
  if (masterClock.isRunning) return;

  masterClock.startContextTime = audioContext.currentTime;
  masterClock.isRunning = true;
}

function pauseMasterClock() {
  if (!masterClock.isRunning) return;

  masterClock.pausedOffset = getCurrentMasterOffset();
  masterClock.isRunning = false;
}

function stopTrackSource(trackKey) {
  const state = trackState[trackKey];

  if (state.source) {
    try {
      state.source.stop();
    } catch (error) {
      // Ignorar si ya estaba detenida
    }

    state.source.disconnect();
    state.source = null;
  }
}

function startTrackSource(trackKey, offset) {
  const buffer = audioBuffers[trackKey];
  if (!buffer) return;

  stopTrackSource(trackKey);

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = masterClock.duration || buffer.duration;
  source.connect(audioContext.destination);

  source.start(0, offset);

  trackState[trackKey].source = source;
}

function hasAnyActiveTrack() {
  return Object.values(trackState).some(track => track.active);
}

function syncAllActiveTracks() {
  const offset = getCurrentMasterOffset();

  Object.keys(trackState).forEach(trackKey => {
    if (trackState[trackKey].active) {
      startTrackSource(trackKey, offset);
    }
  });
}

async function toggleTrack(trackKey) {
  await ensureAudioContext();

  const state = trackState[trackKey];

  if (!state.active) {
    state.active = true;

    if (!masterClock.isRunning) {
      startMasterClock();
    }

    const offset = getCurrentMasterOffset();
    startTrackSource(trackKey, offset);
  } else {
    state.active = false;
    stopTrackSource(trackKey);

    if (!hasAnyActiveTrack()) {
      pauseMasterClock();
    }
  }

  updateButtonStates();
}

function bindButtons() {
  buttons.audio_01.addEventListener("click", () => toggleTrack("audio_01"));
  buttons.audio_02.addEventListener("click", () => toggleTrack("audio_02"));
  buttons.audio_03.addEventListener("click", () => toggleTrack("audio_03"));
}

async function init() {
  setButtonsDisabled(true);

  try {
    const requestedId = getRequestedId();

    if (!requestedId) {
      showError("Falta el parámetro ?id=id_01");
      return;
    }

    const rows = await fetchCSVRows();
    const row = findRowById(rows, requestedId);

    if (!row) {
      showError(`No existe ninguna fila para ${requestedId}`);
      return;
    }

    fillContent(row);
    showContent();
    bindButtons();

    statusEl.textContent = "Toca una pista para cargar el audio";

    await ensureAudioContext();
    await loadAudioBuffers(row);

    setButtonsDisabled(false);
    statusEl.classList.add("hidden");
  } catch (error) {
    console.error(error);
    showError("Error al cargar datos o audios");
  }
}

init();
