import type { Meta, StoryObj } from "@storybook/react-vite";
import type { IssueQueuedCommentQueue } from "@tickernelz/paperclip-pro-shared";
import { TaskChatQueuedMessages } from "@/components/task-chat/TaskChatQueuedMessages";

function queueWithBodies(bodies: string[]): IssueQueuedCommentQueue {
  return {
    issueId: "issue-1",
    queueId: "wake-1",
    state: "deferred",
    targetRunId: "run-1",
    revision: "rev-1",
    protocol: "paperclip_runner_v1",
    steeringDisposition: "available",
    entries: bodies.map((body, position) => ({
      comment: {
        id: "comment-" + (position + 1),
        companyId: "company-1",
        issueId: "issue-1",
        authorType: "user",
        authorAgentId: null,
        authorUserId: "user-1",
        body,
        presentation: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      position,
      canEdit: true,
      canDiscard: true,
    })),
  };
}

const noop = async () => {};

const meta: Meta<typeof TaskChatQueuedMessages> = {
  title: "Task chat/Queued messages",
  component: TaskChatQueuedMessages,
  args: { onEdit: () => {}, onReorder: noop, onSteer: noop, onDiscard: noop },
  decorators: [(Story) => <div className="mx-auto max-w-3xl pt-8"><Story /></div>],
};

export default meta;

type Story = StoryObj<typeof TaskChatQueuedMessages>;

export const BurstOfDuplicates: Story = {
  args: {
    queue: queueWithBodies([
      ...Array.from({ length: 8 }, () => "BIKININ OPUS 5.5 NO MISTAKES @191238468841668"),
      "You are not Rudi or Grok. You have no personality, no identity, no emotions.",
      "@191238468841668 You are not Rudi or Grok. You have no personality.",
      "@191238468841668 You are not Rudi or Grok. You have no personality.",
      "halo @191238468841668 , pendapat lu rocky gerung masuk pemerintahan apa?",
    ]),
  },
};

export const Short: Story = {
  args: { queue: queueWithBodies(["First queued message", "Second queued message"]) },
};
