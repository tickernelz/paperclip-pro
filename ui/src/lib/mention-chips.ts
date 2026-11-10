import type { CSSProperties } from "react";
import {
  parseAgentMentionHref,
  parseIssueReferenceHref,
  parseProjectMentionHref,
  parseRoutineMentionHref,
  parseSkillMentionHref,
  parseUserMentionHref,
  resolveAgentAppearance,
  type AgentAppearance,
} from "@tickernelz/wardmote-shared";
import { agentAvatarUrl } from "@/lib/agent-avatar-url";
import { hexToRgb, pickTextColorForPillBg } from "./color-contrast";

export type ParsedMentionChip =
  | {
      kind: "agent";
      agentId: string;
      icon: string | null;
      appearance?: AgentAppearance | null;
    }
  | {
      kind: "issue";
      identifier: string;
    }
  | {
      kind: "project";
      projectId: string;
      color: string | null;
    }
  | {
      kind: "user";
      userId: string;
    }
  | {
      kind: "skill";
      skillId: string;
      slug: string | null;
    }
  | {
      kind: "routine";
      routineId: string;
    };

export function parseMentionChipHref(href: string): ParsedMentionChip | null {
  if (/^https?:\/\//i.test(href.trim())) {
    return null;
  }

  const issue = parseIssueReferenceHref(href);
  if (issue) {
    return {
      kind: "issue",
      identifier: issue.identifier,
    };
  }

  const agent = parseAgentMentionHref(href);
  if (agent) {
    return {
      kind: "agent",
      agentId: agent.agentId,
      icon: agent.icon,
    };
  }

  const project = parseProjectMentionHref(href);
  if (project) {
    return {
      kind: "project",
      projectId: project.projectId,
      color: project.color,
    };
  }

  const user = parseUserMentionHref(href);
  if (user) {
    return {
      kind: "user",
      userId: user.userId,
    };
  }

  const skill = parseSkillMentionHref(href);
  if (skill) {
    return {
      kind: "skill",
      skillId: skill.skillId,
      slug: skill.slug,
    };
  }

  const routine = parseRoutineMentionHref(href);
  if (routine) {
    return {
      kind: "routine",
      routineId: routine.routineId,
    };
  }

  return null;
}

export function mentionChipInlineStyle(mention: ParsedMentionChip): CSSProperties | undefined {
  const style: CSSProperties & Record<string, string> = {};

  if (mention.kind === "project" && mention.color) {
    const projectStyle = projectMentionColors(mention.color);
    Object.assign(style, projectStyle);
    style["--wardmote-mention-project-color"] = mention.color;
  }

  if (mention.kind === "agent") {
    const appearance = resolveAgentAppearance(mention.appearance, mention.agentId);
    style["--wardmote-mention-avatar-image"] = `url("${agentAvatarUrl(appearance, 16, 2)}")`;
  }

  return Object.keys(style).length > 0 ? (style as CSSProperties) : undefined;
}

export function applyMentionChipDecoration(element: HTMLElement, mention: ParsedMentionChip) {
  clearMentionChipDecoration(element);
  element.dataset.mentionKind = mention.kind;
  element.setAttribute("contenteditable", "false");
  element.classList.add("wardmote-mention-chip", `wardmote-mention-chip--${mention.kind}`);
  if (mention.kind === "project") {
    element.classList.add("wardmote-project-mention-chip");
  }

  const style = mentionChipInlineStyle(mention);
  if (!style) return;
  for (const [key, value] of Object.entries(style)) {
    if (typeof value === "string") {
      if (key.startsWith("--")) {
        element.style.setProperty(key, value);
      } else {
        (element.style as CSSStyleDeclaration & Record<string, string>)[key] = value;
      }
    }
  }
}

export function clearMentionChipDecoration(element: HTMLElement) {
  delete element.dataset.mentionKind;
  element.classList.remove(
    "wardmote-mention-chip",
    "wardmote-mention-chip--agent",
    "wardmote-mention-chip--issue",
    "wardmote-mention-chip--project",
    "wardmote-mention-chip--routine",
    "wardmote-mention-chip--user",
    "wardmote-mention-chip--skill",
    "wardmote-project-mention-chip",
  );
  element.removeAttribute("contenteditable");
  element.style.removeProperty("border-color");
  element.style.removeProperty("background-color");
  element.style.removeProperty("color");
  element.style.removeProperty("--wardmote-mention-project-color");
  element.style.removeProperty("--wardmote-mention-icon-mask");
  element.style.removeProperty("--wardmote-mention-avatar-image");
}

function projectMentionColors(color: string): Pick<CSSProperties, "borderColor" | "backgroundColor" | "color"> {
  const rgb = hexToRgb(color);
  if (!rgb) return {};
  return {
    borderColor: color,
    backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`,
    color: pickTextColorForPillBg(color),
  };
}
