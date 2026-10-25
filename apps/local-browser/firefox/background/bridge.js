(function (root) {
  "use strict";

  var LB = root.LB;
  var protocol = LB.protocol;
  var backoff = LB.backoff;
  var D = protocol.DEFAULTS;
  var C = protocol.ERROR_CODES;

  var STATUS = {
    UNPAIRED: "unpaired",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    DISCONNECTED: "disconnected",
    RETIRED: "retired"
  };

  var POLICY_VIOLATION = 1008;
  var PAIRING_CODE_ATTEMPTS = 3;

  var pairing = null;
  var socket = null;
  var stopped = true;
  var attempt = 0;
  var codeAttempts = 0;
  var pendingCode = null;
  var reconnectTimer = null;
  var heartbeatTimer = null;
  var broadcastTimer = null;
  var lastPongAt = 0;
  var viewerFailures = 0;
  var viewer = { timer: null, tabId: null, intervalMs: 0, busy: false };
  var tabsTimer = null;
  var lastTabsJson = "";
  var trustedInput = { mode: "synthetic" };

  var state = {
    status: STATUS.UNPAIRED,
    origin: null,
    label: null,
    tier: null,
    sessionId: null,
    allowedOrigins: [],
    profileName: null,
    connectedAt: null,
    lastError: null,
    retiredReason: null,
    clientVersion: "0.0.0"
  };

  try {
    state.clientVersion = browser.runtime.getManifest().version;
  } catch (error) {
    state.clientVersion = "0.0.0";
  }

  function scheduleTabsEvent() {
    if (tabsTimer !== null || !isConnected()) return;
    tabsTimer = setTimeout(async function () {
      tabsTimer = null;
      if (!isConnected()) return;
      var tabs = [];
      try {
        tabs = await LB.tabs.listTabs();
      } catch (error) {
        return;
      }
      var serialized = JSON.stringify(tabs);
      if (serialized === lastTabsJson) return;
      lastTabsJson = serialized;
      send({ type: "event", event: "tabs", data: { tabs: tabs } });
    }, 300);
  }

  function installTabWatchers() {
    browser.tabs.onCreated.addListener(function () {
      scheduleTabsEvent();
    });
    browser.tabs.onRemoved.addListener(function (tabId) {
      LB.network.release(tabId);
      if (viewer.tabId === tabId) stopViewer("The watched tab closed");
      scheduleTabsEvent();
    });
    browser.tabs.onUpdated.addListener(function (tabId, info) {
      if (!info || info.status === "complete" || typeof info.title === "string" || typeof info.url === "string") scheduleTabsEvent();
    });
    browser.tabs.onActivated.addListener(function () {
      scheduleTabsEvent();
    });
    LB.tabs.installContainerWatchers(function () {
      lastTabsJson = "";
      scheduleTabsEvent();
    });
  }

  function installAccessWatchers() {
    LB.access.onChange(function (snapshot) {
      send({ type: "event", event: "access", data: snapshot });
      broadcast();
    });
    LB.guards.onChange(function (guards) {
      LB.network.resize(guards.networkBufferSize);
      send({ type: "event", event: "guards", data: guards });
      broadcast();
    });
  }

  function setState(patch) {
    var keys = Object.keys(patch || {});
    for (var i = 0; i < keys.length; i += 1) state[keys[i]] = patch[keys[i]];
    broadcast();
  }

  function snapshotState() {
    return {
      status: state.status,
      origin: state.origin,
      label: state.label,
      tier: state.tier,
      sessionId: state.sessionId,
      allowedOrigins: state.allowedOrigins,
      clientVersion: state.clientVersion,
      profileName: state.profileName,
      connectedAt: state.connectedAt,
      lastError: state.lastError,
      retiredReason: state.retiredReason,
      attempt: attempt,
      viewerTabId: viewer.tabId,
      viewerActive: viewer.timer !== null
    };
  }

  async function status() {
    var tabs = [];
    try {
      tabs = await LB.tabs.listTabs();
    } catch (error) {
      tabs = [];
    }
    var access = null;
    try {
      access = await LB.access.snapshot();
    } catch (error) {
      access = { siteAccess: "unknown", granted: [], missing: [], pending: [] };
    }
    var guards = LB.guards.current();
    try {
      guards = await LB.guards.get();
    } catch (error) {
      void error;
    }
    var out = {
      client: protocol.CLIENT,
      version: state.clientVersion,
      state: state.status,
      label: state.label,
      origin: state.origin,
      sessionId: state.sessionId,
      tier: state.tier,
      allowedOrigins: state.allowedOrigins,
      tabs: tabs,
      access: access,
      guards: guards,
      trustedInput: trustedInput
    };
    if (state.retiredReason) out.retiredReason = state.retiredReason;
    if (state.lastError) out.lastError = state.lastError;
    return out;
  }

  async function refreshTrustedInput() {
    try {
      trustedInput = await LB.bidi.trustedInput();
    } catch (error) {
      trustedInput = { mode: "synthetic" };
    }
    return trustedInput;
  }

  function broadcast() {
    try {
      Promise.resolve(LB.access.refreshBadge()).catch(function () {});
    } catch (error) {
      void error;
    }
    if (broadcastTimer !== null) return;
    broadcastTimer = setTimeout(function () {
      broadcastTimer = null;
      void status().then(function (current) {
        try {
          var sending = browser.runtime.sendMessage({ channel: "lb-status", status: current });
          if (sending && typeof sending.catch === "function") sending.catch(function () {});
        } catch (error) {
          void error;
        }
      });
    }, 50);
  }

  async function readPairing() {
    try {
      var stored = await browser.storage.local.get(protocol.STORAGE_PAIRING);
      var value = stored[protocol.STORAGE_PAIRING];
      if (!value || typeof value !== "object") return null;
      if (typeof value.origin !== "string" || !protocol.originOf(value.origin)) return null;
      return {
        origin: value.origin,
        label: typeof value.label === "string" && value.label ? value.label : protocol.DEFAULT_LABEL,
        sessionToken: typeof value.sessionToken === "string" ? value.sessionToken : null,
        sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
        tier: typeof value.tier === "string" ? value.tier : null,
        retiredAt: typeof value.retiredAt === "string" ? value.retiredAt : null,
        retiredReason: typeof value.retiredReason === "string" ? value.retiredReason : null
      };
    } catch (error) {
      return null;
    }
  }

  async function writePairing(value) {
    if (!value) {
      await browser.storage.local.remove(protocol.STORAGE_PAIRING);
      return;
    }
    await browser.storage.local.set({ [protocol.STORAGE_PAIRING]: value });
  }

  function isConnected() {
    return Boolean(socket) && socket.readyState === WebSocket.OPEN;
  }

  function send(frame) {
    if (!isConnected()) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      return false;
    }
  }

  function closeSocket() {
    var current = socket;
    socket = null;
    if (!current) return;
    try {
      current.close();
    } catch (error) {
      void error;
    }
  }

  function clearReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    lastPongAt = Date.now();
    heartbeatTimer = setInterval(function () {
      if (!isConnected()) return;
      if (Date.now() - lastPongAt > D.heartbeatTimeoutMs) {
        closeSocket();
        scheduleReconnect();
        return;
      }
      send({ type: "ping", at: new Date().toISOString() });
    }, D.heartbeatMs);
  }

  function isKnownCode(code) {
    return Object.keys(C).some(function (key) {
      return C[key] === code;
    });
  }

  function normalizeError(failure) {
    if (failure && typeof failure.code === "string" && typeof failure.message === "string" && isKnownCode(failure.code)) {
      var payload = { code: failure.code, message: failure.message };
      if (typeof failure.hint === "string" && failure.hint) payload.hint = failure.hint;
      if (typeof failure.retryable === "boolean") payload.retryable = failure.retryable;
      if (Array.isArray(failure.permissions) && failure.permissions.length) payload.permissions = failure.permissions.slice();
      return payload;
    }
    var message = failure && failure.message ? failure.message : String(failure);
    if (/missing host permission|cannot access contents of|not allowed to access/i.test(message)) {
      return protocol.error(
        C.permissionRequired,
        "This browser blocks the extension from that page, so nothing was read or changed",
        { hint: "Ask the user to open the extension and allow Every website, then retry", retryable: true, permissions: ["<all_urls>"] }
      );
    }
    return protocol.error(C.protocolError, message, "Retry the call", true);
  }

  function withTimeout(promise, timeoutMs, label) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(protocol.error(C.timeout, label + " did not finish in " + timeoutMs + "ms", "Retry, or narrow the request", true));
      }, timeoutMs);
      promise.then(
        function (value) {
          clearTimeout(timer);
          resolve(value);
        },
        function (failure) {
          clearTimeout(timer);
          reject(failure);
        }
      );
    });
  }

  function context(budgetMs) {
    return {
      sessionId: state.sessionId,
      clientVersion: state.clientVersion,
      label: pairing ? pairing.label : protocol.DEFAULT_LABEL,
      profileName: state.profileName,
      tier: state.tier || "refine",
      allowedOrigins: state.allowedOrigins,
      connectedAt: state.connectedAt,
      controlledByViewer: viewer.timer !== null,
      budgetMs: budgetMs,
      deadline: Date.now() + budgetMs
    };
  }

  async function sendHello() {
    var tabs = [];
    try {
      tabs = await LB.tabs.listTabs();
    } catch (error) {
      tabs = [];
    }
    var profileName = null;
    try {
      if (browser.profiles && typeof browser.profiles.getProfileName === "function") {
        profileName = await browser.profiles.getProfileName();
      }
    } catch (error) {
      profileName = null;
    }
    state.profileName = profileName;
    var frame = {
      type: "hello",
      protocol: protocol.PROTOCOL_VERSION,
      client: protocol.CLIENT,
      clientVersion: state.clientVersion,
      capabilities: protocol.CAPABILITIES.slice(),
      label: pairing && pairing.label ? pairing.label : protocol.DEFAULT_LABEL,
      profileName: profileName,
      tabs: tabs
    };
    try {
      frame.access = await LB.access.snapshot();
    } catch (error) {
      void error;
    }
    try {
      frame.guards = await LB.guards.get();
    } catch (error) {
      void error;
    }
    send(frame);
  }

  function emitAgentActivity(stateName) {
    if (viewer.timer === null) return;
    emitViewerState(stateName, viewer.tabId === null ? undefined : viewer.tabId);
  }

  async function handleCall(frame) {
    var id = typeof frame.id === "string" ? frame.id : String(frame.id);
    var tool = String(frame.tool || "");
    var args = frame.args && typeof frame.args === "object" ? frame.args : {};
    var budgetMs = LB.budget.budgetFor(tool, args, frame.budgetMs);
    var result = null;
    var failure = null;
    if (tool !== "local_browser_viewer") emitAgentActivity(VIEWER_STATES.AGENT_STREAMING);
    try {
      result = await withTimeout(LB.tools.dispatch(tool, args, context(budgetMs)), budgetMs, tool);
    } catch (error) {
      failure = normalizeError(error);
    }
    if (failure) {
      send({ type: "result", id: id, ok: false, error: failure });
      if (tool !== "local_browser_viewer") emitAgentActivity(VIEWER_STATES.AGENT_IDLE);
      return;
    }
    send({ type: "result", id: id, ok: true, result: result === undefined ? null : result });
    if (tool !== "local_browser_viewer") emitAgentActivity(VIEWER_STATES.AGENT_IDLE);
  }

  async function handleFrame(raw) {
    var frame;
    try {
      frame = JSON.parse(String(raw));
    } catch (error) {
      return;
    }
    if (!frame || typeof frame !== "object") return;
    lastPongAt = Date.now();
    if (frame.type === "hello_ack") {
      if (pairing) {
        pairing.sessionToken = typeof frame.sessionToken === "string" ? frame.sessionToken : pairing.sessionToken;
        pairing.sessionId = typeof frame.sessionId === "string" ? frame.sessionId : pairing.sessionId;
        pairing.tier = typeof frame.tier === "string" ? frame.tier : pairing.tier;
        pairing.retiredAt = null;
        pairing.retiredReason = null;
        try {
          await writePairing(pairing);
        } catch (error) {
          void error;
        }
      }
      pendingCode = null;
      attempt = 0;
      setState({
        status: STATUS.CONNECTED,
        sessionId: typeof frame.sessionId === "string" ? frame.sessionId : state.sessionId,
        tier: typeof frame.tier === "string" ? frame.tier : state.tier,
        allowedOrigins: Array.isArray(frame.allowedOrigins) ? frame.allowedOrigins : state.allowedOrigins,
        connectedAt: new Date().toISOString(),
        lastError: null,
        retiredReason: null
      });
      startHeartbeat();
      scheduleTabsEvent();
      return;
    }
    if (frame.type === "ping") {
      send({ type: "pong", at: typeof frame.at === "string" ? frame.at : new Date().toISOString() });
      return;
    }
    if (frame.type === "pong") {
      lastPongAt = Date.now();
      return;
    }
    if (frame.type === "call") {
      await handleCall(frame);
    }
  }

  function scheduleReconnect(credentials) {
    if (stopped) return;
    attempt += 1;
    var delay = backoff.computeDelay(attempt - 1, { baseMs: 1000, maxMs: 30000, jitter: 0.25 });
    setState({ status: STATUS.DISCONNECTED });
    clearReconnect();
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      if (stopped) return;
      var next = credentials || (pendingCode ? { code: pendingCode } : {});
      connect(next);
    }, delay);
  }

  function connect(credentials) {
    clearReconnect();
    closeSocket();
    stopHeartbeat();
    var useCode = credentials && credentials.code ? credentials.code : null;
    var query = useCode ? { code: useCode } : { session: pairing ? pairing.sessionToken : null };
    var url = protocol.bridgeUrl(pairing ? pairing.origin : "", query);
    if (!url) {
      setState({ status: STATUS.DISCONNECTED, lastError: "The paired origin is not http or https" });
      return;
    }
    setState({ status: STATUS.CONNECTING, origin: pairing.origin, label: pairing.label, lastError: null });
    var ws;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      setState({ status: STATUS.DISCONNECTED, lastError: "Firefox could not open the bridge socket" });
      scheduleReconnect(useCode ? { code: useCode } : null);
      return;
    }
    socket = ws;
    ws.onopen = function () {
      if (socket !== ws) return;
      void sendHello();
    };
    ws.onmessage = function (event) {
      if (socket !== ws) return;
      void handleFrame(event.data);
    };
    ws.onclose = function (event) {
      if (socket !== ws) return;
      socket = null;
      stopHeartbeat();
      if (stopped) return;
      emitViewerState(VIEWER_STATES.DISCONNECTED, undefined, "The bridge socket closed");
      var code = event && typeof event.code === "number" ? event.code : 1006;
      var reason = event && typeof event.reason === "string" && event.reason ? event.reason : "the bridge closed the socket";
      if (code === POLICY_VIOLATION) {
        void retirePairing(reason);
        return;
      }
      var codeNeverAccepted = useCode && !(pairing && pairing.sessionToken);
      if (codeNeverAccepted) {
        codeAttempts += 1;
        if (codeAttempts >= PAIRING_CODE_ATTEMPTS) {
          void retirePairing("the pairing code was not accepted");
          return;
        }
      }
      scheduleReconnect(codeNeverAccepted ? { code: useCode } : null);
    };
    ws.onerror = function () {
      if (socket !== ws) return;
      setState({ lastError: "The bridge socket reported an error" });
    };
  }

  function retiredMessage(reason) {
    return reason
      ? "Session ended: " + reason + ". Pair this browser again to reconnect."
      : "This browser was disconnected. Pair it again to reconnect.";
  }

  async function start() {
    pairing = await readPairing();
    if (!pairing) {
      stopped = true;
      setState({ status: STATUS.UNPAIRED, origin: null, label: null, tier: null, sessionId: null, lastError: null, retiredReason: null });
      return;
    }
    if (pairing.retiredAt && !pairing.sessionToken) {
      stopped = true;
      setState({
        status: STATUS.RETIRED,
        origin: pairing.origin,
        label: pairing.label,
        tier: null,
        sessionId: null,
        retiredReason: pairing.retiredReason || "the pairing ended",
        lastError: retiredMessage(pairing.retiredReason)
      });
      return;
    }
    stopped = false;
    attempt = 0;
    pendingCode = null;
    connect({});
  }

  async function defaultLabel() {
    var os = "";
    try {
      var info = await browser.runtime.getPlatformInfo();
      os = info && info.os ? info.os : "";
    } catch (error) {
      os = "";
    }
    return os ? protocol.DEFAULT_LABEL + " on " + os : protocol.DEFAULT_LABEL;
  }

  async function detectPairingTab() {
    var tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs.length) tabs = await browser.tabs.query({ active: true });
    if (!tabs.length) return null;
    var tab = tabs[0];
    if (!tab || typeof tab.id !== "number" || !/^https?:/i.test(String(tab.url || ""))) return null;
    var results = await browser.tabs
      .executeScript(tab.id, {
        code: [
          "(function(){",
          "var el=document.querySelector('[data-paperclip-local-browser-pairing]');",
          "if(!el)return null;",
          "return {origin:el.getAttribute('data-origin')||'',code:el.getAttribute('data-code')||''};",
          "})()"
        ].join("")
      })
      .catch(function () {
        return null;
      });
    var found = results && results[0];
    if (!found || !found.code) return null;
    return { origin: LB.pairing.normalizeOrigin(found.origin || tab.url), code: String(found.code).trim() };
  }

  function detectedInput(found) {
    if (!found || !found.code) return null;
    return { input: found.origin ? found.origin + "/?code=" + encodeURIComponent(found.code) : found.code };
  }

  async function pair(options) {
    var opts = options || {};
    var origin = LB.pairing.normalizeOrigin(opts.origin);
    if (!origin) throw new Error("Use an http or https address, such as https://paperclip.example");
    var code = String(opts.code || "").trim();
    if (!/^[A-Za-z0-9]{4,32}$/.test(code)) throw new Error("The pairing code looks wrong");
    var label = String(opts.label || "").trim() || (await defaultLabel());
    pairing = { origin: origin, label: label, sessionToken: null, sessionId: null, tier: null };
    await writePairing(pairing);
    pendingCode = code;
    stopped = false;
    attempt = 0;
    codeAttempts = 0;
    state.retiredReason = null;
    connect({ code: code });
  }

  async function pairFromInput(input) {
    var parsed = LB.pairing.parsePairingInput(input);
    if (parsed.reason) throw new Error(parsed.reason);
    if (parsed.needsCode || !parsed.code) throw new Error("This link has no pairing code. Copy the whole pairing link from Paperclip.");
    var scheme = /^\s*([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(String(input || ""));
    if (!parsed.origin && scheme) throw new Error("Use an http or https address, not " + scheme[1] + ":");
    var origin = parsed.origin || (pairing ? pairing.origin : null);
    if (!origin) throw new Error("A bare code needs the Paperclip address. Paste the whole pairing link instead.");
    var label = pairing && pairing.origin === origin ? pairing.label : "";
    await pair({ origin: origin, code: parsed.code, label: label });
  }

  function stop(options) {
    var opts = options || {};
    stopped = true;
    pendingCode = null;
    clearReconnect();
    stopHeartbeat();
    stopViewer();
    closeSocket();
    if (opts.keepPairing === true) {
      setState({ status: STATUS.DISCONNECTED, connectedAt: null, lastError: opts.reason ? "Stopped: " + opts.reason : null });
      return;
    }
    setState({ status: STATUS.UNPAIRED, sessionId: null, tier: null, connectedAt: null, lastError: opts.reason || null });
  }

  async function disconnect() {
    stop({});
    pairing = null;
    await writePairing(null);
    setState({ status: STATUS.UNPAIRED, origin: null, label: null, tier: null, sessionId: null, lastError: null, retiredReason: null });
  }

  async function retirePairing(reason) {
    stopped = true;
    pendingCode = null;
    attempt = 0;
    codeAttempts = 0;
    clearReconnect();
    stopHeartbeat();
    stopViewer("The session ended");
    closeSocket();
    var keptOrigin = pairing ? pairing.origin : state.origin;
    var keptLabel = pairing ? pairing.label : state.label;
    var retired = {
      origin: keptOrigin,
      label: keptLabel,
      sessionToken: null,
      sessionId: null,
      tier: null,
      retiredAt: new Date().toISOString(),
      retiredReason: reason
    };
    pairing = retired;
    try {
      await writePairing(retired);
    } catch (error) {
      void error;
    }
    setState({
      status: STATUS.RETIRED,
      origin: keptOrigin,
      label: keptLabel,
      tier: null,
      sessionId: null,
      allowedOrigins: [],
      connectedAt: null,
      retiredReason: reason,
      lastError: retiredMessage(reason)
    });
  }

  var VIEWER_STATES = Object.freeze({
    CONNECTED: "connected",
    UNAVAILABLE: "viewer_unavailable",
    AGENT_STREAMING: "agent_streaming",
    AGENT_IDLE: "agent_idle",
    DISCONNECTED: "disconnected"
  });

  function emitViewerState(stateName, tabId, message) {
    var data = { state: stateName };
    if (typeof tabId === "number" && tabId >= 0) data.tabId = tabId;
    if (typeof message === "string" && message) data.message = message.slice(0, 400);
    send({ type: "event", event: "state", data: data });
  }

  function stopViewer(reason) {
    if (viewer.timer) clearInterval(viewer.timer);
    var wasActive = viewer.timer !== null;
    var lastTab = viewer.tabId;
    viewer.timer = null;
    viewer.tabId = null;
    viewer.intervalMs = 0;
    viewer.busy = false;
    viewerFailures = 0;
    if (wasActive) emitViewerState(VIEWER_STATES.AGENT_IDLE, typeof lastTab === "number" ? lastTab : undefined, reason || "The viewer stopped");
  }

  async function emitFrame() {
    if (viewer.busy || viewer.tabId === null || !isConnected()) return;
    viewer.busy = true;
    var tabId = viewer.tabId;
    try {
      var tab = await browser.tabs.get(tabId);
      var summary = LB.tabs.summarize(tab);
      var viewport = await LB.tabs.send(tabId, "viewport", {});
      var shot = null;
      if (summary.active) {
        shot = await LB.tabs.captureVisible(summary.windowId);
      } else {
        var background = await LB.bidi.captureScreenshot(summary);
        if (!background) {
          viewerFailures += 1;
          if (viewerFailures === 1) {
            emitViewerState(VIEWER_STATES.UNAVAILABLE, tabId, "This tab needs to be in front before it can be watched");
          }
          return;
        }
        shot = { dataUrl: background };
      }
      var bitmap = await LB.tabs.measureCapture(shot.dataUrl);
      var geometry = LB.frames.frameGeometry({
        bitmapWidth: bitmap ? bitmap.width : null,
        bitmapHeight: bitmap ? bitmap.height : null,
        dpr: viewport.dpr,
        cssWidth: viewport.width,
        cssHeight: viewport.height
      });
      if (!geometry) throw new Error("The tab reported an empty viewport");
      viewerFailures = 0;
      send({
        type: "event",
        event: "frame",
        data: { dataUrl: shot.dataUrl, width: geometry.width, height: geometry.height, tabId: tabId }
      });
    } catch (error) {
      viewerFailures += 1;
      if (viewerFailures === 1) {
        emitViewerState(VIEWER_STATES.UNAVAILABLE, tabId, error && error.message ? error.message : "The viewer could not capture this tab");
      }
      if (viewerFailures >= 5) stopViewer("The viewer stopped after repeated capture failures");
    } finally {
      viewer.busy = false;
    }
  }

  function startViewer(tab, intervalMs) {
    stopViewer();
    viewer.tabId = tab.tabId;
    viewer.intervalMs = intervalMs;
    viewerFailures = 0;
    viewer.timer = setInterval(function () {
      void emitFrame();
    }, intervalMs);
    emitViewerState(VIEWER_STATES.CONNECTED, tab.tabId);
    void emitFrame();
  }

  function fail(message) {
    return status().then(function (current) {
      return { ok: false, error: message, status: current };
    });
  }

  async function succeed(extra) {
    return Object.assign({ ok: true, status: await status() }, extra || {});
  }

  async function control(message) {
    var op = message && message.op;
    try {
      if (op === "status") {
        await refreshTrustedInput();
        return succeed();
      }
      if (op === "pair") {
        await pairFromInput(message.input);
        return succeed();
      }
      if (op === "detect") {
        return succeed({ detected: detectedInput(await detectPairingTab()) });
      }
      if (op === "reconnect") {
        if (!pairing) return fail("Pair this browser first.");
        if (pairing.retiredAt && !pairing.sessionToken) {
          return fail(
            pairing.retiredReason
              ? "Session ended: " + pairing.retiredReason + ". Pair this browser again with a new link."
              : "This browser was disconnected. Pair it again with a new link."
          );
        }
        pendingCode = null;
        stopped = false;
        attempt = 0;
        connect({});
        return succeed();
      }
      if (op === "disconnect") {
        await disconnect();
        return succeed();
      }
      if (op === "guards.set") {
        await LB.guards.set(message.patch && typeof message.patch === "object" ? message.patch : {});
        return succeed();
      }
      if (op === "pending.clear") {
        await LB.access.clearPending(Array.isArray(message.permissions) ? message.permissions : undefined);
        return succeed();
      }
      if (op === "bidi.set") {
        trustedInput = await LB.bidi.setPort(message.port);
        broadcast();
        return succeed();
      }
      if (op === "bidi.check") {
        trustedInput = await LB.bidi.check();
        broadcast();
        return succeed();
      }
      return fail("Unknown control op " + String(op) + ".");
    } catch (error) {
      return fail(error && error.message ? error.message : String(error));
    }
  }

  root.LB = root.LB || {};
  root.LB.bridge = {
    STATUS: STATUS,
    start: start,
    stop: stop,
    pair: pair,
    pairFromInput: pairFromInput,
    disconnect: disconnect,
    control: control,
    status: status,
    refreshTrustedInput: refreshTrustedInput,
    startViewer: startViewer,
    stopViewer: stopViewer,
    installTabWatchers: installTabWatchers,
    installAccessWatchers: installAccessWatchers,
    isConnected: isConnected,
    snapshotState: snapshotState
  };
})(globalThis);
