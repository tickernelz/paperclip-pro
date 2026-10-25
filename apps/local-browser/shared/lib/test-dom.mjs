export function t(text) {
  return { kind: "text", text: String(text) };
}

export function el(tag, options = {}) {
  return {
    kind: "element",
    tag,
    attrs: options.attrs || {},
    style: { display: "block", visibility: "visible", opacity: "1", ...(options.style || {}) },
    box: options.box === undefined ? { width: 10, height: 10 } : options.box,
    props: options.props || {},
    children: options.children || [],
  };
}

function textOf(node) {
  if (!node) return "";
  if (node.kind === "text") return node.text;
  let out = "";
  for (const child of node.children || []) {
    out += textOf(child) + " ";
  }
  return out;
}

function descendants(node, visit) {
  if (!node || node.kind !== "element") return;
  visit(node);
  for (const child of node.children || []) descendants(child, visit);
}

export function createFakeAdapter({ body, url = "https://example.test/page", title = "Example" }) {
  const index = new Map();
  descendants(body, (node) => {
    const id = node.attrs.id;
    if (id && !index.has(id)) index.set(id, node);
  });

  function matches(node, selector) {
    if (selector.startsWith("#")) return node.attrs.id === selector.slice(1);
    const classMatch = /^\.([\w-]+)$/.exec(selector);
    if (classMatch) return String(node.attrs.class || "").split(/\s+/).includes(classMatch[1]);
    return node.tag === selector;
  }

  function find(node, selector) {
    if (!node) return null;
    if (node.kind === "element" && matches(node, selector)) return node;
    for (const child of node.children || []) {
      const hit = find(child, selector);
      if (hit) return hit;
    }
    return null;
  }

  return {
    url: () => url,
    title: () => title,
    getRoot: () => body,
    query: (scope, selector) => find(scope || body, selector),
    children: (node) => (node && node.kind === "element" ? node.children.filter((child) => child.kind === "element") : []),
    childNodes: (node) => (node && node.children ? node.children : []),
    isElement: (node) => Boolean(node) && node.kind === "element",
    isText: (node) => Boolean(node) && node.kind === "text",
    nodeText: (node) => (node && node.text) || "",
    tagName: (node) => (node && typeof node.tag === "string" ? node.tag : ""),
    attr: (node, name) => (node && Object.prototype.hasOwnProperty.call(node.attrs, name) ? node.attrs[name] : null),
    style: (node) => node.style,
    rect: (node) => ({ ...node.box, dpr: 1 }),
    isConnected: (node) => Boolean(node) && node.props.detached !== true,
    textOf: (node) => textOf(node),
    innerText: (node) => textOf(node),
    innerHTML: (node) => {
      if (!node) return "";
      if (node.kind === "text") return node.text;
      const attrs = Object.entries(node.attrs)
        .map(([name, value]) => ` ${name}="${value}"`)
        .join("");
      const inner = (node.children || []).map((child) => (child.kind === "text" ? child.text : `<${child.tag}>`)).join("");
      return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
    },
    valueOf: (node) => (node && node.props.value !== undefined ? node.props.value : node && node.attrs.value !== undefined ? node.attrs.value : ""),
    checkedOf: (node) => Boolean(node) && node.props.checked === true,
    selectedOf: (node) => Boolean(node) && node.props.selected === true,
    disabledOf: (node) => Boolean(node) && (node.props.disabled === true || node.attrs["aria-disabled"] === "true"),
    labelText: (node) => (node && node.props.label) || "",
    getById: (id) => index.get(id) || null,
    selectedTexts: (node) => {
      if (!node) return [];
      return (node.children || [])
        .filter((child) => child.tag === "option" && child.props.selected === true)
        .map((child) => textOf(child));
    },
    cssPath: (node) => (node && node.attrs.id ? `#${node.attrs.id}` : null),
    rectOf: (node) => ({ ...node.box, dpr: 1 }),
  };
}
