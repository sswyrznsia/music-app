const { createServer } = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 4173);
const ROOT_DIR = __dirname;
const STORAGE_DIR = process.env.PULSE_SHELF_STORAGE_DIR || ROOT_DIR;
const DATA_DIR = path.join(STORAGE_DIR, "data");
const LIBRARY_DIR = path.join(STORAGE_DIR, "library");
const TRACKS_FILE = path.join(DATA_DIR, "tracks.json");
const MAX_JSON_BYTES = 1024 * 64;
const LOCAL_YT_DLP = path.join(ROOT_DIR, "tools", "yt-dlp.exe");
const RESOURCE_DIR = process.resourcesPath || ROOT_DIR;
const RESOURCE_YT_DLP = path.join(RESOURCE_DIR, "tools", "yt-dlp.exe");
const SEED_DATA_DIR = path.join(RESOURCE_DIR, "seed-data", "data");
const SEED_LIBRARY_DIR = path.join(RESOURCE_DIR, "seed-data", "library");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

const ytDlpCandidates = [
  { command: RESOURCE_YT_DLP, args: [] },
  { command: LOCAL_YT_DLP, args: [] },
  { command: "yt-dlp", args: [] },
  { command: "python", args: ["-m", "yt_dlp"] },
  { command: "py", args: ["-m", "yt_dlp"] },
];

let downloadProgress = createIdleDownloadProgress();

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function startServer(preferredPort = PORT) {
  await ensureStorage();

  const server = createServer(handleRequest);
  const port = await listenWithFallback(server, preferredPort);
  console.log(`Pulse Shelf is running at http://localhost:${port}`);
  return { port, server };
}

function listenWithFallback(server, preferredPort) {
  return new Promise((resolve, reject) => {
    let port = preferredPort;

    const tryListen = () => {
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port < preferredPort + 20) {
          port += 1;
          tryListen();
          return;
        }

        reject(error);
      });

      server.listen(port, () => resolve(port));
    };

    tryListen();
  });
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return sendJson(response, await getHealth());
    }

    if (url.pathname === "/api/tracks" && request.method === "GET") {
      const tracks = await readTracks();
      return sendJson(response, tracks.map(toClientTrack));
    }

    if (url.pathname === "/api/download" && request.method === "POST") {
      const body = await readJsonBody(request);
      const track = await downloadTrack(body.url);
      return sendJson(response, toClientTrack(track), 201);
    }

    if (url.pathname === "/api/download/progress" && request.method === "GET") {
      return sendJson(response, getDownloadProgress());
    }

    if (url.pathname === "/api/tracks" && request.method === "DELETE") {
      await deleteAllTracks();
      return sendJson(response, { ok: true });
    }

    const trackMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)$/);
    if (trackMatch && request.method === "DELETE") {
      await deleteTrack(decodeURIComponent(trackMatch[1]));
      return sendJson(response, { ok: true });
    }

    if (url.pathname.startsWith("/media/") && request.method === "GET") {
      return streamMedia(url.pathname, request, response);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return serveStatic(url.pathname, response, request.method === "HEAD");
    }

    sendJson(response, { error: "지원하지 않는 요청입니다." }, 405);
  } catch (error) {
    if (request.url?.startsWith("/api/download")) {
      updateDownloadProgress({
        active: false,
        status: "error",
        message: "다운로드 실패",
      });
    }

    const status = error.statusCode || 500;
    sendJson(response, { error: error.publicMessage || error.message || "서버 오류" }, status);
  }
}

async function getHealth() {
  return {
    ok: true,
    tools: {
      ytDlp: Boolean(findWorkingCommand(ytDlpCandidates)),
      ffmpeg: Boolean(findWorkingCommand([{ command: "ffmpeg", args: [] }])),
    },
  };
}

async function downloadTrack(sourceUrl) {
  updateDownloadProgress({
    active: true,
    percent: 0,
    status: "starting",
    message: "다운로드 준비 중",
  });
  const videoId = extractYouTubeId(sourceUrl);
  if (!videoId) {
    updateDownloadProgress({
      active: false,
      status: "error",
      message: "유효한 유튜브 링크가 아닙니다.",
    });
    throw publicError("유효한 유튜브 링크를 넣어 주세요.", 400);
  }

  const ytDlp = findWorkingCommand(ytDlpCandidates);

  if (!ytDlp) {
    updateDownloadProgress({
      active: false,
      status: "error",
      message: "yt-dlp 설치가 필요합니다.",
    });
    throw publicError("yt-dlp 설치가 필요합니다.", 503);
  }

  const id = crypto.randomUUID();
  updateDownloadProgress({
    percent: 4,
    status: "metadata",
    message: "영상 정보 확인 중",
  });
  const metadata = await loadVideoMetadata(ytDlp, sourceUrl);
  const outputTemplate = path.join(LIBRARY_DIR, `${id}.%(ext)s`);

  await runCommand(ytDlp.command, [
    ...ytDlp.args,
    "--newline",
    "--no-playlist",
    "--format",
    "bestaudio/best",
    "--output",
    outputTemplate,
    sourceUrl,
  ], {
    onOutput: updateProgressFromYtDlp,
  });

  updateDownloadProgress({
    percent: 96,
    status: "saving",
    message: "파일 저장 중",
  });
  const fileName = await findDownloadedFile(id);
  const tracks = await readTracks();
  const track = {
    id,
    title: metadata.title || `YouTube ${videoId}`,
    sourceUrl,
    videoId,
    fileName,
    thumbnail: metadata.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    createdAt: new Date().toISOString(),
  };

  tracks.unshift(track);
  await writeTracks(tracks);
  updateDownloadProgress({
    active: false,
    percent: 100,
    status: "complete",
    message: "저장 완료",
  });
  return track;
}

async function loadVideoMetadata(ytDlp, sourceUrl) {
  try {
    const output = await runCommand(ytDlp.command, [
      ...ytDlp.args,
      "--dump-json",
      "--no-playlist",
      sourceUrl,
    ]);
    const info = JSON.parse(output.stdout);
    return {
      title: typeof info.title === "string" ? info.title : "",
      thumbnail: typeof info.thumbnail === "string" ? info.thumbnail : "",
    };
  } catch {
    return {};
  }
}

function createIdleDownloadProgress() {
  return {
    active: false,
    percent: 0,
    status: "idle",
    message: "",
    updatedAt: new Date().toISOString(),
  };
}

function getDownloadProgress() {
  return downloadProgress;
}

function updateDownloadProgress(nextState) {
  const percent =
    typeof nextState.percent === "number"
      ? Math.max(0, Math.min(100, nextState.percent))
      : downloadProgress.percent;

  downloadProgress = {
    ...downloadProgress,
    ...nextState,
    percent,
    updatedAt: new Date().toISOString(),
  };
}

function updateProgressFromYtDlp(output) {
  const lines = String(output).split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const percentMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
    if (percentMatch) {
      updateDownloadProgress({
        active: true,
        percent: Math.min(95, Number(percentMatch[1])),
        status: "downloading",
        message: "오디오 다운로드 중",
      });
      continue;
    }

    if (line.includes("[download] Destination:")) {
      updateDownloadProgress({
        active: true,
        status: "downloading",
        message: "오디오 파일 받는 중",
      });
      continue;
    }

    if (line.includes("[ExtractAudio]") || line.includes("[Merger]")) {
      updateDownloadProgress({
        active: true,
        percent: Math.max(downloadProgress.percent, 92),
        status: "processing",
        message: "오디오 정리 중",
      });
    }
  }
}

async function findDownloadedFile(id) {
  const files = await fs.readdir(LIBRARY_DIR);
  const match = files.find((file) => path.parse(file).name === id);
  if (!match) {
    throw publicError("다운로드된 오디오 파일을 찾지 못했습니다.", 500);
  }
  return match;
}

async function readTracks() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(TRACKS_FILE, "utf8");
    const tracks = JSON.parse(raw);
    return Array.isArray(tracks) ? tracks : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeTracks(tracks) {
  await ensureStorage();
  await fs.writeFile(TRACKS_FILE, JSON.stringify(tracks, null, 2), "utf8");
}

async function deleteTrack(id) {
  const tracks = await readTracks();
  const track = tracks.find((item) => item.id === id);

  if (!track) {
    throw publicError("곡을 찾지 못했습니다.", 404);
  }

  await removeLibraryFile(track.fileName);
  await writeTracks(tracks.filter((item) => item.id !== id));
}

async function deleteAllTracks() {
  const tracks = await readTracks();
  await Promise.all(tracks.map((track) => removeLibraryFile(track.fileName)));
  await writeTracks([]);
}

async function removeLibraryFile(fileName) {
  if (!fileName) return;
  const filePath = path.join(LIBRARY_DIR, path.basename(fileName));
  await fs.rm(filePath, { force: true });
}

function toClientTrack(track) {
  return {
    id: track.id,
    title: track.title,
    videoId: track.videoId,
    thumbnail: track.thumbnail,
    createdAt: track.createdAt,
    format: path.extname(track.fileName || "").replace(".", "").toUpperCase() || "Audio",
    audioUrl: `/media/${encodeURIComponent(track.fileName)}`,
  };
}

async function streamMedia(pathname, request, response) {
  const fileName = path.basename(decodeURIComponent(pathname.replace("/media/", "")));
  const filePath = path.join(LIBRARY_DIR, fileName);
  const stat = await fs.stat(filePath).catch(() => null);

  if (!stat || !stat.isFile()) {
    return sendText(response, "Not found", 404);
  }

  const range = request.headers.range;
  const contentType = MIME_TYPES[path.extname(fileName).toLowerCase()] || "application/octet-stream";

  if (range) {
    const { start, end } = parseRange(range, stat.size);
    response.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Type": contentType,
    });
    return createReadStream(filePath, { start, end }).pipe(response);
  }

  response.writeHead(200, {
    "Accept-Ranges": "bytes",
    "Content-Length": stat.size,
    "Content-Type": contentType,
  });
  createReadStream(filePath).pipe(response);
}

function parseRange(rangeHeader, size) {
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return { start: 0, end: size - 1 };

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;

  return {
    start: Math.max(0, Math.min(start, size - 1)),
    end: Math.max(0, Math.min(end, size - 1)),
  };
}

async function serveStatic(pathname, response, headOnly = false) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const relative = decodeURIComponent(normalized).replace(/^\/+/, "");
  const allowedFiles = new Set([
    "index.html",
    "styles.css",
    "app.js",
    "mini-player.html",
    "mini-player.css",
    "mini-player.js",
  ]);

  if (!allowedFiles.has(relative)) {
    return sendText(response, "Not found", 404);
  }

  const filePath = path.resolve(ROOT_DIR, relative);

  if (!filePath.startsWith(ROOT_DIR)) {
    return sendText(response, "Forbidden", 403);
  }

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return sendText(response, "Not found", 404);
  }

  response.writeHead(200, {
    "Content-Length": stat.size,
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
  });

  if (headOnly) {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

async function readJsonBody(request) {
  let raw = "";

  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > MAX_JSON_BYTES) {
      throw publicError("요청이 너무 큽니다.", 413);
    }
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw publicError("JSON 형식이 올바르지 않습니다.", 400);
  }
}

function sendJson(response, payload, statusCode = 200) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function sendText(response, message, statusCode = 200) {
  response.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(message),
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(message);
}

function findWorkingCommand(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 5000,
    });

    if (result.status === 0) return candidate;
  }

  return null;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      options.onOutput?.(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      options.onOutput?.(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(publicError(stderr.trim() || "명령 실행에 실패했습니다.", 500));
      }
    });
  });
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(LIBRARY_DIR, { recursive: true });
  await seedAppDataStorage();
}

async function seedAppDataStorage() {
  if (!process.env.PULSE_SHELF_STORAGE_DIR) return;

  const hasTracks = await fileExists(TRACKS_FILE);
  if (!hasTracks && (await fileExists(path.join(SEED_DATA_DIR, "tracks.json")))) {
    await fs.copyFile(path.join(SEED_DATA_DIR, "tracks.json"), TRACKS_FILE);
  }

  const libraryFiles = await fs.readdir(LIBRARY_DIR).catch(() => []);
  if (libraryFiles.length > 0 || !(await directoryExists(SEED_LIBRARY_DIR))) return;

  const seedFiles = await fs.readdir(SEED_LIBRARY_DIR);
  await Promise.all(
    seedFiles.map((file) =>
      fs.copyFile(path.join(SEED_LIBRARY_DIR, file), path.join(LIBRARY_DIR, file)),
    ),
  );
}

async function fileExists(filePath) {
  const stat = await fs.stat(filePath).catch(() => null);
  return Boolean(stat?.isFile());
}

async function directoryExists(directoryPath) {
  const stat = await fs.stat(directoryPath).catch(() => null);
  return Boolean(stat?.isDirectory());
}

function extractYouTubeId(value) {
  if (!value || typeof value !== "string") return null;

  const directId = value.match(/^[a-zA-Z0-9_-]{11}$/)?.[0];
  if (directId) return directId;

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return normalizeVideoId(url.pathname.slice(1));
    }

    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (url.searchParams.has("v")) {
        return normalizeVideoId(url.searchParams.get("v"));
      }

      const parts = url.pathname.split("/").filter(Boolean);
      const markerIndex = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      if (markerIndex >= 0) {
        return normalizeVideoId(parts[markerIndex + 1]);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeVideoId(value) {
  const match = value?.match(/[a-zA-Z0-9_-]{11}/);
  return match ? match[0] : null;
}

function publicError(message, statusCode) {
  const error = new Error(message);
  error.publicMessage = message;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  startServer,
};
