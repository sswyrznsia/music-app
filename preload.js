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
  sendPlaybackState(state) {
    ipcRenderer.send("playback-state", {
      duration: Number(state.duration) || 0,
      position: Number(state.position) || 0,
      state: state.state || "none",
      title: state.title || "Pulse Shelf",
      format: state.format || "",
      repeatOne: Boolean(state.repeatOne),
      shuffle: Boolean(state.shuffle),
      volume: Number(state.volume) || 0,
      darkMode: Boolean(state.darkMode),
    });
  },
});
