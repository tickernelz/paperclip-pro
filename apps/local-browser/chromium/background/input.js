(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var ToolFailure = core.ToolFailure;
  var INPUT_IDLE_DETACH_MS = 30000;
  var HOLDER = "input";

  var KEY_EVENTS = {
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
  var MODIFIER_BITS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  var MOUSE_BUTTON_BITS = { left: 1, middle: 4, right: 2 };

  var session = null;

  function modifierMask(args) {
    var mask = 0;
    if (args.alt === true) mask |= MODIFIER_BITS.alt;
    if (args.ctrl === true) mask |= MODIFIER_BITS.ctrl;
    if (args.meta === true) mask |= MODIFIER_BITS.meta;
    if (args.shift === true) mask |= MODIFIER_BITS.shift;
    return mask;
  }

  function keyCodeOf(key) {
    var spec = KEY_EVENTS[key];
    if (spec) return spec.windowsVirtualKeyCode;
    if (typeof key === "string" && key.length === 1) return key.toUpperCase().charCodeAt(0);
    return 0;
  }

  function touch() {
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(function () {
      void detach();
    }, INPUT_IDLE_DETACH_MS);
  }

  async function detach() {
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    var tabId = session.tabId;
    session = null;
    await LB.bg.cdp.release(tabId, HOLDER).catch(function () {});
  }

  async function ensureDebugger(tabId) {
    if (session && session.tabId === tabId && LB.bg.cdp.holds(tabId, HOLDER)) {
      touch();
      return;
    }
    if (session) await detach();
    try {
      await LB.bg.cdp.acquire(tabId, HOLDER);
    } catch (error) {
      throw new ToolFailure(
        ERROR.unsupported,
        "The browser refused trusted input for this tab",
        "Another debugger may hold the tab; this call fell back to synthetic events"
      );
    }
    session = { tabId: tabId, timer: null };
    touch();
  }

  function onDebuggerDetached(tabId) {
    if (session && session.tabId === tabId) {
      if (session.timer) clearTimeout(session.timer);
      session = null;
    }
  }

  function send(tabId, method, params) {
    return LB.bg.cdp.send(tabId, method, params);
  }

  async function dispatchMouse(tabId, args) {
    var button = args.button || "left";
    var clickCount = core.clampInt(args.clickCount, 1, 1, 3);
    var held = MOUSE_BUTTON_BITS[button] || 1;
    if (args.action === "move") {
      await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: args.x, y: args.y, button: "none", buttons: 0 });
      return;
    }
    if (args.action === "down") {
      await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: args.x, y: args.y, button: button, clickCount: clickCount, buttons: held });
      return;
    }
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: args.x, y: args.y, button: button, clickCount: clickCount, buttons: 0 });
  }

  async function dispatchWheel(tabId, args) {
    await send(tabId, "Input.dispatchMouseEvent", {
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
    var key = String(args.key || "");
    var spec = KEY_EVENTS[key] || {};
    var code = args.code || spec.code || (key.length === 1 ? "Key" + key.toUpperCase() : key);
    var virtualKey = spec.windowsVirtualKeyCode !== undefined ? spec.windowsVirtualKeyCode : keyCodeOf(key);
    var base = {
      key: spec.key !== undefined ? spec.key : key,
      code: code,
      windowsVirtualKeyCode: virtualKey,
      nativeVirtualKeyCode: virtualKey,
      modifiers: modifierMask(args)
    };
    if (args.action === "up") {
      await send(tabId, "Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, base));
      return;
    }
    await send(tabId, "Input.dispatchKeyEvent", Object.assign({ type: "rawKeyDown" }, base));
    if (args.ctrl === true || args.meta === true) return;
    var fallback = spec.text !== undefined ? spec.text : key.length === 1 ? (args.shift === true ? key.toUpperCase() : key) : "";
    var text = typeof args.text === "string" ? args.text : fallback;
    if (text.length) await send(tabId, "Input.dispatchKeyEvent", Object.assign({ type: "char", text: text, unmodifiedText: text }, base));
  }

  async function pressTrustedKey(tabId, key) {
    await dispatchKey(tabId, { kind: "key", action: "down", key: key });
    await dispatchKey(tabId, { kind: "key", action: "up", key: key });
  }

  function assertInputShape(args) {
    if (args.kind === "mouse") {
      if (args.action !== "move" && args.action !== "down" && args.action !== "up") {
        throw new ToolFailure(ERROR.protocolError, "mouse action must be move, down or up", "Send a viewer input frame from the UI");
      }
      if (!Number.isInteger(args.x) || !Number.isInteger(args.y)) throw new ToolFailure(ERROR.protocolError, "mouse needs integer x and y");
      return;
    }
    if (args.kind === "wheel") {
      if (!Number.isInteger(args.x) || !Number.isInteger(args.y)) throw new ToolFailure(ERROR.protocolError, "wheel needs integer x and y");
      if (typeof args.deltaX !== "number" || typeof args.deltaY !== "number") {
        throw new ToolFailure(ERROR.protocolError, "wheel needs numeric deltaX and deltaY");
      }
      return;
    }
    if (args.kind === "key") {
      if (args.action !== "down" && args.action !== "up") {
        throw new ToolFailure(ERROR.protocolError, "key action must be down or up", "Send a viewer input frame from the UI");
      }
      if (typeof args.key !== "string" || !args.key.length) throw new ToolFailure(ERROR.protocolError, "key needs a key name");
      return;
    }
    throw new ToolFailure(ERROR.protocolError, "input kind must be mouse, wheel or key");
  }

  async function toolInput(args) {
    var tab = await LB.bg.tabs.resolveTab(args);
    assertInputShape(args);
    var payload = Object.assign({}, args);
    delete payload.tabId;
    delete payload.sessionId;
    try {
      await ensureDebugger(tab.id);
      if (args.kind === "mouse") await dispatchMouse(tab.id, args);
      else if (args.kind === "wheel") await dispatchWheel(tab.id, args);
      else await dispatchKey(tab.id, args);
      touch();
      return { ok: true, mode: "trusted", kind: args.kind, action: args.action || null, tabId: tab.id };
    } catch (error) {
      var fallback = await LB.bg.tabs.rpc(tab.id, "inputFallback", payload, 10000).catch(function () {
        return null;
      });
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

  function activeTabId() {
    return session ? session.tabId : null;
  }

  LB.bg = LB.bg || {};
  LB.bg.input = {
    ensureDebugger: ensureDebugger,
    touch: touch,
    detach: detach,
    onDebuggerDetached: onDebuggerDetached,
    pressTrustedKey: pressTrustedKey,
    assertInputShape: assertInputShape,
    toolInput: toolInput,
    activeTabId: activeTabId
  };
})(globalThis);
