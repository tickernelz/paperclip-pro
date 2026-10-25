(function () {
  "use strict";

  if (globalThis.__lbAgentLoaded) return;
  globalThis.__lbAgentLoaded = true;

  var LB = globalThis.LB;
  var protocol = LB.protocol;
  var text = LB.text;
  var refmap = LB.refmap;
  var snapshotLib = LB.snapshot;
  var markdownLib = LB.markdown;
  var dom = LB.dom;
  var keys = LB.keys;
  var adapter = dom.adapter;

  var refs = refmap.createRefMap();
  var refUrl = location.href;
  var mutationCount = 0;
  var mutationObserver = null;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function clampInt(value, fallback, min, max) {
    return text.clampInt(value, fallback, min, max);
  }

  function fail(code, message, hint, retryable) {
    return protocol.error(code, message, { hint: hint, retryable: retryable });
  }

  function syncRefs() {
    if (location.href !== refUrl) {
      refs.reset();
      refUrl = location.href;
      return true;
    }
    return false;
  }

  function trackMutations() {
    if (mutationObserver || typeof MutationObserver !== "function") return;
    mutationObserver = new MutationObserver(function () {
      mutationCount += 1;
    });
    var scope = document.documentElement;
    if (!scope) return;
    mutationObserver.observe(scope, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  trackMutations();

  function activitySignature() {
    var resources = 0;
    try {
      resources = performance.getEntriesByType("resource").length;
    } catch (error) {
      resources = 0;
    }
    return { mutations: mutationCount, resources: resources };
  }

  function resolveElement(args) {
    syncRefs();
    if (args && args.ref) {
      var hit = refs.resolve(args.ref);
      if (hit.ok) return hit.element;
      if (hit.reason === "stale") {
        throw fail(protocol.ERROR_CODES.refStale, "Ref " + args.ref + " is stale because the page changed", "Take a fresh snapshot and use its refs", true);
      }
      throw fail(protocol.ERROR_CODES.elementMissing, "Ref " + args.ref + " is not in the current snapshot", "Take a fresh snapshot and use its refs", true);
    }
    if (args && args.selector) {
      var found = adapter.query(document, args.selector);
      if (found) return found;
      throw fail(protocol.ERROR_CODES.elementMissing, "No element matches " + args.selector, "Take a snapshot to see the page", true);
    }
    throw fail(protocol.ERROR_CODES.elementMissing, "Pass ref or selector", "Take a snapshot first", true);
  }

  function centerOf(element) {
    var rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect: rect };
  }

  function mouseEvent(element, type, point, buttons) {
    var init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons: buttons,
      detail: type === "click" || type === "dblclick" ? 1 : 0
    };
    var event;
    if (type.indexOf("pointer") === 0 && typeof PointerEvent === "function") {
      init.pointerId = 1;
      init.pointerType = "mouse";
      init.isPrimary = true;
      event = new PointerEvent(type, init);
    } else {
      event = new MouseEvent(type, init);
    }
    element.dispatchEvent(event);
    return event;
  }

  function hoverSequence(element) {
    var point = centerOf(element);
    mouseEvent(element, "pointerover", point, 0);
    mouseEvent(element, "pointerenter", point, 0);
    mouseEvent(element, "mouseover", point, 0);
    mouseEvent(element, "mouseenter", point, 0);
    mouseEvent(element, "pointermove", point, 0);
    mouseEvent(element, "mousemove", point, 0);
  }

  function pressPointer(element) {
    var point = centerOf(element);
    mouseEvent(element, "pointerdown", point, 1);
    mouseEvent(element, "mousedown", point, 1);
  }

  function releasePointer(element) {
    var point = centerOf(element);
    mouseEvent(element, "pointerup", point, 0);
    mouseEvent(element, "mouseup", point, 0);
  }

  function focusElement(element) {
    if (!element || typeof element.focus !== "function") return;
    try {
      element.focus({ preventScroll: true });
    } catch (error) {
      element.focus();
    }
  }

  function clickElement(element, double) {
    if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "center", inline: "center" });
    focusElement(element);
    hoverSequence(element);
    pressPointer(element);
    releasePointer(element);
    if (typeof element.click === "function") {
      element.click();
    } else {
      mouseEvent(element, "click", centerOf(element), 0);
    }
    if (!double) return;
    pressPointer(element);
    releasePointer(element);
    if (typeof element.click === "function") element.click();
    mouseEvent(element, "dblclick", centerOf(element), 0);
  }

  function valueDescriptor(element) {
    var proto = Object.getPrototypeOf(element);
    var descriptor = null;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      proto = Object.getPrototypeOf(proto);
    }
    return descriptor;
  }

  function setNativeValue(element, value) {
    var descriptor = valueDescriptor(element);
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(element, value);
      return;
    }
    element.value = value;
  }

  function fireInput(element) {
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  function fireChange(element) {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function editableOf(element) {
    if (!element) return null;
    var tag = adapter.tagName(element);
    if (tag === "input" || tag === "textarea") return element;
    if (element.isContentEditable) return element;
    return null;
  }

  function insertTextInto(element, value) {
    var editable = editableOf(element);
    if (!editable) return false;
    focusElement(editable);
    if (adapter.tagName(editable) === "input" || adapter.tagName(editable) === "textarea") {
      setNativeValue(editable, value);
      fireInput(editable);
      fireChange(editable);
      return true;
    }
    var selection = window.getSelection();
    if (selection) {
      var range = document.createRange();
      range.selectNodeContents(editable);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    var inserted = false;
    try {
      inserted = document.execCommand("insertText", false, value);
    } catch (error) {
      inserted = false;
    }
    if (!inserted) editable.textContent = value;
    fireInput(editable);
    fireChange(editable);
    return true;
  }

  function insertAtCaret(element, value) {
    var editable = editableOf(element);
    if (!editable) return false;
    focusElement(editable);
    var tag = adapter.tagName(editable);
    if (tag === "input" || tag === "textarea") {
      var current = typeof editable.value === "string" ? editable.value : "";
      var start = typeof editable.selectionStart === "number" ? editable.selectionStart : current.length;
      var end = typeof editable.selectionEnd === "number" ? editable.selectionEnd : start;
      if (start > end) {
        var swap = start;
        start = end;
        end = swap;
      }
      setNativeValue(editable, current.slice(0, start) + value + current.slice(end));
      var caret = start + value.length;
      if (typeof editable.setSelectionRange === "function") {
        try {
          editable.setSelectionRange(caret, caret);
        } catch (error) {
          void error;
        }
      }
      fireInput(editable);
      return true;
    }
    var inserted = false;
    try {
      inserted = document.execCommand("insertText", false, value);
    } catch (error) {
      inserted = false;
    }
    if (!inserted) editable.textContent = (editable.textContent || "") + value;
    fireInput(editable);
    return true;
  }

  function pressKey(element, name) {
    var info = keys.resolve(name);
    var target = element || document.activeElement || document.body;
    if (!target) return;
    var init = {
      key: info.key,
      code: info.code,
      keyCode: info.keyCode,
      which: info.keyCode,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    var down = new KeyboardEvent("keydown", init);
    target.dispatchEvent(down);
    if (!info.modifier && info.key.length === 1) {
      insertTextInto(target, info.key);
      target.dispatchEvent(new KeyboardEvent("keypress", init));
    }
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    if (info.key === "Enter" || info.key === " ") {
      var tag = adapter.tagName(target);
      var role = adapter.attr(target, "role") || "";
      if (tag === "button" || tag === "a" || role === "button" || role === "link") {
        if (typeof target.click === "function") target.click();
        return;
      }
      if (info.key === "Enter" && tag === "input" && target.form && typeof target.form.requestSubmit === "function") {
        target.form.requestSubmit();
      }
    }
  }

  function selectValues(element, values) {
    var wanted = Array.isArray(values) && values.length ? values : [];
    var tag = adapter.tagName(element);
    if (tag !== "select") {
      throw fail(protocol.ERROR_CODES.elementMissing, "select needs a select element, found " + (tag || "unknown"), "Take a snapshot and target the dropdown", false);
    }
    var options = Array.prototype.slice.call(element.options || []);
    var matched = 0;
    for (var i = 0; i < options.length; i += 1) {
      var option = options[i];
      var hit = wanted.indexOf(option.value) !== -1 || wanted.indexOf(option.text) !== -1;
      if (hit) matched += 1;
      if (element.multiple) {
        option.selected = hit;
      } else if (hit) {
        option.selected = true;
      }
    }
    if (!matched) {
      throw fail(protocol.ERROR_CODES.elementMissing, "No option matches " + wanted.join(", "), "Read the select options from a snapshot first", true);
    }
    fireInput(element);
    fireChange(element);
    return matched;
  }

  function pageSignature() {
    return {
      url: location.href,
      title: document.title,
      elements: document.getElementsByTagName("*").length
    };
  }

  async function settleChange(before, budgetMs) {
    var deadline = Date.now() + clampInt(budgetMs, 400, 0, 3000);
    var changed = false;
    while (Date.now() <= deadline) {
      var now = pageSignature();
      if (now.url !== before.url || now.title !== before.title || now.elements !== before.elements) {
        changed = true;
        break;
      }
      await sleep(50);
    }
    return { ok: true, url: location.href, title: document.title, changed: changed };
  }

  async function act(args) {
    var action = args.action;
    var before = pageSignature();
    if (action === "scroll") {
      var deltaY = typeof args.deltaY === "number" ? args.deltaY : 0;
      var deltaX = typeof args.deltaX === "number" ? args.deltaX : 0;
      if (args.ref || args.selector) {
        var scroller = resolveElement(args);
        scroller.scrollBy({ top: deltaY, left: deltaX, behavior: "instant" });
      } else {
        window.scrollBy({ top: deltaY, left: deltaX, behavior: "instant" });
      }
      return settleChange(before, 120);
    }

    var element = resolveElement(args);

    switch (action) {
      case "click":
        clickElement(element, false);
        break;
      case "dblclick":
        clickElement(element, true);
        break;
      case "hover":
        hoverSequence(element);
        break;
      case "focus":
        focusElement(element);
        break;
      case "type":
        if (!insertTextInto(element, typeof args.text === "string" ? args.text : "")) {
          throw fail(protocol.ERROR_CODES.elementMissing, "type needs an input, textarea or contenteditable element", "Take a snapshot and target a textbox", false);
        }
        if (args.submit === true) pressKey(editableOf(element) || element, "Enter");
        break;
      case "press":
        pressKey(element, args.key || "Enter");
        break;
      case "check":
      case "uncheck": {
        var want = action === "check";
        var isCheckable = typeof element.checked === "boolean";
        if (!isCheckable) {
          throw fail(protocol.ERROR_CODES.elementMissing, action + " needs a checkbox or radio", "Take a snapshot and target a checkbox", false);
        }
        if (element.checked !== want) {
          focusElement(element);
          clickElement(element, false);
        }
        if (element.checked !== want) {
          element.checked = want;
          fireInput(element);
          fireChange(element);
        }
        break;
      }
      case "select":
        selectValues(element, typeof args.value === "string" ? [args.value] : args.values);
        break;
      case "scroll_into_view":
        element.scrollIntoView({ block: "center", inline: "center" });
        break;
      default:
        throw fail(protocol.ERROR_CODES.unsupported, "Unknown action " + String(action), "Use one of click, dblclick, type, press, hover, focus, check, uncheck, select, scroll, scroll_into_view", false);
    }

    return settleChange(before, args.timeoutMs);
  }

  function documentState() {
    return LB.documentState && typeof LB.documentState.read === "function" ? LB.documentState.read() : null;
  }

  function withDocument(result) {
    var state = documentState();
    if (state && result && typeof result === "object") result.document = state;
    return result;
  }

  function readPage(args) {
    var format = args.format || "text";
    var maxChars = typeof args.maxChars === "number" && args.maxChars >= 1 ? Math.floor(args.maxChars) : protocol.DEFAULTS.textChars;
    var url = location.href;
    var title = document.title;
    var start = args.selector ? adapter.query(document, args.selector) : adapter.getRoot();
    if (!start) {
      return { url: url, title: title, format: format, text: "", truncated: false, totalChars: 0, missing: true };
    }
    var body = "";
    if (format === "html") {
      body = adapter.innerHTML(start);
    } else if (format === "markdown") {
      body = markdownLib.renderMarkdown(adapter, { selector: args.selector }).text;
    } else {
      body = markdownLib.toText(adapter, { selector: args.selector }).text;
    }
    var totalChars = body.length;
    var truncated = totalChars > maxChars;
    return {
      url: url,
      title: title,
      format: format,
      text: truncated ? body.slice(0, maxChars) : body,
      truncated: truncated,
      totalChars: totalChars
    };
  }

  async function waitFor(args) {
    var timeoutMs = clampInt(args.timeoutMs, protocol.DEFAULTS.waitTimeoutMs, 100, Number.MAX_SAFE_INTEGER);
    var start = Date.now();
    var wantSelector = typeof args.selector === "string" && args.selector;
    var wantText = typeof args.text === "string" && args.text;
    var wantUrl = typeof args.urlIncludes === "string" && args.urlIncludes;
    var wantIdle = args.idle === true || (!wantSelector && !wantText && !wantUrl);
    var lastSignature = activitySignature();
    var quietSince = Date.now();

    while (true) {
      if (wantSelector && adapter.query(document, args.selector)) {
        return { matched: true, condition: "selector", elapsedMs: Date.now() - start, url: location.href, title: document.title };
      }
      if (wantText) {
        var haystack = document.body ? document.body.innerText || "" : "";
        if (haystack.indexOf(args.text) !== -1) {
          return { matched: true, condition: "text", elapsedMs: Date.now() - start, url: location.href, title: document.title };
        }
      }
      if (wantUrl && location.href.indexOf(args.urlIncludes) !== -1) {
        return { matched: true, condition: "url", elapsedMs: Date.now() - start, url: location.href, title: document.title };
      }
      if (wantIdle) {
        var signature = activitySignature();
        if (signature.mutations !== lastSignature.mutations || signature.resources !== lastSignature.resources) {
          lastSignature = signature;
          quietSince = Date.now();
        }
        if (document.readyState === "complete" && Date.now() - quietSince >= 400) {
          return { matched: true, condition: "idle", elapsedMs: Date.now() - start, url: location.href, title: document.title };
        }
      }
      if (Date.now() - start >= timeoutMs) {
        return {
          matched: false,
          elapsedMs: Date.now() - start,
          url: location.href,
          title: document.title,
          note: "Nothing matched within " + timeoutMs + "ms; take a snapshot to see the current page, or raise timeoutMs"
        };
      }
      await sleep(100);
    }
  }

  function storageArea(kind) {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  }

  function storageOp(args) {
    var kind = args.kind;
    if (kind !== "local" && kind !== "session") {
      throw fail(protocol.ERROR_CODES.unsupported, "storage kind must be local or session", "Cookies go through the extension", false);
    }
    var area = storageArea(kind);
    var op = args.op;
    if (op === "get") {
      if (args.name) {
        var single = area.getItem(args.name);
        return { kind: kind, op: op, entries: single === null ? [] : [{ name: args.name, value: single }] };
      }
      var entries = [];
      for (var i = 0; i < area.length; i += 1) {
        var name = area.key(i);
        entries.push({ name: name, value: area.getItem(name) });
      }
      return { kind: kind, op: op, entries: entries };
    }
    if (op === "set") {
      var writes = Array.isArray(args.entries) ? args.entries : [];
      for (var w = 0; w < writes.length; w += 1) area.setItem(writes[w].name, writes[w].value);
      return { kind: kind, op: op, count: writes.length };
    }
    if (op === "clear") {
      if (args.name) {
        area.removeItem(args.name);
        return { kind: kind, op: op, count: 1 };
      }
      var size = area.length;
      area.clear();
      return { kind: kind, op: op, count: size };
    }
    throw fail(protocol.ERROR_CODES.unsupported, "Unknown storage op " + String(op), "Use get, set or clear", false);
  }

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function uploadFiles(args) {
    var element = resolveElement(args);
    if (adapter.tagName(element) !== "input" || (adapter.attr(element, "type") || "").toLowerCase() !== "file") {
      throw fail(protocol.ERROR_CODES.elementMissing, "upload needs a file input", "Take a snapshot and target the file input", false);
    }
    var incoming = Array.isArray(args.files) ? args.files : [];
    if (!incoming.length) {
      throw fail(protocol.ERROR_CODES.unsupported, "No file bytes arrived with the call", "Attach the file to the task and retry", false);
    }
    var transfer = new DataTransfer();
    for (var i = 0; i < incoming.length; i += 1) {
      var entry = incoming[i];
      var bytes = base64ToBytes(entry.base64 || "");
      transfer.items.add(new File([bytes], entry.name || "upload-" + String(i), { type: entry.mimeType || "application/octet-stream" }));
    }
    element.files = transfer.files;
    fireInput(element);
    fireChange(element);
    return { ok: true, count: transfer.files.length, selector: args.selector || null };
  }

  function viewportInfo() {
    var root = document.documentElement;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      docWidth: root ? root.scrollWidth : window.innerWidth,
      docHeight: root ? root.scrollHeight : window.innerHeight
    };
  }

  function elementBox(args) {
    var element = resolveElement(args);
    var rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 };
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result));
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read the image"));
      };
      reader.readAsDataURL(blob);
    });
  }

  async function loadBitmap(dataUrl) {
    var response = await fetch(dataUrl);
    var blob = await response.blob();
    return createImageBitmap(blob);
  }

  function makeCanvas(width, height) {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  async function encodeCanvas(canvas, type, quality) {
    if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type: type, quality: quality });
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode the image"));
      }, type, quality);
    });
  }

  async function cropImage(args) {
    var bitmap = await loadBitmap(args.dataUrl);
    var dpr = typeof args.dpr === "number" && args.dpr > 0 ? args.dpr : 1;
    var width = Math.max(1, Math.round(args.width * dpr));
    var height = Math.max(1, Math.round(args.height * dpr));
    var sx = Math.max(0, Math.round(args.x * dpr));
    var sy = Math.max(0, Math.round(args.y * dpr));
    var canvas = makeCanvas(width, height);
    var context = canvas.getContext("2d");
    context.drawImage(bitmap, sx, sy, width, height, 0, 0, width, height);
    var blob = await encodeCanvas(canvas, "image/png");
    return { dataUrl: await blobToDataUrl(blob), width: width, height: height, dpr: dpr };
  }

  async function stitchFrames(args) {
    var dpr = typeof args.dpr === "number" && args.dpr > 0 ? args.dpr : 1;
    var width = Math.max(1, Math.round(args.width * dpr));
    var height = Math.max(1, Math.round(args.height * dpr));
    var canvas = makeCanvas(width, height);
    var context = canvas.getContext("2d");
    var frames = Array.isArray(args.frames) ? args.frames : [];
    for (var i = 0; i < frames.length; i += 1) {
      var frame = frames[i];
      var bitmap = await loadBitmap(frame.dataUrl);
      var targetWidth = width;
      var targetHeight = Math.round((bitmap.height / bitmap.width) * width);
      context.drawImage(bitmap, 0, Math.round(frame.y * dpr), targetWidth, targetHeight);
      if (typeof bitmap.close === "function") bitmap.close();
    }
    var png = await encodeCanvas(canvas, "image/png");
    var dataUrl = await blobToDataUrl(png);
    if (dataUrl.length > protocol.DEFAULTS.screenshotJpegAboveBytes) {
      var jpeg = await blobToDataUrl(await encodeCanvas(canvas, "image/jpeg", 0.82));
      if (jpeg.length < dataUrl.length) dataUrl = jpeg;
    }
    return { dataUrl: dataUrl, width: width, height: height, dpr: dpr };
  }

  function targetAt(x, y) {
    var element = document.elementFromPoint(x, y);
    return element || document.body || document.documentElement;
  }

  function pointerAt(element, type, x, y, options) {
    var opts = options || {};
    var init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      button: typeof opts.buttonIndex === "number" ? opts.buttonIndex : 0,
      buttons: typeof opts.buttons === "number" ? opts.buttons : 0
    };
    if (opts.modifiers) {
      init.altKey = opts.modifiers.alt === true;
      init.ctrlKey = opts.modifiers.ctrl === true;
      init.metaKey = opts.modifiers.meta === true;
      init.shiftKey = opts.modifiers.shift === true;
    }
    if (type === "click" || type === "dblclick") {
      init.detail = typeof opts.clickCount === "number" ? opts.clickCount : type === "dblclick" ? 2 : 1;
    }
    if (type.indexOf("pointer") === 0 && typeof PointerEvent === "function") {
      init.pointerId = 1;
      init.pointerType = "mouse";
      init.isPrimary = true;
      element.dispatchEvent(new PointerEvent(type, init));
      return;
    }
    element.dispatchEvent(new MouseEvent(type, init));
  }

  var inputState = LB.input.createInputState();
  var BUTTON_MASK = { left: 1, middle: 4, right: 2 };

  function syntheticMouse(plan, args) {
    var x = plan.effects[0].x;
    var y = plan.effects[0].y;
    var element = targetAt(x, y);
    var button = plan.effects[0].button;
    var buttonIndex = plan.effects[0].buttonIndex;
    var clickCount = plan.effects[0].clickCount || 1;

    for (var i = 0; i < plan.effects.length; i += 1) {
      var effect = plan.effects[i];
      if (effect.type === "pointerMove") {
        pointerAt(element, "pointerover", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: 0, modifiers: plan.modifiers });
        pointerAt(element, "pointermove", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: 0, modifiers: plan.modifiers });
        pointerAt(element, "mousemove", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: 0, modifiers: plan.modifiers });
        continue;
      }
      if (effect.type === "pointerDown") {
        focusElement(element);
        pointerAt(element, "pointerdown", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: BUTTON_MASK[button] || 1, modifiers: plan.modifiers });
        pointerAt(element, "mousedown", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: BUTTON_MASK[button] || 1, modifiers: plan.modifiers });
        continue;
      }
      if (effect.type === "pointerUp") {
        pointerAt(element, "pointerup", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: 0, modifiers: plan.modifiers });
        pointerAt(element, "mouseup", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: 0, modifiers: plan.modifiers });
        continue;
      }
      if (effect.type === "click") {
        if (button !== "left") {
          pointerAt(element, "auxclick", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: 0, clickCount: 1, modifiers: plan.modifiers });
          continue;
        }
        pointerAt(element, "click", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: 0, clickCount: effect.clickCount, modifiers: plan.modifiers });
        if (effect.clickCount === 2) {
          pointerAt(element, "dblclick", effect.x, effect.y, { buttonIndex: buttonIndex, buttons: 0, clickCount: 2, modifiers: plan.modifiers });
        }
        continue;
      }
      if (effect.type === "keyUp" && effect.release) {
        dispatchKey("keyup", effect.key, effect.code, null, plan.modifiers);
      }
    }

    return {
      ok: true,
      synthetic: true,
      mode: "synthetic",
      kind: "mouse",
      action: plan.action,
      clicked: plan.clicked,
      released: plan.released
    };
  }

  function dispatchKey(type, keyName, code, insert, modifiers) {
    var info = keys.resolve(keyName);
    var init = {
      key: info.key,
      code: code || info.code,
      keyCode: info.keyCode,
      which: info.keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      altKey: Boolean(modifiers && modifiers.alt),
      ctrlKey: Boolean(modifiers && modifiers.ctrl),
      metaKey: Boolean(modifiers && modifiers.meta),
      shiftKey: Boolean(modifiers && modifiers.shift)
    };
    var target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent(type, init));
    if (type === "keydown" && insert) insertAtCaret(target, insert);
    return target;
  }

  function syntheticWheel(plan) {
    var effect = plan.effects[0];
    var wheelTarget = targetAt(effect.x, effect.y);
    wheelTarget.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: effect.x,
        clientY: effect.y,
        deltaX: effect.deltaX,
        deltaY: effect.deltaY
      })
    );
    window.scrollBy({ top: effect.deltaY, left: effect.deltaX, behavior: "instant" });
    return { ok: true, synthetic: true, mode: "synthetic", kind: "wheel", action: "scroll" };
  }

  function syntheticKey(plan) {
    var released = [];
    for (var i = 0; i < plan.effects.length; i += 1) {
      var effect = plan.effects[i];
      if (effect.type === "keyDown") {
        dispatchKey("keydown", effect.key, effect.code, effect.insert, plan.modifiers);
        if (!effect.modifier && effect.key === "Enter") {
          var target = document.activeElement || document.body;
          var tag = adapter.tagName(target);
          var role = adapter.attr(target, "role") || "";
          if (tag === "button" || role === "button") {
            if (typeof target.click === "function") target.click();
          } else if (tag === "input" && target.form && typeof target.form.requestSubmit === "function") {
            target.form.requestSubmit();
          }
        }
        continue;
      }
      if (effect.type === "keyUp") {
        dispatchKey("keyup", effect.key, effect.code, null, plan.modifiers);
        if (effect.release) released.push(effect.key);
      }
    }
    return {
      ok: true,
      synthetic: true,
      mode: "synthetic",
      kind: "key",
      action: plan.action,
      released: plan.released,
      releasedKeys: released
    };
  }

  function syntheticInput(args) {
    var plan;
    try {
      plan = inputState.apply(args);
    } catch (error) {
      throw fail(protocol.ERROR_CODES.unsupported, error && error.message ? error.message : String(error), "Use the frozen input schema: mouse action move, down or up; key action down or up; wheel", false);
    }
    if (plan.kind === "mouse") return syntheticMouse(plan, args);
    if (plan.kind === "wheel") return syntheticWheel(plan);
    return syntheticKey(plan);
  }

  function snapshotOptions(args, cursor) {
    return {
      selector: args.selector,
      maxNodes: args.maxNodes,
      includeText: args.includeText,
      includeHidden: args.includeHidden,
      cursor: cursor,
      refs: refs
    };
  }

  function snapshot(args) {
    var urlChanged = syncRefs();
    var cursorState = snapshotLib.parseCursor(args.cursor);
    var honoured = cursorState.provided && cursorState.valid && !urlChanged;
    if (!honoured) refs.reset();

    var built = snapshotLib.buildSnapshot(adapter, snapshotOptions(args, honoured ? args.cursor : undefined));
    if (built.missing) {
      throw fail(protocol.ERROR_CODES.elementMissing, "No element matches " + args.selector, "Drop the selector to snapshot the whole page", true);
    }

    if (built.cursorStale) {
      refs.reset();
      var fresh = snapshotLib.buildSnapshot(adapter, snapshotOptions(args, undefined));
      if (fresh.missing) {
        throw fail(protocol.ERROR_CODES.elementMissing, "No element matches " + args.selector, "Drop the selector to snapshot the whole page", true);
      }
      return {
        url: fresh.url,
        title: fresh.title,
        nodes: fresh.nodes,
        truncated: fresh.truncated,
        total: fresh.total,
        cursor: fresh.cursor,
        offset: fresh.offset,
        cursorReset: true,
        note: "The page changed and the cursor no longer matches; this is a fresh first page"
      };
    }

    return {
      url: built.url,
      title: built.title,
      nodes: built.nodes,
      truncated: built.truncated,
      total: built.total,
      cursor: built.cursor,
      offset: built.offset,
      cursorIgnored: cursorState.provided && (!cursorState.valid || urlChanged)
    };
  }

  var OPS = {
    ping: function () {
      return { ok: true, url: location.href, title: document.title };
    },
    viewport: function () {
      return viewportInfo();
    },
    documentState: function () {
      return documentState();
    },
    snapshot: function (args) {
      return withDocument(snapshot(args));
    },
    act: function (args) {
      return act(args);
    },
    read: function (args) {
      return withDocument(readPage(args));
    },
    wait: function (args) {
      return waitFor(args).then(withDocument);
    },
    storage: function (args) {
      return storageOp(args);
    },
    upload: function (args) {
      return uploadFiles(args);
    },
    box: function (args) {
      return elementBox(args);
    },
    crop: function (args) {
      return cropImage(args);
    },
    stitch: function (args) {
      return stitchFrames(args);
    },
    scrollTo: function (args) {
      window.scrollTo({ top: Number(args.y) || 0, left: Number(args.x) || 0, behavior: "instant" });
      return viewportInfo();
    },
    input: function (args) {
      return syntheticInput(args);
    },
    inputReset: function () {
      inputState.reset();
      return { ok: true, reset: true };
    }
  };

  async function handle(message) {
    var op = message.op;
    var handler = OPS[op];
    if (!handler) {
      return { ok: false, error: fail(protocol.ERROR_CODES.unsupported, "Unknown content op " + String(op), "Reload the extension", false) };
    }
    try {
      var result = await handler(message.args || {});
      return { ok: true, result: result };
    } catch (error) {
      if (error && error.code) return { ok: false, error: error };
      return {
        ok: false,
        error: fail(protocol.ERROR_CODES.protocolError, error && error.message ? error.message : String(error), "Retry the call, or take a fresh snapshot", true)
      };
    }
  }

  browser.runtime.onMessage.addListener(function (message) {
    if (!message || message.channel !== "lb") return undefined;
    return handle(message);
  });
})();
