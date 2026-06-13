const miniStatus = document.querySelector("#miniStatus");
const miniTitle = document.querySelector("#miniTitle");
const miniArtist = document.querySelector("#miniArtist");
const miniTray = document.querySelector("#miniTray");
const miniSeek = document.querySelector("#miniSeek");
const miniPosition = document.querySelector("#miniPosition");
const miniDuration = document.querySelector("#miniDuration");
const miniRepeat = document.querySelector("#miniRepeat");
const miniPrev = document.querySelector("#miniPrev");
const miniPlay = document.querySelector("#miniPlay");
const miniNext = document.querySelector("#miniNext");
const miniShuffle = document.querySelector("#miniShuffle");
const miniFavorite = document.querySelector("#miniFavorite");
const miniVolume = document.querySelector("#miniVolume");
const miniDark = document.querySelector("#miniDark");

let currentDuration = 0;
let isSeeking = false;

miniRepeat.addEventListener("click", () => sendCommand("toggle-repeat-one"));
miniTray.addEventListener("click", () => sendCommand("hide-mini-player"));
miniPrev.addEventListener("click", () => sendCommand("previous-track"));
miniPlay.addEventListener("click", () => sendCommand("toggle-play"));
miniNext.addEventListener("click", () => sendCommand("next-track"));
miniShuffle.addEventListener("click", () => sendCommand("toggle-shuffle"));
miniFavorite.addEventListener("click", () => sendCommand("toggle-favorite"));
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
  miniFavorite.innerHTML = state.favorite ? "&#9829;" : "&#9825;";
  miniFavorite.disabled = state.state === "none";
  miniFavorite.setAttribute("aria-pressed", String(Boolean(state.favorite)));
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

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}
