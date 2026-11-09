import { describe, expect, it } from "vitest";
import {
  isCloudManagedInstance,
  type CloudInstanceEnv,
} from "../services/cloud-instance.js";

describe("isCloudManagedInstance", () => {
  it("unifies both prior signals without weakening either restrictive floor", () => {
    const cases: CloudInstanceEnv[] = [
      {},
      { PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "tenant-token" },
      { PAPERCLIP_MANAGED_CONFIG: "" },
      {
        PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "tenant-token",
        PAPERCLIP_MANAGED_CONFIG: "managed-document",
      },
    ];

    for (const env of cases) {
      const priorTokenFloor = Boolean(env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN?.trim());
      const priorManagedConfigFloor = env.PAPERCLIP_MANAGED_CONFIG !== undefined;
      const canonicalFloor = isCloudManagedInstance(env);

      expect(canonicalFloor).toBe(priorTokenFloor || priorManagedConfigFloor);
      expect(canonicalFloor || !priorTokenFloor).toBe(true);
      expect(canonicalFloor || !priorManagedConfigFloor).toBe(true);
    }
  });

  it("does not treat a blank tenant token alone as a managed signal", () => {
    expect(isCloudManagedInstance({ PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "   " })).toBe(false);
  });
});
