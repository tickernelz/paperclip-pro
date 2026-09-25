import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAgentHireSchema, createIssueThreadInteractionSchema, updateIssueSchema } from "@tickernelz/paperclip-pro-shared";

const reference = readFileSync(new URL("../../../skills/paperclip/references/api-reference.md", import.meta.url), "utf8");
const uuid = "11111111-1111-4111-8111-111111111111";
const substituteIds = (body: unknown) => JSON.parse(JSON.stringify(body).replace(/\{[\w-]+\}/g, uuid));

type ToolArguments = Record<string, unknown> & {
  issueId?: string;
  advanced?: Record<string, unknown>;
};

function publishedArguments(markdown: string): ToolArguments[] {
  return [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].flatMap((match) => {
    try {
      const parsed: unknown = JSON.parse(match[1]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed as ToolArguments] : [];
    } catch {
      return [];
    }
  });
}

function interactionBody({ issueId, ...rest }: ToolArguments) {
  return substituteIds({ kind: "ask_user_questions", ...rest });
}

function issueUpdateBody({ issueId, advanced, ...rest }: ToolArguments) {
  return substituteIds({ ...rest, ...advanced });
}

describe("published hiring and human-input examples", () => {
  const published = publishedArguments(reference);
  const questions = published.filter((body) => typeof body.payload === "object" && body.payload !== null && "questionSet" in body.payload);
  const hires = published.filter((body) => "instructionsBundle" in body);
  const waits = published.filter(
    (body) =>
      body.issueId !== undefined &&
      (body.advanced?.unblockDescriptor !== undefined ||
        body.comment === "Waiting for your answer in the saved responsibility question card."),
  );

  it("publishes valid structured and free-text questions, managed hires, and waiting states", () => {
    expect(questions).toHaveLength(1);
    expect(hires.length).toBeGreaterThan(0);
    expect(waits).toHaveLength(2);
    for (const body of questions) {
      expect(createIssueThreadInteractionSchema.safeParse(interactionBody(body))).toMatchObject({ success: true });
    }
    for (const body of hires) {
      expect(createAgentHireSchema.safeParse(substituteIds(body))).toMatchObject({ success: true });
      expect((body.instructionsBundle as { files: Record<string, string> }).files["AGENTS.md"]).toEqual(expect.any(String));
    }
    for (const body of waits) {
      expect(updateIssueSchema.safeParse(issueUpdateBody(body))).toMatchObject({ success: true });
    }
  });

  it("includes a complete valid text-field recipe in the skill itself", () => {
    const skill = readFileSync(new URL("../../../skills/paperclip/SKILL.md", import.meta.url), "utf8");
    const section = skill.split("**Asking a free-text question.**")[1]!;
    const body = JSON.parse(section.match(/```json\n([\s\S]*?)\n```/)![1]) as ToolArguments;
    expect(createIssueThreadInteractionSchema.safeParse(interactionBody(body))).toMatchObject({ success: true });
    const payload = body.payload as { questionSet: { questions: { id: string; answerMode: string }[] }; questions: { id: string }[] };
    expect(payload.questionSet.questions[0]).toMatchObject({ answerMode: "text" });
    expect(payload.questions[0].id).toBe(payload.questionSet.questions[0].id);
  });
});
