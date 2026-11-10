import { describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import {
  getOrCreateWardmoteReactRoot,
  type WardmoteReactRootHost,
} from "./react-root";

describe("getOrCreateWardmoteReactRoot", () => {
  it("reuses the existing root when the entry module runs again", () => {
    const host: WardmoteReactRootHost = {};
    const container = {} as Parameters<typeof getOrCreateWardmoteReactRoot>[1];
    const root = { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
    const createRoot = vi.fn(() => root);

    expect(getOrCreateWardmoteReactRoot(host, container, createRoot)).toBe(root);
    expect(getOrCreateWardmoteReactRoot(host, container, createRoot)).toBe(root);
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(container);
  });
});
