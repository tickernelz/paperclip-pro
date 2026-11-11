import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyDevRunnerOptions } from "../../../scripts/dev-runner-options.ts";

describe("applyDevRunnerOptions", () => {
  it("turns --data-dir into isolated Wardmote paths and consumes the option", () => {
    const env: NodeJS.ProcessEnv = {};
    const cwd = path.join(os.tmpdir(), "wardmote-dev-runner-options");
    const previousInstanceId = process.env.WARDMOTE_INSTANCE_ID;
    process.env.WARDMOTE_INSTANCE_ID = "ambient-test-instance";

    try {
      const result = applyDevRunnerOptions(
        ["--bind", "loopback", "--data-dir", "./tmp", "--future-option"],
        env,
        cwd,
      );

      const expectedHome = path.resolve(cwd, "tmp");
      expect(result).toEqual({
        forwardedArgs: ["--bind", "loopback", "--future-option"],
        dataDir: expectedHome,
      });
      expect(env.WARDMOTE_HOME).toBe(expectedHome);
      expect(env.WARDMOTE_INSTANCE_ID).toBe("default");
      expect(env.WARDMOTE_CONFIG).toBe(
        path.join(expectedHome, "instances", "default", "config.json"),
      );
      expect(env.WARDMOTE_CONTEXT).toBe(path.join(expectedHome, "context.json"));
    } finally {
      if (previousInstanceId === undefined) {
        delete process.env.WARDMOTE_INSTANCE_ID;
      } else {
        process.env.WARDMOTE_INSTANCE_ID = previousInstanceId;
      }
    }
  });

  it.each([
    ["short option", ["-d", "~/paperclip-dev"]],
    ["equals form", ["--data-dir=~/paperclip-dev"]],
  ])("supports the %s", (_label, args) => {
    const env: NodeJS.ProcessEnv = {};

    const result = applyDevRunnerOptions(args, env, "/unused");

    expect(result.forwardedArgs).toEqual([]);
    expect(result.dataDir).toBe(path.join(os.homedir(), "paperclip-dev"));
  });

  it("uses the selected instance for the default config path", () => {
    const env: NodeJS.ProcessEnv = { WARDMOTE_INSTANCE_ID: "experiment" };

    applyDevRunnerOptions(["--data-dir", "/isolated/home"], env, "/unused");

    expect(env.WARDMOTE_CONFIG).toBe(
      path.join("/isolated/home", "instances", "experiment", "config.json"),
    );
  });

  it("preserves explicit config and context paths", () => {
    const env: NodeJS.ProcessEnv = {
      WARDMOTE_CONFIG: "/explicit/config.json",
      WARDMOTE_CONTEXT: "/explicit/context.json",
    };

    applyDevRunnerOptions(["--data-dir", "/isolated/home"], env, "/unused");

    expect(env.WARDMOTE_HOME).toBe("/isolated/home");
    expect(env.WARDMOTE_CONFIG).toBe("/explicit/config.json");
    expect(env.WARDMOTE_CONTEXT).toBe("/explicit/context.json");
  });

  it.each([["--data-dir"], ["-d"], ["--data-dir="]])(
    "rejects a missing value for %s",
    (...args) => {
      expect(() => applyDevRunnerOptions(args, {}, "/unused")).toThrow(
        /requires a value/,
      );
    },
  );
});
