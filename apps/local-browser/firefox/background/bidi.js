(function (root) {
  "use strict";

  var LB = root.LB;
  var protocol = LB.protocol;

  var socket = null;
  var nextId = 1;
  var pending = new Map();
  var connecting = null;
  var probeCache = { at: 0, url: null };
  var PROBE_TTL_MS = 15000;
  var COMMAND_TIMEOUT_MS = 4000;

  function timeout(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function fetchJson(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, 900);
    try {
      var response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
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

  async function probe() {
    if (Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.url;
    var port = await portOf();
    var candidates = ["http://127.0.0.1:" + port + "/session", "http://127.0.0.1:" + port + "/json/version"];
    for (var i = 0; i < candidates.length; i += 1) {
      var payload = await fetchJson(candidates[i]);
      if (!payload) continue;
      var url = payload.webSocketUrl || payload.webSocketDebuggerUrl;
      if (typeof url === "string" && url) {
        probeCache = { at: Date.now(), url: url };
        return url;
      }
    }
    probeCache = { at: Date.now(), url: null };
    return null;
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
      waiter.reject(new Error((payload.error && payload.error.message) || "BiDi command failed"));
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
    await new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("BiDi handshake timed out"));
      }, 3000);
      ws.onopen = function () {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = function () {
        clearTimeout(timer);
        reject(new Error("BiDi handshake failed"));
      };
    });
    ws.onmessage = onMessage;
    ws.onclose = function () {
      socket = null;
      pending.forEach(function (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("BiDi closed"));
      });
      pending.clear();
    };
    return ws;
  }

  async function connect() {
    if (socket && socket.readyState === WebSocket.OPEN) return socket;
    if (connecting) return connecting;
    connecting = (async function () {
      var url = await probe();
      if (!url) return null;
      var ws = await openSocket(url);
      socket = ws;
      try {
        await command("session.new", { capabilities: { alwaysMatch: {} } }, 3000);
      } catch (error) {
        void error;
      }
      return ws;
    })();
    try {
      return await connecting;
    } catch (error) {
      probeCache = { at: Date.now(), url: null };
      socket = null;
      return null;
    } finally {
      connecting = null;
    }
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

  function extensionOrigin() {
    try {
      return browser.runtime.getURL("/").replace(/\/$/, "");
    } catch (error) {
      return "";
    }
  }

  async function status() {
    var url = await probe();
    var port = await portOf();
    var origin = extensionOrigin();
    return {
      available: Boolean(url),
      endpoint: url,
      port: port,
      extensionOrigin: origin,
      launchHint: origin
        ? "firefox --remote-debugging-port " + port + " --remote-allow-origins " + origin
        : "firefox --remote-debugging-port " + port
    };
  }

  function resetInput() {
    inputState.reset();
  }

  async function close() {
    if (!socket) return;
    try {
      socket.close();
    } catch (error) {
      void error;
    }
    socket = null;
  }

  root.LB = root.LB || {};
  root.LB.bidi = {
    connect: connect,
    sendInput: sendInput,
    resetInput: resetInput,
    status: status,
    close: close,
    timeout: timeout
  };
})(globalThis);
