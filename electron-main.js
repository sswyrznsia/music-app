const { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

if (app.isPackaged) {
  process.env.PULSE_SHELF_STORAGE_DIR = path.join(
    process.env.APPDATA || path.dirname(process.execPath),
    "Pulse Shelf",
  );
}

const { startServer } = require("./server");
const {
  initDiscordPresence,
  updatePlaybackPresence,
  destroyDiscordPresence,
} = require("./discordPresence");

const ROOT_DIR = __dirname;
const PORT_RANGE = Array.from({ length: 21 }, (_, index) => 4173 + index);
const LOG_DIR = path.join(process.env.PULSE_SHELF_STORAGE_DIR || ROOT_DIR, "logs");
const ELECTRON_LOG = path.join(LOG_DIR, "electron.log");
const APP_ICON_PATH = path.join(ROOT_DIR, "assets", "icons", "pulse-shelf.png");

let mainWindow = null;
let miniWindow = null;
let tray = null;
let serverHandle = null;
let appIsQuitting = false;
let miniManuallyHidden = false;
let currentAppUrl = null;
let playbackState = {
  duration: 0,
  darkMode: false,
  favorite: false,
  format: "",
  artist: "",
  position: 0,
  repeatEnd: 0,
  repeatOne: false,
  repeatStart: 0,
  shuffle: false,
  state: "none",
  title: "Pulse Shelf",
  volume: 1,
};

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  writeLog("Single instance lock already held; quitting new process.");
  app.quit();
} else {
  writeLog("Electron main starting.");
  app.setAppUserModelId("PulseShelf.LocalMusicApp");

  process.on("uncaughtException", (error) => {
    writeLog(`Uncaught exception: ${error.stack || error.message}`);
  });

  process.on("unhandledRejection", (error) => {
    writeLog(`Unhandled rejection: ${error?.stack || error}`);
  });

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady()
    .then(async () => {
      writeLog("App ready.");
      try {
        initDiscordPresence({ logger: writeLog });
      } catch (error) {
        writeLog(`Discord Presence init failed: ${error.stack || error.message}`);
      }
      const url = await findOrStartServer();
      writeLog(`Using app URL: ${url}`);
      createWindow(url);
      createTray();
    })
    .catch((error) => {
      writeLog(`Startup failed: ${error.stack || error.message}`);
    });

  app.on("window-all-closed", () => {
    writeLog("All windows closed; quitting.");
    app.quit();
  });

  app.on("before-quit", () => {
    writeLog("Before quit.");
    appIsQuitting = true;
    destroyDiscordPresence();
    cleanupTray();
    cleanupMiniWindow();
    cleanupServer();
  });
}

function createWindow(url) {
  writeLog("Creating main window.");
  currentAppUrl = url;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    icon: getAppIconPath() || undefined,
    show: false,
    title: "Pulse Shelf",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(ROOT_DIR, "preload.js"),
    },
  });
  applyWindowIcon(mainWindow);

  mainWindow.loadURL(url).catch((error) => {
    writeLog(`Main window load failed: ${error.stack || error.message}`);
  });
  mainWindow.once("ready-to-show", () => {
    writeLog("Main window ready to show.");
    mainWindow.show();
  });
  mainWindow.on("close", () => {
    if (appIsQuitting) return;
    writeLog("Main window close requested; quitting Pulse Shelf.");
    appIsQuitting = true;
    cleanupMiniWindow();
    cleanupServer();
  });
  mainWindow.on("closed", () => {
    writeLog("Main window closed.");
    mainWindow = null;
    if (appIsQuitting) {
      app.quit();
    }
  });

  createMiniWindow(url);
  updateTaskbar();
}

function createMiniWindow(url) {
  writeLog("Creating mini window.");
  if (miniWindow && !miniWindow.isDestroyed()) {
    keepMiniVisible();
    return;
  }

  miniWindow = new BrowserWindow({
    width: 330,
    height: 206,
    minWidth: 300,
    minHeight: 190,
    maxWidth: 390,
    maxHeight: 240,
    alwaysOnTop: true,
    closable: true,
    frame: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: "Pulse Shelf Mini",
    icon: getAppIconPath() || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(ROOT_DIR, "preload.js"),
    },
  });
  applyWindowIcon(miniWindow);

  miniWindow.setAlwaysOnTop(true, "screen-saver");
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  miniWindow.loadURL(`${url}/mini-player.html`).catch((error) => {
    writeLog(`Mini window load failed: ${error.stack || error.message}`);
  });
  miniWindow.once("ready-to-show", () => {
    writeLog("Mini window ready to show.");
    if (miniManuallyHidden) {
      miniWindow.hide();
    } else {
      keepMiniVisible();
    }
    miniWindow.webContents.send("playback-state-update", playbackState);
    updateTrayMenu();
  });
  miniWindow.on("close", (event) => {
    writeLog("Mini close requested.");
    if (appIsQuitting) return;
    event.preventDefault();
    hideMiniWindow();
  });
  miniWindow.on("closed", () => {
    writeLog("Mini window closed.");
    miniWindow = null;
    updateTrayMenu();
  });
  miniWindow.webContents.on("render-process-gone", (_event, details) => {
    writeLog(`Mini renderer gone: ${details.reason}`);
    recreateMiniWindow();
  });
  miniWindow.webContents.on("did-fail-load", (_event, code, description) => {
    writeLog(`Mini failed to load: ${code} ${description}`);
    recreateMiniWindow();
  });
}

function cleanupMiniWindow() {
  if (!miniWindow || miniWindow.isDestroyed()) return;

  try {
    miniWindow.destroy();
  } catch {
  } finally {
    miniWindow = null;
  }
}

function cleanupServer() {
  if (!serverHandle?.server) return;

  try {
    serverHandle.server.close();
  } catch {
  } finally {
    serverHandle = null;
  }
}

function createTray() {
  if (tray) {
    updateTrayMenu();
    return;
  }

  tray = new Tray(getTrayIcon());
  tray.setToolTip("Pulse Shelf");
  tray.on("double-click", toggleMiniWindow);
  updateTrayMenu();
}

function cleanupTray() {
  if (!tray) return;

  try {
    tray.destroy();
  } catch {
  } finally {
    tray = null;
  }
}

function updateTrayMenu() {
  if (!tray) return;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "미니 플레이어 보이기",
        enabled: !miniWindow || miniWindow.isDestroyed() || !miniWindow.isVisible(),
        click: showMiniWindow,
      },
      {
        label: "미니 플레이어 숨기기",
        enabled: Boolean(miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()),
        click: hideMiniWindow,
      },
      { type: "separator" },
      {
        label: "앱 종료",
        click: quitFromTray,
      },
    ]),
  );
}

function showMiniWindow() {
  miniManuallyHidden = false;
  if ((!miniWindow || miniWindow.isDestroyed()) && currentAppUrl) {
    createMiniWindow(currentAppUrl);
    return;
  }

  keepMiniVisible();
  updateTrayMenu();
}

function hideMiniWindow() {
  miniManuallyHidden = true;
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.hide();
  }
  updateTrayMenu();
}

function toggleMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
    hideMiniWindow();
  } else {
    showMiniWindow();
  }
}

function quitFromTray() {
  appIsQuitting = true;
  cleanupTray();
  cleanupMiniWindow();
  cleanupServer();
  app.quit();
}

function getTrayIcon() {
  const iconPath = getAppIconPath();
  if (iconPath) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) return icon.resize({ width: 16, height: 16 });
  }

  return getTaskbarIcon("play");
}

function getAppIconPath() {
  if (fs.existsSync(APP_ICON_PATH)) return APP_ICON_PATH;

  writeLog(`App icon not found: ${APP_ICON_PATH}`);
  return null;
}

function applyWindowIcon(window) {
  if (process.platform === "darwin") return;

  const iconPath = getAppIconPath();
  if (!iconPath) return;

  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    writeLog(`App icon could not be loaded: ${iconPath}`);
    return;
  }

  window.setIcon(icon);
}

ipcMain.on("playback-state", (_event, state) => {
  playbackState = {
    duration: Number(state.duration) || 0,
    darkMode: Boolean(state.darkMode),
    favorite: Boolean(state.favorite),
    format: state.format || "",
    artist: state.artist || "",
    position: Number(state.position) || 0,
    repeatEnd: Number(state.repeatEnd) || 0,
    repeatOne: Boolean(state.repeatOne),
    repeatStart: Number(state.repeatStart) || 0,
    shuffle: Boolean(state.shuffle),
    state: state.state || "none",
    title: state.title || "Pulse Shelf",
    volume: Number(state.volume) || 0,
  };
  updateTaskbar();
  miniWindow?.webContents.send("playback-state-update", playbackState);
  if (!miniManuallyHidden) {
    keepMiniVisible();
  }
  updateTrayMenu();
});

ipcMain.on("presence:playback-update", (_event, trackState) => {
  updatePlaybackPresence(trackState).catch((error) => {
    writeLog(`Discord Presence playback update failed: ${error.stack || error.message}`);
  });
});

ipcMain.on("desktop-command", (_event, command) => {
  writeLog(`Desktop command: ${command}`);
  const commandType = typeof command === "string" ? command : command?.type;
  if (commandType === "hide-mini-player") {
    hideMiniWindow();
    return;
  }

  sendCommandToMainWindow(command);
});

ipcMain.on("open-external", (_event, url) => {
  if (typeof url !== "string" || !/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) return;
  shell.openExternal(url).catch((error) => {
    writeLog(`Open external failed: ${error.stack || error.message}`);
  });
});

function sendCommandToMainWindow(command) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  if (!miniManuallyHidden) {
    keepMiniVisible();
  }

  mainWindow.webContents
    .executeJavaScript(
      `window.__pulseShelfCommand && window.__pulseShelfCommand(${JSON.stringify(command)})`,
      true,
    )
    .then((handled) => {
      if (!handled) {
        mainWindow?.webContents.send("desktop-command", command);
      }
    })
    .catch(() => {
      mainWindow?.webContents.send("desktop-command", command);
    });
  if (!miniManuallyHidden) {
    setTimeout(keepMiniVisible, 120);
  }
}

function keepMiniVisible() {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  miniManuallyHidden = false;
  miniWindow.setAlwaysOnTop(true, "screen-saver");
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (!miniWindow.isVisible()) {
    miniWindow.showInactive();
    return;
  }
  miniWindow.moveTop();
  updateTrayMenu();
}

function recreateMiniWindow() {
  if (appIsQuitting || !currentAppUrl) return;

  const oldMiniWindow = miniWindow;
  miniWindow = null;

  try {
    if (oldMiniWindow && !oldMiniWindow.isDestroyed()) {
      oldMiniWindow.destroy();
    }
  } catch {
  }

  setTimeout(() => createMiniWindow(currentAppUrl), 350);
}

async function findOrStartServer() {
  writeLog("Looking for running server.");
  const existingUrl = await findRunningServer();
  if (existingUrl) {
    writeLog(`Found running server: ${existingUrl}`);
    return existingUrl;
  }

  writeLog("Starting embedded server.");
  serverHandle = await startServer(PORT_RANGE[0]);
  writeLog(`Embedded server ready on port ${serverHandle.port}.`);
  return `http://localhost:${serverHandle.port}`;
}

async function findRunningServer() {
  for (const port of PORT_RANGE) {
    const ok = await checkAppReady(port);
    if (ok) return `http://localhost:${port}`;
  }

  return null;
}

async function checkAppReady(port) {
  return checkPath(port, "/mini-player.html", (body) => body.includes("Pulse Shelf Mini"));
}

function checkPath(port, path, validate) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: "localhost",
        path,
        port,
        timeout: 750,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(response.statusCode === 200 && validate(body));
          } catch {
            resolve(false);
          }
        });
      },
    );

    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

function updateTaskbar() {
  if (!mainWindow) return;

  const isPlaying = playbackState.state === "playing";
  const hasTrack = playbackState.state !== "none";

  if (hasTrack && playbackState.duration > 0) {
    const progress = Math.max(0, Math.min(playbackState.position / playbackState.duration, 1));
    mainWindow.setProgressBar(progress);
  } else {
    mainWindow.setProgressBar(-1);
  }

  mainWindow.setThumbarButtons([
    {
      tooltip: isPlaying ? "일시정지" : "재생",
      icon: getTaskbarIcon(isPlaying ? "pause" : "play"),
      click: () => sendCommandToMainWindow("toggle-play"),
    },
    {
      tooltip: "다음 곡",
      icon: getTaskbarIcon("next"),
      click: () => sendCommandToMainWindow("next-track"),
    },
  ]);
}

function getTaskbarIcon(type) {
  const width = 32;
  const height = 32;
  const buffer = Buffer.alloc(width * height * 4);

  const drawPixel = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    buffer[offset] = 17;
    buffer[offset + 1] = 24;
    buffer[offset + 2] = 39;
    buffer[offset + 3] = 255;
  };

  const drawRect = (left, top, right, bottom) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        drawPixel(x, y);
      }
    }
  };

  const drawPolygon = (points) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (isInsidePolygon(x + 0.5, y + 0.5, points)) {
          drawPixel(x, y);
        }
      }
    }
  };

  if (type === "pause") {
    drawRect(10, 8, 14, 24);
    drawRect(18, 8, 22, 24);
  } else if (type === "next") {
    drawPolygon([
      [7, 8],
      [15, 16],
      [7, 24],
    ]);
    drawPolygon([
      [16, 8],
      [24, 16],
      [16, 24],
    ]);
    drawRect(25, 8, 27, 24);
  } else {
    drawPolygon([
      [10, 7],
      [24, 16],
      [10, 25],
    ]);
  }

  return nativeImage.createFromBitmap(buffer, { width, height, scaleFactor: 1 });
}

function isInsidePolygon(x, y, points) {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeLog(message) {
  try {
    require("node:fs").mkdirSync(LOG_DIR, { recursive: true });
    require("node:fs").appendFileSync(
      ELECTRON_LOG,
      `[${new Date().toISOString()}] ${message}\n`,
      "utf8",
    );
  } catch {
  }
}
