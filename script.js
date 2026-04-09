const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJM_fPxtlc5UEyNf0DHLNg5B4tGIm8Qbba3k78kbQDRj9a9jGpSDRHwz_UOgAz4jbpcRJKHEUe1eNY/pub?gid=1431457859&single=true&output=csv";

const statusEl = document.getElementById("status");
const contentEl = document.getElementById("content");
const textEl = document.getElementById("text");
const imageEl = document.getElementById("image");

function getRequestedId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
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
    .filter(line => line.trim() !== "");

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

function showContent(row) {
  textEl.textContent = row.texto || "";

  if (row.imagen) {
    imageEl.src = row.imagen;
    imageEl.alt = row.identificador || "Imagen";
    imageEl.classList.remove("hidden");
  } else {
    imageEl.classList.add("hidden");
  }

  statusEl.classList.add("hidden");
  contentEl.classList.remove("hidden");
}

async function init() {
  const requestedId = getRequestedId();

  if (!requestedId) {
    showError("Falta el parámetro ?id=id_01");
    return;
  }

  try {
    const response = await fetch(CSV_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("No se pudo cargar el CSV");
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText);

    const row = rows.find(item => item.identificador === requestedId);

    if (!row) {
      showError(`No existe el identificador ${requestedId}`);
      return;
    }

    showContent(row);
  } catch (error) {
    console.error(error);
    showError("Error al leer el CSV");
  }
}

init();
