const STORAGE_KEY = "makelrc.autosave.v2";
const RETAKE_MARGIN_SECONDS = 2.5;
const SEEK_STEP_SECONDS = 3;

const elements = {
  audioFileInput: document.querySelector("#audioFileInput"),
  audioPlayer: document.querySelector("#audioPlayer"),
  lyricsInput: document.querySelector("#lyricsInput"),
  pasteButton: document.querySelector("#pasteButton"),
  playPauseButton: document.querySelector("#playPauseButton"),
  stampButton: document.querySelector("#stampButton"),
  retakeButton: document.querySelector("#retakeButton"),
  previousButton: document.querySelector("#previousButton"),
  nextButton: document.querySelector("#nextButton"),
  backButton: document.querySelector("#backButton"),
  forwardButton: document.querySelector("#forwardButton"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  clearTimingsButton: document.querySelector("#clearTimingsButton"),
  copyOutputButton: document.querySelector("#copyOutputButton"),
  downloadButton: document.querySelector("#downloadButton"),
  helpButton: document.querySelector("#helpButton"),
  helpPanel: document.querySelector("#helpPanel"),
  formatSelect: document.querySelector("#formatSelect"),
  outputPreview: document.querySelector("#outputPreview"),
  currentTime: document.querySelector("#currentTime"),
  activeLine: document.querySelector("#activeLine"),
  lineCount: document.querySelector("#lineCount"),
  saveStatus: document.querySelector("#saveStatus"),
  tapZone: document.querySelector("#tapZone"),
};

const state = {
  lines: [],
  activeIndex: 0,
  timings: [],
  undoStack: [],
  redoStack: [],
  audioUrl: "",
  saveTimer: 0,
};

function normalizeLyrics(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseLines(text) {
  const normalized = normalizeLyrics(text);
  return normalized ? normalized.split("\n") : [];
}

function formatLrcTime(seconds) {
  if (!Number.isFinite(seconds)) return "--:--.--";
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(totalCentiseconds / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function formatSrtTime(seconds) {
  const millis = Math.max(0, Math.round((seconds || 0) * 1000));
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor((millis % 3600000) / 60000);
  const secs = Math.floor((millis % 60000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function formatWebVttTime(seconds) {
  return formatSrtTime(seconds).replace(",", ".");
}

function getOutputRows() {
  return state.lines.map((text, index) => ({
    index,
    text,
    time: state.timings[index],
  }));
}

function buildOutput() {
  const rows = getOutputRows();
  const format = elements.formatSelect.value;

  if (format === "webvtt") {
    const cues = rows.map((row, index) => {
      const start = Number.isFinite(row.time) ? row.time : 0;
      const nextTime = rows.slice(index + 1).find((candidate) => Number.isFinite(candidate.time))?.time;
      const end = Math.max(start + 0.2, Number.isFinite(nextTime) ? nextTime : start + 4);
      return `${formatWebVttTime(start)} --> ${formatWebVttTime(end)}\n${row.text}`;
    });
    return ["WEBVTT", "", ...cues].join("\n\n");
  }

  if (format === "srt") {
    return rows
      .map((row, index) => {
        const start = Number.isFinite(row.time) ? row.time : 0;
        const nextTime = rows.slice(index + 1).find((candidate) => Number.isFinite(candidate.time))?.time;
        const end = Math.max(start + 0.2, Number.isFinite(nextTime) ? nextTime : start + 4);
        return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${row.text}`;
      })
      .join("\n\n");
  }

  return rows
    .map((row) => `[${formatLrcTime(row.time)}]${row.text}`)
    .join("\n");
}

function pushUndo() {
  state.undoStack.push({
    timings: [...state.timings],
    activeIndex: state.activeIndex,
  });
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack = [];
}

function restoreSnapshot(snapshot) {
  state.timings = [...snapshot.timings];
  state.activeIndex = clampLineIndex(snapshot.activeIndex);
  render();
  scheduleSave();
}

function clampLineIndex(index) {
  return Math.min(Math.max(index, 0), Math.max(0, state.lines.length - 1));
}

function stampCurrentLine() {
  if (!state.lines.length) return;
  pushUndo();
  state.timings[state.activeIndex] = elements.audioPlayer.currentTime || 0;
  state.activeIndex = clampLineIndex(state.activeIndex + 1);
  render();
  scheduleSave();
}

function retakeCurrentLine() {
  if (!state.lines.length) return;
  const currentTime = state.timings[state.activeIndex];
  const seekTo = Number.isFinite(currentTime)
    ? Math.max(0, currentTime - RETAKE_MARGIN_SECONDS)
    : Math.max(0, (elements.audioPlayer.currentTime || 0) - RETAKE_MARGIN_SECONDS);
  elements.audioPlayer.currentTime = seekTo;
  elements.saveStatus.textContent = "Ready to retake";
  elements.audioPlayer.play().catch(() => {});
  render();
}

function moveActive(delta) {
  if (!state.lines.length) return;
  state.activeIndex = clampLineIndex(state.activeIndex + delta);
  render();
  scheduleSave();
}

function seekBy(delta) {
  elements.audioPlayer.currentTime = Math.max(0, (elements.audioPlayer.currentTime || 0) + delta);
  render();
}

function undo() {
  const snapshot = state.undoStack.pop();
  if (!snapshot) return;
  state.redoStack.push({ timings: [...state.timings], activeIndex: state.activeIndex });
  restoreSnapshot(snapshot);
}

function redo() {
  const snapshot = state.redoStack.pop();
  if (!snapshot) return;
  state.undoStack.push({ timings: [...state.timings], activeIndex: state.activeIndex });
  restoreSnapshot(snapshot);
}

function clearTimings() {
  pushUndo();
  state.timings = [];
  state.activeIndex = 0;
  render();
  scheduleSave();
}

function syncLinesFromInput() {
  const normalized = normalizeLyrics(elements.lyricsInput.value);
  if (elements.lyricsInput.value !== normalized) {
    elements.lyricsInput.value = normalized;
  }
  const nextLines = parseLines(normalized);
  state.lines = nextLines;
  state.timings.length = nextLines.length;
  state.activeIndex = clampLineIndex(state.activeIndex);
  render();
  scheduleSave();
}

function render() {
  const activeText = state.lines[state.activeIndex]?.trim();
  elements.currentTime.textContent = formatLrcTime(elements.audioPlayer.currentTime || 0);
  elements.activeLine.textContent = activeText || "Enter lyrics to start";
  elements.lineCount.textContent = `${state.lines.length} lines`;
  elements.undoButton.disabled = state.undoStack.length === 0;
  elements.redoButton.disabled = state.redoStack.length === 0;
  renderOutputPreview();
}

function renderOutputPreview() {
  elements.outputPreview.textContent = "";
  const rows = getOutputRows();

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "output-empty";
    empty.textContent = "Output will appear here.";
    elements.outputPreview.append(empty);
    return;
  }

  for (const row of rows) {
    const line = document.createElement("div");
    line.className = `output-line${row.index === state.activeIndex ? " is-active" : ""}`;

    const time = document.createElement("span");
    time.className = "output-time";
    time.textContent = `[${formatLrcTime(row.time)}]`;

    const lyric = document.createElement("span");
    lyric.textContent = row.text;

    line.append(time, lyric);
    elements.outputPreview.append(line);
  }

  elements.outputPreview.querySelector(".is-active")?.scrollIntoView({
    block: "nearest",
  });
}

function scheduleSave() {
  elements.saveStatus.textContent = "Saving...";
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveDraft, 200);
}

function saveDraft() {
  const payload = {
    lyrics: elements.lyricsInput.value,
    timings: state.timings,
    activeIndex: state.activeIndex,
    format: elements.formatSelect.value,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    elements.saveStatus.textContent = "Draft saved";
  } catch {
    elements.saveStatus.textContent = "Draft save failed";
  }
}

function loadDraft() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    elements.lyricsInput.value = normalizeLyrics(draft.lyrics || "");
    elements.formatSelect.value = draft.format || "lrc";
    state.lines = parseLines(elements.lyricsInput.value);
    state.timings = Array.isArray(draft.timings) ? draft.timings : [];
    state.activeIndex = Number.isInteger(draft.activeIndex) ? draft.activeIndex : 0;
    elements.saveStatus.textContent = "Draft restored";
  } catch {
    elements.saveStatus.textContent = "Draft restore failed";
  }
}

async function pasteLyrics() {
  if (!navigator.clipboard?.readText) {
    elements.lyricsInput.focus();
    return;
  }
  const text = await navigator.clipboard.readText();
  if (!text) return;
  elements.lyricsInput.value = normalizeLyrics(text);
  syncLinesFromInput();
}

async function copyOutput() {
  const text = buildOutput();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    elements.saveStatus.textContent = "Copied";
  } catch {
    const textarea = document.createElement("textarea");
    textarea.className = "output-copy-source";
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    elements.saveStatus.textContent = "Copied";
  }
}

function downloadOutput() {
  const text = buildOutput();
  if (!text) return;
  const extension = elements.formatSelect.value === "webvtt" ? "vtt" : elements.formatSelect.value === "srt" ? "srt" : "lrc";
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lyrics.${extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function togglePlayback() {
  if (elements.audioPlayer.paused) {
    elements.audioPlayer.play().catch(() => {
      elements.saveStatus.textContent = "Playback failed";
    });
  } else {
    elements.audioPlayer.pause();
  }
}

function toggleHelp() {
  const isHidden = elements.helpPanel.hidden;
  elements.helpPanel.hidden = !isHidden;
  elements.helpButton.setAttribute("aria-expanded", String(isHidden));
}

function isEditableTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}

function bindEvents() {
  elements.audioFileInput.addEventListener("change", () => {
    const file = elements.audioFileInput.files?.[0];
    if (!file) return;
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = URL.createObjectURL(file);
    elements.audioPlayer.src = state.audioUrl;
    elements.saveStatus.textContent = file.name;
  });

  elements.lyricsInput.addEventListener("input", syncLinesFromInput);
  elements.formatSelect.addEventListener("change", () => {
    render();
    scheduleSave();
  });

  elements.pasteButton.addEventListener("click", pasteLyrics);
  elements.playPauseButton.addEventListener("click", togglePlayback);
  elements.stampButton.addEventListener("click", stampCurrentLine);
  elements.retakeButton.addEventListener("click", retakeCurrentLine);
  elements.tapZone.addEventListener("click", stampCurrentLine);
  elements.previousButton.addEventListener("click", () => moveActive(-1));
  elements.nextButton.addEventListener("click", () => moveActive(1));
  elements.backButton.addEventListener("click", () => seekBy(-SEEK_STEP_SECONDS));
  elements.forwardButton.addEventListener("click", () => seekBy(SEEK_STEP_SECONDS));
  elements.undoButton.addEventListener("click", undo);
  elements.redoButton.addEventListener("click", redo);
  elements.clearTimingsButton.addEventListener("click", clearTimings);
  elements.copyOutputButton.addEventListener("click", copyOutput);
  elements.downloadButton.addEventListener("click", downloadOutput);
  elements.helpButton.addEventListener("click", toggleHelp);
  elements.audioPlayer.addEventListener("timeupdate", render);
  elements.audioPlayer.addEventListener("loadedmetadata", render);

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (key === "?" && !isEditableTarget(event.target)) {
      event.preventDefault();
      toggleHelp();
      return;
    }

    if (isEditableTarget(event.target)) return;

    if (event.code === "Space" && event.shiftKey) {
      event.preventDefault();
      togglePlayback();
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      stampCurrentLine();
      return;
    }

    if (key === "r") {
      event.preventDefault();
      retakeCurrentLine();
      return;
    }

    if (event.code === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }

    if (event.code === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }

    if (key === "j") {
      event.preventDefault();
      seekBy(-SEEK_STEP_SECONDS);
      return;
    }

    if (key === "k") {
      event.preventDefault();
      seekBy(SEEK_STEP_SECONDS);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      undo();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();
      redo();
    }
  });

  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 320) event.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );
}

loadDraft();
bindEvents();
syncLinesFromInput();
