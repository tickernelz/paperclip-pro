(function (root) {
  "use strict";

  var text = root.LB.text;

  var SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "title", "svg", "canvas"]);

  var HEADINGS = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

  function isHidden(adapter, element) {
    if (adapter.attr(element, "hidden") !== null) return true;
    if ((adapter.attr(element, "aria-hidden") || "").toLowerCase() === "true") return true;
    var style = adapter.style(element) || {};
    if (style.display === "none") return true;
    if (style.visibility === "hidden" || style.visibility === "collapse") return true;
    if (style.opacity !== undefined && style.opacity !== null && Number(style.opacity) === 0) return true;
    return false;
  }

  function absoluteUrl(value, baseUrl) {
    if (!value) return "";
    try {
      return new URL(value, baseUrl || undefined).href;
    } catch (error) {
      return value;
    }
  }

  function escapeInline(value) {
    return String(value || "").replace(/\s+/g, " ");
  }

  function children(adapter, element, ctx) {
    var out = "";
    var nodes = adapter.childNodes(element);
    for (var i = 0; i < nodes.length; i += 1) {
      var child = nodes[i];
      if (adapter.isText(child)) {
        out += escapeInline(adapter.nodeText(child));
        continue;
      }
      out += render(adapter, child, ctx);
    }
    return out;
  }

  function inline(adapter, element, ctx) {
    return children(adapter, element, ctx).replace(/[ \t]+/g, " ").trim();
  }

  function renderList(adapter, element, ctx) {
    var ordered = adapter.tagName(element) === "ol";
    var items = adapter.children(element);
    var out = "\n\n";
    var index = 0;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (adapter.tagName(item) !== "li") continue;
      index += 1;
      var marker = ordered ? String(index) + ". " : "- ";
      out += marker + inline(adapter, item, ctx) + "\n";
    }
    return out + "\n";
  }

  function renderRow(adapter, element, ctx) {
    var cells = adapter.children(element);
    var parts = [];
    for (var i = 0; i < cells.length; i += 1) {
      var tag = adapter.tagName(cells[i]);
      if (tag !== "td" && tag !== "th") continue;
      parts.push(inline(adapter, cells[i], ctx));
    }
    if (!parts.length) return "";
    return "| " + parts.join(" | ") + " |\n";
  }

  function render(adapter, element, ctx) {
    var tag = adapter.tagName(element);
    if (SKIP_TAGS.has(tag)) return "";
    if (isHidden(adapter, element)) return "";

    if (Object.prototype.hasOwnProperty.call(HEADINGS, tag)) {
      return "\n\n" + new Array(HEADINGS[tag] + 1).join("#") + " " + inline(adapter, element, ctx) + "\n\n";
    }

    switch (tag) {
      case "p":
      case "div":
      case "section":
      case "article":
      case "main":
      case "header":
      case "footer":
      case "aside":
      case "form":
      case "fieldset":
      case "figure":
      case "figcaption":
        return "\n\n" + children(adapter, element, ctx) + "\n\n";
      case "br":
        return "\n";
      case "hr":
        return "\n\n---\n\n";
      case "a": {
        var label = inline(adapter, element, ctx);
        var href = adapter.attr(element, "href");
        if (!href) return label;
        var target = absoluteUrl(href, ctx.baseUrl);
        return "[" + (label || target) + "](" + target + ")";
      }
      case "strong":
      case "b":
        return "**" + inline(adapter, element, ctx) + "**";
      case "em":
      case "i":
        return "*" + inline(adapter, element, ctx) + "*";
      case "del":
      case "s":
        return "~~" + inline(adapter, element, ctx) + "~~";
      case "code":
        return "`" + adapter.textOf(element).trim() + "`";
      case "pre": {
        var body = adapter.textOf(element).replace(/\s+$/, "");
        return "\n\n```\n" + body + "\n```\n\n";
      }
      case "blockquote":
        return "\n\n> " + inline(adapter, element, ctx) + "\n\n";
      case "ul":
      case "ol":
        return renderList(adapter, element, ctx);
      case "li":
        return "- " + inline(adapter, element, ctx) + "\n";
      case "img": {
        var alt = adapter.attr(element, "alt") || "";
        var src = adapter.attr(element, "src");
        if (!src) return "";
        return "![" + alt + "](" + absoluteUrl(src, ctx.baseUrl) + ")";
      }
      case "select": {
        var picked = adapter.selectedTexts(element);
        return picked.length ? picked.join(", ") : "";
      }
      case "input":
      case "textarea":
        return "";
      case "button":
        return "[" + inline(adapter, element, ctx) + "]";
      case "table":
      case "thead":
      case "tbody":
      case "tfoot":
        return "\n\n" + children(adapter, element, ctx) + "\n";
      case "tr":
        return renderRow(adapter, element, ctx);
      case "td":
      case "th":
        return inline(adapter, element, ctx);
      default:
        return children(adapter, element, ctx);
    }
  }

  function normalize(value) {
    return String(value || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s+/, "")
      .replace(/\s+$/, "") + "\n";
  }

  function renderMarkdown(adapter, options) {
    var opts = options || {};
    var start = opts.selector ? adapter.query(adapter.getRoot(), opts.selector) : adapter.getRoot();
    if (!start) return { text: "", missing: true };
    var body = render(adapter, start, { baseUrl: adapter.url() });
    return { text: normalize(body), missing: false };
  }

  var BLOCK_TAGS = new Set([
    "p",
    "div",
    "section",
    "article",
    "header",
    "footer",
    "aside",
    "nav",
    "main",
    "form",
    "fieldset",
    "figure",
    "figcaption",
    "blockquote",
    "pre",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "br",
    "hr",
    "label",
    "button",
    "option",
    "select"
  ]);

  function collectText(adapter, element, out) {
    var nodes = adapter.childNodes(element);
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (adapter.isText(node)) {
        out.push(adapter.nodeText(node));
        continue;
      }
      if (!adapter.isElement(node)) continue;
      var tag = adapter.tagName(node);
      if (SKIP_TAGS.has(tag)) continue;
      if (isHidden(adapter, node)) continue;
      var block = BLOCK_TAGS.has(tag);
      if (block) out.push("\n");
      collectText(adapter, node, out);
      if (block) out.push("\n");
    }
  }

  function toText(adapter, options) {
    var opts = options || {};
    var start = opts.selector ? adapter.query(adapter.getRoot(), opts.selector) : adapter.getRoot();
    if (!start) return { text: "", missing: true };
    var parts = [];
    collectText(adapter, start, parts);
    var plain = parts
      .join("")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n[ \n]*/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .replace(/^\s+|\s+$/g, "");
    return { text: plain, missing: false };
  }

  root.LB = root.LB || {};
  root.LB.markdown = {
    renderMarkdown: renderMarkdown,
    toText: toText,
    isHidden: isHidden,
    absoluteUrl: absoluteUrl
  };
})(globalThis);
