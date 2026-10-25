(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var ToolFailure = core.ToolFailure;
  var PROTOCOL = LB.protocol;
  var STORE_KEY = "lb.pairing";
  var HEARTBEAT_MS = 20000;
  var CLOSE_POLICY_VIOLATION = 1008;
  var CAPABILITIES = [
    "cookies.v2",
    "permissions.v1",
    "context.v1",
    "network.headers",
    "tabs.container",
    "document.state",
    "api.v1",
    "act.force",
    "budget.v1",
    "act.input"
  ];

  var socket = null;
  var socketState = "idle";
  var socketGeneration = 0;
  var sessionClosed = false;
  var pendingSessionClose = false;
  var retiredReason = "";
  var lastError = "";
  var backoffMs = 1000;
  var reconnectTimer = null;
  var heartbeatTimer = null;
  var intentionalClose = false;
  var lastTabsJson = "";
  var tabsTimer = null;
  var broadcastTimer = null;

  function clientVersion() {
    return chrome.runtime.getManifest().version;
  }

  async function readPairing() {
    var stored = await chrome.storage.local.get(STORE_KEY);
    return stored[STORE_KEY] || null;
  }

  async function writePairing(value) {
    await chrome.storage.local.set({ [STORE_KEY]: value });
  }

  async function clearPairing() {
    await chrome.storage.local.remove(STORE_KEY);
  }

  function retiredReasonOf(stored) {
    if (!stored || stored.sessionToken || stored.code) return "";
    return typeof stored.retiredAt === "string" && stored.retiredAt ? String(stored.retiredReason || "") : "";
  }

  function isOpen() {
    return Boolean(socket && socket.readyState === WebSocket.OPEN);
  }

  function send(frame) {
    if (!isOpen()) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      return false;
    }
  }

  function buildSocketUrl(entry) {
    var base = entry.origin.replace(/^http/, "ws").replace(/\/+$/, "");
    var query = entry.sessionToken ? "session=" + encodeURIComponent(entry.sessionToken) : "code=" + encodeURIComponent(entry.code || "");
    return base + PROTOCOL.BRIDGE_PATH + "?" + query;
  }

  function clearReconnect() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null) return;
    var delay = backoffMs + Math.floor(Math.random() * 250);
    backoffMs = Math.min(backoffMs * 2, 30000);
    reconnectTimer = setTimeout(function () {
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
    heartbeatTimer = setInterval(function () {
      send({ type: "ping", at: new Date().toISOString() });
    }, HEARTBEAT_MS);
  }

  async function retirePairing(reason) {
    sessionClosed = true;
    clearReconnect();
    LB.bg.viewer.stop();
    await LB.bg.input.detach();
    var stored = (await readPairing()) || {};
    retiredReason = String(reason || "").slice(0, 200);
    await writePairing({
      origin: stored.origin || null,
      label: stored.label || core.defaultLabel(),
      sessionToken: null,
      sessionId: null,
      code: null,
      tier: null,
      allowedOrigins: [],
      pairedAt: stored.pairedAt || null,
      retiredAt: new Date().toISOString(),
      retiredReason: retiredReason
    });
    scheduleBroadcast();
  }

  async function connect() {
    if (socketState !== "idle" || sessionClosed) return;
    var stored = await readPairing();
    if (!stored || (!stored.sessionToken && !stored.code)) return;
    if (sessionClosed || socketState !== "idle") return;
    var generation = socketGeneration;
    socketState = "connecting";
    intentionalClose = false;
    scheduleBroadcast();
    var next;
    try {
      next = new WebSocket(buildSocketUrl(stored));
    } catch (error) {
      if (generation === socketGeneration) {
        socketState = "idle";
        lastError = "Paperclip at " + stored.origin + " could not be reached";
        scheduleReconnect();
        scheduleBroadcast();
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

    next.addEventListener("open", function () {
      if (socket !== next) return;
      socketState = "open";
      backoffMs = 1000;
      lastError = "";
      startHeartbeat();
      void sendHello();
      scheduleBroadcast();
    });

    next.addEventListener("message", function (event) {
      if (socket !== next) return;
      void onFrame(event.data);
    });

    next.addEventListener("close", function (event) {
      if (socket !== next) return;
      socket = null;
      socketState = "idle";
      stopHeartbeat();
      LB.bg.viewer.stop();
      var code = event && typeof event.code === "number" ? event.code : 1006;
      if (code === CLOSE_POLICY_VIOLATION) {
        void retirePairing(event && typeof event.reason === "string" ? event.reason : "");
        return;
      }
      if (!intentionalClose && !sessionClosed) {
        lastError = event && event.reason ? String(event.reason).slice(0, 200) : "";
        scheduleReconnect();
      }
      scheduleBroadcast();
    });

    next.addEventListener("error", function () {
      if (socket !== next) return;
      try {
        next.close();
      } catch (error) {}
    });
  }

  function closeSocket() {
    stopHeartbeat();
    socketGeneration += 1;
    var current = socket;
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
    var settings = options || {};
    sessionClosed = true;
    clearReconnect();
    LB.bg.viewer.stop();
    await LB.bg.input.detach();
    closeSocket();
    if (settings.clear !== false) await clearPairing();
    backoffMs = 1000;
    scheduleBroadcast();
  }

  function reopenSession() {
    sessionClosed = false;
    retiredReason = "";
  }

  async function restart() {
    closeSocket();
    clearReconnect();
    reopenSession();
    socketState = "idle";
    backoffMs = 1000;
    await connect();
  }

  async function sendHello() {
    var stored = (await readPairing()) || {};
    var frame = {
      type: "hello",
      protocol: PROTOCOL.PROTOCOL_VERSION,
      client: PROTOCOL.CLIENT,
      clientVersion: clientVersion(),
      capabilities: CAPABILITIES.slice(),
      label: stored.label || core.defaultLabel(),
      profileName: null,
      tabs: await LB.bg.tabs.listTabs()
    };
    try {
      frame.access = await LB.access.snapshot();
    } catch (error) {}
    try {
      frame.guards = await LB.guards.get();
    } catch (error) {}
    send(frame);
  }

  async function applyHelloAck(frame) {
    var stored = (await readPairing()) || {};
    await writePairing({
      origin: stored.origin,
      label: stored.label || core.defaultLabel(),
      sessionId: frame.sessionId,
      sessionToken: frame.sessionToken,
      tier: frame.tier,
      allowedOrigins: Array.isArray(frame.allowedOrigins) ? frame.allowedOrigins : [],
      pairedAt: stored.pairedAt || new Date().toISOString()
    });
    retiredReason = "";
    backoffMs = 1000;
    scheduleBroadcast();
  }

  async function onFrame(raw) {
    if (typeof raw !== "string") return;
    var frame;
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
    if (frame.type === "ping") send({ type: "pong", at: typeof frame.at === "string" ? frame.at : new Date().toISOString() });
  }

  function callContext(tool, args, budgetMs) {
    var fromServer = LB.budget.serverBudget(budgetMs) !== null;
    var budget = LB.budget.callBudget(tool, args, budgetMs);
    return {
      budget: budget,
      fromServer: fromServer,
      inner: function (requested, fallback, legacyMax) {
        return LB.budget.innerTimeout(requested, fallback, fromServer ? budget : undefined, legacyMax);
      },
      pageTimeout: function (legacyMs) {
        return fromServer ? Math.max(100, budget - LB.budget.INNER_SLACK_MS) : legacyMs;
      }
    };
  }

  async function runTool(entry, tool, args, call) {
    await LB.bg.tools.ensureAccess(tool, args);
    return await entry.run(args, call);
  }

  async function handleCall(frame) {
    var tool = String(frame.tool || "");
    var id = String(frame.id || "");
    var entry = LB.bg.tools.handler(tool);
    if (!entry) {
      send({
        type: "result",
        id: id,
        ok: false,
        error: core.toolError(ERROR.unsupported, "Unknown tool " + tool, "Update the extension to the version the server expects")
      });
      return;
    }
    var args = frame.args && typeof frame.args === "object" ? frame.args : {};
    var call = callContext(tool, args, frame.budgetMs);
    if (!entry.quiet) LB.bg.viewer.emitAgentState(true);
    try {
      var result = await core.withTimeout(runTool(entry, tool, args, call), call.budget);
      send({ type: "result", id: id, ok: true, result: result === undefined ? null : result });
    } catch (error) {
      send({ type: "result", id: id, ok: false, error: core.toToolError(error) });
    } finally {
      if (!entry.quiet) LB.bg.viewer.emitAgentState(false);
    }
    if (pendingSessionClose) {
      pendingSessionClose = false;
      await disconnect({ clear: true });
    }
  }

  function closeAfterCall() {
    pendingSessionClose = true;
  }

  function scheduleTabsEvent() {
    if (tabsTimer !== null) return;
    tabsTimer = setTimeout(async function () {
      tabsTimer = null;
      if (!isOpen()) return;
      var tabs = await LB.bg.tabs.listTabs();
      var serialized = JSON.stringify(tabs);
      if (serialized === lastTabsJson) return;
      lastTabsJson = serialized;
      send(LB.frames.tabsEvent(tabs));
    }, 300);
  }

  function sendAccess(snapshot) {
    if (snapshot) send({ type: "event", event: "access", data: snapshot });
  }

  function sendGuards(guards) {
    if (guards) send({ type: "event", event: "guards", data: guards });
  }

  function connectionState(stored) {
    if (retiredReason || retiredReasonOf(stored)) return "retired";
    if (!stored || (!stored.sessionToken && !stored.code)) return "unpaired";
    if (socketState === "open") return "connected";
    if (socketState === "connecting") return "connecting";
    return "disconnected";
  }

  function trustedInput() {
    return { mode: "cdp", hint: "Chromium drives trusted clicks and keys through its debugger; no setup is needed." };
  }

  async function status() {
    var stored = (await readPairing()) || {};
    var state = connectionState(stored);
    var result = {
      client: PROTOCOL.CLIENT,
      version: clientVersion(),
      state: state,
      label: stored.label || "",
      origin: stored.origin || null,
      sessionId: stored.sessionId || null,
      tier: stored.tier || null,
      allowedOrigins: Array.isArray(stored.allowedOrigins) ? stored.allowedOrigins : [],
      tabs: (await LB.bg.tabs.listTabs()).length,
      access: await LB.access.snapshot(),
      guards: await LB.guards.get(),
      trustedInput: trustedInput()
    };
    var reason = retiredReason || retiredReasonOf(stored);
    if (state === "retired") result.retiredReason = reason;
    if (lastError) result.lastError = lastError;
    return result;
  }

  function paintConnectionBadge() {
    var action = LB.ext.action();
    if (!action || typeof action.setBadgeText !== "function") return;
    readPairing().then(function (stored) {
      var state = connectionState(stored || {});
      var text = state === "retired" ? "!" : state === "disconnected" ? "\u2026" : "";
      var color = state === "retired" ? "#b91c1c" : "#6b7280";
      Promise.resolve(action.setBadgeText({ text: text })).catch(function () {});
      if (text) Promise.resolve(action.setBadgeBackgroundColor({ color: color })).catch(function () {});
    }, function () {});
  }

  function scheduleBroadcast() {
    if (broadcastTimer !== null) return;
    broadcastTimer = setTimeout(function () {
      broadcastTimer = null;
      void broadcast();
    }, 50);
  }

  async function broadcast() {
    LB.access.refreshBadge();
    try {
      var current = await status();
      await Promise.resolve(chrome.runtime.sendMessage({ channel: "lb-status", status: current })).catch(function () {});
    } catch (error) {}
  }

  async function parsePairingInput(input) {
    var parsed = LB.pairing.parsePairingInput(String(input || "").trim());
    if (parsed.reason) {
      throw new ToolFailure(ERROR.protocolError, parsed.reason, "Paperclip shows a pairing link with the code in it on the Local Browser page");
    }
    var stored = (await readPairing()) || {};
    var origin = parsed.origin || stored.origin || "";
    if (!origin) {
      throw new ToolFailure(
        ERROR.protocolError,
        "Paste the pairing link from Paperclip, or open the pairing page in a tab first",
        "The link carries the server address and the code together"
      );
    }
    var code = String(parsed.code || "").toUpperCase();
    if (!code) throw new ToolFailure(ERROR.protocolError, "Add the pairing code", "The pairing link already carries it");
    return { origin: origin, code: code, label: stored.label || core.defaultLabel() };
  }

  async function pair(input) {
    var parsed = await parsePairingInput(input);
    await writePairing({
      origin: parsed.origin,
      code: parsed.code,
      label: parsed.label,
      sessionToken: null,
      sessionId: null,
      tier: null,
      allowedOrigins: [],
      pairedAt: new Date().toISOString()
    });
    lastError = "";
    await restart();
  }

  async function detectPairingTab() {
    var tab = await LB.bg.tabs.focusedTab();
    if (!tab || typeof tab.id !== "number" || !/^https?:/i.test(String(tab.url || ""))) return null;
    var results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function () {
          var element = document.querySelector("[data-paperclip-local-browser-pairing]");
          if (!element) return null;
          return { origin: element.getAttribute("data-origin") || "", code: element.getAttribute("data-code") || "" };
        }
      });
    } catch (error) {
      return null;
    }
    var found = results && results[0] && results[0].result;
    if (!found || !found.code) return null;
    var origin = LB.pairing.normalizeOrigin(found.origin || tab.url);
    if (!origin) return null;
    return { input: origin + "/?code=" + encodeURIComponent(String(found.code).trim()) };
  }

  function sentence(error) {
    var message = error && typeof error === "object" && error.message ? String(error.message) : String(error || "Something went wrong");
    return message.slice(0, 300);
  }

  async function control(message) {
    var op = message.op;
    if (op === "status") return { ok: true, status: await status() };
    if (op === "pair") {
      await pair(message.input);
      return { ok: true, status: await status() };
    }
    if (op === "detect") return { ok: true, status: await status(), detected: await detectPairingTab() };
    if (op === "reconnect") {
      var stored = (await readPairing()) || {};
      if (connectionState(stored) === "retired") {
        return { ok: false, error: "Paperclip ended this pairing. Paste a new pairing link to connect again.", status: await status() };
      }
      if (!stored.sessionToken && !stored.code) return { ok: false, error: "This browser is not paired yet.", status: await status() };
      await restart();
      return { ok: true, status: await status() };
    }
    if (op === "disconnect") {
      await disconnect({ clear: true });
      return { ok: true, status: await status() };
    }
    if (op === "guards.set") {
      await LB.guards.set(message.patch && typeof message.patch === "object" ? message.patch : {});
      return { ok: true, status: await status() };
    }
    if (op === "pending.clear") {
      await LB.access.clearPending(Array.isArray(message.permissions) ? message.permissions : undefined);
      return { ok: true, status: await status() };
    }
    return { ok: false, error: "Unknown control operation " + String(op) };
  }

  function onMessage(message, sender, sendResponse) {
    if (!message || typeof message !== "object") return false;
    if (message.type === "lb:frame-ready") {
      sendResponse({ tabId: sender && sender.tab ? sender.tab.id : undefined, frameId: sender ? sender.frameId : undefined });
      return false;
    }
    if (message.channel !== "lb-control") return false;
    control(message).then(sendResponse, function (error) {
      status().then(
        function (current) {
          sendResponse({ ok: false, error: sentence(error), status: current });
        },
        function () {
          sendResponse({ ok: false, error: sentence(error) });
        }
      );
    });
    return true;
  }

  function isClosed() {
    return sessionClosed;
  }

  LB.bg = LB.bg || {};
  LB.bg.bridge = {
    CAPABILITIES: CAPABILITIES,
    STORE_KEY: STORE_KEY,
    clientVersion: clientVersion,
    readPairing: readPairing,
    send: send,
    connect: connect,
    disconnect: disconnect,
    reopenSession: reopenSession,
    isClosed: isClosed,
    handleCall: handleCall,
    closeAfterCall: closeAfterCall,
    scheduleTabsEvent: scheduleTabsEvent,
    sendAccess: sendAccess,
    sendGuards: sendGuards,
    status: status,
    control: control,
    onMessage: onMessage,
    paintConnectionBadge: paintConnectionBadge,
    scheduleBroadcast: scheduleBroadcast
  };
})(globalThis);
