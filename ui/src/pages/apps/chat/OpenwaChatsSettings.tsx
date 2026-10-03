import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  OPENWA_CHAT_ACTIVATIONS,
  OPENWA_CHAT_NOTE_MAX_LENGTH,
  OPENWA_REPLY_POLICIES,
  type OpenwaChatActivation,
  type OpenwaEndpointPolicy,
  type OpenwaReplyPolicy,
} from "@tickernelz/paperclip-pro-shared";
import { chatEndpointsApi, type OpenwaChat } from "@/api/chatEndpoints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/queryKeys";
import { FieldMessage, NumberField, SettingsSection, fieldError, openwaSelectClass } from "./openwa-fields";
import {
  OPENWA_TRIGGER_RULES,
  apiFieldErrors,
  chatDraft,
  chatSettingsInput,
  openwaChatSettingsErrors,
  type ChatDraft,
  type FieldErrors,
  type TriggerChoice,
} from "./openwa-settings-model";

const activationLabels: Record<OpenwaChatActivation, string> = {
  auto: "Automatic",
  on: "On",
  off: "Off",
};

const replyLabels: Record<OpenwaReplyPolicy, string> = {
  allowed: "Reply freely",
  ask_owner: "Ask an owner first",
  owner_absent_only: "Only while owners are away",
};

function activationDetail(chat: Pick<OpenwaChat, "type" | "enabled" | "ownerPresent">, numberMode: OpenwaEndpointPolicy["numberMode"]): string {
  const state = chat.enabled ? "active" : "inactive";
  if (numberMode === "owner_number") return state;
  if (chat.type === "group_chat" && chat.ownerPresent !== null)
    return state + (chat.ownerPresent ? " · an owner is in this group" : " · no owner in this group");
  return state;
}

export function OpenwaChatsSettings({ endpointId, policy }: { endpointId: string; policy: OpenwaEndpointPolicy }) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<{ chatId: string; label: string; draft: ChatDraft } | null>(null);
  const chats = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaChats(endpointId),
    queryFn: () => chatEndpointsApi.listOpenwaChats(endpointId),
  });
  const gatewayChats = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGatewayChats(endpointId),
    queryFn: () => chatEndpointsApi.listOpenwaGatewayChats(endpointId),
    enabled: picking,
  });
  const configured = chats.data ?? [];
  const unconfigured = (gatewayChats.data ?? []).filter((chat) => !chat.configured);
  return (
    <SettingsSection
      title="Chats"
      description={
        policy.numberMode === "owner_number"
          ? "Only chats turned on here can trigger the agent; your self-chat is always on for your own commands."
          : "Direct chats are active automatically; groups are active while an owner is a member. Override any chat here."
      }
    >
      {chats.isPending ? (
        <p className="text-sm text-muted-foreground">Loading chats…</p>
      ) : chats.isError ? (
        <p role="alert" className="text-sm text-destructive">Couldn't load chats.</p>
      ) : configured.length === 0 ? (
        <p className="text-sm text-muted-foreground">No chat has its own settings yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {configured.map((chat) => (
            <li key={chat.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{chat.label}</p>
                <p className="text-xs text-muted-foreground">
                  {activationLabels[chat.settings.activation]} · {activationDetail(chat, policy.numberMode)}
                  {chat.participantCount !== null ? " · " + chat.participantCount + " members" : ""}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing({ chatId: chat.chatId, label: chat.label, draft: chatDraft(chat.label, chat.settings) })}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ChatEditor
          key={editing.chatId}
          endpointId={endpointId}
          chatId={editing.chatId}
          initial={editing.draft}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <div className="space-y-2">
        <Button size="sm" variant="outline" onClick={() => setPicking((value) => !value)}>
          {picking ? "Hide gateway chats" : "Add a chat from WhatsApp"}
        </Button>
        {picking ? (
          gatewayChats.isPending ? (
            <p className="text-sm text-muted-foreground">Loading chats from the gateway…</p>
          ) : gatewayChats.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {gatewayChats.error instanceof Error ? gatewayChats.error.message : "Couldn't read chats from the gateway."}
            </p>
          ) : unconfigured.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every chat the gateway lists already has settings.</p>
          ) : (
            <ul aria-label="Gateway chats" className="max-h-80 divide-y divide-border overflow-y-auto border-y border-border">
              {unconfigured.map((chat) => (
                <li key={chat.chatId} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{chat.name}</p>
                    <p className="text-xs text-muted-foreground">{chat.isGroup ? "Group" : "Direct chat"}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing({ chatId: chat.chatId, label: chat.name, draft: chatDraft(chat.name, { activation: chat.activation }) });
                      setPicking(false);
                    }}
                  >
                    Configure
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </SettingsSection>
  );
}

function ChatEditor({
  endpointId,
  chatId,
  initial,
  onClose,
}: {
  endpointId: string;
  chatId: string;
  initial: ChatDraft;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: () => chatEndpointsApi.updateOpenwaChat(endpointId, { chatId, label: draft.label.trim() || undefined, settings: chatSettingsInput(draft) }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaChats(endpointId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaGatewayChats(endpointId) }),
      ]);
      onClose();
    },
    onError: (error) => setErrors(apiFieldErrors(error, "settings")),
  });
  const submit = () => {
    const invalid = openwaChatSettingsErrors(chatSettingsInput(draft));
    if (invalid) {
      setErrors(invalid);
      return;
    }
    setErrors({});
    save.mutate();
  };
  const setTrigger = (key: keyof ChatDraft["triggers"], value: TriggerChoice) =>
    setDraft((current) => ({ ...current, triggers: { ...current.triggers, [key]: value } }));
  const triggerRows = [...OPENWA_TRIGGER_RULES.map((rule) => ({ key: rule.key, label: rule.label })), { key: "commandPrefix" as const, label: "Command prefix" }];
  return (
    <div aria-label={"Settings for " + initial.label} className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-sm font-semibold">{initial.label}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor="openwa-chat-activation" className="text-sm font-medium">Activation</label>
          <select
            id="openwa-chat-activation"
            className={openwaSelectClass}
            value={draft.activation}
            onChange={(event) => setDraft((current) => ({ ...current, activation: event.target.value as OpenwaChatActivation }))}
          >
            {OPENWA_CHAT_ACTIVATIONS.map((value) => (
              <option key={value} value={value}>{activationLabels[value]}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="openwa-chat-reply" className="text-sm font-medium">Replies to non-owners</label>
          <select
            id="openwa-chat-reply"
            className={openwaSelectClass}
            value={draft.replyPolicy}
            onChange={(event) => setDraft((current) => ({ ...current, replyPolicy: event.target.value as ChatDraft["replyPolicy"] }))}
          >
            <option value="inherit">Use endpoint default</option>
            {OPENWA_REPLY_POLICIES.map((value) => (
              <option key={value} value={value}>{replyLabels[value]}</option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Trigger overrides</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {triggerRows.map((row) => (
            <div key={row.key} className="grid grid-cols-2 items-center gap-2">
              <label htmlFor={"openwa-chat-trigger-" + row.key} className="text-xs">{row.label}</label>
              <select
                id={"openwa-chat-trigger-" + row.key}
                className={openwaSelectClass}
                value={draft.triggers[row.key]}
                onChange={(event) => setTrigger(row.key, event.target.value as TriggerChoice)}
              >
                <option value="inherit">Default</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
          ))}
        </div>
        <div className="grid gap-1">
          <label htmlFor="openwa-chat-prefix" className="text-xs">Prefix override</label>
          <Input
            id="openwa-chat-prefix"
            className="max-w-xs font-mono"
            placeholder="Endpoint default"
            value={draft.prefix}
            aria-invalid={fieldError(errors, "triggers.commandPrefix") ? true : undefined}
            onChange={(event) => setDraft((current) => ({ ...current, prefix: event.target.value }))}
          />
          <FieldMessage id="openwa-chat-prefix" error={fieldError(errors, "triggers.commandPrefix")} />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={draft.keywordsOverride}
            onChange={(event) => setDraft((current) => ({ ...current, keywordsOverride: event.target.checked }))}
          />
          Use chat-specific keywords
        </label>
        {draft.keywordsOverride ? (
          <div className="grid gap-1">
            <label htmlFor="openwa-chat-keywords" className="sr-only">Chat keywords</label>
            <Input
              id="openwa-chat-keywords"
              placeholder="invoice, refund"
              value={draft.keywords}
              aria-invalid={fieldError(errors, "triggers.keywords") ? true : undefined}
              onChange={(event) => setDraft((current) => ({ ...current, keywords: event.target.value }))}
            />
            <FieldMessage id="openwa-chat-keywords" error={fieldError(errors, "triggers.keywords")} />
          </div>
        ) : null}
      </fieldset>
      <NumberField
        id="openwa-chat-absence"
        label="Absence timer (seconds)"
        help="Leave blank to use the endpoint default."
        value={draft.absenceSeconds}
        error={fieldError(errors, "absenceSeconds")}
        onChange={(absenceSeconds) => setDraft((current) => ({ ...current, absenceSeconds }))}
      />
      <div className="grid gap-1">
        <label htmlFor="openwa-chat-note" className="text-sm font-medium">Note for the agent</label>
        <Textarea
          id="openwa-chat-note"
          rows={3}
          value={draft.note}
          aria-invalid={fieldError(errors, "note") ? true : undefined}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
        />
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{draft.note.length}</span> / <span className="font-mono">{OPENWA_CHAT_NOTE_MAX_LENGTH}</span> characters
        </p>
        <FieldMessage id="openwa-chat-note" error={fieldError(errors, "note")} />
      </div>
      {errors.form ? <p role="alert" className="text-xs text-destructive">{errors.form}</p> : null}
      {errors.chatId ? <p role="alert" className="text-xs text-destructive">{errors.chatId}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={save.isPending} onClick={submit}>{save.isPending ? "Saving…" : "Save chat"}</Button>
      </div>
    </div>
  );
}
