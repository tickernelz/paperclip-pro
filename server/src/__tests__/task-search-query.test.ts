import { describe, expect, it } from "vitest";
import { parseTaskSearch } from "../services/task-search.js";

describe("task search query intent", () => {
  it("keeps negation, short domain terms and quoted filler", () => {
    expect(parseTaskSearch('the API is not "in the UI"').tokens).toEqual(["api", "is", "not", "in the ui"]);
    expect(parseTaskSearch("the and").tokens).toEqual(["the", "and"]);
  });

  it("retains the strictest intent for repeated terms", () => {
    expect(parseTaskSearch('callback "callback"').terms).toEqual([{ text: "callback", quoted: true }]);
  });

  it("normalizes task identifiers without guessing their numbers", () => {
    for (const q of ["PAP-42", "pap42", "PAP 42"]) expect(parseTaskSearch(q).identifierQuery).toBe("pap-42");
    expect(parseTaskSearch("T123-42").identifierQuery).toBe("t123-42");
    expect(parseTaskSearch("PAP-420").identifierQuery).toBe("pap-420");
  });

  it("parses field prefixes, quoted field values and unknown prefixes as text", () => {
    expect(parseTaskSearch('title:"Internal Status" comment:foo bar').terms).toEqual([
      { text: "internal status", quoted: true, field: "title" },
      { text: "foo", quoted: false, field: "comment" },
      { text: "bar", quoted: false },
    ]);
    expect(parseTaskSearch("desc:x doc:y text:z").terms.map((term) => term.field)).toEqual(["desc", "doc", "text"]);
    expect(parseTaskSearch("foo:bar").terms).toEqual([{ text: "foo:bar", quoted: false }]);
    expect(parseTaskSearch("title:the").terms).toEqual([{ text: "the", quoted: false, field: "title" }]);
    expect(parseTaskSearch("title: internal").terms).toEqual([{ text: "internal", quoted: false }]);
    expect(parseTaskSearch("internal status").fielded).toBe(false);
    expect(parseTaskSearch("title:internal").fielded).toBe(true);
  });

  it("normalizes id: values to exact identifiers", () => {
    const search = parseTaskSearch("id:ZHA9");
    expect(search.terms).toEqual([{ text: "zha-9", quoted: false, field: "id" }]);
    expect(search.identifierQuery).toBe("zha-9");
    expect(parseTaskSearch("id:ZHA-9 status").identifierQuery).toBe("zha-9");
  });
});
