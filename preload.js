const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pulseShelfDesktop", {
  onCommand(callback) {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("desktop-command", listener);
    return () => ipcRenderer.removeListener("desktop-command", listener);
  },
  onPlaybackState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("playback-state-update", listener);
    return () => ipcRenderer.removeListener("playback-state-update", listener);
  },
  sendCommand(command) {
    ipcRenderer.send("desktop-command", command);
  },
  openExternal(url) {
    ipcRenderer.send("open-external", url);
  },
  sendPlaybackState(state) {
    ipcRenderer.send("playback-state", {
      duration: Number(state.duration) || 0,
      position: Number(state.position) || 0,
      state: state.state || "none",
      title: state.title || "Pulse Shelf",
      format: state.format || "",
      artist: state.artist || "",
      favorite: Boolean(state.favorite),
      repeatOne: Boolean(state.repeatOne),
      repeatStart: Number(state.repeatStart) || 0,
      repeatEnd: Number(state.repeatEnd) || 0,
      shuffle: Boolean(state.shuffle),
      volume: Number(state.volume) || 0,
      darkMode: Boolean(state.darkMode),
    });
  },
  sendPresencePlaybackUpdate(trackState = {}) {
    ipcRenderer.send("presence:playback-update", {
      status: trackState.status === "playing" || trackState.status === "paused" ? trackState.status : "stopped",
      title: trackState.title || "",
      artist: trackState.artist || "",
      album: trackState.album || "",
      duration: Number(trackState.duration) || 0,
      position: Number(trackState.position) || 0,
      trackId: trackState.trackId || "",
    });
  },
});
