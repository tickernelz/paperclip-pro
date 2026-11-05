(function (root) {
  "use strict";

  var text = root.LB.text;
  var refmap = root.LB.refmap;
  var MAX_NODES_GUARD = 1000000;

  var SKIP_TAGS = new Set([
    "script",
    "style",
    "noscript",
    "template",
    "meta",
    "link",
    "head",
    "title",
    "base",
    "svg",
    "canvas",
    "object",
    "embed",
    "video",
    "audio",
    "source",
    "track",
    "map",
    "area"
  ]);

  var FRAME_TAGS = new Set(["iframe", "frame"]);

  var IMPLICIT_ROLES = {
    a: "link",
    button: "button",
    summary: "button",
    textarea: "textbox",
    option: "option",
    optgroup: "group",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
    img: "img",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    aside: "complementary",
    form: "form",
    search: "search",
    dialog: "dialog",
    table: "table",
    tr: "row",
    td: "cell",
    th: "columnheader",
    ul: "list",
    ol: "list",
    li: "listitem",
    label: "label",
    fieldset: "group",
    details: "group",
    article: "article",
    section: "region"
  };

  var INPUT_ROLES = {
    text: "textbox",
    search: "textbox",
    email: "textbox",
    tel: "textbox",
    url: "textbox",
    password: "textbox",
    number: "textbox",
    date: "textbox",
    "datetime-local": "textbox",
    month: "textbox",
    time: "textbox",
    week: "textbox",
    checkbox: "checkbox",
    radio: "radio",
    submit: "button",
    button: "button",
    reset: "button",
    image: "button",
    file: "button",
    range: "slider",
    color: "button",
    hidden: null
  };

  var ARIA_ROLES = new Set([
    "link",
    "button",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "switch",
    "combobox",
    "listbox",
    "option",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "tabpanel",
    "heading",
    "img",
    "dialog",
    "alertdialog",
    "navigation",
    "main",
    "banner",
    "contentinfo",
    "complementary",
    "form",
    "search",
    "table",
    "row",
    "cell",
    "columnheader",
    "rowheader",
    "grid",
    "list",
    "listitem",
    "group",
    "alert",
    "status",
    "progressbar",
    "slider",
    "spinbutton",
    "separator",
    "tooltip"
  ]);

  var INTERACTIVE_ROLES = new Set([
    "link",
    "button",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "switch",
    "combobox",
    "listbox",
    "option",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "slider",
    "spinbutton"
  ]);

  function roleFor(adapter, element) {
    var explicit = adapter.attr(element, "role");
    if (explicit) {
      var first = explicit.trim().toLowerCase().split(/\s+/)[0];
      if (ARIA_ROLES.has(first)) return first;
    }
    var tag = adapter.tagName(element);
    if (tag === "input") {
      var type = (adapter.attr(element, "type") || "text").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(INPUT_ROLES, type)) return INPUT_ROLES[type];
      return "textbox";
    }
    if (tag === "select") return adapter.attr(element, "multiple") === null ? "combobox" : "listbox";
    if (tag === "a") return adapter.attr(element, "href") === null ? null : "link";
    if (Object.prototype.hasOwnProperty.call(IMPLICIT_ROLES, tag)) return IMPLICIT_ROLES[tag];
    return null;
  }

  function hiddenReason(adapter, element) {
    if (adapter.attr(element, "hidden") !== null) return "attribute";
    if ((adapter.attr(element, "aria-hidden") || "").toLowerCase() === "true") return "attribute";
    var style = adapter.style(element) || {};
    if (style.display === "none") return "style";
    if (style.visibility === "hidden" || style.visibility === "collapse") return "style";
    if (style.opacity !== undefined && style.opacity !== null && Number(style.opacity) === 0) return "style";
    if (adapter.tagName(element) === "option") return null;
    var rect = adapter.rect(element) || {};
    if (!(rect.width > 0) || !(rect.height > 0)) return overflows(style) ? "empty-box" : "box";
    return null;
  }

  function overflows(style) {
    var x = style.overflowX;
    var y = style.overflowY;
    return (!x || x === "visible") && (!y || y === "visible");
  }

  function isHidden(adapter, element) {
    return hiddenReason(adapter, element) !== null;
  }

  var TEXT_NAME_ROLES = new Set([
    "link",
    "button",
    "heading",
    "img",
    "cell",
    "columnheader",
    "rowheader",
    "listitem",
    "label",
    "tab",
    "option",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "alert",
    "tooltip"
  ]);

  function nodeName(adapter, element, role) {
    var ariaLabel = text.normalizeName(adapter.attr(element, "aria-label") || "");
    if (ariaLabel) return ariaLabel;

    var labelledBy = adapter.attr(element, "aria-labelledby");
    if (labelledBy) {
      var joined = labelledBy
        .split(/\s+/)
        .map(function (id) {
          var target = adapter.getById(id);
          return target ? adapter.textOf(target) : "";
        })
        .join(" ");
      var fromLabel = text.normalizeName(joined);
      if (fromLabel) return fromLabel;
    }

    var label = text.normalizeName(adapter.labelText(element) || "");
    if (label) return label;

    if (role === "img") {
      var alt = text.normalizeName(adapter.attr(element, "alt") || "");
      if (alt) return alt;
    }

    var placeholder = text.normalizeName(adapter.attr(element, "placeholder") || "");
    if (placeholder) return placeholder;

    var tag = adapter.tagName(element);
    if (tag === "input" || tag === "button") {
      var controlValue = text.normalizeName(adapter.attr(element, "value") || "");
      if (controlValue) return controlValue;
    }

    var title = text.normalizeName(adapter.attr(element, "title") || "");
    if (title) return title;

    if (TEXT_NAME_ROLES.has(role)) {
      var content = text.normalizeName(adapter.textOf(element));
      if (content) return content;
    }

    return text.normalizeName(adapter.attr(element, "name") || "");
  }

  function nodeState(adapter, element, role) {
    var state = {};
    if (role === "textbox" || role === "searchbox" || role === "slider" || role === "spinbutton") {
      var type = (adapter.attr(element, "type") || "").toLowerCase();
      if (type !== "password") {
        var value = adapter.valueOf(element);
        if (typeof value === "string" && value) state.value = text.truncate(value, text.NODE_NAME_MAX);
      }
    }
    if (role === "combobox" || role === "listbox") {
      var selected = adapter.selectedTexts(element);
      if (selected.length) state.value = text.normalizeName(selected.join(", "));
      else if (role === "combobox" && adapter.tagName(element) === "input" && (adapter.attr(element, "type") || "").toLowerCase() !== "password") {
        var typed = adapter.valueOf(element);
        if (typeof typed === "string" && typed) state.value = text.truncate(typed, text.NODE_NAME_MAX);
      }
    }
    if (role === "checkbox" || role === "radio" || role === "switch") {
      state.checked = adapter.checkedOf(element) === true;
    }
    if (role === "option") state.selected = adapter.selectedOf(element) === true;
    if (adapter.disabledOf(element) === true) state.disabled = true;
    return state;
  }

  var OVERLAY_ROLES = new Set(["dialog", "alertdialog"]);

  function isOverlay(adapter, element, role) {
    if (OVERLAY_ROLES.has(role)) return true;
    return (adapter.attr(element, "aria-modal") || "").toLowerCase() === "true";
  }

  function childrenOf(adapter, element) {
    var shadow = adapter.shadowRoot ? adapter.shadowRoot(element) : null;
    var children = adapter.children(element);
    return shadow ? adapter.children(shadow).concat(children) : children;
  }

  function withRef(node, ref) {
    var out = { ref: ref };
    for (var key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) out[key] = node[key];
    }
    return out;
  }

  function directText(adapter, element) {
    var out = "";
    var shadow = adapter.shadowRoot ? adapter.shadowRoot(element) : null;
    var nodes = shadow ? adapter.childNodes(shadow).concat(adapter.childNodes(element)) : adapter.childNodes(element);
    for (var i = 0; i < nodes.length; i += 1) {
      var child = nodes[i];
      if (adapter.isText(child)) out += adapter.nodeText(child) + " ";
    }
    return out;
  }

  function parseCursor(cursor) {
    var cursorLib = root.LB && root.LB.cursor;
    if (cursorLib) {
      var parsed = cursorLib.parseCursor(cursor);
      return { offset: parsed.offset, provided: parsed.provided, valid: parsed.valid };
    }
    if (typeof cursor !== "string") return { offset: 0, provided: false, valid: true };
    var match = /^(\d+)$/.exec(cursor.trim());
    if (!match) return { offset: 0, provided: Boolean(cursor), valid: false };
    return { offset: Number(match[1]), provided: true, valid: true };
  }

  function buildSnapshot(adapter, options) {
    var opts = options || {};
    var maxNodes = text.clampInt(opts.maxNodes, 120, 1, MAX_NODES_GUARD);
    var includeText = opts.includeText !== false;
    var includeHidden = opts.includeHidden === true;
    var cursorState = parseCursor(opts.cursor);
    var offset = cursorState.offset;
    var refs = opts.refs || refmap.createRefMap();
    var url = adapter.url();
    var title = adapter.title();
    var start = opts.selector ? adapter.query(adapter.getRoot(), opts.selector) : adapter.getRoot();

    if (!start) {
      return { url: url, title: title, nodes: [], truncated: false, total: 0, missing: true };
    }

    var overlayEntries = [];
    var pageEntries = [];
    var stack = [];

    function record(item, entry) {
      (item.overlay ? overlayEntries : pageEntries).push(entry);
    }

    function pushChildren(item, list) {
      for (var c = list.length - 1; c >= 0; c -= 1) {
        stack.push({ element: list[c], depth: item.depth + 1, overlay: item.overlay, shift: item.shift });
      }
    }

    var seed = adapter.children(start);
    for (var s = seed.length - 1; s >= 0; s -= 1) stack.push({ element: seed[s], depth: 0, overlay: false, shift: 0 });

    while (stack.length) {
      var item = stack.pop();
      var element = item.element;
      if (!includeHidden) {
        var hidden = hiddenReason(adapter, element);
        if (hidden === "empty-box") pushChildren(item, childrenOf(adapter, element));
        if (hidden !== null) continue;
      }
      var tag = adapter.tagName(element);
      if (FRAME_TAGS.has(tag)) {
        var frameBody = adapter.frameBody ? adapter.frameBody(element) : null;
        if (frameBody) pushChildren(item, adapter.children(frameBody));
        continue;
      }
      if (SKIP_TAGS.has(tag)) continue;

      var role = roleFor(adapter, element);
      var opensOverlay = !item.overlay && isOverlay(adapter, element, role);
      if (opensOverlay) {
        item = { element: element, depth: item.depth, overlay: true, shift: item.depth };
        if (!role) role = "dialog";
      }
      if (role) {
        var node = {};
        var interactive = INTERACTIVE_ROLES.has(role);
        node.role = role;
        node.name = nodeName(adapter, element, role);
        var state = nodeState(adapter, element, role);
        if (Object.prototype.hasOwnProperty.call(state, "value")) node.value = state.value;
        node.depth = item.depth - item.shift;
        if (state.disabled) node.disabled = true;
        if (Object.prototype.hasOwnProperty.call(state, "checked")) node.checked = state.checked;
        if (Object.prototype.hasOwnProperty.call(state, "selected")) node.selected = state.selected;
        if (interactive || node.name || opensOverlay) record(item, { node: node, element: interactive ? element : null });
      }

      if (includeText) {
        var run = text.normalizeName(directText(adapter, element));
        if (run) record(item, { node: { role: "text", name: run, depth: item.depth - item.shift + 1 }, element: null });
      }

      pushChildren(item, childrenOf(adapter, element));
    }

    var entries = overlayEntries.length ? overlayEntries.concat(pageEntries) : pageEntries;
    var total = entries.length;
    var nodes = [];
    for (var e = 0; e < entries.length; e += 1) {
      var entry = entries[e];
      if (entry.element) entry.node = withRef(entry.node, refs.assign(entry.element));
      if (e >= offset && nodes.length < maxNodes) nodes.push(entry.node);
    }

    var stale = offset > 0 && offset >= total;
    var truncated = !stale && total > offset + nodes.length;
    var result = {
      url: url,
      title: title,
      nodes: nodes,
      truncated: truncated,
      total: total,
      offset: offset,
      cursorValid: cursorState.valid,
      cursorStale: stale
    };
    var cursorLib = root.LB && root.LB.cursor;
    var next = cursorLib ? cursorLib.nextCursor(offset, nodes.length, total) : truncated ? String(offset + nodes.length) : null;
    if (next) result.cursor = next;
    return result;
  }

  root.LB = root.LB || {};
  root.LB.snapshot = {
    buildSnapshot: buildSnapshot,
    parseCursor: parseCursor,
    roleFor: roleFor,
    isHidden: isHidden,
    nodeName: nodeName,
    INTERACTIVE_ROLES: INTERACTIVE_ROLES
  };
})(globalThis);
