import { describe, expect, it } from "vitest";
import { readAgentTodoCardExpanded, writeAgentTodoCardExpanded } from "./agent-todo-card-state";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("agent todo card state", () => {
  it("is collapsed until the user opens it, then follows the last choice", () => {
    const storage = memoryStorage();
    expect(readAgentTodoCardExpanded(storage)).toBe(false);
    writeAgentTodoCardExpanded(true, storage);
    expect(readAgentTodoCardExpanded(storage)).toBe(true);
    writeAgentTodoCardExpanded(false, storage);
    expect(readAgentTodoCardExpanded(storage)).toBe(false);
  });

  it("stays collapsed when storage is unavailable or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readAgentTodoCardExpanded(broken)).toBe(false);
    expect(() => writeAgentTodoCardExpanded(true, broken)).not.toThrow();
    expect(readAgentTodoCardExpanded(null)).toBe(false);
  });
});
