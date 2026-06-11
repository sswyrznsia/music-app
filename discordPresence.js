const path = require("node:path");
const dotenv = require("dotenv");
const RPC = require("discord-rpc");

dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });
if (process.cwd() !== __dirname) {
  dotenv.config({ quiet: true });
}

const RECONNECT_DELAY_MS = 30_000;
const MAX_ACTIVITY_TEXT_LENGTH = 128;
const ACTIVITY_TYPE_LISTENING = 2;
const startTimestamp = new Date();

let client = null;
let clientId = null;
let connected = false;
let connecting = false;
let destroyed = false;
let reconnectTimer = null;
let lastActivity = null;
let logger = null;
let typedActivityUnsupported = false;

function log(message, level = "log") {
  const line = `[Discord Presence] ${message}`;

  if (typeof logger === "function") {
    logger(line);
  }

  const writer = console[level] || console.log;
  writer(line);
}

function getClientId() {
  return (process.env.DISCORD_CLIENT_ID || "").trim();
}

function getLargeImageKey() {
  return (process.env.DISCORD_LARGE_IMAGE_KEY || "pulse_shelf").trim() || "pulse_shelf";
}

function buildDefaultActivity() {
  return {
    details: "Pulse Shelf \uC0AC\uC6A9 \uC911",
    state: "\uB77C\uC774\uBE0C\uB7EC\uB9AC \uC815\uB9AC \uC911",
    startTimestamp,
    // Upload an image with this asset key in Discord Developer Portal > Rich Presence > Art Assets.
    largeImageKey: getLargeImageKey(),
    largeImageText: "Pulse Shelf",
    // smallImageKey: "optional_asset_name",
  };
}

function buildPlaybackActivity(trackState = {}) {
  const status = normalizeStatus(trackState.status);
  if (status === "stopped") {
    return buildDefaultActivity();
  }

  const title = truncateActivityText(trackState.title, "\uC74C\uC545 \uAC10\uC0C1 \uC911");
  const artist = truncateActivityText(trackState.artist, "\uC54C \uC218 \uC5C6\uB294 \uC544\uD2F0\uC2A4\uD2B8");
  const activity = {
    name: "Pulse Shelf",
    type: ACTIVITY_TYPE_LISTENING,
    details: title,
    state: artist,
    largeImageKey: getLargeImageKey(),
    largeImageText: "Pulse Shelf",
  };

  const duration = toPositiveNumber(trackState.duration);
  const position = toNonNegativeNumber(trackState.position);

  if (status === "playing" && duration && position !== null && position < duration) {
    const playbackStart = Date.now() - position * 1000;
    activity.startTimestamp = new Date(playbackStart);
    activity.endTimestamp = new Date(playbackStart + duration * 1000);
  }

  return activity;
}

function sanitizeActivity(activity) {
  return Object.fromEntries(
    Object.entries(activity).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function createClient() {
  const rpcClient = new RPC.Client({ transport: "ipc" });

  rpcClient.on("ready", () => {
    connected = true;
    connecting = false;
    clearReconnectTimer();
    log("Connected to local Discord client.");
    applyLastActivity().catch((error) => {
      log(`Initial SET_ACTIVITY failed: ${formatError(error)}`, "warn");
    });
  });

  rpcClient.on("disconnected", () => {
    connected = false;
    connecting = false;
    log("Disconnected from local Discord client. Retrying in 30 seconds.", "warn");
    resetClient(rpcClient);
    scheduleReconnect();
  });

  rpcClient.on("error", (error) => {
    connected = false;
    connecting = false;
    log(`RPC error: ${formatError(error)}. Retrying in 30 seconds.`, "warn");
    resetClient(rpcClient);
    scheduleReconnect();
  });

  return rpcClient;
}

function initDiscordPresence(options = {}) {
  if (typeof options.logger === "function") {
    logger = options.logger;
  }

  if (destroyed) {
    destroyed = false;
  }

  clientId = getClientId();
  if (!clientId) {
    log(
      "DISCORD_CLIENT_ID is not set. Create a .env file with DISCORD_CLIENT_ID=YOUR_APPLICATION_ID to enable Rich Presence.",
      "warn",
    );
    return;
  }

  try {
    RPC.register(clientId);
  } catch (error) {
    log(`RPC.register failed: ${formatError(error)}`, "warn");
  }

  connect();
}

async function connect() {
  if (destroyed || !clientId || connected || connecting) return;

  connecting = true;
  clearReconnectTimer();

  if (!client) {
    client = createClient();
  }

  try {
    log("Connecting to local Discord client.");
    await client.login({ clientId });

    if (!connected) {
      connected = true;
      connecting = false;
      clearReconnectTimer();
      log("Connected to local Discord client.");
      await applyLastActivity();
    }
  } catch (error) {
    connected = false;
    connecting = false;
    if (destroyed) {
      resetClient();
      return;
    }
    log(`Could not connect to local Discord client: ${formatError(error)}. Retrying in 30 seconds.`, "warn");
    resetClient();
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (destroyed || !clientId || reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

async function applyLastActivity() {
  return updateDiscordPresence(lastActivity || buildDefaultActivity());
}

async function setDefaultPresence() {
  return updateDiscordPresence(buildDefaultActivity());
}

async function updatePlaybackPresence(trackState = {}) {
  const status = normalizeStatus(trackState.status);
  if (status === "stopped") {
    return setDefaultPresence();
  }

  return updateDiscordPresence(buildPlaybackActivity({ ...trackState, status }));
}

async function updateDiscordPresence(partialActivity = {}) {
  const activity = sanitizeActivity(partialActivity);

  lastActivity = activity;

  if (!connected || !client) {
    log("Presence update queued until Discord is connected.");
    return;
  }

  try {
    await setRpcActivity(activity);
    log("Rich Presence activity updated.");
  } catch (error) {
    connected = false;
    log(`SET_ACTIVITY failed: ${formatError(error)}. Retrying in 30 seconds.`, "warn");
    resetClient();
    scheduleReconnect();
  }
}

async function clearDiscordPresence() {
  lastActivity = null;

  if (!connected || !client) return;

  try {
    await client.clearActivity();
    log("Rich Presence activity cleared.");
  } catch (error) {
    log(`clearActivity failed: ${formatError(error)}`, "warn");
  }
}

function destroyDiscordPresence() {
  destroyed = true;
  connected = false;
  connecting = false;
  clearReconnectTimer();

  const activeClient = client;
  client = null;

  if (!activeClient) return;

  Promise.resolve()
    .then(async () => {
      try {
        await activeClient.clearActivity();
      } catch (error) {
        log(`clearActivity during shutdown failed: ${formatError(error)}`, "warn");
      }

      try {
        await safeDestroyClient(activeClient);
        log("Discord RPC connection closed.");
      } catch (error) {
        log(`RPC destroy failed: ${formatError(error)}`, "warn");
      }
    })
    .catch((error) => {
      log(`Shutdown cleanup failed: ${formatError(error)}`, "warn");
    });
}

function resetClient(targetClient = client) {
  if (targetClient === client) {
    client = null;
  }

  if (!targetClient) return;

  safeDestroyClient(targetClient);
}

async function safeDestroyClient(targetClient) {
  try {
    await targetClient.destroy();
  } catch {
  }
}

function formatError(error) {
  if (!error) return "Unknown error";
  if (error.message) return error.message;
  return String(error);
}

async function setRpcActivity(activity) {
  if (activity.type === undefined || typedActivityUnsupported) {
    return client.setActivity(activity);
  }

  try {
    return await client.request("SET_ACTIVITY", {
      pid: process.pid,
      activity: buildRpcActivityPayload(activity),
    });
  } catch (error) {
    const fallbackResult = await client.setActivity(stripRpcOnlyActivityFields(activity));
    typedActivityUnsupported = true;
    log(`Activity type was not accepted by Discord RPC: ${formatError(error)}. Falling back to normal Rich Presence.`, "warn");
    return fallbackResult;
  }
}

function buildRpcActivityPayload(activity) {
  const payload = {
    name: activity.name,
    type: activity.type,
    state: activity.state,
    details: activity.details,
    timestamps: buildTimestamps(activity),
    assets: buildAssets(activity),
    buttons: activity.buttons,
    instance: Boolean(activity.instance),
  };

  return sanitizeActivity(payload);
}

function buildTimestamps(activity) {
  if (!activity.startTimestamp && !activity.endTimestamp) return undefined;

  return sanitizeActivity({
    start: normalizeTimestamp(activity.startTimestamp),
    end: normalizeTimestamp(activity.endTimestamp),
  });
}

function buildAssets(activity) {
  if (
    !activity.largeImageKey
    && !activity.largeImageText
    && !activity.smallImageKey
    && !activity.smallImageText
  ) {
    return undefined;
  }

  return sanitizeActivity({
    large_image: activity.largeImageKey,
    large_text: activity.largeImageText,
    small_image: activity.smallImageKey,
    small_text: activity.smallImageText,
  });
}

function normalizeTimestamp(value) {
  if (!value) return undefined;
  if (value instanceof Date) return Math.round(value.getTime());
  return value;
}

function stripRpcOnlyActivityFields(activity) {
  const { name, type, ...standardActivity } = activity;
  return standardActivity;
}

function normalizeStatus(status) {
  if (status === "playing" || status === "paused") return status;
  return "stopped";
}

function truncateActivityText(value, fallback) {
  const text = String(value || "").trim() || fallback;
  return [...text].slice(0, MAX_ACTIVITY_TEXT_LENGTH).join("");
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

module.exports = {
  initDiscordPresence,
  setDefaultPresence,
  updatePlaybackPresence,
  updateDiscordPresence,
  clearDiscordPresence,
  destroyDiscordPresence,
};
