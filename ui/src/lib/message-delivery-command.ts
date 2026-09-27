import type { ActionCommandOption } from "@/context/EditorAutocompleteContext";

export type MessageDeliveryMode = "steer" | "queue";

export type MessageDeliveryCommand = {
  mode: MessageDeliveryMode;
  prompt: string;
};

export type ParsedMessageDeliveryCommand =
  | { matched: false }
  | { matched: true; command: MessageDeliveryCommand }
  | { matched: true; error: string };

const DELIVERY_COMMANDS = ["/steer", "/queue"] as const;
const DELIVERY_COMMAND_TOKENS = DELIVERY_COMMANDS as readonly string[];

type DeliveryCommandToken = (typeof DELIVERY_COMMANDS)[number];

function isDeliveryCommand(token: string): token is DeliveryCommandToken {
  return DELIVERY_COMMAND_TOKENS.includes(token);
}

const ABSORBABLE_COMMANDS = ["goal", "steer", "queue"] as const;
const ABSORBABLE_COMMAND_TOKENS = ABSORBABLE_COMMANDS as readonly string[];

type AbsorbableCommand = (typeof ABSORBABLE_COMMANDS)[number];

function isAbsorbableCommand(token: string): token is AbsorbableCommand {
  return ABSORBABLE_COMMAND_TOKENS.includes(token);
}

function labelMatchesCommand(label: string, command: AbsorbableCommand): boolean {
  if (label === "" || label === command) return true;
  return command === "goal" && label === "go";
}

/**
 * MDXEditor's link extension can reinterpret a composer command plus its
 * subsequently typed argument as one relative autolink, so a typed
 * `/steer look at this` reaches the parser as the whole document
 * `[/steer](</steer look at this>)` and would otherwise post as a link. Only
 * the exact whole-document shapes it generates are absorbed, and only when the
 * link label and its target name the same known command, so an ordinary
 * Markdown link stays an ordinary comment. `goal` keeps every label spelling
 * it has always accepted.
 */
export function normalizeComposerCommandText(value: string): string {
  const trimmed = value.trim();

  const relativeAutolink = trimmed.match(
    /^\[\/([A-Za-z]*)[ \t\u00a0]*\]\(<(\/[A-Za-z]+(?:[ \t\u00a0].*)?)>\)$/s,
  );
  if (relativeAutolink) {
    const label = relativeAutolink[1]!;
    const target = relativeAutolink[2]!.replaceAll("\u00a0", " ");
    const named = target.slice(1).split(/[ \t]/)[0] ?? "";
    if (isAbsorbableCommand(named) && labelMatchesCommand(label, named)) {
      return target;
    }
    return trimmed.replaceAll("\u00a0", " ");
  }

  const encodedAutolink = trimmed.match(
    /^\[\/([A-Za-z]*)[ \t\u00a0]*\]\((\/[A-Za-z]+(?:%20|%C2%A0).*)\)$/s,
  );
  if (encodedAutolink) {
    const label = encodedAutolink[1]!;
    const raw = encodedAutolink[2]!;
    const named = decodeURIComponent(
      raw.slice(1).split(/(?:%20|%C2%A0)/)[0] ?? "",
    );
    if (isAbsorbableCommand(named) && labelMatchesCommand(label, named)) {
      try {
        return decodeURIComponent(raw).replaceAll("\u00a0", " ");
      } catch {
        return trimmed;
      }
    }
  }

  return trimmed.replaceAll("\u00a0", " ");
}

export function parseMessageDeliveryCommand(
  value: string,
): ParsedMessageDeliveryCommand {
  const trimmed = normalizeComposerCommandText(value);
  if (!trimmed) return { matched: false };
  const firstWhitespace = trimmed.search(/\s/);
  const firstToken =
    firstWhitespace === -1 ? trimmed : trimmed.slice(0, firstWhitespace);
  if (!isDeliveryCommand(firstToken)) return { matched: false };
  const prompt =
    firstWhitespace === -1 ? "" : trimmed.slice(firstWhitespace).trim();
  if (!prompt) {
    return {
      matched: true,
      error: `${firstToken} needs a message. Type ${firstToken} followed by what you want to send.`,
    };
  }
  return {
    matched: true,
    command: { mode: firstToken.slice(1) as MessageDeliveryMode, prompt },
  };
}

export const MESSAGE_DELIVERY_COMMAND_OPTIONS: ActionCommandOption[] = [
  {
    id: "action:steer",
    kind: "action",
    command: "steer",
    name: "Steer",
    description: "Send into the agent's running turn now.",
    aliases: ["steer", "steering", "steered", "now"],
  },
  {
    id: "action:queue",
    kind: "action",
    command: "queue",
    name: "Queue",
    description: "Queue for the next turn boundary.",
    aliases: ["queue", "queued", "later", "next"],
  },
];

export type SteeringUnavailableReason =
  | "not_requested"
  | "board_only"
  | "no_active_run"
  | "legacy_protocol"
  | "conversation_issue"
  | "steering_failed";

export type MessageDeliveryDisposition = {
  deliveredAs?: "queued" | "steered" | null;
  steeringUnavailable?: SteeringUnavailableReason | null;
};

const STEERING_UNAVAILABLE_REASONS: Record<SteeringUnavailableReason, string> = {
  not_requested: "",
  board_only: "steering is only available to board users.",
  no_active_run: "there was no active run to steer.",
  legacy_protocol:
    "this runner's session protocol cannot accept a mid-turn steer.",
  conversation_issue:
    "conversation messages are delivered in order at turn boundaries.",
  steering_failed:
    "the steer did not land, so the message is queued and will be read at the next turn.",
};

const UNKNOWN_STEERING_REASON = "this task could not be steered mid-turn.";

/**
 * A steer that silently became a queue must stay visible, so a downgrade always
 * carries its reason and a delivery that matched the request produces nothing.
 * `deliveredAs` is the primary signal; `not_requested` is excluded so an
 * explicit `/queue` never borrows the downgrade notice.
 */
export function describeDeliveryDowngrade(
  effectiveMode: MessageDeliveryMode,
  disposition: MessageDeliveryDisposition | void | null,
): string | null {
  if (effectiveMode !== "steer") return null;
  if (!disposition) return null;
  if (disposition.deliveredAs === "steered") return null;
  const reason = disposition.steeringUnavailable ?? null;
  if (!reason || reason === "not_requested") return null;
  const detail = STEERING_UNAVAILABLE_REASONS[reason] ?? UNKNOWN_STEERING_REASON;
  return `Queued instead of steering the running turn — ${detail}`;
}

/**
 * `PATCH /api/issues/:id` creates the comment as a side effect of the update
 * and returns the issue with the comment nested, so the disposition is read off
 * that nested object rather than off the issue itself.
 */
export type IssueUpdateCommentDisposition = {
  comment?: MessageDeliveryDisposition | null;
};

export function deliveryDispositionFromIssueUpdate(
  response: IssueUpdateCommentDisposition | null | undefined,
): MessageDeliveryDisposition | undefined {
  return response?.comment ?? undefined;
}
