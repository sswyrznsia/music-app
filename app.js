const downloadForm = document.querySelector("#downloadForm");
const youtubeUrl = document.querySelector("#youtubeUrl");
const downloadButton = document.querySelector("#downloadButton");
const downloadProgress = document.querySelector("#downloadProgress");
const downloadProgressBar = document.querySelector("#downloadProgressBar");
const downloadProgressText = document.querySelector("#downloadProgressText");
const downloadProgressValue = document.querySelector("#downloadProgressValue");
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
const searchInput = document.querySelector("#searchInput");
const statsToggle = document.querySelector("#statsToggle");
const statsPanel = document.querySelector("#statsPanel");
const statsList = document.querySelector("#statsList");
const statsTotal = document.querySelector("#statsTotal");
const clearStats = document.querySelector("#clearStats");
const playlistForm = document.querySelector("#playlistForm");
const playlistName = document.querySelector("#playlistName");
const playlistList = document.querySelector("#playlistList");
const playlistTrackSelect = document.querySelector("#playlistTrackSelect");
const playlistAddTrack = document.querySelector("#playlistAddTrack");
const activePlaylistLabel = document.querySelector("#activePlaylistLabel");

const PLAYER_OPTIONS_KEY = "pulseShelf.playerOptions";
const PLAYLISTS_KEY = "pulseShelf.playlists";
const LISTEN_STATS_KEY = "pulseShelf.listenStats";

let tracks = [];
let activeTrackId = null;
let isBusy = false;
let mediaProgressTimer = null;
let downloadProgressTimer = null;
let playerOptions = loadPlayerOptions();
let playlists = loadPlaylists();
let activePlaylistId = null;
let searchQuery = "";
let listenStats = loadListenStats();
let lastStatsTick = 0;

init();

downloadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = youtubeUrl.value.trim();
  if (!url || isBusy) return;

  setBusy(true);
  showDownloadProgress({
    active: true,
    percent: 0,
    message: "다운로드 준비 중",
  });
  startDownloadProgressPolling();
  setStatus("저장 중");

  try {
    const track = await postJson("/api/download", { url });
    showDownloadProgress({
      active: false,
      percent: 100,
      message: "저장 완료",
    });
    youtubeUrl.value = "";
    await loadTracks();
    playTrack(track.id);
  } catch (error) {
    showDownloadProgress({
      active: false,
      percent: 0,
      message: "다운로드 실패",
    });
    setStatus(error.message || "저장 실패");
  } finally {
    stopDownloadProgressPolling();
    scheduleDownloadProgressHide();
    setBusy(false);
  }
});

clearQueue.addEventListener("click", async () => {
  if (!tracks.length || isBusy) return;
  if (!confirm("전체 곡을 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;

  setBusy(true);
  try {
    await fetch("/api/tracks", { method: "DELETE" });
    tracks = [];
    playlists = playlists.map((playlist) => ({ ...playlist, trackIds: [] }));
    listenStats = {};
    activeTrackId = null;
    savePlaylists();
    saveListenStats();
    stopPlayer();
    renderTracks();
    renderPlaylists();
    renderPlaylistTrackOptions();
    renderStats();
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
searchInput?.addEventListener("input", () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  renderTracks();
  renderPlaylistTrackOptions();
});
statsToggle?.addEventListener("click", () => {
  statsPanel.hidden = !statsPanel.hidden;
  statsToggle.setAttribute("aria-pressed", String(!statsPanel.hidden));
  renderStats();
});
clearStats?.addEventListener("click", () => {
  listenStats = {};
  saveListenStats();
  renderStats();
});
playlistForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  createPlaylist(playlistName.value);
});
playlistAddTrack?.addEventListener("click", () => {
  addSelectedTrackToPlaylist();
});

playPause.addEventListener("click", togglePlayback);

function togglePlayback() {
  const playableTracks = getVisibleTracks();
  if (!activeTrackId && playableTracks.length) {
    playTrack(playableTracks[0].id);
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
  flushListenStats();
  playPause.innerHTML = "&#9654;";
  setStatus("일시정지");
  vinyl.classList.remove("playing");
  setMediaPlaybackState("paused");
  stopMediaProgressUpdates();
  updateMediaPosition();
});

audioPlayer.addEventListener("ended", () => {
  flushListenStats();
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
  renderPlaylists();
  renderStats();
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
    prunePlaylistTracks();
    renderTracks();
    renderPlaylists();
    renderPlaylistTrackOptions();
    renderStats();
    if (!tracks.length) resetNowPlaying();
  } catch {
    setStatus("목록 로드 실패");
  }
}

function playTrack(trackId) {
  const track = tracks.find((item) => item.id === trackId);
  if (!track) return;

  flushListenStats();
  activeTrackId = track.id;
  lastStatsTick = performance.now();
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
  const playableTracks = getVisibleTracks();
  if (!playableTracks.length) return;

  const activeIndex = playableTracks.findIndex((track) => track.id === activeTrackId);
  const baseIndex = activeIndex >= 0 ? activeIndex : 0;
  const nextIndex = (baseIndex + offset + playableTracks.length) % playableTracks.length;
  playTrack(playableTracks[nextIndex].id);
}

function playNextTrack() {
  const playableTracks = getVisibleTracks();
  if (!playableTracks.length) return;

  if (playerOptions.shuffle && playableTracks.length > 1) {
    playTrack(getRandomTrackId());
    return;
  }

  playRelative(1);
}

function playPreviousTrack() {
  const playableTracks = getVisibleTracks();
  if (!playableTracks.length) return;

  if (playerOptions.shuffle && playableTracks.length > 1) {
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
  const playableTracks = getVisibleTracks();
  const candidates = playableTracks.filter((track) => track.id !== activeTrackId);
  const pool = candidates.length ? candidates : playableTracks;
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
  flushListenStats();
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
  const visibleTracks = getVisibleTracks();
  queueCount.textContent = String(visibleTracks.length);
  if (activePlaylistLabel) {
    activePlaylistLabel.textContent = getActivePlaylist()?.name || "전체 곡";
  }

  if (!visibleTracks.length) {
    const empty = document.createElement("p");
    empty.className = "track-empty";
    empty.textContent = "플레이리스트가 비어 있습니다.";
    trackList.append(empty);
    return;
  }

  visibleTracks.forEach((track) => {
    const item = trackTemplate.content.firstElementChild.cloneNode(true);
    const mainButton = item.querySelector(".track-main");
    const playlistButton = item.querySelector(".playlist-track-action");
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

    if (playlistButton) {
      updateTrackPlaylistButton(playlistButton, track.id);
    }

    mainButton.addEventListener("click", () => playTrack(track.id));
    playlistButton?.addEventListener("click", () => toggleTrackInActivePlaylist(track.id));
    removeButton.addEventListener("click", () => removeTrack(track.id));
    trackList.append(item);
  });
}

function getVisibleTracks() {
  const activePlaylist = getActivePlaylist();
  const activeTrackIds = activePlaylist ? new Set(activePlaylist.trackIds) : null;

  return tracks.filter((track) => {
    const matchesPlaylist = !activeTrackIds || activeTrackIds.has(track.id);
    const matchesSearch =
      !searchQuery ||
      track.title.toLowerCase().includes(searchQuery) ||
      (track.format || "").toLowerCase().includes(searchQuery);

    return matchesPlaylist && matchesSearch;
  });
}

function getActivePlaylist() {
  return playlists.find((playlist) => playlist.id === activePlaylistId) || null;
}

function createPlaylist(name) {
  const cleanName = name.trim();
  if (!cleanName) return;

  playlists = [
    ...playlists,
    {
      id: crypto.randomUUID(),
      name: cleanName,
      trackIds: [],
      createdAt: new Date().toISOString(),
    },
  ];
  playlistName.value = "";
  savePlaylists();
  renderPlaylists();
}

function renderPlaylists() {
  if (!playlistList) return;

  playlistList.replaceChildren();

  if (!playlists.length) {
    const empty = document.createElement("p");
    empty.className = "playlist-empty";
    empty.textContent = "플레이리스트가 없습니다.";
    playlistList.append(empty);
  } else {
    playlists.forEach((playlist) => {
      const item = document.createElement("div");
      item.className = "playlist-item";

      const button = document.createElement("button");
      button.className = "playlist-chip";
      button.type = "button";
      button.setAttribute("aria-pressed", String(playlist.id === activePlaylistId));
      button.textContent = `${playlist.name} (${playlist.trackIds.length})`;
      button.addEventListener("click", () => {
        activePlaylistId = activePlaylistId === playlist.id ? null : playlist.id;
        renderTracks();
        renderPlaylists();
        renderPlaylistTrackOptions();
      });

      const deleteButton = document.createElement("button");
      deleteButton.className = "playlist-delete";
      deleteButton.type = "button";
      deleteButton.textContent = "삭제";
      deleteButton.title = "플레이리스트 삭제";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deletePlaylist(playlist.id);
      });

      item.append(button, deleteButton);
      playlistList.append(item);
    });
  }

  renderPlaylistTrackOptions();
}

function deletePlaylist(playlistId) {
  playlists = playlists.filter((playlist) => playlist.id !== playlistId);
  if (activePlaylistId === playlistId) {
    activePlaylistId = null;
  }

  savePlaylists();
  renderTracks();
  renderPlaylists();
  renderPlaylistTrackOptions();
}

function renderPlaylistTrackOptions() {
  if (!playlistTrackSelect || !playlistAddTrack) return;

  playlistTrackSelect.replaceChildren();
  const activePlaylist = getActivePlaylist();
  const tracksToAdd = activePlaylist
    ? tracks.filter((track) => !activePlaylist.trackIds.includes(track.id))
    : [];

  if (!activePlaylist) {
    playlistTrackSelect.append(new Option("플레이리스트를 선택하세요", ""));
  } else if (!tracksToAdd.length) {
    playlistTrackSelect.append(new Option("추가할 곡이 없습니다", ""));
  } else {
    tracksToAdd.forEach((track) => {
      playlistTrackSelect.append(new Option(track.title, track.id));
    });
  }

  playlistTrackSelect.disabled = !activePlaylist || !tracksToAdd.length;
  playlistAddTrack.disabled = !activePlaylist || !tracksToAdd.length;
}

function addSelectedTrackToPlaylist() {
  const trackId = playlistTrackSelect?.value;
  const activePlaylist = getActivePlaylist();
  if (!trackId || !activePlaylist) return;

  playlists = playlists.map((playlist) => {
    if (playlist.id !== activePlaylist.id || playlist.trackIds.includes(trackId)) return playlist;
    return {
      ...playlist,
      trackIds: [...playlist.trackIds, trackId],
    };
  });
  savePlaylists();
  renderTracks();
  renderPlaylists();
  renderPlaylistTrackOptions();
}

function toggleTrackInActivePlaylist(trackId) {
  const activePlaylist = getActivePlaylist();
  if (!activePlaylist) return;

  const hasTrack = activePlaylist.trackIds.includes(trackId);
  playlists = playlists.map((playlist) => {
    if (playlist.id !== activePlaylist.id) return playlist;
    return {
      ...playlist,
      trackIds: hasTrack
        ? playlist.trackIds.filter((id) => id !== trackId)
        : [...playlist.trackIds, trackId],
    };
  });
  savePlaylists();
  renderTracks();
  renderPlaylists();
  renderPlaylistTrackOptions();
}

function updateTrackPlaylistButton(button, trackId) {
  const activePlaylist = getActivePlaylist();
  button.hidden = !activePlaylist;
  if (!activePlaylist) return;

  const hasTrack = activePlaylist.trackIds.includes(trackId);
  button.textContent = hasTrack ? "빼기" : "추가";
  button.title = hasTrack ? "이 플레이리스트에서 빼기" : "이 플레이리스트에 추가";
}

function prunePlaylistTracks() {
  const trackIds = new Set(tracks.map((track) => track.id));
  playlists = playlists.map((playlist) => ({
    ...playlist,
    trackIds: playlist.trackIds.filter((id) => trackIds.has(id)),
  }));
  savePlaylists();
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
    playlists = playlists.map((playlist) => ({
      ...playlist,
      trackIds: playlist.trackIds.filter((id) => id !== trackId),
    }));
    delete listenStats[trackId];
    savePlaylists();
    saveListenStats();

    if (activeTrackId === trackId) {
      activeTrackId = null;
      stopPlayer();
      resetNowPlaying();
    }

    renderTracks();
    renderPlaylists();
    renderPlaylistTrackOptions();
    renderStats();
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

function startDownloadProgressPolling() {
  stopDownloadProgressPolling();
  refreshDownloadProgress();
  downloadProgressTimer = window.setInterval(refreshDownloadProgress, 400);
}

function stopDownloadProgressPolling() {
  if (!downloadProgressTimer) return;

  window.clearInterval(downloadProgressTimer);
  downloadProgressTimer = null;
}

async function refreshDownloadProgress() {
  try {
    const progress = await getJson("/api/download/progress");
    showDownloadProgress(progress);

    if (!progress.active && ["complete", "error"].includes(progress.status)) {
      stopDownloadProgressPolling();
    }
  } catch {
  }
}

function showDownloadProgress(progress) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
  downloadProgress.hidden = false;
  downloadProgressBar.style.width = `${percent}%`;
  downloadProgressValue.textContent = `${percent}%`;
  downloadProgressText.textContent = progress.message || getDownloadProgressLabel(progress.status);
}

function scheduleDownloadProgressHide() {
  window.setTimeout(() => {
    if (isBusy) return;
    downloadProgress.hidden = true;
  }, 1600);
}

function getDownloadProgressLabel(status) {
  if (status === "metadata") return "영상 정보 확인 중";
  if (status === "downloading") return "오디오 다운로드 중";
  if (status === "processing") return "오디오 정리 중";
  if (status === "saving") return "파일 저장 중";
  if (status === "complete") return "저장 완료";
  if (status === "error") return "다운로드 실패";
  return "다운로드 준비 중";
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

  if (commandType === "seek-to") {
    seekTo(command.position);
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

  seekTo(audioPlayer.currentTime + offset);
}

function seekTo(position) {
  if (!Number.isFinite(audioPlayer.duration)) return;

  audioPlayer.currentTime = Math.max(0, Math.min(Number(position) || 0, audioPlayer.duration));
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
  accumulateListenStats();
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

function accumulateListenStats() {
  if (!activeTrackId || audioPlayer.paused) {
    lastStatsTick = performance.now();
    return;
  }

  const now = performance.now();
  if (!lastStatsTick) {
    lastStatsTick = now;
    return;
  }

  const deltaSeconds = (now - lastStatsTick) / 1000;
  lastStatsTick = now;
  if (deltaSeconds <= 0 || deltaSeconds > 5) return;

  listenStats[activeTrackId] = (listenStats[activeTrackId] || 0) + deltaSeconds;
  saveListenStats();

  if (statsPanel && !statsPanel.hidden) {
    updateStatsNumbers();
  }
}

function flushListenStats() {
  accumulateListenStats();
  lastStatsTick = 0;
}

function renderStats() {
  if (!statsList) return;

  const rows = tracks
    .map((track) => ({
      track,
      seconds: listenStats[track.id] || 0,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  const totalSeconds = rows.reduce((sum, row) => sum + row.seconds, 0);
  if (statsTotal) {
    statsTotal.textContent = `${formatListenMinutes(totalSeconds)}분`;
  }

  statsList.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "stats-empty";
    empty.textContent = "아직 들은 기록이 없습니다.";
    statsList.append(empty);
    return;
  }

  rows.forEach(({ track, seconds }) => {
    const item = document.createElement("div");
    item.className = "stats-row";
    item.dataset.trackId = track.id;

    const title = document.createElement("span");
    title.textContent = track.title;

    const minutes = document.createElement("strong");
    minutes.dataset.statMinutes = track.id;
    minutes.textContent = `${formatListenMinutes(seconds)}분`;

    item.append(title, minutes);
    statsList.append(item);
  });
}

function updateStatsNumbers() {
  const totalSeconds = tracks.reduce((sum, track) => sum + (listenStats[track.id] || 0), 0);
  if (statsTotal) {
    statsTotal.textContent = `${formatListenMinutes(totalSeconds)}분`;
  }

  statsList?.querySelectorAll("[data-stat-minutes]").forEach((item) => {
    const seconds = listenStats[item.dataset.statMinutes] || 0;
    item.textContent = `${formatListenMinutes(seconds)}분`;
  });
}

function formatListenMinutes(seconds) {
  return (Math.max(0, seconds) / 60).toFixed(1);
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

function loadPlaylists() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || "[]");
    if (!Array.isArray(saved)) return [];

    return saved
      .filter((playlist) => playlist && typeof playlist.name === "string")
      .map((playlist) => ({
        id: playlist.id || crypto.randomUUID(),
        name: playlist.name,
        trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds : [],
        createdAt: playlist.createdAt || new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function savePlaylists() {
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
}

function loadListenStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(LISTEN_STATS_KEY) || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};

    return Object.fromEntries(
      Object.entries(saved)
        .map(([trackId, seconds]) => [trackId, Number(seconds) || 0])
        .filter(([, seconds]) => seconds >= 0),
    );
  } catch {
    return {};
  }
}

function saveListenStats() {
  localStorage.setItem(LISTEN_STATS_KEY, JSON.stringify(listenStats));
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
