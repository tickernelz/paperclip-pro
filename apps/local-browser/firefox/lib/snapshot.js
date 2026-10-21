(function (root) {
  "use strict";

  var text = root.LB.text;
  var refmap = root.LB.refmap;

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
    "iframe",
    "object",
    "embed",
    "video",
    "audio",
    "source",
    "track",
    "map",
    "area"
  ]);

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

  function isHidden(adapter, element) {
    if (adapter.attr(element, "hidden") !== null) return true;
    if ((adapter.attr(element, "aria-hidden") || "").toLowerCase() === "true") return true;
    var style = adapter.style(element) || {};
    if (style.display === "none") return true;
    if (style.visibility === "hidden" || style.visibility === "collapse") return true;
    if (style.opacity !== undefined && style.opacity !== null && Number(style.opacity) === 0) return true;
    if (adapter.tagName(element) === "option") return false;
    var rect = adapter.rect(element) || {};
    if (!(rect.width > 0) || !(rect.height > 0)) return true;
    return false;
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
    }
    if (role === "checkbox" || role === "radio" || role === "switch") {
      state.checked = adapter.checkedOf(element) === true;
    }
    if (role === "option") state.selected = adapter.selectedOf(element) === true;
    if (adapter.disabledOf(element) === true) state.disabled = true;
    return state;
  }

  function directText(adapter, element) {
    var out = "";
    var nodes = adapter.childNodes(element);
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
    var maxNodes = text.clampInt(opts.maxNodes, 120, 10, 400);
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

    var nodes = [];
    var total = 0;

    function emit(node) {
      total += 1;
      if (total <= offset) return;
      if (nodes.length < maxNodes) nodes.push(node);
    }

    var stack = [];
    var seed = adapter.children(start);
    for (var s = seed.length - 1; s >= 0; s -= 1) stack.push({ element: seed[s], depth: 0 });

    while (stack.length) {
      var item = stack.pop();
      var element = item.element;
      if (!includeHidden && isHidden(adapter, element)) continue;
      var tag = adapter.tagName(element);
      if (SKIP_TAGS.has(tag)) continue;

      var role = roleFor(adapter, element);
      if (role) {
        var node = {};
        var interactive = INTERACTIVE_ROLES.has(role);
        if (interactive) node.ref = refs.assign(element);
        node.role = role;
        node.name = nodeName(adapter, element, role);
        var state = nodeState(adapter, element, role);
        if (Object.prototype.hasOwnProperty.call(state, "value")) node.value = state.value;
        node.depth = item.depth;
        if (state.disabled) node.disabled = true;
        if (Object.prototype.hasOwnProperty.call(state, "checked")) node.checked = state.checked;
        if (Object.prototype.hasOwnProperty.call(state, "selected")) node.selected = state.selected;
        if (interactive || node.name) emit(node);
      }

      if (includeText) {
        var run = text.normalizeName(directText(adapter, element));
        if (run) emit({ role: "text", name: run, depth: item.depth + 1 });
      }

      var children = adapter.children(element);
      for (var c = children.length - 1; c >= 0; c -= 1) stack.push({ element: children[c], depth: item.depth + 1 });
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
