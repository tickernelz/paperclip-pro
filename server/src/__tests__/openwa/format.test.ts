import { describe, expect, it } from "vitest";
import {
  formatOpenwaPublication,
  markdownToWhatsapp,
  OPENWA_DOCUMENT_CAPTION_LIMIT,
  OPENWA_RESPONSE_DOCUMENT_NAME,
  OPENWA_TEXT_LIMIT,
  packWhatsappBlocks,
} from "../../services/openwa/format.js";

const length = (text: string) => Array.from(text).length;

describe("OpenWA Markdown to WhatsApp formatting", () => {
  it.each([
    ["bold", "**bold** text", "*bold* text"],
    ["underscore italic", "_soft_ text", "_soft_ text"],
    ["asterisk italic", "*soft* text", "_soft_ text"],
    ["strikethrough", "~~gone~~ text", "~gone~ text"],
    ["inline code keeps markdown literal", "use `a*b_c ~d~` here", "use `a*b_c ~d~` here"],
    ["fenced code keeps markdown and drops language", "```ts\nconst x = **y** _z_;\n```", "```\nconst x = **y** _z_;\n```"],
    ["blockquote", "> quoted **b**\n> second", "> quoted *b*\n> second"],
    ["unordered and nested list", "- one\n- two\n  - nested *i*", "- one\n- two\n  - nested _i_"],
    ["ordered list keeps numbering", "3. third\n4. fourth", "3. third\n4. fourth"],
    ["task list", "- [x] done\n- [ ] todo", "- [x] done\n- [ ] todo"],
    ["heading becomes a bold line", "# Title\n\nBody", "*Title*\n\nBody"],
    ["heading with inline emphasis", "## Sub *x* **y**", "*Sub _x_ y*"],
    ["link becomes label (url)", "[docs](https://example.com/docs)", "docs (https://example.com/docs)"],
    ["link URL with underscores and asterisks is untouched", "[a](https://example.com/a_b*c_d)", "a (https://example.com/a_b*c_d)"],
    ["bare URL with underscores is untouched", "see https://ex.com/x_y_z now", "see https://ex.com/x_y_z now"],
    ["autolink without label prints once", "<https://example.com/p>", "https://example.com/p"],
    ["reference link", "[ref][r]\n\n[r]: https://ref.example/p_q", "ref (https://ref.example/p_q)"],
    ["narrow table becomes a monospace block", "| a | b |\n|---|---|\n| 1 | 2 |", "```\na | b\n--+--\n1 | 2\n```"],
    [
      "wide table becomes bullets",
      "| name | description |\n|---|---|\n| alpha | a very long description that will not fit in the monospace width limit |",
      "- *name:* alpha; *description:* a very long description that will not fit in the monospace width limit",
    ],
    ["nested emphasis", "**bold _nested_ ~~strike~~**", "*bold _nested_ ~strike~*"],
    ["bold italic", "***both***", "_*both*_"],
    ["emoji survive", "emoji 🎉 **party 🎉**", "emoji 🎉 *party 🎉*"],
    ["hard break", "line one  \nline two", "line one\nline two"],
    ["paragraphs", "first\n\nsecond", "first\n\nsecond"],
  ])("%s", (_name, input, expected) => {
    expect(markdownToWhatsapp(input)).toBe(expected);
  });
});

describe("OpenWA publication splitting", () => {
  it("keeps a short reply as one part and prefixes only the first part", () => {
    expect(formatOpenwaPublication({ markdown: "**hi**", prefix: "🤖 *Assistant:*" })).toEqual({
      kind: "text",
      parts: ["🤖 *Assistant:*\n*hi*"],
    });
  });

  it("splits at paragraph boundaries under 4096 code points with the prefix on the first part only", () => {
    const paragraph = "🎉".repeat(1500);
    const result = formatOpenwaPublication({ markdown: [paragraph, paragraph, paragraph].join("\n\n"), prefix: "PFX" });
    expect(result.kind).toBe("text");
    if (result.kind !== "text") return;
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]).toBe("PFX\n" + paragraph + "\n\n" + paragraph);
    expect(result.parts[1]).toBe(paragraph);
    for (const part of result.parts) expect(length(part)).toBeLessThanOrEqual(OPENWA_TEXT_LIMIT);
    expect(result.parts.filter((part) => part.includes("PFX"))).toHaveLength(1);
  });

  it("splits an oversized code block into self-contained fences", () => {
    const code = Array.from({ length: 600 }, (_, index) => "line_" + index + " = **" + index + "**").join("\n");
    const parts = packWhatsappBlocks([markdownToWhatsapp("```\n" + code + "\n```")]);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(length(part)).toBeLessThanOrEqual(OPENWA_TEXT_LIMIT);
      expect(part.startsWith("```\n")).toBe(true);
      expect(part.endsWith("\n```")).toBe(true);
    }
    expect(parts.map((part) => part.slice(4, -4)).join("\n")).toBe(code);
  });

  it("hard-splits a single paragraph longer than the limit", () => {
    const words = Array.from({ length: 2000 }, (_, index) => "w" + index).join(" ");
    const parts = packWhatsappBlocks([words]);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(length(part)).toBeLessThanOrEqual(OPENWA_TEXT_LIMIT);
    expect(parts.join(" ")).toBe(words);
  });

  it("turns more than three parts into a markdown document plus a short caption", () => {
    const paragraph = "x".repeat(3000);
    const markdown = Array.from({ length: 4 }, () => paragraph).join("\n\n");
    const result = formatOpenwaPublication({ markdown, prefix: "PFX" });
    expect(result.kind).toBe("document");
    if (result.kind !== "document") return;
    expect(result.document).toEqual({ filename: OPENWA_RESPONSE_DOCUMENT_NAME, mimetype: "text/markdown", content: markdown });
    expect(result.caption.startsWith("PFX\n")).toBe(true);
    expect(length(result.caption)).toBeLessThanOrEqual(OPENWA_DOCUMENT_CAPTION_LIMIT);
  });

  it("keeps exactly three parts inline", () => {
    const paragraph = "y".repeat(3000);
    const result = formatOpenwaPublication({ markdown: [paragraph, paragraph, paragraph].join("\n\n") });
    expect(result).toEqual({ kind: "text", parts: [paragraph, paragraph, paragraph] });
  });

  it("publishes nothing for empty output", () => {
    expect(formatOpenwaPublication({ markdown: "   ", prefix: "PFX" })).toEqual({ kind: "text", parts: [] });
  });
});
