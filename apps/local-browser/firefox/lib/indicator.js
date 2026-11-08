(function (root) {
  "use strict";

  var HOST_ATTRIBUTE = "data-wardmote-agent-indicator";
  var CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"];
  var OFFSET = "16px";
  var PAINT_TIMEOUT_MS = 120;

  var STYLE = [
    ":host { all: initial; --bg-2: oklch(1 0 0); --line: oklch(0.885 0.007 265); --ink: oklch(0.225 0.014 268);",
    "  --accent: oklch(0.505 0.2 277); --accent-ink: oklch(0.99 0.004 277); --accent-hover: oklch(0.455 0.2 277);",
    "  --bg-3: oklch(0.948 0.005 265); --line-strong: oklch(0.58 0.012 265); --ok: oklch(0.47 0.12 152); --focus: oklch(0.55 0.2 277);",
    "  --shadow-2: 0 12px 32px -12px oklch(0.225 0.02 268 / 0.28), 0 2px 6px -2px oklch(0.225 0.02 268 / 0.12); }",
    "@media (prefers-color-scheme: dark) { :host { --bg-2: oklch(0.2 0.007 268); --line: oklch(0.31 0.009 268); --ink: oklch(0.962 0.004 268);",
    "  --accent: oklch(0.73 0.145 277); --accent-ink: oklch(0.17 0.02 277); --accent-hover: oklch(0.78 0.13 277);",
    "  --bg-3: oklch(0.24 0.008 268); --line-strong: oklch(0.6 0.012 268); --ok: oklch(0.79 0.14 152); --focus: oklch(0.79 0.13 277);",
    "  --shadow-2: 0 16px 36px -14px oklch(0 0 0 / 0.75), 0 2px 8px -2px oklch(0 0 0 / 0.5); } }",
    ".bar { display: flex; align-items: center; gap: 10px; max-width: min(420px, calc(100vw - 32px)); box-sizing: border-box;",
    "  padding: 8px 8px 8px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg-2); color: var(--ink);",
    "  font: 600 12px/1.4 InterVariable, Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; box-shadow: var(--shadow-2);",
    "  pointer-events: none; }",
    ".dot { flex: none; width: 8px; height: 8px; border-radius: 999px; background: var(--accent); }",
    ".held .dot { background: var(--ok); }",
    ".text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    "button { flex: none; pointer-events: auto; font: inherit; color: var(--accent-ink); background: var(--accent); border: 0; border-radius: 6px;",
    "  padding: 4px 10px; cursor: pointer; }",
    "button:hover { background: var(--accent-hover); }",
    ".held button { color: var(--ink); background: var(--bg-3); box-shadow: inset 0 0 0 1px var(--line-strong); }",
    ".held button:hover { background: var(--line); }",
    "button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }",
    "@media (prefers-reduced-motion: no-preference) { .dot { animation: pulse 1.6s ease-in-out infinite; } }",
    "@keyframes pulse { 50% { opacity: 0.35; } }"
  ].join("\n");

  function cleanAgents(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (name) {
      if (typeof name !== "string") return;
      var trimmed = name.trim().slice(0, 80);
      if (trimmed && out.indexOf(trimmed) === -1) out.push(trimmed);
    });
    return out;
  }

  function label(state) {
    if (state.held) return "You have control of this tab";
    var agents = cleanAgents(state.agents);
    if (!agents.length) return "A Wardmote agent is using this tab";
    if (agents.length === 1) return "Wardmote agent " + agents[0] + " is using this tab";
    return "Wardmote agents " + agents.join(", ") + " are using this tab";
  }

  function actionLabel(state) {
    return state.held ? "Hand back" : "Take over";
  }

  function sameState(a, b) {
    if (!a || !b) return a === b;
    return a.held === b.held && JSON.stringify(a.agents) === JSON.stringify(b.agents);
  }

  function createTracker() {
    var desired = new Map();
    var held = new Set();

    function stateOf(tabId) {
      if (held.has(tabId)) return { agents: (desired.get(tabId) || []).slice(), held: true };
      if (desired.has(tabId)) return { agents: desired.get(tabId).slice(), held: false };
      return null;
    }

    function tabIds() {
      var ids = new Set(Array.from(desired.keys()).concat(Array.from(held)));
      return Array.from(ids).sort(function (a, b) {
        return a - b;
      });
    }

    function replace(tabs) {
      var before = new Map();
      tabIds().forEach(function (tabId) {
        before.set(tabId, stateOf(tabId));
      });
      desired = new Map();
      (Array.isArray(tabs) ? tabs : []).forEach(function (entry) {
        if (!entry || typeof entry.tabId !== "number" || !Number.isInteger(entry.tabId) || entry.tabId < 0) return;
        desired.set(entry.tabId, cleanAgents(entry.agents));
      });
      var ids = new Set(Array.from(before.keys()).concat(tabIds()));
      return Array.from(ids)
        .filter(function (tabId) {
          return !sameState(before.get(tabId) || null, stateOf(tabId));
        })
        .sort(function (a, b) {
          return a - b;
        });
    }

    function toggle(tabId) {
      if (held.has(tabId)) {
        held.delete(tabId);
        return true;
      }
      if (!desired.has(tabId)) return false;
      held.add(tabId);
      return true;
    }

    function forget(tabId) {
      desired.delete(tabId);
      held.delete(tabId);
    }

    function restoreHeld(ids) {
      (Array.isArray(ids) ? ids : []).forEach(function (tabId) {
        if (typeof tabId === "number" && Number.isInteger(tabId) && tabId >= 0) held.add(tabId);
      });
    }

    return {
      replace: replace,
      restoreHeld: restoreHeld,
      heldIds: function () {
        return Array.from(held).sort(function (a, b) {
          return a - b;
        });
      },
      toggle: toggle,
      stateOf: stateOf,
      isHeld: function (tabId) {
        return held.has(tabId);
      },
      forget: forget,
      tabIds: tabIds
    };
  }

  var host = null;
  var parts = null;
  var shown = null;
  var toggleHandler = null;

  function isHost(node) {
    return Boolean(node && node.nodeType === 1 && typeof node.hasAttribute === "function" && node.hasAttribute(HOST_ATTRIBUTE));
  }

  function cornerOf(element) {
    var index = Number(element.getAttribute(HOST_ATTRIBUTE));
    return Number.isInteger(index) && index >= 0 && index < CORNERS.length ? index : 0;
  }

  function place(element, index) {
    var name = CORNERS[index];
    var style = element.style;
    element.setAttribute(HOST_ATTRIBUTE, String(index));
    style.setProperty("top", name.indexOf("top") === 0 ? OFFSET : "auto", "important");
    style.setProperty("bottom", name.indexOf("bottom") === 0 ? OFFSET : "auto", "important");
    style.setProperty("left", name.indexOf("left") > 0 ? OFFSET : "auto", "important");
    style.setProperty("right", name.indexOf("right") > 0 ? OFFSET : "auto", "important");
  }

  function buildHost(doc) {
    host = doc.createElement("div");
    host.style.cssText =
      "all: initial !important; position: fixed !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important;";
    var shadow = host.attachShadow({ mode: "closed" });
    var style = doc.createElement("style");
    style.textContent = STYLE;
    var bar = doc.createElement("div");
    bar.className = "bar";
    bar.setAttribute("role", "status");
    var dot = doc.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    var text = doc.createElement("span");
    text.className = "text";
    var button = doc.createElement("button");
    button.type = "button";
    button.addEventListener("click", function (event) {
      if (event.isTrusted !== true || !toggleHandler) return;
      toggleHandler();
    });
    bar.appendChild(dot);
    bar.appendChild(text);
    bar.appendChild(button);
    shadow.appendChild(style);
    shadow.appendChild(bar);
    parts = { bar: bar, text: text, button: button };
    place(host, 0);
  }

  function show(state, onToggle) {
    var doc = root.document;
    if (!doc || !doc.documentElement) return false;
    toggleHandler = typeof onToggle === "function" ? onToggle : null;
    if (!state) {
      hide();
      return false;
    }
    if (!host) buildHost(doc);
    parts.text.textContent = label(state);
    parts.text.title = label(state);
    parts.button.textContent = actionLabel(state);
    parts.bar.className = state.held ? "bar held" : "bar";
    host.style.setProperty("visibility", "visible", "important");
    shown = { agents: cleanAgents(state.agents), held: state.held === true };
    keepAttached();
    return true;
  }

  function hide() {
    shown = null;
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  function keepAttached() {
    if (!shown || !host || host.isConnected) return;
    var doc = root.document;
    if (doc && doc.documentElement) doc.documentElement.appendChild(host);
  }

  function touches(record) {
    if (!record) return false;
    if (isHost(record.target)) return true;
    var added = record.addedNodes ? record.addedNodes.length : 0;
    var removed = record.removedNodes ? record.removedNodes.length : 0;
    if (added + removed !== 1) return false;
    return isHost(added ? record.addedNodes[0] : record.removedNodes[0]);
  }

  function contains(rect, point) {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function dodge(element, point) {
    if (!isHost(element) || !element.isConnected || !point) return false;
    if (!contains(element.getBoundingClientRect(), point)) return false;
    var start = cornerOf(element);
    for (var step = 1; step < CORNERS.length; step += 1) {
      place(element, (start + step) % CORNERS.length);
      if (!contains(element.getBoundingClientRect(), point)) return true;
    }
    place(element, start);
    return false;
  }

  function afterPaint() {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve();
      }
      setTimeout(finish, PAINT_TIMEOUT_MS);
      if (typeof root.requestAnimationFrame === "function") {
        root.requestAnimationFrame(function () {
          root.requestAnimationFrame(finish);
        });
      }
    });
  }

  function suppress(flag) {
    if (!host || !host.isConnected) return Promise.resolve(false);
    host.style.setProperty("visibility", flag ? "hidden" : "visible", "important");
    var doc = root.document;
    if (!flag || (doc && doc.visibilityState === "hidden")) return Promise.resolve(true);
    return afterPaint().then(function () {
      return true;
    });
  }

  root.LB = root.LB || {};
  root.LB.indicator = {
    HOST_ATTRIBUTE: HOST_ATTRIBUTE,
    label: label,
    actionLabel: actionLabel,
    createTracker: createTracker,
    show: show,
    hide: hide,
    isHost: isHost,
    keepAttached: keepAttached,
    touches: touches,
    dodge: dodge,
    suppress: suppress,
    current: function () {
      return shown;
    }
  };
})(globalThis);
