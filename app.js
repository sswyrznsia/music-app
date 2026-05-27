const downloadForm = document.querySelector("#downloadForm");
const youtubeUrl = document.querySelector("#youtubeUrl");
const downloadButton = document.querySelector("#downloadButton");
const trackList = document.querySelector("#trackList");
const trackTemplate = document.querySelector("#trackTemplate");
const clearQueue = document.querySelector("#clearQueue");
const audioPlayer = document.querySelector("#audioPlayer");
const audioStage = document.querySelector("#audioStage");
const emptyState = document.querySelector("#emptyState");
const currentTitle = document.querySelector("#currentTitle");
const sourceLabel = document.querySelector("#sourceLabel");
const currentKind = document.querySelector("#currentKind");
const playerStatus = document.querySelector("#playerStatus");
const queueCount = document.querySelector("#queueCount");
const statusDot = document.querySelector("#statusDot");
const vinyl = document.querySelector(".vinyl");
const toolState = document.querySelector("#toolState");
const toolHelp = document.querySelector("#toolHelp");
const prevTrack = document.querySelector("#prevTrack");
const playPause = document.querySelector("#playPause");
const nextTrack = document.querySelector("#nextTrack");
const repeatOne = document.querySelector("#repeatOne");
const shuffleMode = document.querySelector("#shuffleMode");

const PLAYER_OPTIONS_KEY = "pulseShelf.playerOptions";

let tracks = [];
let activeTrackId = null;
let isBusy = false;
let mediaProgressTimer = null;
let playerOptions = loadPlayerOptions();

init();

downloadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = youtubeUrl.value.trim();
  if (!url || isBusy) return;

  setBusy(true);
  setStatus("저장 중");

  try {
    const track = await postJson("/api/download", { url });
    youtubeUrl.value = "";
    await loadTracks();
    playTrack(track.id);
  } catch (error) {
    setStatus(error.message || "저장 실패");
  } finally {
    setBusy(false);
  }
});

clearQueue.addEventListener("click", async () => {
  if (!tracks.length || isBusy) return;

  setBusy(true);
  try {
    await fetch("/api/tracks", { method: "DELETE" });
    tracks = [];
    activeTrackId = null;
    stopPlayer();
    renderTracks();
    resetNowPlaying();
  } catch {
    setStatus("삭제 실패");
  } finally {
    setBusy(false);
  }
});

prevTrack.addEventListener("click", () => playPreviousTrack());
nextTrack.addEventListener("click", () => playNextTrack());
repeatOne.addEventListener("click", () => togglePlayerOption("repeatOne"));
shuffleMode.addEventListener("click", () => togglePlayerOption("shuffle"));

playPause.addEventListener("click", togglePlayback);

function togglePlayback() {
  if (!activeTrackId && tracks.length) {
    playTrack(tracks[0].id);
    return;
  }

  if (!audioPlayer.src) return;

  if (audioPlayer.paused) {
    audioPlayer.play().catch(() => setStatus("재생 대기"));
  } else {
    audioPlayer.pause();
  }
}

audioPlayer.addEventListener("play", () => {
  playPause.innerHTML = "&#10073;&#10073;";
  setStatus("재생 중", true);
  vinyl.classList.add("playing");
  setMediaPlaybackState("playing");
  startMediaProgressUpdates();
});

audioPlayer.addEventListener("pause", () => {
  playPause.innerHTML = "&#9654;";
  setStatus("일시정지");
  vinyl.classList.remove("playing");
  setMediaPlaybackState("paused");
  stopMediaProgressUpdates();
  updateMediaPosition();
});

audioPlayer.addEventListener("ended", () => {
  vinyl.classList.remove("playing");
  handleTrackEnded();
});

audioPlayer.addEventListener("volumechange", () => {
  const volume = clampVolume(audioPlayer.volume);
  if (Math.abs(playerOptions.volume - volume) < 0.001) return;

  playerOptions = {
    ...playerOptions,
    volume,
  };
  savePlayerOptions();
  notifyDesktopPlayback();
});

["durationchange", "loadedmetadata", "ratechange", "seeked", "timeupdate"].forEach((eventName) => {
  audioPlayer.addEventListener(eventName, updateMediaPosition);
});

async function init() {
  applyPlayerOptions();
  updateModeButtons();
  initMediaSession();
  initDesktopBridge();
  await Promise.all([loadHealth(), loadTracks()]);
}

async function loadHealth() {
  try {
    const health = await getJson("/api/health");
    const canDownload = health.tools?.ytDlp;

    toolState.textContent = canDownload ? "준비 완료" : "도구 필요";
    toolState.classList.toggle("warning", !canDownload);
    downloadButton.disabled = !canDownload;

    if (!canDownload) {
      toolHelp.textContent =
        "이 PC에 yt-dlp가 설치되면 링크 저장이 작동합니다. 이미 저장된 곡은 그대로 재생할 수 있습니다.";
    }
  } catch {
    toolState.textContent = "서버 오류";
    toolState.classList.add("warning");
    downloadButton.disabled = true;
    toolHelp.textContent = "로컬 앱 서버가 실행 중인지 확인해 주세요.";
  }
}

async function loadTracks() {
  try {
    tracks = await getJson("/api/tracks");
    renderTracks();
    if (!tracks.length) resetNowPlaying();
  } catch {
    setStatus("목록 로드 실패");
  }
}

function playTrack(trackId) {
  const track = tracks.find((item) => item.id === trackId);
  if (!track) return;

  activeTrackId = track.id;
  currentTitle.textContent = track.title;
  currentKind.textContent = track.format || "Audio";
  sourceLabel.textContent = "Saved Audio";
  emptyState.style.display = "none";
  audioStage.classList.add("active");
  audioPlayer.src = track.audioUrl;
  updateMediaMetadata(track);
  audioPlayer.play().catch(() => setStatus("재생 대기"));
  renderTracks();
}

function playRelative(offset) {
  if (!tracks.length) return;

  const activeIndex = tracks.findIndex((track) => track.id === activeTrackId);
  const baseIndex = activeIndex >= 0 ? activeIndex : 0;
  const nextIndex = (baseIndex + offset + tracks.length) % tracks.length;
  playTrack(tracks[nextIndex].id);
}

function playNextTrack() {
  if (!tracks.length) return;

  if (playerOptions.shuffle && tracks.length > 1) {
    playTrack(getRandomTrackId());
    return;
  }

  playRelative(1);
}

function playPreviousTrack() {
  if (!tracks.length) return;

  if (playerOptions.shuffle && tracks.length > 1) {
    playTrack(getRandomTrackId());
    return;
  }

  playRelative(-1);
}

function handleTrackEnded() {
  if (playerOptions.repeatOne && activeTrackId) {
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => setStatus("재생 대기"));
    return;
  }

  playNextTrack();
}

function getRandomTrackId() {
  const candidates = tracks.filter((track) => track.id !== activeTrackId);
  const pool = candidates.length ? candidates : tracks;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index].id;
}

function togglePlayerOption(option) {
  playerOptions = {
    ...playerOptions,
    [option]: !playerOptions[option],
  };
  savePlayerOptions();
  updateModeButtons();
  notifyDesktopPlayback();
}

function updateModeButtons() {
  repeatOne.setAttribute("aria-pressed", String(playerOptions.repeatOne));
  shuffleMode.setAttribute("aria-pressed", String(playerOptions.shuffle));
}

function applyPlayerOptions() {
  audioPlayer.volume = clampVolume(playerOptions.volume);
}

function setPlayerVolume(volume) {
  const nextVolume = clampVolume(volume);
  playerOptions = {
    ...playerOptions,
    volume: nextVolume,
  };
  audioPlayer.volume = nextVolume;
  savePlayerOptions();
  notifyDesktopPlayback();
}

function toggleDarkMode() {
  playerOptions = {
    ...playerOptions,
    darkMode: !playerOptions.darkMode,
  };
  savePlayerOptions();
  notifyDesktopPlayback();
}

function stopPlayer() {
  audioPlayer.pause();
  audioPlayer.removeAttribute("src");
  audioStage.classList.remove("active");
  emptyState.style.display = "grid";
  vinyl.classList.remove("playing");
  statusDot.classList.remove("live");
  playPause.innerHTML = "&#9654;";
  clearMediaSession();
}

function resetNowPlaying() {
  currentTitle.textContent = "노래를 선택해 주세요";
  sourceLabel.textContent = "Ready";
  currentKind.textContent = "-";
  setStatus("대기");
}

function renderTracks() {
  trackList.replaceChildren();
  queueCount.textContent = String(tracks.length);

  if (!tracks.length) {
    const empty = document.createElement("p");
    empty.className = "track-empty";
    empty.textContent = "플레이리스트가 비어 있습니다.";
    trackList.append(empty);
    return;
  }

  tracks.forEach((track) => {
    const item = trackTemplate.content.firstElementChild.cloneNode(true);
    const mainButton = item.querySelector(".track-main");
    const removeButton = item.querySelector(".remove-track");
    const thumb = item.querySelector(".thumb");
    const title = item.querySelector("strong");
    const subtitle = item.querySelector("small");

    item.classList.toggle("active", track.id === activeTrackId);
    title.textContent = track.title;
    subtitle.textContent = formatDate(track.createdAt);

    if (track.thumbnail) {
      const image = document.createElement("img");
      image.src = track.thumbnail;
      image.alt = "";
      thumb.append(image);
    } else {
      thumb.textContent = "MP3";
    }

    mainButton.addEventListener("click", () => playTrack(track.id));
    removeButton.addEventListener("click", () => removeTrack(track.id));
    trackList.append(item);
  });
}

async function removeTrack(trackId) {
  if (isBusy) return;

  setBusy(true);
  try {
    const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
      method: "DELETE",
    });

    if (!response.ok) throw new Error();

    tracks = tracks.filter((track) => track.id !== trackId);

    if (activeTrackId === trackId) {
      activeTrackId = null;
      stopPlayer();
      resetNowPlaying();
    }

    renderTracks();
  } catch {
    setStatus("삭제 실패");
  } finally {
    setBusy(false);
  }
}

function setBusy(value) {
  isBusy = value;
  downloadButton.disabled = value || toolState.classList.contains("warning");
  downloadButton.textContent = value ? "저장 중" : "저장";
  youtubeUrl.disabled = value;
}

function setStatus(label, isLive = false) {
  playerStatus.textContent = label;
  statusDot.classList.toggle("live", isLive);
}

function initMediaSession() {
  if (!("mediaSession" in navigator)) return;

  const actionHandlers = {
    play: resumePlayback,
    pause: () => audioPlayer.pause(),
    previoustrack: () => playPreviousTrack(),
    nexttrack: () => playNextTrack(),
    seekbackward: (details) => seekBy(-(details.seekOffset || 10)),
    seekforward: (details) => seekBy(details.seekOffset || 10),
    seekto: (details) => {
      if (typeof details.seekTime === "number") {
        audioPlayer.currentTime = details.seekTime;
        updateMediaPosition();
      }
    },
    stop: () => {
      stopPlayer();
      resetNowPlaying();
    },
  };

  Object.entries(actionHandlers).forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
    }
  });
}

function initDesktopBridge() {
  window.__pulseShelfCommand = runDesktopCommand;

  if (!window.pulseShelfDesktop) return;

  window.pulseShelfDesktop.onCommand(runDesktopCommand);

  notifyDesktopPlayback();
}

function runDesktopCommand(command) {
  const commandType = typeof command === "string" ? command : command?.type;

  if (commandType === "toggle-play") {
    togglePlayback();
    return true;
  }

  if (commandType === "next-track") {
    playNextTrack();
    return true;
  }

  if (commandType === "previous-track") {
    playPreviousTrack();
    return true;
  }

  if (commandType === "toggle-repeat-one") {
    togglePlayerOption("repeatOne");
    return true;
  }

  if (commandType === "toggle-shuffle") {
    togglePlayerOption("shuffle");
    return true;
  }

  if (commandType === "set-volume") {
    setPlayerVolume(command.volume);
    return true;
  }

  if (commandType === "toggle-dark-mode") {
    toggleDarkMode();
    return true;
  }

  return false;
}

function resumePlayback() {
  if (!activeTrackId && tracks.length) {
    playTrack(tracks[0].id);
    return;
  }

  if (audioPlayer.src) {
    audioPlayer.play().catch(() => setStatus("재생 대기"));
  }
}

function seekBy(offset) {
  if (!Number.isFinite(audioPlayer.duration)) return;

  audioPlayer.currentTime = Math.max(
    0,
    Math.min(audioPlayer.currentTime + offset, audioPlayer.duration),
  );
  updateMediaPosition();
}

function updateMediaMetadata(track) {
  document.title = `${track.title} - Pulse Shelf`;

  if (!("mediaSession" in navigator)) return;

  const artwork = track.thumbnail
    ? [
        {
          src: track.thumbnail,
          sizes: "320x180",
          type: "image/jpeg",
        },
      ]
    : [];

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: "Pulse Shelf",
    album: track.format || "Saved Audio",
    artwork,
  });
}

function setMediaPlaybackState(state) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

function startMediaProgressUpdates() {
  stopMediaProgressUpdates();
  updateMediaPosition();
  mediaProgressTimer = window.setInterval(updateMediaPosition, 1000);
}

function stopMediaProgressUpdates() {
  if (mediaProgressTimer) {
    window.clearInterval(mediaProgressTimer);
    mediaProgressTimer = null;
  }
}

function updateMediaPosition() {
  const duration = audioPlayer.duration;
  const position = audioPlayer.currentTime;

  updateTaskbarTitle(position, duration);
  notifyDesktopPlayback();

  if (!("mediaSession" in navigator)) return;
  if (!Number.isFinite(duration) || duration <= 0) return;

  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: audioPlayer.playbackRate || 1,
      position: Math.min(position, duration),
    });
  } catch {
  }
}

function updateTaskbarTitle(position, duration) {
  const track = tracks.find((item) => item.id === activeTrackId);
  if (!track) {
    document.title = "Pulse Shelf";
    return;
  }

  if (Number.isFinite(duration) && duration > 0) {
    document.title = `${formatTime(position)} / ${formatTime(duration)} - ${track.title}`;
  } else {
    document.title = `${track.title} - Pulse Shelf`;
  }
}

function clearMediaSession() {
  stopMediaProgressUpdates();
  document.title = "Pulse Shelf";
  setMediaPlaybackState("none");
  notifyDesktopPlayback("none");

  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = null;
  }
}

function notifyDesktopPlayback(forcedState) {
  if (!window.pulseShelfDesktop) return;

  const duration = audioPlayer.duration;
  const position = audioPlayer.currentTime;
  const hasTrack = Boolean(activeTrackId && audioPlayer.src);
  const track = tracks.find((item) => item.id === activeTrackId);

  window.pulseShelfDesktop.sendPlaybackState({
    duration: Number.isFinite(duration) ? duration : 0,
    position: Number.isFinite(position) ? position : 0,
    state: forcedState || (hasTrack ? (audioPlayer.paused ? "paused" : "playing") : "none"),
    title: track?.title || "Pulse Shelf",
    format: track?.format || "",
    repeatOne: playerOptions.repeatOne,
    shuffle: playerOptions.shuffle,
    volume: playerOptions.volume,
    darkMode: playerOptions.darkMode,
  });
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || "요청 실패");
  }

  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || "요청 실패");
  }

  return payload;
}

function formatDate(value) {
  if (!value) return "저장된 오디오";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function loadPlayerOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYER_OPTIONS_KEY) || "{}");
    return {
      darkMode: Boolean(saved.darkMode),
      repeatOne: Boolean(saved.repeatOne),
      shuffle: Boolean(saved.shuffle),
      volume: clampVolume(saved.volume ?? 1),
    };
  } catch {
    return {
      darkMode: false,
      repeatOne: false,
      shuffle: false,
      volume: 1,
    };
  }
}

function savePlayerOptions() {
  localStorage.setItem(PLAYER_OPTIONS_KEY, JSON.stringify(playerOptions));
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function clampVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(volume, 1));
}
