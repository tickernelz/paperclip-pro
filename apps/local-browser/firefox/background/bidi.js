(function (root) {
  "use strict";

  var LB = root.LB;
  var protocol = LB.protocol;

  var socket = null;
  var socketPort = 0;
  var live = false;
  var nextId = 1;
  var pending = new Map();
  var probing = null;
  var probingPort = 0;
  var probeCache = { at: 0, port: 0, result: null };
  var PROBE_TTL_MS = 15000;
  var HTTP_TIMEOUT_MS = 900;
  var HANDSHAKE_TIMEOUT_MS = 3000;
  var COMMAND_TIMEOUT_MS = 4000;

  function timeout(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function httpAnswers(port) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, HTTP_TIMEOUT_MS);
    try {
      await fetch("http://127.0.0.1:" + port + "/", { mode: "no-cors", cache: "no-store", signal: controller.signal });
      return true;
    } catch (error) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function portOf() {
    try {
      var stored = await browser.storage.local.get(protocol.STORAGE_BIDI);
      var value = stored[protocol.STORAGE_BIDI] || {};
      if (typeof value.port === "number" && value.port > 0 && value.port < 65536) return value.port;
    } catch (error) {
      return protocol.DEFAULT_BIDI_PORT;
    }
    return protocol.DEFAULT_BIDI_PORT;
  }

  function isOpen() {
    return live && Boolean(socket) && socket.readyState === WebSocket.OPEN;
  }

  function remember(port, result) {
    probeCache = { at: Date.now(), port: port, result: result };
    return result;
  }

  async function attempt(port) {
    await close();
    if (!(await httpAnswers(port))) return { mode: "synthetic", port: port, reason: "not_running" };
    var ws;
    try {
      ws = await openSocket("ws://127.0.0.1:" + port + "/session");
    } catch (error) {
      return { mode: "synthetic", port: port, reason: "origin_refused" };
    }
    socket = ws;
    socketPort = port;
    live = false;
    try {
      var current = await command("session.status", {}, HANDSHAKE_TIMEOUT_MS);
      if (current && current.ready === false) throw new Error("BiDi session is taken");
      await command("session.new", { capabilities: { alwaysMatch: {} } }, HANDSHAKE_TIMEOUT_MS);
    } catch (error) {
      await close();
      return { mode: "synthetic", port: port, reason: "busy" };
    }
    live = true;
    return { mode: "bidi", port: port };
  }

  async function probe(force) {
    var port = await portOf();
    if (probing) {
      if (probingPort === port) return probing;
      await probing;
      return probe(force);
    }
    if (isOpen() && socketPort === port) return remember(port, { mode: "bidi", port: port });
    if (!force && probeCache.result && probeCache.port === port && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.result;
    probingPort = port;
    probing = attempt(port).then(
      function (result) {
        return remember(port, result);
      },
      function () {
        return remember(port, { mode: "synthetic", port: port, reason: "not_running" });
      }
    );
    try {
      return await probing;
    } finally {
      probing = null;
    }
  }

  function onMessage(event) {
    var payload;
    try {
      payload = JSON.parse(String(event.data));
    } catch (error) {
      return;
    }
    if (!payload || typeof payload.id !== "number") return;
    var waiter = pending.get(payload.id);
    if (!waiter) return;
    pending.delete(payload.id);
    clearTimeout(waiter.timer);
    if (payload.type === "error") {
      waiter.reject(new Error(String(payload.message || payload.error || "BiDi command failed")));
      return;
    }
    waiter.resolve(payload.result || {});
  }

  function command(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("BiDi is not connected"));
        return;
      }
      var id = nextId;
      nextId += 1;
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(new Error("BiDi command timed out"));
      }, timeoutMs || COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      socket.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }

  async function openSocket(url) {
    var ws = new WebSocket(url);
    try {
      await new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          reject(new Error("BiDi handshake timed out"));
        }, HANDSHAKE_TIMEOUT_MS);
        ws.onopen = function () {
          clearTimeout(timer);
          resolve();
        };
        ws.onerror = function () {
          clearTimeout(timer);
          reject(new Error("BiDi handshake failed"));
        };
        ws.onclose = function () {
          clearTimeout(timer);
          reject(new Error("BiDi handshake refused"));
        };
      });
    } catch (error) {
      ws.onclose = null;
      try {
        ws.close();
      } catch (closeError) {
        void closeError;
      }
      throw error;
    }
    ws.onmessage = onMessage;
    ws.onerror = null;
    ws.onclose = function () {
      if (socket === ws) {
        socket = null;
        socketPort = 0;
        live = false;
        probeCache = { at: 0, port: 0, result: null };
      }
      pending.forEach(function (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("BiDi closed"));
      });
      pending.clear();
    };
    return ws;
  }

  async function connect() {
    if (isOpen()) return socket;
    var result = await probe(false);
    return result.mode === "bidi" && isOpen() ? socket : null;
  }

  function sameOrigin(a, b) {
    var left = protocol.originOf(a);
    var right = protocol.originOf(b);
    return Boolean(left) && left === right;
  }

  async function contextFor(tab) {
    var tree = await command("browsingContext.getTree", { maxDepth: 1 });
    var contexts = Array.isArray(tree.contexts) ? tree.contexts : [];
    if (!contexts.length) return null;
    for (var i = 0; i < contexts.length; i += 1) {
      if (contexts[i].url === tab.url) return contexts[i].context;
    }
    for (var j = 0; j < contexts.length; j += 1) {
      if (sameOrigin(contexts[j].url, tab.url)) return contexts[j].context;
    }
    return contexts[0].context;
  }

  var inputState = LB.input.createInputState();

  async function sendInput(tab, args) {
    var plan;
    try {
      plan = inputState.apply(args);
    } catch (error) {
      return { available: false, rejected: true, error: error && error.message ? error.message : String(error) };
    }
    var ws = await connect();
    if (!ws) return { available: false, plan: plan };
    try {
      var context = await contextFor(tab);
      if (!context) return { available: false, plan: plan, error: "No browsing context matched this tab" };
      try {
        await command("browsingContext.activate", { context: context }, 2000);
      } catch (error) {
        void error;
      }
      var sources = LB.input.bidiActions(plan);
      if (sources.length) await command("input.performActions", { context: context, actions: sources });
      if (plan.action === "up") {
        try {
          await command("input.releaseActions", { context: context }, 2000);
        } catch (error) {
          void error;
        }
      }
      return { available: true, mode: "trusted", plan: plan };
    } catch (error) {
      return { available: false, plan: plan, error: error && error.message ? error.message : String(error) };
    }
  }

  function messageOf(error) {
    return error && error.message ? error.message : String(error);
  }

  async function performActions(tab, batches) {
    var ws = await connect();
    if (!ws) return { available: false, dispatched: 0, error: "WebDriver BiDi is not reachable" };
    var context;
    try {
      context = await contextFor(tab);
    } catch (error) {
      return { available: false, dispatched: 0, error: messageOf(error) };
    }
    if (!context) return { available: false, dispatched: 0, error: "No browsing context matched this tab" };
    try {
      await command("browsingContext.activate", { context: context }, 2000);
    } catch (error) {
      void error;
    }
    for (var index = 0; index < batches.length; index += 1) {
      try {
        await command("input.performActions", { context: context, actions: batches[index] });
      } catch (error) {
        return { available: false, dispatched: index, error: messageOf(error) };
      }
    }
    try {
      await command("input.releaseActions", { context: context }, 2000);
    } catch (error) {
      void error;
    }
    return { available: true, dispatched: batches.length };
  }

  async function captureScreenshot(tab) {
    var ws = await connect();
    if (!ws) return null;
    try {
      var context = await contextFor(tab);
      if (!context) return null;
      var shot = await command("browsingContext.captureScreenshot", { context: context }, 10000);
      if (!shot || typeof shot.data !== "string") return null;
      return "data:image/png;base64," + shot.data;
    } catch (error) {
      return null;
    }
  }

  function extensionOrigin() {
    try {
      return browser.runtime.getURL("/").replace(/\/$/, "");
    } catch (error) {
      return "";
    }
  }

  async function trustedInput(force) {
    var result = await probe(force === true);
    var out = {
      mode: result.mode === "bidi" ? "bidi" : "synthetic",
      port: result.port,
      origin: extensionOrigin(),
      checkedAt: probeCache.at || Date.now()
    };
    if (out.mode === "synthetic" && result.reason) out.reason = result.reason;
    return out;
  }

  function check() {
    probeCache = { at: 0, port: 0, result: null };
    return trustedInput(true);
  }

  async function setPort(port) {
    var value = typeof port === "number" ? Math.floor(port) : NaN;
    if (!(value >= 1 && value <= 65535)) throw new Error("Use a port between 1 and 65535");
    await browser.storage.local.set({ [protocol.STORAGE_BIDI]: { port: value } });
    probeCache = { at: 0, port: 0, result: null };
    await close();
    return trustedInput(true);
  }

  function resetInput() {
    inputState.reset();
  }

  async function close() {
    live = false;
    socketPort = 0;
    if (!socket) return;
    var ws = socket;
    socket = null;
    try {
      ws.close();
    } catch (error) {
      void error;
    }
  }

  root.LB = root.LB || {};
  root.LB.bidi = {
    connect: connect,
    sendInput: sendInput,
    performActions: performActions,
    resetInput: resetInput,
    probe: probe,
    trustedInput: trustedInput,
    check: check,
    setPort: setPort,
    captureScreenshot: captureScreenshot,
    close: close,
    timeout: timeout
  };
})(globalThis);
