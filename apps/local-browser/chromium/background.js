import "./lib/protocol.js";
import "./lib/pairing.js";
import "./lib/budget.js";
import "./lib/attachments.js";
import "./lib/frames.js";

const LB = globalThis.LB;
const PROTOCOL = LB.protocol;
const ERROR = PROTOCOL.ERROR_CODES;
const DEFAULTS = PROTOCOL.DEFAULTS;
const STORE_KEY = "lb.pairing";
const KEEPALIVE_ALARM = "lb-heartbeat";
const HEARTBEAT_MS = 20000;
const INPUT_IDLE_DETACH_MS = 30000;
const CONTENT_FILES = [
  "lib/protocol.js",
  "lib/text.js",
  "lib/refmap.js",
  "lib/snapshot.js",
  "lib/markdown.js",
  "lib/cursor.js",
  "lib/attachments.js",
  "lib/frames.js",
  "lib/hit.js",
  "lib/dom-adapter.js",
  "content.js"
];

const CLIENT_VERSION = chrome.runtime.getManifest().version;

class ToolFailure extends Error {
  constructor(code, message, hint, retryable) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.retryable = retryable;
  }
}

let socket = null;
let socketState = "idle";
let socketGeneration = 0;
let sessionClosed = false;
let pendingSessionClose = false;
let retiredReason = "";
const CLOSE_POLICY_VIOLATION = 1008;

async function retirePairing(reason) {
  sessionClosed = true;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopViewer();
  await detachInputSession();
  const stored = (await readPairing()) || {};
  retiredReason = String(reason || "").slice(0, 200);
  await writePairing({
    origin: stored.origin || null,
    label: stored.label || defaultLabel(),
    sessionToken: null,
    sessionId: null,
    code: null,
    tier: null,
    allowedOrigins: [],
    pairedAt: stored.pairedAt || null,
    retiredAt: new Date().toISOString(),
    retiredReason: retiredReason
  });
}
let backoffMs = 1000;
let reconnectTimer = null;
let heartbeatTimer = null;
let intentionalClose = false;
let lastTabsJson = "";
let tabsTimer = null;
let viewer = null;
let inputSession = null;
const networkBuffers = new Map();

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clampInt(value, fallback, min, max) {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  if (number < min) return min;
  if (number > max) return max;
  return number;
}

function defaultLabel() {
  const agent = navigator.userAgent || "";
  if (agent.includes("Edg/")) return "Edge";
  if (agent.includes("OPR/")) return "Opera";
  return "Chrome";
}

function toolError(code, message, hint, retryable) {
  const error = { code, message };
  if (hint) error.hint = hint;
  if (typeof retryable === "boolean") error.retryable = retryable;
  return error;
}

function siteAccessDenied(message) {
  return /cannot access contents of|missing host permission|extension manifest must request permission|Cannot access a chrome-extension|not allowed to access/i.test(
    message
  );
}

function toToolError(error) {
  const message = error instanceof ToolFailure
    ? error.message || "The browser refused the call"
    : String((error && error.message) || error || "Unknown browser error");
  if (siteAccessDenied(message)) {
    return toolError(
      ERROR.originDenied,
      "This browser blocks the extension from that page, so nothing was read or changed",
      "Open the extension details page and set site access to all sites, then retry",
      true
    );
  }
  if (error instanceof ToolFailure) {
    return toolError(error.code, message, error.hint, error.retryable);
  }
  return toolError(ERROR.protocolError, message, undefined, true);
}

function fromContentError(error) {
  if (!error || typeof error !== "object") {
    return new ToolFailure(ERROR.protocolError, "The page returned an unreadable error");
  }
  return new ToolFailure(error.code || ERROR.protocolError, error.message || "The page refused the call", error.hint, error.retryable);
}

async function readPairing() {
  const stored = await chrome.storage.local.get(STORE_KEY);
  return stored[STORE_KEY] || null;
}

async function writePairing(value) {
  await chrome.storage.local.set({ [STORE_KEY]: value });
}

async function clearPairing() {
  await chrome.storage.local.remove(STORE_KEY);
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => typeof tab.id === "number")
    .map((tab) => ({
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || "",
      active: tab.active === true,
      status: tab.status || "unknown"
    }));
}

function tabInfo(tab) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || "",
    url: tab.url || "",
    active: tab.active === true,
    status: tab.status || "unknown"
  };
}

function buildSocketUrl(entry) {
  const base = entry.origin.replace(/^http/, "ws").replace(/\/+$/, "");
  const query = entry.sessionToken
    ? "session=" + encodeURIComponent(entry.sessionToken)
    : "code=" + encodeURIComponent(entry.code || "");
  return base + PROTOCOL.BRIDGE_PATH + "?" + query;
}

function send(frame) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(frame));
    return true;
  } catch (error) {
    return false;
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  const delay = backoffMs + Math.floor(Math.random() * 250);
  backoffMs = Math.min(backoffMs * 2, 30000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

function stopHeartbeat() {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    send({ type: "ping", at: new Date().toISOString() });
  }, HEARTBEAT_MS);
}

function retiredReasonOf(stored) {
  if (!stored || stored.sessionToken || stored.code) return "";
  return typeof stored.retiredAt === "string" && stored.retiredAt ? String(stored.retiredReason || "") : "";
}

async function connect() {
  if (socketState !== "idle") return;
  if (sessionClosed) return;
  const stored = await readPairing();
  if (!stored || (!stored.sessionToken && !stored.code)) return;
  if (sessionClosed) return;
  const generation = socketGeneration;
  const url = buildSocketUrl(stored);
  socketState = "connecting";
  intentionalClose = false;

  let next;
  try {
    next = new WebSocket(url);
  } catch (error) {
    if (generation === socketGeneration) {
      socketState = "idle";
      scheduleReconnect();
    }
    return;
  }
  if (generation !== socketGeneration || sessionClosed) {
    try {
      next.close(1000, "superseded");
    } catch (error) {}
    return;
  }
  socket = next;

  next.addEventListener("open", () => {
    if (socket !== next) return;
    socketState = "open";
    backoffMs = 1000;
    startHeartbeat();
    void sendHello();
  });

  next.addEventListener("message", (event) => {
    if (socket !== next) return;
    void onFrame(event.data);
  });

  next.addEventListener("close", (event) => {
    if (socket !== next) return;
    socket = null;
    socketState = "idle";
    stopHeartbeat();
    stopViewer();
    const code = event && typeof event.code === "number" ? event.code : 1006;
    if (code === CLOSE_POLICY_VIOLATION) {
      void retirePairing(event && typeof event.reason === "string" ? event.reason : "");
      return;
    }
    if (!intentionalClose && !sessionClosed) scheduleReconnect();
  });

  next.addEventListener("error", () => {
    if (socket !== next) return;
    try {
      next.close();
    } catch (error) {}
  });
}

function closeSocket() {
  stopHeartbeat();
  socketGeneration += 1;
  const current = socket;
  socket = null;
  socketState = "idle";
  intentionalClose = true;
  if (current) {
    try {
      current.close(1000, "client closing");
    } catch (error) {}
  }
}

async function disconnect(options) {
  const settings = options || {};
  sessionClosed = true;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopViewer();
  await detachInputSession();
  closeSocket();
  if (settings.clear !== false) await clearPairing();
  backoffMs = 1000;
}

function reopenSession() {
  sessionClosed = false;
  retiredReason = "";
}

async function sendHello() {
  const stored = (await readPairing()) || {};
  send({
    type: "hello",
    protocol: PROTOCOL.PROTOCOL_VERSION,
    client: PROTOCOL.CLIENT,
    clientVersion: CLIENT_VERSION,
    capabilities: ["cookies.v2"],
    label: stored.label || defaultLabel(),
    profileName: null,
    tabs: await listTabs()
  });
}

async function applyHelloAck(frame) {
  const stored = (await readPairing()) || {};
  const next = {
    origin: stored.origin,
    label: stored.label || defaultLabel(),
    sessionId: frame.sessionId,
    sessionToken: frame.sessionToken,
    tier: frame.tier,
    allowedOrigins: Array.isArray(frame.allowedOrigins) ? frame.allowedOrigins : [],
    pairedAt: stored.pairedAt || new Date().toISOString()
  };
  await writePairing(next);
  retiredReason = "";
  backoffMs = 1000;
}

async function onFrame(raw) {
  if (typeof raw !== "string") return;
  let frame;
  try {
    frame = JSON.parse(raw);
  } catch (error) {
    return;
  }
  if (!frame || typeof frame.type !== "string") return;
  if (frame.type === "hello_ack") {
    await applyHelloAck(frame);
    return;
  }
  if (frame.type === "call") {
    await handleCall(frame);
    return;
  }
  if (frame.type === "ping") {
    send({ type: "pong", at: typeof frame.at === "string" ? frame.at : new Date().toISOString() });
  }
}

function timeoutFor(tool, args) {
  return LB.budget.callBudget(tool, args);
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ToolFailure(ERROR.timeout, "The browser did not answer in " + timeoutMs + " ms", "Retry, or reload the tab", true));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function handleCall(frame) {
  const tool = String(frame.tool || "");
  const id = String(frame.id || "");
  const handler = TOOL_HANDLERS[tool];
  if (!handler) {
    send({
      type: "result",
      id,
      ok: false,
      error: toolError(ERROR.unsupported, "Unknown tool " + tool, "Update the extension to the version the server expects")
    });
    return;
  }
  const args = frame.args && typeof frame.args === "object" ? frame.args : {};
  const drivesViewer = tool === "local_browser_viewer";
  if (!drivesViewer) emitAgentState(true);
  try {
    const result = await withTimeout(handler(args), timeoutFor(tool, args));
    send({ type: "result", id, ok: true, result: result === undefined ? null : result });
  } catch (error) {
    send({ type: "result", id, ok: false, error: toToolError(error) });
  } finally {
    if (!drivesViewer) emitAgentState(false);
  }
  if (pendingSessionClose) {
    pendingSessionClose = false;
    await disconnect({ clear: true });
  }
}

async function resolveTab(args) {
  if (typeof args.tabId === "number") {
    const tab = await chrome.tabs.get(args.tabId).catch(() => null);
    if (!tab) {
      throw new ToolFailure(ERROR.tabMissing, "Tab " + args.tabId + " is gone", "Call local_browser_sessions for the current tabs");
    }
    return tab;
  }
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused) return focused;
  const [any] = await chrome.tabs.query({ active: true });
  if (any) return any;
  throw new ToolFailure(ERROR.tabMissing, "No active tab in the paired browser", "Open a tab, then retry");
}

function isNoReceiver(error) {
  const message = String((error && error.message) || error || "");
  return message.includes("Receiving end does not exist") || message.includes("Could not establish connection");
}

function sendToTab(tabId, payload, timeoutMs, frameId) {
  const options = typeof frameId === "number" ? { frameId } : {};
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ToolFailure(ERROR.timeout, "The page did not answer in " + timeoutMs + " ms", "Retry, or reload the tab", true));
    }, timeoutMs);
    chrome.tabs.sendMessage(tabId, payload, options, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response) {
        reject(new Error("The page returned no response"));
        return;
      }
      if (response.ok === false) {
        reject(fromContentError(response.error));
        return;
      }
      resolve(response.result);
    });
  });
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
}

async function rpc(tabId, op, args, timeoutMs) {
  const payload = { type: "lb:rpc", op, args: args || {}, tabId };
  const budget = typeof timeoutMs === "number" ? timeoutMs : 15000;
  try {
    return await sendToTab(tabId, payload, budget, 0);
  } catch (error) {
    if (!isNoReceiver(error)) throw error;
    await injectContentScript(tabId).catch(() => {});
    try {
      return await sendToTab(tabId, payload, budget, 0);
    } catch (retryError) {
      if (!isNoReceiver(retryError)) throw retryError;
      return await sendToTab(tabId, payload, budget);
    }
  }
}

async function waitForTab(tabId, waitUntil, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const mode = waitUntil || "load";
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new ToolFailure(ERROR.tabMissing, "The tab closed while loading", "Open the page again");
    if (tab.status === "complete") {
      if (mode !== "networkidle") return tab;
      const idle = await rpc(tabId, "wait", { idle: true, timeoutMs: Math.min(3000, Math.max(200, deadline - Date.now())) }, 6000).catch(
        () => ({ matched: true })
      );
      if (idle && idle.matched !== false) return tab;
    }
    await sleep(120);
  }
  throw new ToolFailure(ERROR.timeout, "The page did not settle in " + timeoutMs + " ms", "Retry with a longer timeoutMs", true);
}

async function trySnapshot(tabId, args) {
  try {
    return await rpc(tabId, "snapshot", args || {}, 15000);
  } catch (error) {
    return null;
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  return "data:" + (blob.type || "application/octet-stream") + ";base64," + toBase64(buffer);
}

async function cropDataUrl(dataUrl, rect) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const box = LB.frames.cropRect(rect, rect.dpr, bitmap.width, bitmap.height);
  if (!box) {
    if (typeof bitmap.close === "function") bitmap.close();
    return null;
  }
  const sourceX = box.x;
  const sourceY = box.y;
  const sourceWidth = box.width;
  const sourceHeight = box.height;
  const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  if (typeof bitmap.close === "function") bitmap.close();
  return await blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

async function captureFullPage(tab) {
  const target = { tabId: tab.id };
  const alreadyHeld = inputSession !== null && inputSession.tabId === tab.id;
  try {
    if (!alreadyHeld) await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    return null;
  }
  try {
    await chrome.debugger.sendCommand(target, "Page.enable", {});
    const metrics = await chrome.debugger.sendCommand(target, "Page.getLayoutMetrics");
    const size = metrics.cssContentSize || metrics.contentSize;
    const shot = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 }
    });
    return { dataUrl: "data:image/png;base64," + shot.data, width: Math.ceil(size.width), height: Math.ceil(size.height) };
  } catch (error) {
    return null;
  } finally {
    if (!alreadyHeld) await chrome.debugger.detach(target).catch(() => {});
    else touchInputSession();
  }
}

async function toolSessions() {
  const tabs = await listTabs();
  const stored = (await readPairing()) || {};
  const summary = {
    sessionId: stored.sessionId || null,
    client: PROTOCOL.CLIENT,
    clientVersion: CLIENT_VERSION,
    label: stored.label || defaultLabel(),
    tier: stored.tier || "refine",
    tabs
  };
  return Object.assign({}, summary, { sessions: [summary] });
}

const agentTabs = new Set();

async function paperclipOrigins() {
  const stored = (await readPairing()) || {};
  const origins = new Set();
  const paired = originOf(stored.origin);
  if (paired) origins.add(paired);
  return origins;
}

async function assertNavigationAllowed(tab) {
  const origins = await paperclipOrigins();
  const current = originOf(tab.url);
  if (current && origins.has(current)) {
    throw new ToolFailure(
      ERROR.navigationBlocked,
      "This tab belongs to Paperclip itself, so it is never navigated",
      "Call local_browser_open with a url; that always uses a fresh tab"
    );
  }
  if (agentTabs.has(tab.id)) return;
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused && focused.id === tab.id) {
    throw new ToolFailure(
      ERROR.navigationBlocked,
      "This is the tab the user is looking at, so it is left alone",
      "Call local_browser_open with a url; that always uses a fresh tab"
    );
  }
}

async function ownAgentTab() {
  for (const id of [...agentTabs]) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (!tab) {
      agentTabs.delete(id);
      continue;
    }
    const origins = await paperclipOrigins();
    const current = originOf(tab.url);
    if (current && origins.has(current)) continue;
    return tab;
  }
  return null;
}

async function newAgentTab(url, active) {
  const tab = await chrome.tabs.create({ url, active });
  agentTabs.add(tab.id);
  return tab;
}

async function toolOpen(args) {
  let tab;
  if (args.url) {
    if (typeof args.tabId === "number") {
      const target = await resolveTab(args);
      await assertNavigationAllowed(target);
      tab = await chrome.tabs.update(target.id, { url: args.url });
      agentTabs.add(tab.id);
    } else {
      const reusable = await ownAgentTab();
      if (reusable) {
        tab = await chrome.tabs.update(reusable.id, { url: args.url });
      } else {
        tab = await newAgentTab(args.url, args.active === true);
      }
    }
  } else {
    tab = await resolveTab(args);
    if (args.active === true) await chrome.tabs.update(tab.id, { active: true });
  }
  await waitForTab(tab.id, "load", DEFAULTS.navigateTimeoutMs);
  const fresh = await chrome.tabs.get(tab.id);
  const snapshot = await trySnapshot(tab.id, {});
  return { tab: tabInfo(fresh), snapshot };
}

async function toolNavigate(args) {
  const tab = await resolveTab(args);
  await assertNavigationAllowed(tab);
  const timeoutMs = clampInt(args.timeoutMs, DEFAULTS.navigateTimeoutMs, 100, 120000);
  let action = null;
  if (args.url) action = "url";
  else if (args.back) action = "back";
  else if (args.forward) action = "forward";
  else if (args.reload) action = "reload";
  if (!action) throw new ToolFailure(ERROR.protocolError, "navigate needs url, back, forward or reload");

  try {
    if (action === "url") await chrome.tabs.update(tab.id, { url: args.url });
    else if (action === "back") await chrome.tabs.goBack(tab.id);
    else if (action === "forward") await chrome.tabs.goForward(tab.id);
    else await chrome.tabs.reload(tab.id);
  } catch (error) {
    throw new ToolFailure(
      ERROR.navigationBlocked,
      "The browser could not " + action + " this tab",
      "Open the url with local_browser_open instead"
    );
  }
  await waitForTab(tab.id, args.waitUntil || "load", timeoutMs);
  const fresh = await chrome.tabs.get(tab.id);
  return { tab: tabInfo(fresh) };
}

async function toolSnapshot(args) {
  const tab = await resolveTab(args);
  return await rpc(
    tab.id,
    "snapshot",
    {
      selector: args.selector,
      maxNodes: args.maxNodes,
      includeText: args.includeText,
      includeHidden: args.includeHidden,
      cursor: args.cursor
    },
    20000
  );
}

async function toolAct(args) {
  const tab = await resolveTab(args);
  const result = await rpc(tab.id, "act", args, clampInt(args.timeoutMs, 15000, 100, 60000));
  let trusted = false;
  const retryKey = args.key || (args.action === "type" && args.submit ? "Enter" : null);
  if (result && result.trustedNeeded === true && retryKey) {
    try {
      await ensureDebugger(tab.id);
      await pressTrustedKey(tab.id, retryKey);
      touchInputSession();
      trusted = true;
    } catch (error) {
      trusted = false;
    }
  }
  return {
    ok: result && result.ok !== false,
    url: (result && result.url) || tab.url || "",
    title: (result && result.title) || tab.title || "",
    changed: Boolean(result && result.changed) || trusted
  };
}

async function toolRead(args) {
  const tab = await resolveTab(args);
  return await rpc(tab.id, "read", { selector: args.selector, format: args.format, maxChars: args.maxChars }, 20000);
}

async function captureBackgroundTab(tab) {
  const target = { tabId: tab.id };
  const alreadyHeld = inputSession !== null && inputSession.tabId === tab.id;
  try {
    if (!alreadyHeld) await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    return null;
  }
  try {
    const shot = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", { format: "png" });
    return "data:image/png;base64," + shot.data;
  } catch (error) {
    return null;
  } finally {
    if (!alreadyHeld) await chrome.debugger.detach(target).catch(() => {});
    else touchInputSession();
  }
}

async function screenshotWithoutFocus(tab) {
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused && focused.id === tab.id) {
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  }
  const background = await captureBackgroundTab(tab);
  if (background) return background;
  throw new ToolFailure(
    ERROR.unsupported,
    "This tab cannot be captured without bringing it to the front",
    "Ask the user to switch to that tab, or use local_browser_read instead"
  );
}

async function toolScreenshot(args) {
  const tab = await resolveTab(args);
  let fullPageFallback = null;
  if (args.fullPage === true) {
    const full = await captureFullPage(tab);
    if (full) return { dataUrl: full.dataUrl, width: full.width, height: full.height, tabId: tab.id, fullPage: true };
    fullPageFallback = "The browser refused the debugger, so this is the visible viewport only";
  }
  let rect = null;
  if (args.selector) {
    rect = await rpc(tab.id, "elementRect", { selector: args.selector }, 10000);
  }
  const dataUrl = await screenshotWithoutFocus(tab);
  const result = { dataUrl, width: null, height: null, tabId: tab.id, fullPage: false };
  if (fullPageFallback) result.note = fullPageFallback;
  if (!rect) return result;
  const cropped = await cropDataUrl(dataUrl, rect).catch(() => null);
  if (!cropped) {
    result.width = Math.round(rect.width);
    result.height = Math.round(rect.height);
    result.cropped = false;
    result.note = "The element crop failed, so this is the whole viewport";
    return result;
  }
  result.dataUrl = cropped;
  result.width = Math.round(rect.width);
  result.height = Math.round(rect.height);
  result.cropped = true;
  return result;
}

async function toolWait(args) {
  const tab = await resolveTab(args);
  if (!args.selector && !args.text && !args.urlIncludes && !args.idle) {
    throw new ToolFailure(ERROR.protocolError, "wait needs selector, text, urlIncludes or idle");
  }
  const timeoutMs = clampInt(args.timeoutMs, DEFAULTS.waitTimeoutMs, 100, 120000);
  return await rpc(tab.id, "wait", args, timeoutMs + 5000);
}

async function pageEvaluate(expression, awaitPromise) {
  function safeClone(input) {
    if (input === undefined) return { value: null, type: "undefined", note: "not serializable" };
    if (input === null) return { value: null, type: "null" };
    try {
      return { value: JSON.parse(JSON.stringify(input)), type: typeof input };
    } catch (error) {
      return { value: null, type: typeof input, note: "not serializable" };
    }
  }
  try {
    const raw = (0, eval)(expression);
    if (raw && typeof raw.then === "function") {
      if (!awaitPromise) return { value: null, type: "promise", note: "not serializable" };
      return safeClone(await raw);
    }
    return safeClone(raw);
  } catch (error) {
    return { __lbError: String((error && error.message) || error) };
  }
}

async function toolEvaluate(args) {
  const tab = await resolveTab(args);
  const world = args.world === "isolated" ? "ISOLATED" : "MAIN";
  let frames;
  try {
    frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world,
      args: [args.expression, args.awaitPromise === true],
      awaitPromise: true,
      func: pageEvaluate
    });
  } catch (error) {
    throw new ToolFailure(
      ERROR.unsupported,
      "This page refused injected code: " + String((error && error.message) || error),
      "Retry with world:isolated, or use local_browser_act instead"
    );
  }
  const outcome = frames && frames[0] ? frames[0].result : null;
  if (outcome && outcome.__lbError) {
    throw new ToolFailure(
      ERROR.unsupported,
      "The page blocked the expression: " + outcome.__lbError,
      "Some sites block eval through their content security policy; retry with world:isolated"
    );
  }
  return outcome;
}

function cookieSummary(cookie) {
  const summary = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    session: cookie.session === true,
    sameSite: cookie.sameSite || "unspecified",
    expirationDate: cookie.expirationDate
  };
  if (cookie.storeId) summary.storeId = cookie.storeId;
  if (cookie.partitionKey && cookie.partitionKey.topLevelSite) summary.partitionTopLevelSite = cookie.partitionKey.topLevelSite;
  return summary;
}

function cookieQuery(args, tab) {
  const query = {};
  if (args.storeId) query.storeId = args.storeId;
  if (args.name) query.name = args.name;
  if (args.allDomains === true) return query;
  if (typeof args.domain === "string" && args.domain) {
    query.domain = args.domain.replace(/^\./, "");
  } else {
    const url = args.url || tab.url;
    if (!url || !/^https?:/.test(url)) {
      throw new ToolFailure(ERROR.protocolError, "Cookies need an http(s) url or a domain", "Pass url, domain, or allDomains, or use a tab on a website");
    }
    query.url = url;
  }
  return query;
}

function cookieUrlFor(args, tab, entry) {
  if (entry && typeof entry.url === "string" && /^https?:/.test(entry.url)) return entry.url;
  const scheme = entry && entry.secure === false ? "http://" : "https://";
  const domain = (entry && entry.domain) || (typeof args.domain === "string" ? args.domain : "");
  if (domain) return scheme + String(domain).replace(/^\./, "") + ((entry && entry.path) || "/");
  const base = args.url || (tab.url && /^https?:/.test(tab.url) ? tab.url : "");
  if (!base) {
    throw new ToolFailure(ERROR.protocolError, "Cookies need an http(s) url or a domain", "Pass url, domain, or allDomains, or use a tab on a website");
  }
  if (entry && entry.path) {
    try {
      return new URL(entry.path, base).href;
    } catch (error) {
      return base;
    }
  }
  return base;
}

async function toolStorage(args) {
  const jarScope = args.kind === "cookies" && (args.allDomains === true || typeof args.domain === "string");
  const tab = jarScope ? await resolveTab(args).catch(() => ({ id: null, url: "" })) : await resolveTab(args);
  if (args.kind !== "cookies") {
    return await rpc(tab.id, "storage", args, 10000);
  }
  if (args.op === "get") {
    const query = cookieQuery(args, tab);
    const found = (await chrome.cookies.getAll(query)).map(cookieSummary);
    const limit = typeof args.limit === "number" ? args.limit : 200;
    return { kind: "cookies", op: "get", query, total: found.length, cookies: found.slice(0, limit) };
  }
  if (args.op === "set") {
    const entries = args.entries || [];
    const written = [];
    const failed = [];
    for (const entry of entries) {
      const details = { url: cookieUrlFor(args, tab, entry), name: entry.name, value: entry.value };
      if (entry.storeId || args.storeId) details.storeId = entry.storeId || args.storeId;
      const entryDomain = entry.domain || (typeof args.domain === "string" ? args.domain : "");
      if (entryDomain) details.domain = entryDomain;
      if (typeof entry.path === "string" && entry.path) details.path = entry.path;
      if (typeof entry.secure === "boolean") details.secure = entry.secure;
      if (typeof entry.httpOnly === "boolean") details.httpOnly = entry.httpOnly;
      if (typeof entry.sameSite === "string" && entry.sameSite !== "unspecified") details.sameSite = entry.sameSite;
      if (typeof entry.expirationDate === "number") details.expirationDate = entry.expirationDate;
      try {
        const cookie = await chrome.cookies.set(details);
        if (cookie) written.push(cookieSummary(cookie));
        else failed.push(entry.name);
      } catch (error) {
        failed.push(entry.name);
      }
    }
    const result = { kind: "cookies", op: "set", count: written.length, cookies: written };
    if (failed.length) {
      result.failed = failed;
      result.note = "The browser refused " + failed.length + " cookie(s); check the domain against the url";
    }
    return result;
  }
  const query = cookieQuery(args, tab);
  const cookies = await chrome.cookies.getAll(query);
  if (args.allDomains === true && cookies.length > 50 && args.confirmAll !== true && !args.name) {
    throw new ToolFailure(ERROR.protocolError, "Refusing to clear " + cookies.length + " cookies across every site", "Pass a name filter or confirmAll: true");
  }
  const removed = [];
  const failed = [];
  for (const cookie of cookies) {
    const host = String(cookie.domain || "").replace(/^\./, "");
    const target = (cookie.secure ? "https://" : "http://") + host + (cookie.path || "/");
    try {
      const outcome = await chrome.cookies.remove({ url: target, name: cookie.name, storeId: cookie.storeId });
      if (outcome) removed.push(cookie.name);
      else failed.push(cookie.name);
    } catch (error) {
      failed.push(cookie.name);
    }
  }
  const result = { kind: "cookies", op: "clear", query, count: removed.length, removed, matched: cookies.length };
  if (failed.length) {
    result.failed = failed;
    result.note = "The browser refused to remove " + failed.length + " cookie(s)";
  }
  return result;
}

async function collectNetwork(tabId, options) {
  const target = { tabId };
  const alreadyHeld = inputSession !== null && inputSession.tabId === tabId;
  try {
    if (!alreadyHeld) await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    throw new ToolFailure(
      ERROR.unsupported,
      "The browser would not attach its debugger to this tab",
      "Close DevTools or another debugging tool for this tab, then retry"
    );
  }

  const rows = new Map();
  const listener = (source, method, params) => {
    if (!source || source.tabId !== tabId) return;
    if (method === "Network.requestWillBeSent") {
      rows.set(params.requestId, {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        type: params.type || "Other",
        startedAt: params.wallTime ? new Date(params.wallTime * 1000).toISOString() : new Date().toISOString(),
        startedMono: params.timestamp,
        status: null,
        durationMs: null,
        hasBody: false
      });
      return;
    }
    if (method === "Network.responseReceived") {
      const row = rows.get(params.requestId);
      if (row) {
        row.status = params.response.status;
        row.mimeType = params.response.mimeType;
      }
      return;
    }
    if (method === "Network.loadingFinished") {
      const row = rows.get(params.requestId);
      if (row) {
        const elapsed = (params.timestamp - row.startedMono) * 1000;
        row.durationMs = Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null;
        row.hasBody = true;
      }
    }
  };

  chrome.debugger.onEvent.addListener(listener);
  try {
    await chrome.debugger.sendCommand(target, "Network.enable", {
      maxTotalBufferSize: 8000000,
      maxResourceBufferSize: 2000000
    });
    await sleep(options.windowMs);
    if (options.includeBodies) {
      for (const row of rows.values()) {
        if (!row.hasBody) continue;
        try {
          const body = await chrome.debugger.sendCommand(target, "Network.getResponseBody", { requestId: row.requestId });
          row.body = String(body.body || "").slice(0, 4000);
          row.bodyBase64 = body.base64Encoded === true;
        } catch (error) {}
      }
    }
  } finally {
    chrome.debugger.onEvent.removeListener(listener);
    if (!alreadyHeld) await chrome.debugger.detach(target).catch(() => {});
    else touchInputSession();
  }

  return Array.from(rows.values()).map((row) => ({
    url: row.url,
    method: row.method,
    status: row.status,
    type: row.type,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    mimeType: row.mimeType,
    body: row.body,
    bodyBase64: row.bodyBase64
  }));
}

async function toolNetwork(args) {
  const tab = await resolveTab(args);
  if (args.op === "clear") {
    networkBuffers.delete(tab.id);
    return { requests: [], total: 0, cleared: true };
  }
  const collected = await collectNetwork(tab.id, {
    includeBodies: args.includeBodies === true,
    windowMs: 1200
  });
  const buffer = (networkBuffers.get(tab.id) || []).concat(collected).slice(-400);
  networkBuffers.set(tab.id, buffer);
  let rows = buffer;
  if (args.urlIncludes) rows = rows.filter((row) => row.url.includes(args.urlIncludes));
  if (args.method) rows = rows.filter((row) => String(row.method).toUpperCase() === String(args.method).toUpperCase());
  const limit = clampInt(args.limit, 50, 1, 200);
  return { requests: rows.slice(-limit), total: rows.length };
}

function normalizeUploadFiles(args) {
  return LB.attachments.normalizeUploadFiles(args);
}

async function attachFiles(selector, files) {
  const input = document.querySelector(selector);
  if (!input) return { ok: false, message: "The file input is gone" };
  const transfer = new DataTransfer();
  for (const file of files) {
    const binary = atob(file.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    transfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, count: transfer.files.length };
}

async function toolUpload(args) {
  const tab = await resolveTab(args);
  const files = normalizeUploadFiles(args);
  if (!files.length) {
    throw new ToolFailure(
      ERROR.unsupported,
      "No file data arrived with this call",
      "The server must send files:[{name,mimeType,base64}] with the call; attachmentIds alone cannot reach the browser"
    );
  }
  const target = await rpc(tab.id, "uploadTarget", { ref: args.ref, selector: args.selector }, 10000);
  const frames = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    args: [target.selector, files],
    func: attachFiles
  });
  const outcome = frames && frames[0] ? frames[0].result : null;
  if (!outcome || outcome.ok !== true) {
    throw new ToolFailure(
      ERROR.elementMissing,
      (outcome && outcome.message) || "The file input could not take the files",
      "Take a fresh snapshot and target the file input again"
    );
  }
  return { ok: true, count: outcome.count, selector: target.selector, tabId: tab.id };
}

function filenameOf(item) {
  const path = String(item.filename || "");
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || "download";
}

function originOf(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin;
  } catch (error) {
    return null;
  }
}

async function toolDownload(args) {
  const tab = await resolveTab(args);
  if (args.op === "save") {
    if (typeof args.downloadId !== "number") {
      throw new ToolFailure(ERROR.protocolError, "download with op:save needs downloadId", "Call local_browser_download with op:list first");
    }
    const [item] = await chrome.downloads.search({ id: args.downloadId });
    if (!item) throw new ToolFailure(ERROR.elementMissing, "No download with id " + args.downloadId);
    const source = item.finalUrl || item.url;
    const response = await fetch(source);
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || undefined;
    return LB.attachments.savedDownload(item, toBase64(buffer), contentType);
  }
  const items = await chrome.downloads.search({ limit: 100, orderBy: ["-startTime"] });
  const origin = originOf(tab.url);
  const rows = items
    .filter((item) => originOf(item.referrer) === origin || originOf(item.finalUrl || item.url) === origin)
    .map((item) => ({
      id: item.id,
      name: filenameOf(item),
      url: item.finalUrl || item.url,
      mime: item.mime,
      state: item.state,
      bytesReceived: item.bytesReceived,
      totalBytes: item.totalBytes,
      startTime: item.startTime
    }));
  return { downloads: rows, total: rows.length };
}

async function toolClose(args) {
  if (args.closeSession === true) {
    pendingSessionClose = true;
    return { ok: true, closed: "session", sessionId: args.sessionId || null };
  }
  const tab = await resolveTab(args);
  await chrome.tabs.remove(tab.id);
  return { ok: true, closed: "tab", tabId: tab.id };
}

const VIEWER_STATE = {
  connected: "connected",
  unavailable: "viewer_unavailable",
  streaming: "agent_streaming",
  idle: "agent_idle",
  disconnected: "disconnected"
};

let agentBusy = false;

function emitViewerState(state, tabId, message) {
  send(LB.frames.stateEvent(state, tabId, message));
}

function emitAgentState(busy) {
  if (agentBusy === busy) return;
  agentBusy = busy;
  if (!viewer) return;
  emitViewerState(busy ? VIEWER_STATE.streaming : VIEWER_STATE.idle, viewer.tabId);
}

function stopViewer() {
  if (!viewer) return null;
  if (viewer.timer) clearInterval(viewer.timer);
  const tabId = viewer.tabId;
  viewer = null;
  agentBusy = false;
  return tabId;
}

async function bitmapSize(dataUrl) {
  if (typeof createImageBitmap !== "function") return null;
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  if (typeof bitmap.close === "function") bitmap.close();
  return size;
}

function readViewportInPage() {
  return {
    width: window.innerWidth || 0,
    height: window.innerHeight || 0,
    dpr: window.devicePixelRatio || 1
  };
}

function usableViewport(value) {
  if (!value || typeof value !== "object") return null;
  const width = typeof value.width === "number" && value.width > 0 ? Math.round(value.width) : 0;
  const height = typeof value.height === "number" && value.height > 0 ? Math.round(value.height) : 0;
  if (!width || !height) return null;
  const ratio = typeof value.dpr === "number" && Number.isFinite(value.dpr) && value.dpr > 0 ? value.dpr : null;
  return { width, height, dpr: ratio };
}

async function tabViewport(tabId, bitmap) {
  const fromRpc = usableViewport(await rpc(tabId, "viewport", {}, 4000).catch(() => null));
  if (fromRpc && fromRpc.dpr !== null) return { viewport: fromRpc, source: "rpc" };
  const injected = await chrome.scripting
    .executeScript({ target: { tabId }, world: "ISOLATED", func: readViewportInPage })
    .then((frames) => usableViewport(frames && frames[0] ? frames[0].result : null))
    .catch(() => null);
  if (injected) {
    const trusted = bitmap
      ? LB.frames.corroborateViewport(bitmap.width, bitmap.height, injected)
      : injected;
    if (trusted) return { viewport: trusted, source: "injected" };
  }
  return { viewport: fromRpc, source: fromRpc ? "rpc-partial" : "none" };
}

function cssPixels(bitmapSize, ratio, viewport) {
  return LB.frames.cssPixels(bitmapSize.width, bitmapSize.height, ratio, viewport);
}

async function activeTabIdOf(windowId) {
  const [active] = await chrome.tabs.query({ active: true, windowId });
  return active && typeof active.id === "number" ? active.id : null;
}

async function viewerFrame(tab) {
  if (tab.active === true) {
    const capturedTabId = await activeTabIdOf(tab.windowId);
    if (capturedTabId === tab.id) {
      return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
    }
  }
  const target = { tabId: tab.id };
  const alreadyHeld = inputSession !== null && inputSession.tabId === tab.id;
  try {
    if (!alreadyHeld) await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    return null;
  }
  try {
    const shot = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", { format: "jpeg", quality: 70 });
    return "data:image/jpeg;base64," + shot.data;
  } catch (error) {
    return null;
  } finally {
    if (!alreadyHeld) await chrome.debugger.detach(target).catch(() => {});
    else touchInputSession();
  }
}

async function captureFrame() {
  if (!viewer) return;
  const current = viewer;
  try {
    const tab = await chrome.tabs.get(current.tabId).catch(() => null);
    if (!tab) {
      stopViewer();
      emitViewerState(VIEWER_STATE.disconnected, current.tabId, "The watched tab closed");
      return;
    }
    const dataUrl = await viewerFrame(tab);
    if (viewer !== current) return;
    const bitmap = await bitmapSize(dataUrl);
    if (!bitmap) {
      emitViewerState(VIEWER_STATE.unavailable, current.tabId, "The browser returned a frame without a readable size");
      return;
    }
    const probe = await tabViewport(current.tabId, bitmap);
    if (viewer !== current) return;
    const viewport = probe.viewport;
    if (!viewport || viewport.dpr === null) {
      emitViewerState(
        VIEWER_STATE.unavailable,
        current.tabId,
        "The page would not report its viewport, so this frame cannot be labelled in CSS pixels",
      );
      return;
    }
    const size = cssPixels(bitmap, viewport.dpr, viewport);
    if (!LB.frames.canSendFrame(dataUrl, size.width, size.height)) {
      emitViewerState(VIEWER_STATE.unavailable, current.tabId, "The browser returned a frame without a usable size");
      return;
    }
    send(LB.frames.frameEvent(dataUrl, size.width, size.height, current.tabId));
  } catch (error) {
    if (viewer !== current) return;
    const stillOpen = await chrome.tabs.get(current.tabId).catch(() => null);
    if (!stillOpen) {
      stopViewer();
      emitViewerState(VIEWER_STATE.disconnected, current.tabId, "The watched tab closed");
      return;
    }
    emitViewerState(VIEWER_STATE.unavailable, current.tabId, "The browser could not capture this tab");
  }
}

async function toolViewer(args) {
  const op = args.op;
  if (op === "stop") {
    const tabId = stopViewer();
    if (typeof tabId === "number") emitViewerState(VIEWER_STATE.disconnected, tabId);
    return { stopped: typeof tabId === "number", active: false, tabId: tabId };
  }
  if (op !== "start") throw new ToolFailure(ERROR.protocolError, "viewer op must be start or stop");
  stopViewer();
  const tab = await resolveTab(args);
  const intervalMs = clampInt(args.intervalMs, DEFAULTS.viewerIntervalMs, 250, 10000);
  viewer = { tabId: tab.id, windowId: tab.windowId, intervalMs, timer: null };
  emitViewerState(VIEWER_STATE.connected, tab.id);
  viewer.timer = setInterval(() => {
    void captureFrame();
  }, intervalMs);
  void captureFrame();
  return { started: true, active: true, tabId: tab.id, intervalMs };
}

const KEY_EVENTS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
  " ": { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " }
};

const MODIFIER_BITS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const MOUSE_BUTTON_BITS = { left: 1, middle: 4, right: 2 };

function modifierMask(args) {
  let mask = 0;
  if (args.alt === true) mask |= MODIFIER_BITS.alt;
  if (args.ctrl === true) mask |= MODIFIER_BITS.ctrl;
  if (args.meta === true) mask |= MODIFIER_BITS.meta;
  if (args.shift === true) mask |= MODIFIER_BITS.shift;
  return mask;
}

function keyCodeOf(key) {
  const spec = KEY_EVENTS[key];
  if (spec) return spec.windowsVirtualKeyCode;
  if (typeof key === "string" && key.length === 1) {
    const upper = key.toUpperCase();
    return upper.charCodeAt(0);
  }
  return 0;
}

async function ensureDebugger(tabId) {
  if (inputSession && inputSession.tabId === tabId && inputSession.attached === true) {
    touchInputSession();
    return;
  }
  if (inputSession) await detachInputSession();
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    throw new ToolFailure(
      ERROR.unsupported,
      "The browser refused trusted input for this tab",
      "Another debugger may hold the tab; this call fell back to synthetic events"
    );
  }
  inputSession = { tabId, attached: true, timer: null };
  touchInputSession();
}

function touchInputSession() {
  if (!inputSession) return;
  if (inputSession.timer) clearTimeout(inputSession.timer);
  inputSession.timer = setTimeout(() => {
    void detachInputSession();
  }, INPUT_IDLE_DETACH_MS);
}

async function detachInputSession() {
  if (!inputSession) return;
  if (inputSession.timer) clearTimeout(inputSession.timer);
  const tabId = inputSession.tabId;
  inputSession = null;
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

async function dispatchMouse(tabId, args) {
  const target = { tabId };
  const x = args.x;
  const y = args.y;
  const button = args.button || "left";
  const clickCount = clampInt(args.clickCount, 1, 1, 3);
  const held = MOUSE_BUTTON_BITS[button] || 1;

  if (args.action === "move") {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0
    });
    return;
  }
  if (args.action === "down") {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      clickCount,
      buttons: held
    });
    return;
  }
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button,
    clickCount,
    buttons: 0
  });
}

async function dispatchWheel(tabId, args) {
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: args.x,
    y: args.y,
    deltaX: args.deltaX,
    deltaY: args.deltaY,
    button: "none",
    buttons: 0
  });
}

async function dispatchKey(tabId, args) {
  const target = { tabId };
  const key = String(args.key || "");
  const spec = KEY_EVENTS[key] || {};
  const code = args.code || spec.code || (key.length === 1 ? "Key" + key.toUpperCase() : key);
  const virtualKey = spec.windowsVirtualKeyCode !== undefined ? spec.windowsVirtualKeyCode : keyCodeOf(key);
  const modifiers = modifierMask(args);
  const base = {
    key: spec.key !== undefined ? spec.key : key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    modifiers
  };

  if (args.action === "up") {
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, base));
    return;
  }

  await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", Object.assign({ type: "rawKeyDown" }, base));
  if (args.ctrl === true || args.meta === true) return;
  const fallback = spec.text !== undefined ? spec.text : key.length === 1 ? (args.shift === true ? key.toUpperCase() : key) : "";
  const text = typeof args.text === "string" ? args.text : fallback;
  if (text.length) {
    await chrome.debugger.sendCommand(
      target,
      "Input.dispatchKeyEvent",
      Object.assign({ type: "char", text, unmodifiedText: text }, base)
    );
  }
}

async function pressTrustedKey(tabId, key) {
  await dispatchKey(tabId, { kind: "key", action: "down", key });
  await dispatchKey(tabId, { kind: "key", action: "up", key });
}

function assertInputShape(args) {
  if (args.kind === "mouse") {
    if (args.action !== "move" && args.action !== "down" && args.action !== "up") {
      throw new ToolFailure(ERROR.protocolError, "mouse action must be move, down or up", "Send a viewer input frame from the UI");
    }
    if (!Number.isInteger(args.x) || !Number.isInteger(args.y)) {
      throw new ToolFailure(ERROR.protocolError, "mouse needs integer x and y");
    }
    return;
  }
  if (args.kind === "wheel") {
    if (!Number.isInteger(args.x) || !Number.isInteger(args.y)) {
      throw new ToolFailure(ERROR.protocolError, "wheel needs integer x and y");
    }
    if (typeof args.deltaX !== "number" || typeof args.deltaY !== "number") {
      throw new ToolFailure(ERROR.protocolError, "wheel needs numeric deltaX and deltaY");
    }
    return;
  }
  if (args.kind === "key") {
    if (args.action !== "down" && args.action !== "up") {
      throw new ToolFailure(ERROR.protocolError, "key action must be down or up", "Send a viewer input frame from the UI");
    }
    if (typeof args.key !== "string" || !args.key.length) {
      throw new ToolFailure(ERROR.protocolError, "key needs a key name");
    }
    return;
  }
  throw new ToolFailure(ERROR.protocolError, "input kind must be mouse, wheel or key");
}

async function toolInput(args) {
  const tab = await resolveTab(args);
  assertInputShape(args);
  const payload = Object.assign({}, args, { tabId: undefined });
  delete payload.tabId;
  delete payload.sessionId;
  try {
    await ensureDebugger(tab.id);
    if (args.kind === "mouse") await dispatchMouse(tab.id, args);
    else if (args.kind === "wheel") await dispatchWheel(tab.id, args);
    else await dispatchKey(tab.id, args);
    touchInputSession();
    return { ok: true, mode: "trusted", kind: args.kind, action: args.action || null, tabId: tab.id };
  } catch (error) {
    const fallback = await rpc(tab.id, "inputFallback", payload, 10000).catch(() => null);
    if (!fallback) {
      if (error instanceof ToolFailure) throw error;
      throw new ToolFailure(ERROR.unsupported, "Trusted input failed and the page could not take synthetic events");
    }
    return {
      ok: fallback.ok !== false,
      mode: "synthetic",
      kind: args.kind,
      action: args.action || null,
      note: "Trusted input is unavailable for this tab, so the events were synthesized in the page",
      tabId: tab.id
    };
  }
}

const TOOL_HANDLERS = {
  local_browser_sessions: toolSessions,
  local_browser_open: toolOpen,
  local_browser_navigate: toolNavigate,
  local_browser_snapshot: toolSnapshot,
  local_browser_act: toolAct,
  local_browser_read: toolRead,
  local_browser_screenshot: toolScreenshot,
  local_browser_wait: toolWait,
  local_browser_evaluate: toolEvaluate,
  local_browser_storage: toolStorage,
  local_browser_network: toolNetwork,
  local_browser_upload: toolUpload,
  local_browser_download: toolDownload,
  local_browser_close: toolClose,
  local_browser_viewer: toolViewer,
  local_browser_input: toolInput
};

function scheduleTabsEvent() {
  if (tabsTimer !== null) return;
  tabsTimer = setTimeout(async () => {
    tabsTimer = null;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const tabs = await listTabs();
    const serialized = JSON.stringify(tabs);
    if (serialized === lastTabsJson) return;
    lastTabsJson = serialized;
    send(LB.frames.tabsEvent(tabs));
  }, 300);
}

async function parsePairingInput(input) {
  const raw = String((input && input.input) || "").trim();
  const parsed = LB.pairing.parsePairingInput(raw);
  if (parsed.reason) {
    throw new ToolFailure(
      ERROR.protocolError,
      parsed.reason,
      "Paperclip shows a pairing link with the code in it on the Local Browser page"
    );
  }
  const stored = (await readPairing()) || {};
  const origin = parsed.origin || stored.origin || "";
  if (!origin) {
    throw new ToolFailure(
      ERROR.protocolError,
      "Paste the pairing link from Paperclip, or open the pairing page in a tab first",
      "The link carries the server address and the code together"
    );
  }
  const code = String(parsed.code || "").toUpperCase();
  if (!code) {
    throw new ToolFailure(ERROR.protocolError, "Add the pairing code", "The pairing link already carries it");
  }
  return { origin, code, label: String((input && input.label) || "").trim() || defaultLabel() };
}

async function detectPairingTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.id !== "number" || !/^https?:/i.test(String(tab.url || ""))) return { pairing: null };
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const element = document.querySelector("[data-paperclip-local-browser-pairing]");
        if (!element) return null;
        return {
          origin: element.getAttribute("data-origin") || "",
          code: element.getAttribute("data-code") || ""
        };
      }
    });
  } catch (error) {
    return { pairing: null };
  }
  const found = results && results[0] && results[0].result;
  if (!found || !found.code) return { pairing: null };
  const origin = LB.pairing.normalizeOrigin(found.origin || tab.url);
  if (!origin) return { pairing: null };
  return { pairing: { origin, code: String(found.code).trim() } };
}

async function pair(input) {
  const parsed = await parsePairingInput(input);
  const entry = {
    origin: parsed.origin,
    code: parsed.code,
    label: parsed.label,
    sessionToken: null,
    sessionId: null,
    tier: null,
    allowedOrigins: [],
    pairedAt: new Date().toISOString()
  };
  await writePairing(entry);
  closeSocket();
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reopenSession();
  socketState = "idle";
  backoffMs = 1000;
  await connect();
  return await status();
}

async function siteAccessState() {
  try {
    const all = await chrome.permissions.contains({ origins: ["<all_urls>"] });
    return all ? "all" : "limited";
  } catch (error) {
    return "unknown";
  }
}

async function status() {
  const stored = (await readPairing()) || {};
  const result = {
    paired: Boolean(stored.sessionToken || stored.code),
    connected: socketState === "open",
    socketState,
    origin: stored.origin || null,
    label: stored.label || "",
    tier: stored.tier || null,
    allowedOrigins: Array.isArray(stored.allowedOrigins) ? stored.allowedOrigins : [],
    sessionId: stored.sessionId || null,
    clientVersion: CLIENT_VERSION,
    tabCount: (await listTabs()).length,
    siteAccess: await siteAccessState()
  };
  const reason = retiredReason || retiredReasonOf(stored);
  if (reason) result.retiredReason = reason;
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "lb:frame-ready") {
    const tabId = sender && sender.tab ? sender.tab.id : undefined;
    sendResponse({ tabId, frameId: sender ? sender.frameId : undefined });
    return false;
  }

  if (message.type === "lb:status") {
    status().then(sendResponse, (error) => sendResponse({ error: String((error && error.message) || error) }));
    return true;
  }

  if (message.type === "lb:detect") {
    detectPairingTab().then(sendResponse, (error) => sendResponse({ error: String((error && error.message) || error) }));
    return true;
  }

  if (message.type === "lb:pair") {
    pair(message.payload || {}).then(sendResponse, (error) => sendResponse({ error: toToolError(error) }));
    return true;
  }

  if (message.type === "lb:disconnect") {
    disconnect({ clear: true }).then(
      () => status().then(sendResponse),
      (error) => sendResponse({ error: String((error && error.message) || error) })
    );
    return true;
  }

  if (message.type === "lb:reconnect") {
    closeSocket();
    reopenSession();
    socketState = "idle";
    backoffMs = 1000;
    connect().then(
      () => status().then(sendResponse),
      (error) => sendResponse({ error: String((error && error.message) || error) })
    );
    return true;
  }

  return false;
});

function ensureAlarm() {
  const created = chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  if (created && typeof created.catch === "function") {
    created.catch(() => {
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
    });
  }
}

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  reopenSession();
  void connect();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  reopenSession();
  void connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  if (sessionClosed) return;
  void connect();
});

chrome.tabs.onCreated.addListener(() => scheduleTabsEvent());
chrome.tabs.onRemoved.addListener((closedTabId) => {
  networkBuffers.delete(closedTabId);
  agentTabs.delete(closedTabId);
  if (viewer && viewer.tabId === closedTabId) {
    stopViewer();
    emitViewerState(VIEWER_STATE.disconnected, closedTabId, "The watched tab closed");
  }
  scheduleTabsEvent();
});
chrome.tabs.onActivated.addListener(() => scheduleTabsEvent());
chrome.tabs.onMoved.addListener(() => scheduleTabsEvent());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete" || changeInfo.title) scheduleTabsEvent();
});

chrome.windows.onRemoved.addListener(() => scheduleTabsEvent());

chrome.debugger.onDetach.addListener((source) => {
  if (inputSession && source && source.tabId === inputSession.tabId) {
    if (inputSession.timer) clearTimeout(inputSession.timer);
    inputSession = null;
  }
});

ensureAlarm();
void connect();
