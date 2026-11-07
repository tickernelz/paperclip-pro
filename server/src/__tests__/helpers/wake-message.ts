export function parseWakePayloadFromMessage(message: unknown): Record<string, unknown> {
  const text = String(message ?? "");
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error(`Expected a wake JSON block in gateway message, got: ${text}`);
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}
