const DECISION_PATH = /^\/(?:approvals\/[^/]+\/(?:approve|reject)|issues\/[^/]+\/interactions\/[^/]+\/(?:accept|reject|respond))$/;
const listeners = new Set<() => void>();

export function isDecisionRequest(method: string, path: string): boolean {
  return method === "POST" && DECISION_PATH.test(path.split("?")[0] ?? "");
}

export function noteDecisionMade() {
  for (const listener of listeners) listener();
}

export function onDecisionMade(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
