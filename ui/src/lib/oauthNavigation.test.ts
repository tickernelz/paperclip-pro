// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { prepareOAuthNavigation } from "./oauthNavigation";

describe("prepareOAuthNavigation", () => {
  it("returns the vetted provider authorization URL and host", () => {
    expect(prepareOAuthNavigation({ authorizationUrl: "https://provider.example.test/authorize?state=one" })).toEqual({
      url: "https://provider.example.test/authorize?state=one",
      host: "provider.example.test",
    });
  });

  it("refuses a script URL", () => {
    expect(() => prepareOAuthNavigation({ authorizationUrl: "javascript:alert(1)" })).toThrow();
  });
});
