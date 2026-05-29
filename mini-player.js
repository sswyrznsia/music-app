const miniStatus = document.querySelector("#miniStatus");
const miniTitle = document.querySelector("#miniTitle");
const miniArtist = document.querySelector("#miniArtist");
const miniSeek = document.querySelector("#miniSeek");
const miniPosition = document.querySelector("#miniPosition");
const miniDuration = document.querySelector("#miniDuration");
const miniRepeat = document.querySelector("#miniRepeat");
const miniPrev = document.querySelector("#miniPrev");
const miniPlay = document.querySelector("#miniPlay");
const miniNext = document.querySelector("#miniNext");
const miniShuffle = document.querySelector("#miniShuffle");
const miniLoopStart = document.querySelector("#miniLoopStart");
const miniLoopEnd = document.querySelector("#miniLoopEnd");
const miniLoopClear = document.querySelector("#miniLoopClear");
const miniVolume = document.querySelector("#miniVolume");
const miniDark = document.querySelector("#miniDark");

let currentDuration = 0;
let currentPosition = 0;
let currentLoopStart = 0;
let currentLoopEnd = 0;
let isSeeking = false;

miniRepeat.addEventListener("click", () => sendCommand("toggle-repeat-one"));
miniPrev.addEventListener("click", () => sendCommand("previous-track"));
miniPlay.addEventListener("click", () => sendCommand("toggle-play"));
miniNext.addEventListener("click", () => sendCommand("next-track"));
miniShuffle.addEventListener("click", () => sendCommand("toggle-shuffle"));
miniLoopStart.addEventListener("click", () => {
  sendCommand({
    type: "set-loop-start",
    position: getCurrentPosition(),
  });
});
miniLoopStart.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  sendCommand("clear-loop-start");
});
miniLoopEnd.addEventListener("click", () => {
  sendCommand({
    type: "set-loop-end",
    position: getCurrentPosition(),
  });
});
miniLoopEnd.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  sendCommand("clear-loop-end");
});
miniLoopClear.addEventListener("click", () => sendCommand("clear-loop-start"));
miniVolume.addEventListener("input", () => {
  sendCommand({
    type: "set-volume",
    volume: Number(miniVolume.value) / 100,
  });
});
miniDark.addEventListener("click", () => sendCommand("toggle-dark-mode"));
miniSeek.addEventListener("input", () => {
  isSeeking = true;
  miniPosition.textContent = formatTime(getSeekPosition());
});
miniSeek.addEventListener("change", () => {
  sendCommand({
    type: "seek-to",
    position: getSeekPosition(),
  });
  isSeeking = false;
});
miniPosition.addEventListener("click", () => promptLoopStart());
miniDuration.addEventListener("click", () => promptLoopEnd());

if (window.pulseShelfDesktop) {
  window.pulseShelfDesktop.onPlaybackState(renderState);
}

function sendCommand(command) {
  window.pulseShelfDesktop?.sendCommand(command);
}

function renderState(state) {
  const duration = Number(state.duration) || 0;
  const position = Number(state.position) || 0;
  const progress = duration > 0 ? Math.min(position / duration, 1) * 100 : 0;
  currentDuration = duration;
  currentPosition = position;

  miniTitle.textContent = state.title || "노래를 선택해 주세요";
  miniArtist.textContent = state.artist || "업로더 정보 없음";
  miniStatus.textContent = getStatusText(state);
  miniSeek.style.setProperty("--progress", `${progress}%`);
  miniSeek.disabled = duration <= 0;
  if (!isSeeking) {
    miniSeek.value = duration > 0 ? String(Math.round((position / duration) * 1000)) : "0";
    miniPosition.textContent = formatTime(position);
  }
  miniDuration.textContent = formatTime(duration);
  miniPlay.innerHTML = state.state === "playing" ? "&#10073;&#10073;" : "&#9654;";
  miniRepeat.setAttribute("aria-pressed", String(Boolean(state.repeatOne)));
  miniShuffle.setAttribute("aria-pressed", String(Boolean(state.shuffle)));
  renderLoopState(state);
  miniDark.setAttribute("aria-pressed", String(Boolean(state.darkMode)));
  document.body.classList.toggle("dark", Boolean(state.darkMode));

  if (document.activeElement !== miniVolume) {
    miniVolume.value = String(Math.round((Number(state.volume) || 0) * 100));
  }
}

function getStatusText(state) {
  if (state.state === "playing") return "재생 중";
  if (state.state === "paused") return "일시정지";
  return "Pulse Shelf";
}

function getSeekPosition() {
  const ratio = Math.max(0, Math.min(1, Number(miniSeek.value) / 1000));
  return currentDuration * ratio;
}

function getCurrentPosition() {
  const ratio = Math.max(0, Math.min(1, Number(miniSeek.value) / 1000));
  return currentDuration * ratio;
}

function renderLoopState(state) {
  const start = Number(state.repeatStart) || 0;
  const end = Number(state.repeatEnd) || 0;
  const active = end > start;
  currentLoopStart = start;
  currentLoopEnd = end;

  miniLoopStart.textContent = start > 0 ? `시작 ${formatTime(start)}` : "시작 처음";
  miniLoopEnd.textContent = end > 0 ? `끝 ${formatTime(end)}` : "끝 없음";
  miniLoopStart.setAttribute("aria-pressed", String(start > 0));
  miniLoopEnd.setAttribute("aria-pressed", String(active));
}

function promptLoopStart() {
  const input = prompt("반복 시작 시간을 입력하세요. 예: 1:23", formatTime(currentLoopStart));
  if (input === null) return;
  if (!input.trim()) {
    sendCommand("clear-loop-start");
    return;
  }

  const seconds = parseTimeInput(input);
  if (seconds === null) {
    alert("시간은 1:23 또는 83처럼 입력해 주세요.");
    return;
  }

  sendCommand({
    type: "set-loop-start",
    position: seconds,
  });
}

function promptLoopEnd() {
  const input = prompt("반복 끝 시간을 입력하세요. 예: 5:03", formatTime(currentLoopEnd || currentPosition));
  if (input === null) return;
  if (!input.trim()) {
    sendCommand("clear-loop-end");
    return;
  }

  const seconds = parseTimeInput(input);
  if (seconds === null) {
    alert("시간은 5:03 또는 303처럼 입력해 주세요.");
    return;
  }

  sendCommand({
    type: "set-loop-end",
    position: seconds,
  });
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function parseTimeInput(value) {
  const input = String(value).trim();
  if (!input) return null;

  if (/^\d+(?:\.\d+)?$/.test(input)) {
    return Math.max(0, Number(input));
  }

  const parts = input.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  const numbers = parts.map(Number);
  if (numbers.some((number) => !Number.isFinite(number))) return null;

  if (numbers.length === 2) {
    return numbers[0] * 60 + numbers[1];
  }

  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}
