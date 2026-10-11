import type { Meta, StoryObj } from "@storybook/react-vite";
import { openwaEndpointPolicySchema } from "@tickernelz/paperclip-pro-shared";
import type { OpenwaChat } from "@/api/chatEndpoints";
import { OpenwaChatsSettings } from "@/pages/apps/chat/OpenwaChatsSettings";

const ENDPOINT = "openwa-chats-mobile-preview";
const policy = openwaEndpointPolicySchema.parse({ attestations: { pacing: true, soleClient: true } });

const CHATS: OpenwaChat[] = [
  {
    id: "res-wira",
    chatId: "120363000000000001@g.us",
    chatKey: "120363000000000001@g.us",
    type: "group_chat",
    label: "Wira — Operations & Field Dispatch",
    availability: "available",
    enabled: true,
    settings: { activation: "auto", replyPolicy: "ask_owner" },
    ownerPresent: true,
    participantCount: 11,
  },
  {
    id: "res-finance",
    chatId: "120363000000000002@g.us",
    chatKey: "120363000000000002@g.us",
    type: "group_chat",
    label: "Finance & Invoice Approvals",
    availability: "available",
    enabled: false,
    settings: { activation: "auto", replyPolicy: "owner_absent_only" },
    ownerPresent: false,
    participantCount: 7,
  },
  {
    id: "res-dedicated",
    chatId: "120363000000000003@g.us",
    chatKey: "120363000000000003@g.us",
    type: "group_chat",
    label: "Dedicated support group — escalation desk",
    availability: "available",
    enabled: true,
    settings: { activation: "on", triggers: { allMessages: true } },
    ownerPresent: true,
    participantCount: 11,
  },
  {
    id: "res-dm",
    chatId: "6285550000555@c.us",
    chatKey: "6285550000555@c.us",
    type: "direct_message",
    label: "Andi — PT Mitra Logistik",
    availability: "available",
    enabled: true,
    settings: { activation: "on" },
    ownerPresent: null,
    participantCount: null,
  },
  {
    id: "res-long",
    chatId: "120363000000000004@g.us",
    chatKey: "120363000000000004@g.us",
    type: "group_chat",
    label: "Operations coordination, vendor escalation and after-hours follow-ups 2026 Q4",
    availability: "available",
    enabled: true,
    settings: { activation: "off" },
    ownerPresent: true,
    participantCount: 23,
  },
];

const GATEWAY_CHATS = [
  { chatId: "120363000000000009@g.us", isGroup: true, name: "Fresh group from gateway", lastActivityAt: null, activation: "auto", configured: false },
  { chatId: "6285550009999@c.us", isGroup: false, name: "+62xxx...0999", lastActivityAt: null, activation: "auto", configured: false },
];

function ChatRows() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <OpenwaChatsSettings endpointId={ENDPOINT} policy={policy} />
    </div>
  );
}

const meta = {
  title: "Connections/OpenWA chat rows",
  component: ChatRows,
  parameters: { layout: "fullscreen" },
  beforeEach() {
    const upstream = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, location.origin).pathname;
      if (path === `/api/chat-endpoints/${ENDPOINT}/openwa/chats`) return Response.json(CHATS);
      if (path === `/api/chat-endpoints/${ENDPOINT}/openwa/gateway-chats`)
        return Response.json(GATEWAY_CHATS);
      return upstream(input, init);
    };
    return () => { window.fetch = upstream; };
  },
} satisfies Meta<typeof ChatRows>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChatList: Story = {};
export const ChatListWithEditor: Story = { play: async ({ canvasElement }) => {
  const buttons = Array.from(canvasElement.querySelectorAll("button"));
  const edit = buttons.find((node) => node.textContent?.trim() === "Edit");
  edit?.click();
} };
