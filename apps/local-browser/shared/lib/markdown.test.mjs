import test from "node:test";
import assert from "node:assert/strict";

import "./text.js";
import "./markdown.js";
import { el, t, createFakeAdapter } from "./test-dom.mjs";

const { renderMarkdown, toText } = globalThis.LB.markdown;

function markdown(body, options = {}) {
  return renderMarkdown(createFakeAdapter({ body }), options).text;
}

test("converts headings with the matching hash level", () => {
  const body = el("body", {
    children: [
      el("h1", { children: [t("Top")] }),
      el("h2", { children: [t("Second")] }),
      el("h3", { children: [t("Third")] }),
    ],
  });
  assert.equal(markdown(body), "# Top\n\n## Second\n\n### Third\n");
});

test("absolutizes links against the page url", () => {
  const body = el("body", {
    children: [
      el("p", {
        children: [
          t("Read "),
          el("a", { attrs: { href: "/docs/start" }, children: [t("the docs")] }),
          t(" now"),
        ],
      }),
    ],
  });
  assert.equal(markdown(body), "Read [the docs](https://example.test/docs/start) now\n");
});

test("keeps absolute links untouched", () => {
  const body = el("body", {
    children: [el("p", { children: [el("a", { attrs: { href: "https://other.test/a" }, children: [t("other")] })] })],
  });
  assert.equal(markdown(body), "[other](https://other.test/a)\n");
});

test("renders unordered and ordered lists", () => {
  const unordered = el("body", {
    children: [el("ul", { children: [el("li", { children: [t("One")] }), el("li", { children: [t("Two")] })] })],
  });
  const ordered = el("body", {
    children: [el("ol", { children: [el("li", { children: [t("First")] }), el("li", { children: [t("Second")] })] })],
  });
  assert.equal(markdown(unordered), "- One\n- Two\n");
  assert.equal(markdown(ordered), "1. First\n2. Second\n");
});

test("fences pre blocks and wraps inline code", () => {
  const body = el("body", {
    children: [
      el("pre", { children: [el("code", { children: [t("const a = 1;\n")] })] }),
      el("p", { children: [t("Run "), el("code", { children: [t("npm test")] }), t(" first")] }),
    ],
  });
  assert.equal(markdown(body), "```\nconst a = 1;\n```\n\nRun `npm test` first\n");
});

test("renders emphasis, strikethrough and images", () => {
  const body = el("body", {
    children: [
      el("p", {
        children: [
          el("strong", { children: [t("bold")] }),
          t(" "),
          el("em", { children: [t("italic")] }),
          t(" "),
          el("del", { children: [t("gone")] }),
        ],
      }),
      el("img", { attrs: { src: "/chart.png", alt: "Chart" } }),
    ],
  });
  assert.equal(markdown(body), "**bold** *italic* ~~gone~~\n\n![Chart](https://example.test/chart.png)\n");
});

test("renders table rows as pipes", () => {
  const body = el("body", {
    children: [
      el("table", {
        children: [
          el("tr", { children: [el("th", { children: [t("Name")] }), el("th", { children: [t("Qty")] })] }),
          el("tr", { children: [el("td", { children: [t("Bolt")] }), el("td", { children: [t("12")] })] }),
        ],
      }),
    ],
  });
  assert.equal(markdown(body), "| Name | Qty |\n| Bolt | 12 |\n");
});

test("renders blockquotes and horizontal rules", () => {
  const body = el("body", {
    children: [el("blockquote", { children: [t("Quoted")] }), el("hr")],
  });
  assert.equal(markdown(body), "> Quoted\n\n---\n");
});

test("drops script and style content", () => {
  const body = el("body", {
    children: [
      el("script", { children: [t("var leaked = true;")] }),
      el("style", { children: [t("body{color:red}")] }),
      el("p", { children: [t("Kept")] }),
    ],
  });
  const output = markdown(body);
  assert.equal(output, "Kept\n");
  assert.equal(output.includes("leaked"), false);
});

test("skips display:none, visibility:hidden and aria-hidden subtrees", () => {
  const body = el("body", {
    children: [
      el("div", { style: { display: "none" }, children: [el("p", { children: [t("Gone")] })] }),
      el("div", { style: { visibility: "hidden" }, children: [el("p", { children: [t("Invisible")] })] }),
      el("div", { attrs: { "aria-hidden": "true" }, children: [el("p", { children: [t("Aria")] })] }),
      el("div", { attrs: { hidden: "" }, children: [el("p", { children: [t("Hidden attribute")] })] }),
      el("p", { children: [t("Kept")] }),
    ],
  });
  assert.equal(markdown(body), "Kept\n");
});

test("renders a select's selected option and brackets buttons", () => {
  const body = el("body", {
    children: [
      el("form", {
        children: [
          el("select", {
            children: [
              el("option", { props: { selected: false }, children: [t("Alpha")] }),
              el("option", { props: { selected: true }, children: [t("Beta")] }),
            ],
          }),
          el("input", { attrs: { type: "text" }, props: { value: "typed" } }),
          el("button", { children: [t("Save")] }),
        ],
      }),
    ],
  });
  assert.equal(markdown(body), "Beta [Save]\n");
});

test("scopes markdown to a selector", () => {
  const body = el("body", {
    children: [
      el("div", { attrs: { id: "outside" }, children: [el("p", { children: [t("Outside")] })] }),
      el("div", { attrs: { id: "inside" }, children: [el("h2", { children: [t("Inside")] })] }),
    ],
  });
  assert.equal(markdown(body, { selector: "#inside" }), "## Inside\n");
});

test("returns missing when the selector matches nothing", () => {
  const body = el("body", { children: [el("p", { children: [t("x")] })] });
  assert.equal(renderMarkdown(createFakeAdapter({ body }), { selector: "#nope" }).missing, true);
});

test("collapses plain text output", () => {
  const body = el("body", { children: [el("p", { children: [t("  spaced   out  ")] })] });
  assert.equal(toText(createFakeAdapter({ body })).text, "spaced out");
});

test("separates text blocks with single newlines", () => {
  const body = el("body", {
    children: [
      el("h2", { children: [t("Title")] }),
      el("p", { children: [t("First paragraph.")] }),
      el("p", { children: [t("Second paragraph.")] }),
    ],
  });
  assert.equal(toText(createFakeAdapter({ body })).text, "Title\nFirst paragraph.\nSecond paragraph.");
});

test("drops hidden subtrees and script text from plain text", () => {
  const body = el("body", {
    children: [
      el("script", { children: [t("var x = 1;")] }),
      el("div", { style: { display: "none" }, children: [el("p", { children: [t("Gone")] })] }),
      el("p", { children: [t("Kept")] }),
    ],
  });
  assert.equal(toText(createFakeAdapter({ body })).text, "Kept");
});

test("returns missing for a selector that matches nothing in plain text", () => {
  const body = el("body", { children: [el("p", { children: [t("x")] })] });
  assert.equal(toText(createFakeAdapter({ body }), { selector: "#nope" }).missing, true);
});
