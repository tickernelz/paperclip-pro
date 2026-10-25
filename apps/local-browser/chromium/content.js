(function () {
  "use strict";

  if (globalThis.__lbBridgeInstalled === true) return;
  globalThis.__lbBridgeInstalled = true;

  var LB = globalThis.LB;
  var ERROR = LB.protocol.ERROR_CODES;
  var DEFAULTS = LB.protocol.DEFAULTS;
  var adapter = LB.dom.adapter;
  var refs = LB.refmap.createRefMap({
    isDetached: function (element) {
      return !element || element.isConnected !== true;
    }
  });

  var tabId = null;
  var frameId = null;
  var refUrl = location.href;

  function syncRefUrl() {
    if (location.href === refUrl) return false;
    refs.reset();
    refUrl = location.href;
    return true;
  }
  var mutationCount = 0;
  var lastMutationAt = Date.now();
  var observer = new MutationObserver(function (records) {
    mutationCount += records.length;
    lastMutationAt = Date.now();
  });
  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true
  });

  function fail(code, message, hint) {
    var error = { code: code, message: message };
    if (hint) error.hint = hint;
    return { ok: false, error: error };
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function resolveTarget(args) {
    syncRefUrl();
    if (args.ref) {
      if (LB.refmap.parseRef(args.ref) === null) {
        return fail(ERROR.refStale, "Ref " + args.ref + " is not shaped like e12", "Take a fresh snapshot and use a ref from it");
      }
      var resolved = refs.resolve(args.ref);
      if (!resolved.ok) {
        return fail(ERROR.refStale, "Ref " + args.ref + " is no longer usable", "Take a fresh snapshot and use the new ref");
      }
      return { ok: true, element: resolved.element };
    }
    if (args.selector) {
      var element = adapter.query(document, args.selector);
      if (!element) {
        return fail(ERROR.elementMissing, "No element matches " + args.selector, "Take a snapshot to find a ref, or check the selector");
      }
      return { ok: true, element: element };
    }
    return fail(ERROR.protocolError, "Pass ref or selector", "Take a snapshot and use the ref it returns");
  }

  function safeScrollIntoView(element) {
    try {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } catch (error) {
      try {
        element.scrollIntoView();
      } catch (inner) {}
    }
  }

  function pointOf(element) {
    var rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  var HIT_TESTED_ACTIONS = { click: true, dblclick: true, hover: true, check: true, uncheck: true, type: true };

  function hitAtPoint(x, y) {
    if (typeof document.elementFromPoint !== "function") return undefined;
    try {
      return document.elementFromPoint(x, y);
    } catch (error) {
      return undefined;
    }
  }

  function viewportOf() {
    return { width: window.innerWidth || 0, height: window.innerHeight || 0 };
  }

  function hitVerdict(element) {
    var point = pointOf(element);
    var hit = hitAtPoint(point.x, point.y);
    return { verdict: LB.hit.hitTestVerdict(element, hit, point, viewportOf()), hit: hit, point: point };
  }

  function ensureReachable(element, action) {
    if (HIT_TESTED_ACTIONS[action] !== true) return null;
    var result = hitVerdict(element);
    if (result.verdict === "allow") return null;
    if (result.verdict === "offscreen") {
      safeScrollIntoView(element);
      result = hitVerdict(element);
      if (result.verdict === "allow") return null;
      if (result.verdict === "offscreen") {
        return fail(
          ERROR.elementMissing,
          "This target stays outside the visible page area, so a real click could not land on it",
          "Scroll the page yourself, or take a fresh snapshot and pick a target that is on screen"
        );
      }
    }
    return fail(
      ERROR.elementMissing,
      "Another element covers this target, so a real click would hit " + LB.hit.describeBlock(result.hit),
      "Take a fresh snapshot: the covering element is probably the one to act on"
    );
  }

  function scrollContainerOf(element) {
    var node = element;
    while (node && node !== document.body && node !== document.documentElement) {
      var style = LB.dom.adapter.style(node);
      var metrics = LB.dom.adapter.scrollMetrics(node);
      var canScrollY = style.overflowY === "auto" || style.overflowY === "scroll";
      var canScrollX = style.overflowX === "auto" || style.overflowX === "scroll";
      if ((canScrollY && metrics.scrollHeight > metrics.clientHeight) || (canScrollX && metrics.scrollWidth > metrics.clientWidth)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function scrollWithin(element, deltaX, deltaY) {
    var container = scrollContainerOf(element);
    if (container) {
      container.scrollBy({ top: deltaY, left: deltaX, behavior: "instant" });
      return true;
    }
    window.scrollBy({ top: deltaY, left: deltaX, behavior: "instant" });
    return false;
  }

  function pointerSequence(element, detail) {
    var point = pointOf(element);
    var base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      detail: detail || 1
    };
    element.dispatchEvent(new PointerEvent("pointerover", base));
    element.dispatchEvent(new MouseEvent("mouseover", base));
    element.dispatchEvent(new PointerEvent("pointermove", base));
    element.dispatchEvent(new MouseEvent("mousemove", base));
    element.dispatchEvent(new PointerEvent("pointerdown", Object.assign({}, base, { buttons: 1 })));
    element.dispatchEvent(new MouseEvent("mousedown", Object.assign({}, base, { buttons: 1 })));
    element.dispatchEvent(new PointerEvent("pointerup", base));
    element.dispatchEvent(new MouseEvent("mouseup", base));
  }

  function needsNativeActivation(element) {
    var tag = element.tagName.toLowerCase();
    if (tag === "button" || tag === "label" || tag === "summary") return true;
    if (tag === "a") return element.hasAttribute("href");
    if (tag === "input") {
      var type = (element.type || "text").toLowerCase();
      return ["submit", "button", "reset", "checkbox", "radio", "file", "image"].indexOf(type) !== -1;
    }
    return false;
  }

  function activate(element) {
    if (needsNativeActivation(element) && typeof element.click === "function") {
      element.click();
      return;
    }
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window, button: 0, detail: 1 })
    );
  }

  function click(element) {
    pointerSequence(element, 1);
    activate(element);
  }

  function dblclick(element) {
    pointerSequence(element, 1);
    pointerSequence(element, 2);
    activate(element);
    element.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, composed: true, view: window, button: 0, detail: 2 })
    );
  }

  function hover(element) {
    var point = pointOf(element);
    var base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: point.x, clientY: point.y };
    element.dispatchEvent(new PointerEvent("pointerover", base));
    element.dispatchEvent(new MouseEvent("mouseover", base));
    element.dispatchEvent(new PointerEvent("pointerenter", Object.assign({}, base, { bubbles: false })));
    element.dispatchEvent(new MouseEvent("mouseenter", Object.assign({}, base, { bubbles: false })));
    element.dispatchEvent(new PointerEvent("pointermove", base));
    element.dispatchEvent(new MouseEvent("mousemove", base));
  }

  var KEY_CODES = {
    Enter: 13,
    Tab: 9,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    " ": 32,
    Space: 32
  };

  function keyboardEvent(type, key, cancelable) {
    var code = KEY_CODES[key];
    var event = new KeyboardEvent(type, {
      key: key === "Space" ? " " : key,
      bubbles: true,
      cancelable: cancelable !== false,
      composed: true,
      view: window,
      shiftKey: key.length === 1 && key !== key.toLowerCase()
    });
    if (typeof code === "number") {
      Object.defineProperty(event, "keyCode", { get: function () { return code; } });
      Object.defineProperty(event, "which", { get: function () { return code; } });
    }
    return event;
  }

  function pressKey(element, key) {
    if (!key) return false;
    var target = element || document.activeElement || document.body;
    var down = keyboardEvent("keydown", key, true);
    var allowed = target.dispatchEvent(down);
    var handled = down.defaultPrevented || allowed === false;
    if (key === "Enter" && !handled) {
      var form = target.form || (target.closest ? target.closest("form") : null);
      if (form && typeof form.requestSubmit === "function") {
        try {
          form.requestSubmit();
          handled = true;
        } catch (error) {}
      }
    }
    if (typeof key === "string" && key.length === 1) {
      target.dispatchEvent(keyboardEvent("keypress", key, true));
    }
    target.dispatchEvent(keyboardEvent("keyup", key, true));
    return handled;
  }

  function typeInto(element, value) {
    if (typeof element.focus === "function") element.focus();
    var isField = element.tagName === "INPUT" || element.tagName === "TEXTAREA";
    if (!isField && element.isContentEditable !== true) return false;
    if (element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      return true;
    }
    var prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && typeof descriptor.set === "function") descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setChecked(element, wanted) {
    if (!("checked" in element)) return;
    if (element.checked === wanted) return;
    element.click();
    if (element.checked !== wanted) {
      element.checked = wanted;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function selectOptions(element, args) {
    var wanted = [];
    if (args.values && args.values.length) wanted = args.values.slice();
    else if (args.value !== undefined) wanted = [args.value];
    if (!element.options) return false;
    for (var index = 0; index < element.options.length; index += 1) {
      var option = element.options[index];
      var matches =
        wanted.indexOf(option.value) !== -1 || wanted.indexOf((option.textContent || "").trim()) !== -1;
      if (matches) option.selected = true;
      else if (!element.multiple) option.selected = false;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function observeChange(beforeUrl, beforeMutations, windowMs) {
    var deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      if (location.href !== beforeUrl) return true;
      if (mutationCount > beforeMutations) return true;
      await sleep(40);
    }
    return location.href !== beforeUrl || mutationCount > beforeMutations;
  }

  async function opAct(args) {
    var target = resolveTarget(args);
    if (!target.ok) return target;
    var element = target.element;

    if (args.action !== "scroll") safeScrollIntoView(element);
    var blocked = args.force === true ? null : ensureReachable(element, args.action);
    if (blocked) return blocked;

    var beforeUrl = location.href;
    var beforeMutations = mutationCount;

    switch (args.action) {
      case "click":
        click(element);
        break;
      case "dblclick":
        dblclick(element);
        break;
      case "hover":
        hover(element);
        break;
      case "focus":
        if (typeof element.focus === "function") element.focus();
        break;
      case "type":
        if (!typeInto(element, args.text === undefined || args.text === null ? "" : String(args.text))) {
          return fail(
            ERROR.unsupported,
            "This element cannot take text",
            "Type into an input, textarea or contenteditable element"
          );
        }
        if (args.submit) pressKey(element, "Enter");
        break;
      case "press":
        pressKey(element, args.key);
        break;
      case "check":
        setChecked(element, true);
        break;
      case "uncheck":
        setChecked(element, false);
        break;
      case "select":
        if (!selectOptions(element, args)) {
          return fail(ERROR.unsupported, "This element is not a select", "Target a <select> element");
        }
        break;
      case "scroll":
        scrollWithin(element, args.deltaX || 0, args.deltaY || 0);
        break;
      case "scroll_into_view":
        safeScrollIntoView(element);
        break;
      default:
        return fail(ERROR.protocolError, "Unknown action " + String(args.action), "Use one of the documented actions");
    }

    var changed = await observeChange(beforeUrl, beforeMutations, 300);
    return {
      ok: true,
      result: { ok: true, url: location.href, title: document.title, changed: changed }
    };
  }

  function canTakeText(element) {
    return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable === true;
  }

  function opActPrepare(args) {
    var target = resolveTarget(args);
    if (!target.ok) return target;
    var element = target.element;
    if (args.action === "type" && !canTakeText(element)) {
      return fail(ERROR.unsupported, "This element cannot take text", "Type into an input, textarea or contenteditable element");
    }
    safeScrollIntoView(element);
    var prepared = { url: location.href, mutations: mutationCount, covered: false };
    if (args.action === "press") {
      if (typeof element.focus === "function") element.focus();
      return { ok: true, result: prepared };
    }
    if (args.force === true) {
      prepared.covered = hitVerdict(element).verdict !== "allow";
    } else {
      var blocked = ensureReachable(element, args.action);
      if (blocked) return blocked;
    }
    if ((args.action === "check" || args.action === "uncheck") && "checked" in element) {
      prepared.done = element.checked === (args.action === "check");
    }
    var point = pointOf(element);
    prepared.x = Math.round(point.x);
    prepared.y = Math.round(point.y);
    return { ok: true, result: prepared };
  }

  async function opActSettle(args) {
    var changed = await observeChange(String(args.url || ""), typeof args.mutations === "number" ? args.mutations : mutationCount, 300);
    return { ok: true, result: { ok: true, url: location.href, title: document.title, changed: changed } };
  }

  function opSnapshot(args) {
    var urlChanged = syncRefUrl();
    var cursorState = LB.cursor.parseCursor(args.cursor);
    var honoured = cursorState.provided && cursorState.valid && !urlChanged;
    if (!honoured) refs.reset();
    var built = LB.snapshot.buildSnapshot(adapter, {
      selector: args.selector,
      maxNodes: args.maxNodes,
      includeText: args.includeText,
      includeHidden: args.includeHidden,
      cursor: honoured ? args.cursor : undefined,
      refs: refs
    });
    if (built.missing) {
      return fail(ERROR.elementMissing, "No element matches " + String(args.selector), "Check the selector, or take an unscoped snapshot");
    }
    if (built.cursorStale) {
      refs.reset();
      var fresh = LB.snapshot.buildSnapshot(adapter, {
        selector: args.selector,
        maxNodes: args.maxNodes,
        includeText: args.includeText,
        includeHidden: args.includeHidden,
        refs: refs
      });
      if (fresh.missing) {
        return fail(ERROR.elementMissing, "No element matches " + String(args.selector), "Check the selector, or take an unscoped snapshot");
      }
      return {
        ok: true,
        result: {
          url: fresh.url,
          title: fresh.title,
          nodes: fresh.nodes,
          truncated: fresh.truncated,
          total: fresh.total,
          cursor: fresh.cursor,
          cursorReset: true,
          note: "The page changed and the cursor no longer matches; this is a fresh first page"
        }
      };
    }
    return {
      ok: true,
      result: {
        url: built.url,
        title: built.title,
        nodes: built.nodes,
        truncated: built.truncated,
        total: built.total,
        cursor: built.cursor,
        offset: built.offset,
        cursorIgnored: cursorState.provided && (!cursorState.valid || urlChanged)
      }
    };
  }

  function opRead(args) {
    var format = args.format || "text";
    var maxChars = LB.text.clampInt(args.maxChars, DEFAULTS.textChars, 1, Number.MAX_SAFE_INTEGER);
    var raw;

    if (format === "html") {
      var root = args.selector ? adapter.query(document, args.selector) : adapter.getRoot();
      if (!root) return fail(ERROR.elementMissing, "No element matches " + String(args.selector), "Check the selector");
      raw = adapter.innerHTML(root);
    } else if (format === "markdown") {
      var rendered = LB.markdown.renderMarkdown(adapter, { selector: args.selector });
      if (rendered.missing) return fail(ERROR.elementMissing, "No element matches " + String(args.selector), "Check the selector");
      raw = rendered.text;
    } else {
      var plain = LB.markdown.toText(adapter, { selector: args.selector });
      if (plain.missing) return fail(ERROR.elementMissing, "No element matches " + String(args.selector), "Check the selector");
      raw = plain.text;
    }

    var totalChars = raw.length;
    var truncated = totalChars > maxChars;
    return {
      ok: true,
      result: {
        url: location.href,
        title: document.title,
        format: format,
        text: truncated ? raw.slice(0, maxChars) : raw,
        truncated: truncated,
        totalChars: totalChars
      }
    };
  }

  function pageIdle() {
    if (document.readyState !== "complete") return false;
    return Date.now() - lastMutationAt >= 500;
  }

  async function opWait(args) {
    var timeoutMs = LB.text.clampInt(args.timeoutMs, DEFAULTS.waitTimeoutMs, 100, Number.MAX_SAFE_INTEGER);
    var started = Date.now();
    var deadline = started + timeoutMs;

    function matched() {
      if (args.selector && !adapter.query(document, args.selector)) return false;
      if (args.text) {
        var haystack = document.body ? document.body.innerText || document.body.textContent || "" : "";
        if (haystack.indexOf(args.text) === -1) return false;
      }
      if (args.urlIncludes && location.href.indexOf(args.urlIncludes) === -1) return false;
      if (args.idle && !pageIdle()) return false;
      return true;
    }

    while (Date.now() < deadline) {
      if (matched()) {
        return {
          ok: true,
          result: { matched: true, elapsedMs: Date.now() - started, url: location.href, title: document.title }
        };
      }
      await sleep(100);
    }

    return {
      ok: true,
      result: { matched: false, elapsedMs: Date.now() - started, url: location.href, title: document.title }
    };
  }

  function opStorage(args) {
    var store;
    try {
      store = args.kind === "session" ? window.sessionStorage : window.localStorage;
    } catch (error) {
      return fail(ERROR.unsupported, "This page blocks storage access", "The page may be sandboxed or third-party");
    }
    if (args.op === "get") {
      var entries = [];
      for (var index = 0; index < store.length; index += 1) {
        var name = store.key(index);
        entries.push({ name: name, value: store.getItem(name) });
      }
      return { ok: true, result: { kind: args.kind, op: "get", entries: entries } };
    }
    if (args.op === "set") {
      var pairs = args.entries || [];
      pairs.forEach(function (entry) {
        store.setItem(entry.name, entry.value);
      });
      return { ok: true, result: { kind: args.kind, op: "set", count: pairs.length } };
    }
    store.clear();
    return { ok: true, result: { kind: args.kind, op: "clear", count: 0 } };
  }

  function opViewport() {
    return {
      ok: true,
      result: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      }
    };
  }

  function opElementRect(args) {
    var target = resolveTarget(args);
    if (!target.ok) return target;
    var element = target.element;
    safeScrollIntoView(element);
    var rect = element.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var left = Math.max(0, rect.left);
    var top = Math.max(0, rect.top);
    var width = Math.min(rect.width, window.innerWidth - left);
    var height = Math.min(rect.height, window.innerHeight - top);
    return {
      ok: true,
      result: {
        x: left,
        y: top,
        width: Math.max(0, width),
        height: Math.max(0, height),
        dpr: dpr,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }
    };
  }

  function opUploadTarget(args) {
    var target = resolveTarget(args);
    if (!target.ok) return target;
    var selector = LB.dom.cssPath(target.element);
    if (!selector) {
      return fail(ERROR.elementMissing, "Could not build a selector for that element", "Pass a selector for the file input instead");
    }
    return { ok: true, result: { selector: selector, tagName: target.element.tagName.toLowerCase() } };
  }

  var lastPointer = null;

  function modifierState(args) {
    return {
      altKey: args.alt === true,
      ctrlKey: args.ctrl === true,
      metaKey: args.meta === true,
      shiftKey: args.shift === true
    };
  }

  function syntheticKeyEvent(type, args) {
    var key = String(args.key || "");
    var code = KEY_CODES[key];
    var event = new KeyboardEvent(type, Object.assign(
      {
        key: key === "Space" ? " " : key,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      },
      modifierState(args)
    ));
    if (typeof code === "number") {
      Object.defineProperty(event, "keyCode", { get: function () { return code; } });
      Object.defineProperty(event, "which", { get: function () { return code; } });
    }
    return event;
  }

  function insertText(text) {
    if (!text) return false;
    var active = document.activeElement;
    if (!active) return false;
    var tag = active.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (typeof active.setRangeText === "function") {
        var start = active.selectionStart === null ? active.value.length : active.selectionStart;
        var end = active.selectionEnd === null ? start : active.selectionEnd;
        active.setRangeText(text, start, end, "end");
      } else {
        active.value = (active.value || "") + text;
      }
      active.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }
    if (active.isContentEditable) {
      if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return true;
      active.textContent = (active.textContent || "") + text;
      active.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }
    return false;
  }

  function hitAt(x, y) {
    if (typeof document.elementFromPoint === "function") {
      var found = null;
      try {
        found = document.elementFromPoint(x, y);
      } catch (error) {}
      if (found) return found;
    }
    return document.body;
  }

  function opInputFallback(args) {
    var kind = args.kind;
    if (kind === "mouse") {
      var pointX = typeof args.x === "number" ? args.x : 0;
      var pointY = typeof args.y === "number" ? args.y : 0;
      var hit = hitAt(pointX, pointY);
      var buttonIndex = args.button === "right" ? 2 : args.button === "middle" ? 1 : 0;
      var detail = typeof args.clickCount === "number" ? args.clickCount : 1;
      var base = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: pointX,
        clientY: pointY,
        button: buttonIndex,
        detail: detail
      };
      if (args.action === "move") {
        hit.dispatchEvent(new PointerEvent("pointermove", base));
        hit.dispatchEvent(new MouseEvent("mousemove", base));
      } else if (args.action === "down") {
        hit.dispatchEvent(new PointerEvent("pointerdown", Object.assign({}, base, { buttons: 1 })));
        hit.dispatchEvent(new MouseEvent("mousedown", Object.assign({}, base, { buttons: 1 })));
        lastPointer = { element: hit, x: pointX, y: pointY, at: Date.now() };
      } else if (args.action === "up") {
        hit.dispatchEvent(new PointerEvent("pointerup", base));
        hit.dispatchEvent(new MouseEvent("mouseup", base));
        if (lastPointer && lastPointer.element === hit && Date.now() - lastPointer.at < 700) {
          hit.dispatchEvent(new MouseEvent("click", base));
        }
        lastPointer = null;
      } else {
        return fail(ERROR.protocolError, "mouse action must be move, down or up", "Send a viewer input frame from the UI");
      }
      return { ok: true, result: { ok: true, mode: "synthetic" } };
    }
    if (kind === "wheel") {
      var target = hitAt(args.x || 0, args.y || 0);
      target.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: args.deltaX || 0,
          deltaY: args.deltaY || 0
        })
      );
      window.scrollBy({ top: args.deltaY || 0, left: args.deltaX || 0, behavior: "instant" });
      return { ok: true, result: { ok: true, mode: "synthetic" } };
    }
    if (kind === "key") {
      var target2 = document.activeElement || document.body;
      if (args.action === "up") {
        target2.dispatchEvent(syntheticKeyEvent("keyup", args));
        return { ok: true, result: { ok: true, mode: "synthetic" } };
      }
      if (args.action !== "down") {
        return fail(ERROR.protocolError, "key action must be down or up", "Send a viewer input frame from the UI");
      }
      var key = String(args.key || "");
      var chord = args.ctrl === true || args.meta === true;
      var fallbackText = key.length === 1 ? (args.shift === true ? key.toUpperCase() : key) : "";
      var text = chord ? "" : typeof args.text === "string" ? args.text : fallbackText;
      var down = syntheticKeyEvent("keydown", args);
      var allowed = target2.dispatchEvent(down);
      var handled = down.defaultPrevented || allowed === false;
      if (key.length === 1 && !chord) target2.dispatchEvent(syntheticKeyEvent("keypress", args));
      if (text) {
        insertText(text);
      } else if (key === "Enter" && !handled) {
        var form = target2.form || (target2.closest ? target2.closest("form") : null);
        if (form && typeof form.requestSubmit === "function") {
          try {
            form.requestSubmit();
          } catch (error) {}
        }
      }
      return { ok: true, result: { ok: true, mode: "synthetic" } };
    }
    return fail(ERROR.protocolError, "Unknown input kind " + String(kind), "Use mouse, wheel or key");
  }

  function documentState() {
    if (!LB.documentState || typeof LB.documentState.read !== "function") return null;
    try {
      return LB.documentState.read();
    } catch (error) {
      return null;
    }
  }

  function withDocument(response) {
    if (response && response.ok === true && response.result && typeof response.result === "object") {
      response.result.document = documentState();
    }
    return response;
  }

  function handle(message) {
    var args = message.args || {};
    switch (message.op) {
      case "snapshot":
        return Promise.resolve(withDocument(opSnapshot(args)));
      case "act":
        return opAct(args);
      case "actPrepare":
        return Promise.resolve(opActPrepare(args));
      case "actSettle":
        return opActSettle(args);
      case "read":
        return Promise.resolve(withDocument(opRead(args)));
      case "wait":
        return opWait(args).then(withDocument);
      case "documentState":
        return Promise.resolve({ ok: true, result: documentState() });
      case "storage":
        return Promise.resolve(opStorage(args));
      case "elementRect":
        return Promise.resolve(opElementRect(args));
      case "viewport":
        return Promise.resolve(opViewport());
      case "uploadTarget":
        return Promise.resolve(opUploadTarget(args));
      case "inputFallback":
        return Promise.resolve(opInputFallback(args));
      default:
        return Promise.resolve(fail(ERROR.unsupported, "Unknown page operation " + String(message.op), "Update the extension"));
    }
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "lb:rpc") return false;
    var senderTab = sender && sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null;
    var ownTab = senderTab !== null ? senderTab : tabId;
    if (ownTab !== null && typeof message.tabId === "number" && message.tabId !== ownTab) return false;
    handle(message).then(
      function (result) {
        sendResponse(result);
      },
      function (error) {
        sendResponse(fail(ERROR.protocolError, String((error && error.message) || error)));
      }
    );
    return true;
  });

  try {
    chrome.runtime.sendMessage({ type: "lb:frame-ready" }, function (response) {
      if (chrome.runtime.lastError) return;
      if (response && typeof response.tabId === "number") {
        tabId = response.tabId;
        frameId = response.frameId;
      }
    });
  } catch (error) {}
})();
