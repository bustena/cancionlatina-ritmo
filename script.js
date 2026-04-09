const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJM_fPxtlc5UEyNf0DHLNg5B4tGIm8Qbba3k78kbQDRj9a9jGpSDRHwz_UOgAz4jbpcRJKHEUe1eNY/pub?gid=1431457859&single=true&output=csv";

const statusEl = document.getElementById("status");
const contentEl = document.getElementById("content");

const titleEl = document.getElementById("title");
const textEl = document.getElementById("text");
const imageEl = document.getElementById("image");

const b1 = document.getElementById("b1");
const b2 = document.getElementById("b2");
const b3 = document.getElementById("b3");

let rowData = null;

let players = [];
let trackEnabled = [false, false, false];
let ready = false;

let duration = 0;
let isRunning = false;
let pausedOffset = 0;
let masterStartPerf = 0;

let syncTimer = null;

function setStatus(message) {
  statusEl.textContent = message;
}

function getRequestedId() {
  return (new URLSearchParams(window.location.search).get("id") || "").trim();
}

function disableButtons() {
  [b1, b2, b3].forEach(btn => {
    btn.disabled = true;
  });
}

function enableButtons() {
  [b1, b2, b3].forEach(btn => {
    btn.disabled = false;
  });
}

function updateButtons() {
  [b1, b2, b3].forEach((btn, index) => {
    btn.classList.toggle("active", trackEnabled[index]);
  });
}

function nowSeconds() {
  return performance.now() / 1000;
}

function getMasterOffset() {
  if (!isRunning || duration <= 0) {
    return pausedOffset;
  }

  return (nowSeconds() - masterStartPerf) % duration;
}

function allTracksOff() {
  return trackEnabled.every(value => !value);
}

function pauseAllPlayers() {
  players.forEach(player => {
    player.pause();
  });
}

function stopSyncTimer() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

function startSyncTimer() {
  stopSyncTimer();

  syncTimer = setInterval(() => {
    if (!isRunning || duration <= 0) return;

    const target = getMasterOffset();

    players.forEach((player, index) => {
      if (!trackEnabled[index]) return;
      if (player.paused) return;

      let diff = Math.abs(player.currentTime - target);

      if (diff > duration / 2) {
        diff = Math.abs(diff - duration);
      }

      if (diff > 0.08) {
        player.currentTime = target;
      }
    });
  }, 200);
}

function startClock(offset = 0) {
  masterStartPerf = nowSeconds() - offset;
  isRunning = true;
  startSyncTimer();
}

function pauseClock() {
  pausedOffset = getMasterOffset();
  isRunning = false;
  stopSyncTimer();
}

function syncAndPlayTrack(index) {
  const player = players[index];
  const offset = getMasterOffset();

  player.currentTime = offset;
  player.play().catch(error => {
    console.error("Error al reproducir pista", index + 1, error);
  });
}

function normalizeHeader(header) {
  return header
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mapRow(row) {
  const normalized = {};

  for (const key in row) {
    normalized[normalizeHeader(key)] = String(row[key] || "").trim();
  }

  return {
    identificador: normalized.identificador || "",
    titulo: normalized.titulo || "",
    texto: normalized.texto || "",
    imagen: normalized.imagen || "",
    audio_01: normalized.audio_01 || "",
    audio_02: normalized.audio_02 || "",
    audio_03: normalized.audio_03 || ""
  };
}

function loadRowFromCSV() {
  return new Promise((resolve, reject) => {
    const requestedId = getRequestedId();

    if (!requestedId) {
      reject(new Error("Falta ?id=id_01"));
      return;
    }

    Papa.parse(CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        const rows = results.data.map(mapRow);
        const row = rows.find(item => item.identificador === requestedId);

        if (!row) {
          reject(new Error(`No existe la fila ${requestedId}`));
          return;
        }

        resolve(row);
      },
      error: function() {
        reject(new Error("No se ha podido leer el CSV"));
      }
    });
  });
}

function renderRow(row) {
  titleEl.textContent = row.titulo || "";
  textEl.textContent = row.texto || "";

  if (row.imagen) {
    imageEl.src = row.imagen;
    imageEl.alt = row.titulo || "Imagen";
    imageEl.classList.remove("hidden");
  } else {
    imageEl.classList.add("hidden");
  }

  contentEl.classList.remove("hidden");
}

function waitForPlayer(player) {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve(player);
    };

    const onError = () => {
      cleanup();
      reject(new Error(`No se pudo cargar ${player.src}`));
    };

    const cleanup = () => {
      player.removeEventListener("canplaythrough", onReady);
      player.removeEventListener("loadedmetadata", onReady);
      player.removeEventListener("error", onError);
    };

    player.addEventListener("canplaythrough", onReady, { once: true });
    player.addEventListener("loadedmetadata", onReady, { once: true });
    player.addEventListener("error", onError, { once: true });

    player.load();
  });
}

async function preparePlayers(row) {
  const urls = [row.audio_01, row.audio_02, row.audio_03];

  if (urls.some(url => !url)) {
    throw new Error("Falta alguna URL de audio");
  }

  players = urls.map(url => {
    const audio = new Audio();
    audio.src = url;
    audio.preload = "auto";
    audio.loop = true;
    audio.playsInline = true;
    return audio;
  });

  await Promise.all(players.map(waitForPlayer));

  const durations = players
    .map(player => Number(player.duration))
    .filter(value => Number.isFinite(value) && value > 0);

  if (!durations.length) {
    throw new Error("No se pudo leer la duración de los audios");
  }

  duration = Math.min(...durations);
  ready = true;
}

function toggleTrack(index) {
  if (!ready) return;

  const wasEnabled = trackEnabled[index];
  trackEnabled[index] = !wasEnabled;

  if (trackEnabled[index]) {
    if (!isRunning) {
      startClock(pausedOffset);
    }

    syncAndPlayTrack(index);
  } else {
    players[index].pause();
  }

  if (allTracksOff()) {
    pauseClock();
    pauseAllPlayers();
    setStatus("Pausa");
  } else {
    const target = getMasterOffset();

    players.forEach((player, i) => {
      if (!trackEnabled[i]) return;

      const diff = Math.abs(player.currentTime - target);
      if (diff > 0.08) {
        player.currentTime = target;
      }

      if (player.paused) {
        player.play().catch(error => {
          console.error("Error al reanudar pista", i + 1, error);
        });
      }
    });

    setStatus("Reproduciendo");
  }

  updateButtons();
}

function bindEvents() {
  b1.addEventListener("click", () => toggleTrack(0));
  b2.addEventListener("click", () => toggleTrack(1));
  b3.addEventListener("click", () => toggleTrack(2));
}

async function init() {
  try {
    disableButtons();
    setStatus("Cargando datos...");

    rowData = await loadRowFromCSV();
    renderRow(rowData);

    setStatus("Cargando audios...");
    await preparePlayers(rowData);

    bindEvents();
    enableButtons();
    updateButtons();
    setStatus("Listo");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Error");
  }
}

init();
