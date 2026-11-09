import { describe, expect, it } from "vitest";
import { signInReturnPath } from "./sign-in-return-path";

describe("signInReturnPath", () => {
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/\n/evil.test", "/auth?next=/auth", "/auth/", "/a/../auth"])(
    "rejects unsafe or recursive return targets: %j", (path) => {
      expect(signInReturnPath(path)).toBe("/");
    },
  );
});
