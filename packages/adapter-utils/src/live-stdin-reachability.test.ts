import { describe, expect, it } from "vitest";
import { adapterExecutionTargetSupportsLiveStdin } from "./execution-target.js";

describe("adapterExecutionTargetSupportsLiveStdin", () => {
  it("allows the local path, including an absent target", () => {
    expect(adapterExecutionTargetSupportsLiveStdin(null)).toBe(true);
    expect(adapterExecutionTargetSupportsLiveStdin(undefined)).toBe(true);
    expect(adapterExecutionTargetSupportsLiveStdin({ kind: "local" })).toBe(true);
  });

  it("allows ssh, which forwards its stdin to the remote command", () => {
    expect(
      adapterExecutionTargetSupportsLiveStdin({
        kind: "remote",
        transport: "ssh",
        remoteCwd: "/workspace",
        spec: { host: "example.test", port: 22, username: "dev", remoteCwd: "/workspace" },
      } as never),
    ).toBe(true);
  });

  it("refuses sandbox, which receives only a one-shot stdin string", () => {
    expect(
      adapterExecutionTargetSupportsLiveStdin({
        kind: "remote",
        transport: "sandbox",
        remoteCwd: "/workspace",
      } as never),
    ).toBe(false);
  });
});
