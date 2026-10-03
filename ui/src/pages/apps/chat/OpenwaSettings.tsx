import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Trash2 } from "lucide-react";
import {
  OPENWA_CUSTOM_INSTRUCTIONS_MAX_LENGTH,
  OPENWA_GATEWAY_ADMIN_TOOL_LEVELS,
  OPENWA_REPLY_POLICIES,
  OPENWA_SENDER_POLICY_MODES,
  openwaE164Schema,
  type OpenwaEndpointPolicy,
  type OpenwaEndpointPolicyInput,
  type OpenwaGatewayAdminToolLevel,
  type OpenwaReplyPolicy,
  type OpenwaSenderPolicyMode,
} from "@tickernelz/paperclip-pro-shared";
import { chatEndpointsApi, type ChatEndpoint, type OpenwaSenderRule } from "@/api/chatEndpoints";
import { agentsApi } from "@/api/agents";
import { useAdapterCapabilities } from "@/adapters/use-adapter-capabilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/context/ToastContext";
import { copyTextToClipboard } from "@/lib/clipboard";
import { queryKeys } from "@/lib/queryKeys";
import { sanitizedSetupErrorMessage } from "./chat-setup-error";
import { OpenwaChatsSettings } from "./OpenwaChatsSettings";
import { OpenwaHealthCard } from "./OpenwaHealthCard";
import { FieldMessage, NumberField, SettingsSection, ToggleRow, fieldError, openwaSelectClass } from "./openwa-fields";
import {
  OPENWA_TRIGGER_RULES,
  apiFieldErrors,
  keywordList,
  openwaCapabilityWarnings,
  openwaPolicyPatchErrors,
  wholeNumber,
  type FieldErrors,
} from "./openwa-settings-model";

const senderModeLabels: Record<OpenwaSenderPolicyMode, string> = {
  all: "Everyone",
  allowlist: "Owners and the allowlist",
  denylist: "Everyone except the denylist",
};

export const replyPolicyLabels: Record<OpenwaReplyPolicy, string> = {
  allowed: "Reply freely",
  ask_owner: "Ask an owner first",
  owner_absent_only: "Only while owners are away",
};

const adminLevelLabels: Record<OpenwaGatewayAdminToolLevel, string> = {
  off: "Off",
  read: "Read only",
  full: "Full",
};

type OpenwaEndpoint = ChatEndpoint & { policy: OpenwaEndpointPolicy };

function usePolicySave(endpoint: OpenwaEndpoint) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: (patch: OpenwaEndpointPolicyInput) => chatEndpointsApi.updateOpenwaPolicy(endpoint.id, patch),
    onSuccess: (result) => {
      setErrors({});
      setSaved(true);
      queryClient.setQueryData<ChatEndpoint>(queryKeys.chatEndpoints.detail(endpoint.id), (current) =>
        current ? { ...current, policy: result.policy, policyRevision: result.policyRevision } : current,
      );
    },
    onError: (error) => setErrors(apiFieldErrors(error)),
  });
  return {
    errors,
    saved,
    pending: mutation.isPending,
    touch: () => setSaved(false),
    save(patch: OpenwaEndpointPolicyInput) {
      setSaved(false);
      const invalid = openwaPolicyPatchErrors(endpoint.policy, patch);
      if (invalid) {
        setErrors(invalid);
        return;
      }
      mutation.mutate(patch);
    },
  };
}

function SaveRow({ label, state }: { label: string; state: ReturnType<typeof usePolicySave> & { submit: () => void } }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" disabled={state.pending} onClick={state.submit}>
        {state.pending ? "Saving…" : label}
      </Button>
      {state.saved ? <span role="status" className="text-xs text-muted-foreground">Saved</span> : null}
      {state.errors.form ? <span role="alert" className="text-xs text-destructive">{state.errors.form}</span> : null}
    </div>
  );
}

export function OpenwaSettings({ endpoint }: { endpoint: ChatEndpoint }) {
  if (!endpoint.policy) return null;
  const typed = endpoint as OpenwaEndpoint;
  const revision = endpoint.policyRevision ?? 0;
  return (
    <section className="max-w-3xl space-y-5">
      <OpenwaHealthCard endpoint={typed} />
      <CapabilityWarnings endpoint={typed} />
      <OwnersSection endpointId={endpoint.id} />
      <SenderPolicySection key={"sender-" + revision} endpoint={typed} />
      <TriggerDefaultsSection key={"triggers-" + revision} endpoint={typed} />
      <OpenwaChatsSettings endpointId={endpoint.id} policy={typed.policy} />
      <ApprovalsSection key={"approvals-" + revision} endpoint={typed} />
      <ConversationSection key={"conversation-" + revision} endpoint={typed} />
      <ProgressSection key={"progress-" + revision} endpoint={typed} />
      <OwnerPrefixSection key={"prefix-" + revision} endpoint={typed} />
      <GatewayAdminSection key={"admin-" + revision} endpoint={typed} />
      <CustomInstructionsSection key={"instructions-" + revision} endpoint={typed} />
      <AuditRetentionSection key={"retention-" + revision} endpoint={typed} />
    </section>
  );
}

function CapabilityWarnings({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const capabilities = useAdapterCapabilities();
  const agent = useQuery({
    queryKey: queryKeys.agents.detail(endpoint.assignedAgentId),
    queryFn: () => agentsApi.get(endpoint.assignedAgentId, endpoint.companyId),
  });
  if (agent.isPending) return <p role="status" className="text-sm text-muted-foreground">Checking the agent's adapter…</p>;
  if (agent.isError || !agent.data)
    return <p role="alert" className="text-sm text-destructive">Couldn't load the assigned agent, so adapter capability warnings are unavailable.</p>;
  const caps = capabilities(agent.data.adapterType);
  const warnings = openwaCapabilityWarnings({
    adapterType: agent.data.adapterType,
    adapterConfig: agent.data.adapterConfig,
    supportsLiveSteering: caps.supportsLiveSteering === true,
    readOnlyToolProfile: caps.readOnlyToolProfile ?? "instruction_only",
    inflightMode: endpoint.inflightMode,
    numberMode: endpoint.policy.numberMode,
  });
  if (!warnings.length) return null;
  return (
    <div aria-label="Capability warnings" className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
      {warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{warning}</span>
        </p>
      ))}
    </div>
  );
}

function OwnersSection({ endpointId }: { endpointId: string }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [confirmation, setConfirmation] = useState<{ url: string; expiresAt: string | null } | null>(null);
  const owners = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaOwners(endpointId),
    queryFn: () => chatEndpointsApi.listOpenwaOwners(endpointId),
  });
  const add = useMutation({
    mutationFn: (e164: string) => chatEndpointsApi.addOpenwaOwner(endpointId, e164),
    onSuccess: async (result) => {
      setNumber("");
      setConfirmation(result.confirmationUrl ? { url: new URL(result.confirmationUrl, window.location.origin).toString(), expiresAt: result.expiresAt } : null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaOwners(endpointId) });
    },
    onError: (failure) => {
      const errors = apiFieldErrors(failure);
      setError(errors.e164 ?? errors.form ?? Object.values(errors)[0]);
    },
  });
  const remove = useMutation({
    mutationFn: (ownerId: string) => chatEndpointsApi.removeOpenwaOwner(endpointId, ownerId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaOwners(endpointId) }),
    onError: (failure) => pushToast({ title: "Couldn't remove owner", body: failure instanceof Error ? failure.message : "Try again.", tone: "error" }),
  });
  const submit = () => {
    const parsed = openwaE164Schema.safeParse(number);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    add.mutate(parsed.data);
  };
  return (
    <SettingsSection
      title="Owners"
      description="Owners can start full-access runs and approve requests. Each owner number must be linked to a Paperclip member who is not a viewer."
    >
      {owners.isPending ? (
        <p className="text-sm text-muted-foreground">Loading owners…</p>
      ) : owners.isError ? (
        <p role="alert" className="text-sm text-destructive">Couldn't load owners.</p>
      ) : owners.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No owners yet. Add the number of the person who manages this agent.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {owners.data.map((owner) => (
            <li key={owner.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">{owner.numberMasked}</p>
                <p className="text-xs text-muted-foreground">
                  {owner.effective
                    ? "Linked to " + (owner.displayName ?? "a Paperclip member")
                    : owner.linkStatus === "linked"
                      ? "Linked, but the member is inactive or a viewer"
                      : "Waiting for identity-link confirmation"}
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={"Remove owner " + owner.numberMasked}
                disabled={remove.isPending}
                onClick={() => remove.mutate(owner.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-1">
        <label htmlFor="openwa-owner-number" className="text-sm font-medium">Add owner number</label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="openwa-owner-number"
            className="max-w-xs font-mono"
            placeholder="+6281234567890"
            value={number}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "openwa-owner-number-error" : undefined}
            onChange={(event) => setNumber(event.target.value)}
          />
          <Button size="sm" variant="outline" disabled={add.isPending || !number.trim()} onClick={submit}>
            {add.isPending ? "Adding…" : "Add owner"}
          </Button>
        </div>
        <FieldMessage id="openwa-owner-number" error={error} />
      </div>
      {confirmation ? (
        <div className="space-y-2 border-y border-border py-3">
          <p className="text-sm font-medium">Private identity-link URL</p>
          <p className="text-xs text-muted-foreground">Send it only to the owner. They open it while signed in to Paperclip to link this number.</p>
          <p className="break-all font-mono text-xs">{confirmation.url}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void copyTextToClipboard(confirmation.url).then(
                () => pushToast({ title: "Identity-link URL copied", tone: "success" }),
                () => pushToast({ title: "Couldn't copy the link", body: "Select and copy it manually.", tone: "error" }),
              )
            }
          >
            <Copy className="size-4" />
            Copy link
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}

function SenderPolicySection({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const [mode, setMode] = useState(endpoint.policy.senderPolicyMode);
  const state = usePolicySave(endpoint);
  const rules = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaSenderRules(endpoint.id),
    queryFn: () => chatEndpointsApi.listOpenwaSenderRules(endpoint.id),
  });
  return (
    <SettingsSection
      title="Sender policy"
      description="Owners are always allowed. Denylisted numbers are dropped everywhere. In groups, people outside the allowlist reach the agent with limited permissions."
    >
      <div className="grid gap-1">
        <label htmlFor="openwa-sender-mode" className="text-sm font-medium">Who can trigger the agent</label>
        <div className="flex flex-wrap gap-2">
          <select
            id="openwa-sender-mode"
            className={openwaSelectClass + " max-w-xs"}
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as OpenwaSenderPolicyMode);
              state.touch();
            }}
          >
            {OPENWA_SENDER_POLICY_MODES.map((value) => (
              <option key={value} value={value}>{senderModeLabels[value]}</option>
            ))}
          </select>
          <SaveRow label="Save sender mode" state={{ ...state, submit: () => state.save({ senderPolicyMode: mode }) }} />
        </div>
        <FieldMessage id="openwa-sender-mode" error={fieldError(state.errors, "senderPolicyMode")} />
      </div>
      {rules.isError ? <p role="alert" className="text-sm text-destructive">Couldn't load sender lists.</p> : null}
      <SenderList endpointId={endpoint.id} list="allow" title="Allowlist" rules={rules.data ?? []} loading={rules.isPending} />
      <SenderList endpointId={endpoint.id} list="deny" title="Denylist" rules={rules.data ?? []} loading={rules.isPending} />
    </SettingsSection>
  );
}

function SenderList({
  endpointId,
  list,
  title,
  rules,
  loading,
}: {
  endpointId: string;
  list: "allow" | "deny";
  title: string;
  rules: OpenwaSenderRule[];
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [number, setNumber] = useState("");
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const entries = rules.filter((rule) => rule.list === list);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaSenderRules(endpointId) });
  const add = useMutation({
    mutationFn: (input: { e164: string; label?: string }) => chatEndpointsApi.addOpenwaSenderRule(endpointId, { list, ...input }),
    onSuccess: async () => {
      setNumber("");
      setLabel("");
      setErrors({});
      await invalidate();
    },
    onError: (failure) => setErrors(apiFieldErrors(failure)),
  });
  const remove = useMutation({
    mutationFn: (ruleId: string) => chatEndpointsApi.removeOpenwaSenderRule(endpointId, ruleId),
    onSuccess: invalidate,
    onError: (failure) => pushToast({ title: "Couldn't remove number", body: failure instanceof Error ? failure.message : "Try again.", tone: "error" }),
  });
  const submit = () => {
    const parsed = openwaE164Schema.safeParse(number);
    const trimmedLabel = label.trim();
    const next: FieldErrors = {};
    if (!parsed.success) next.e164 = parsed.error.issues[0]?.message ?? "Use an E.164 number";
    if (trimmedLabel.length > 120) next.label = "Use at most 120 characters";
    setErrors(next);
    if (!parsed.success || next.label) return;
    add.mutate({ e164: parsed.data, ...(trimmedLabel ? { label: trimmedLabel } : {}) });
  };
  const id = "openwa-" + list;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No numbers.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {entries.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 py-2">
              <span className="font-mono text-sm">{rule.e164}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{rule.label}</span>
              <Button size="icon-sm" variant="ghost" aria-label={"Remove " + rule.e164} disabled={remove.isPending} onClick={() => remove.mutate(rule.id)}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <div className="grid gap-1">
          <label htmlFor={id + "-number"} className="sr-only">{title} number</label>
          <Input
            id={id + "-number"}
            className="w-48 font-mono"
            placeholder="+6281234567890"
            value={number}
            aria-invalid={errors.e164 ? true : undefined}
            aria-describedby={errors.e164 ? id + "-number-error" : undefined}
            onChange={(event) => setNumber(event.target.value)}
          />
          <FieldMessage id={id + "-number"} error={errors.e164} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={id + "-label"} className="sr-only">{title} label</label>
          <Input
            id={id + "-label"}
            className="w-48"
            placeholder="Label (optional)"
            value={label}
            aria-invalid={errors.label ? true : undefined}
            onChange={(event) => setLabel(event.target.value)}
          />
          <FieldMessage id={id + "-label"} error={errors.label} />
        </div>
        <Button size="sm" variant="outline" disabled={add.isPending || !number.trim()} onClick={submit}>
          {"Add to " + title.toLowerCase()}
        </Button>
      </div>
      {errors.form ? <p role="alert" className="text-xs text-destructive">{errors.form}</p> : null}
    </div>
  );
}

function TriggerDefaultsSection({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const policy = endpoint.policy;
  const [triggers, setTriggers] = useState(policy.triggers);
  const [keywords, setKeywords] = useState(policy.triggers.keywords.join(", "));
  const [replyPolicy, setReplyPolicy] = useState(policy.replyPolicy);
  const [absence, setAbsence] = useState(String(policy.absenceSeconds));
  const state = usePolicySave(endpoint);
  const submit = () =>
    state.save({
      replyPolicy,
      absenceSeconds: wholeNumber(absence),
      triggers: { ...triggers, keywords: keywordList(keywords) },
    });
  return (
    <SettingsSection
      title="Triggers and replies"
      description={
        "Endpoint defaults for every chat; a chat's own settings win. Number mode: " +
        (policy.numberMode === "owner_number" ? "owner's number" : "dedicated agent number") +
        " (change it by reconnecting)."
      }
      footer={<SaveRow label="Save triggers" state={{ ...state, submit }} />}
    >
      <div className="divide-y divide-border">
        {OPENWA_TRIGGER_RULES.map((rule) => (
          <ToggleRow
            key={rule.key}
            label={rule.label}
            detail={rule.detail}
            checked={triggers[rule.key]}
            onChange={(value) => {
              setTriggers((current) => ({ ...current, [rule.key]: value }));
              state.touch();
            }}
          />
        ))}
        <ToggleRow
          label="Command prefix"
          detail="Messages that start with the prefix trigger the agent."
          checked={triggers.commandPrefix.enabled}
          onChange={(enabled) => setTriggers((current) => ({ ...current, commandPrefix: { ...current.commandPrefix, enabled } }))}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor="openwa-command-prefix" className="text-sm font-medium">Prefix</label>
        <Input
          id="openwa-command-prefix"
          className="max-w-xs font-mono"
          value={triggers.commandPrefix.prefix}
          aria-invalid={fieldError(state.errors, "triggers.commandPrefix") ? true : undefined}
          onChange={(event) => setTriggers((current) => ({ ...current, commandPrefix: { ...current.commandPrefix, prefix: event.target.value } }))}
        />
        <FieldMessage id="openwa-command-prefix" error={fieldError(state.errors, "triggers.commandPrefix")} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="openwa-keywords" className="text-sm font-medium">Keywords</label>
        <p className="text-xs text-muted-foreground">Comma-separated whole words, matched case-insensitively. Up to 50.</p>
        <Input
          id="openwa-keywords"
          value={keywords}
          aria-invalid={fieldError(state.errors, "triggers.keywords") ? true : undefined}
          onChange={(event) => setKeywords(event.target.value)}
        />
        <FieldMessage id="openwa-keywords" error={fieldError(state.errors, "triggers.keywords")} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="openwa-reply-policy" className="text-sm font-medium">Replies to non-owners</label>
        <select
          id="openwa-reply-policy"
          className={openwaSelectClass + " max-w-xs"}
          value={replyPolicy}
          onChange={(event) => setReplyPolicy(event.target.value as OpenwaReplyPolicy)}
        >
          {OPENWA_REPLY_POLICIES.map((value) => (
            <option key={value} value={value}>{replyPolicyLabels[value]}</option>
          ))}
        </select>
      </div>
      <NumberField
        id="openwa-absence-seconds"
        label="Absence timer (seconds)"
        help="How long an owner can stay silent after being mentioned before the agent is woken. 10 to 86400."
        value={absence}
        error={fieldError(state.errors, "absenceSeconds")}
        onChange={setAbsence}
      />
    </SettingsSection>
  );
}

const approvalToggles = [
  { key: "createTask", label: "Creating or delegating tasks" },
  { key: "externalTools", label: "Write tools and external actions" },
  { key: "crossChatSend", label: "Sending to other chats" },
  { key: "waAdmin", label: "WhatsApp admin actions" },
  { key: "gatewayAdmin", label: "Gateway admin actions" },
] as const;

function ApprovalsSection({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const approvals = endpoint.policy.approvals;
  const [toggles, setToggles] = useState({
    createTask: approvals.createTask,
    externalTools: approvals.externalTools,
    crossChatSend: approvals.crossChatSend,
    waAdmin: approvals.waAdmin,
    gatewayAdmin: approvals.gatewayAdmin,
  });
  const [reminderMinutes, setReminderMinutes] = useState(String(approvals.reminderMinutes));
  const [maxReminders, setMaxReminders] = useState(String(approvals.maxReminders));
  const [grantTtlHours, setGrantTtlHours] = useState(String(approvals.grantTtlHours));
  const state = usePolicySave(endpoint);
  const submit = () =>
    state.save({
      approvals: {
        ...toggles,
        reminderMinutes: wholeNumber(reminderMinutes),
        maxReminders: wholeNumber(maxReminders),
        grantTtlHours: wholeNumber(grantTtlHours),
      },
    });
  return (
    <SettingsSection
      title="Approvals"
      description="Runs started by non-owners need an owner's approval for these actions. Turning one off lets those runs do it without asking."
      footer={<SaveRow label="Save approvals" state={{ ...state, submit }} />}
    >
      <div className="divide-y divide-border">
        {approvalToggles.map((toggle) => (
          <ToggleRow
            key={toggle.key}
            label={toggle.label}
            detail="Requires owner approval"
            checked={toggles[toggle.key]}
            onChange={(value) => setToggles((current) => ({ ...current, [toggle.key]: value }))}
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField id="openwa-reminder-minutes" label="Reminder interval (minutes)" value={reminderMinutes} error={fieldError(state.errors, "approvals.reminderMinutes")} onChange={setReminderMinutes} />
        <NumberField id="openwa-max-reminders" label="Maximum reminders" value={maxReminders} error={fieldError(state.errors, "approvals.maxReminders")} onChange={setMaxReminders} />
        <NumberField id="openwa-grant-ttl" label="Grant lifetime (hours)" value={grantTtlHours} error={fieldError(state.errors, "approvals.grantTtlHours")} onChange={setGrantTtlHours} />
      </div>
    </SettingsSection>
  );
}

function ConversationSection({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const [hours, setHours] = useState(String(endpoint.policy.rotateAfterIdleHours));
  const state = usePolicySave(endpoint);
  return (
    <SettingsSection
      title="Conversation"
      description="Each chat keeps one conversation task until it has been idle this long, or until someone sends /new."
      footer={<SaveRow label="Save conversation" state={{ ...state, submit: () => state.save({ rotateAfterIdleHours: wholeNumber(hours) }) }} />}
    >
      <NumberField id="openwa-rotate-hours" label="Start a new conversation after idle (hours)" value={hours} error={fieldError(state.errors, "rotateAfterIdleHours")} onChange={setHours} />
      <div className="grid gap-1">
        <p className="text-sm font-medium">Messages during a run</p>
        <p className="text-sm">
          <span className="font-mono">{endpoint.inflightMode ?? "steer"}</span>
          <span className="text-muted-foreground">
            {endpoint.inflightMode === "queue"
              ? " · new messages wait for the next run"
              : " · new messages are steered into the running turn when the adapter supports it"}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">This mode is read-only here.</p>
      </div>
    </SettingsSection>
  );
}

function ProgressSection({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const [nudge, setNudge] = useState(String(endpoint.policy.progressNudgeSeconds));
  const [typing, setTyping] = useState(endpoint.policy.typingIndicator);
  const state = usePolicySave(endpoint);
  return (
    <SettingsSection
      title="Progress"
      footer={<SaveRow label="Save progress" state={{ ...state, submit: () => state.save({ progressNudgeSeconds: wholeNumber(nudge), typingIndicator: typing }) }} />}
    >
      <NumberField
        id="openwa-nudge-seconds"
        label="Progress reminder (seconds)"
        help="Reminds the agent to send a progress update when the chat has heard nothing for this long. 0 turns it off."
        value={nudge}
        error={fieldError(state.errors, "progressNudgeSeconds")}
        onChange={setNudge}
      />
      <ToggleRow label="Typing indicator" detail="Show typing in the chat while the agent works." checked={typing} onChange={setTyping} />
    </SettingsSection>
  );
}

function OwnerPrefixSection({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const prefix = endpoint.policy.ownerNumberPrefix;
  const [enabled, setEnabled] = useState(prefix.enabled);
  const [text, setText] = useState(prefix.text);
  const state = usePolicySave(endpoint);
  return (
    <SettingsSection
      title="Owner number label"
      description={
        endpoint.policy.numberMode === "owner_number"
          ? "Messages the agent sends from your number start with this label so people know it is the assistant."
          : "Used only in owner number mode."
      }
      footer={<SaveRow label="Save label" state={{ ...state, submit: () => state.save({ ownerNumberPrefix: { enabled, text } }) }} />}
    >
      <ToggleRow label="Show the label" checked={enabled} onChange={setEnabled} />
      <div className="grid gap-1">
        <label htmlFor="openwa-owner-prefix" className="text-sm font-medium">Label text</label>
        <Input
          id="openwa-owner-prefix"
          className="max-w-sm"
          value={text}
          aria-invalid={fieldError(state.errors, "ownerNumberPrefix.text") ? true : undefined}
          onChange={(event) => setText(event.target.value)}
        />
        <FieldMessage id="openwa-owner-prefix" error={fieldError(state.errors, "ownerNumberPrefix")} />
      </div>
    </SettingsSection>
  );
}

function GatewayAdminSection({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const queryClient = useQueryClient();
  const [level, setLevel] = useState(endpoint.policy.gatewayAdminTools);
  const [adminKey, setAdminKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const state = usePolicySave(endpoint);
  const health = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaHealth(endpoint.id),
    queryFn: () => chatEndpointsApi.getOpenwaHealth(endpoint.id),
    staleTime: 30_000,
  });
  const replaceKey = useMutation({
    mutationFn: (key: string) => chatEndpointsApi.setup(endpoint.id, { action: "reconnect", credentials: { adminApiKey: key } }),
    onSuccess: async (next) => {
      setAdminKey("");
      setKeyError(null);
      queryClient.setQueryData(queryKeys.chatEndpoints.detail(endpoint.id), next);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaHealth(endpoint.id) });
    },
    onError: (failure, key) => setKeyError(sanitizedSetupErrorMessage(failure, { adminApiKey: key })),
  });
  const configured = health.data?.adminKeyConfigured;
  return (
    <SettingsSection
      title="Gateway admin tools"
      description="Lets owner-approved runs manage the OpenWA gateway itself. Operations that need an unscoped admin key stay unavailable until one is saved."
      footer={<SaveRow label="Save admin level" state={{ ...state, submit: () => state.save({ gatewayAdminTools: level }) }} />}
    >
      <div className="grid gap-1">
        <label htmlFor="openwa-admin-level" className="text-sm font-medium">Admin tools</label>
        <select
          id="openwa-admin-level"
          className={openwaSelectClass + " max-w-xs"}
          value={level}
          onChange={(event) => setLevel(event.target.value as OpenwaGatewayAdminToolLevel)}
        >
          {OPENWA_GATEWAY_ADMIN_TOOL_LEVELS.map((value) => (
            <option key={value} value={value}>{adminLevelLabels[value]}</option>
          ))}
        </select>
        <FieldMessage id="openwa-admin-level" error={fieldError(state.errors, "gatewayAdminTools")} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="openwa-admin-key" className="text-sm font-medium">Admin API key</label>
        <p className="text-xs text-muted-foreground">
          {configured === undefined ? "Checking whether a key is saved…" : configured ? "A key is saved. Enter a new one to replace it." : "No admin key is saved."}{" "}
          Saving re-verifies the session, so the channel returns to its test step until an owner sends a test message.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            id="openwa-admin-key"
            type="password"
            autoComplete="new-password"
            className="max-w-sm"
            value={adminKey}
            aria-invalid={keyError ? true : undefined}
            aria-describedby={keyError ? "openwa-admin-key-error" : undefined}
            onChange={(event) => setAdminKey(event.target.value)}
          />
          <Button size="sm" variant="outline" disabled={replaceKey.isPending || !adminKey.trim()} onClick={() => replaceKey.mutate(adminKey.trim())}>
            {replaceKey.isPending ? "Verifying…" : configured ? "Replace admin key" : "Save admin key"}
          </Button>
        </div>
        <FieldMessage id="openwa-admin-key" error={keyError ?? undefined} />
      </div>
    </SettingsSection>
  );
}

function CustomInstructionsSection({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const [text, setText] = useState(endpoint.policy.customInstructions);
  const state = usePolicySave(endpoint);
  const error = fieldError(state.errors, "customInstructions");
  return (
    <SettingsSection
      title="Custom instructions"
      description="Added to the agent's OpenWA guidance on every run, after the built-in rules."
      footer={<SaveRow label="Save instructions" state={{ ...state, submit: () => state.save({ customInstructions: text }) }} />}
    >
      <label htmlFor="openwa-custom-instructions" className="sr-only">Custom instructions</label>
      <Textarea
        id="openwa-custom-instructions"
        rows={6}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "openwa-custom-instructions-error" : undefined}
        onChange={(event) => setText(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{text.length}</span> / <span className="font-mono">{OPENWA_CUSTOM_INSTRUCTIONS_MAX_LENGTH}</span> characters
      </p>
      <FieldMessage id="openwa-custom-instructions" error={error} />
    </SettingsSection>
  );
}

function AuditRetentionSection({ endpoint }: { endpoint: OpenwaEndpoint }) {
  const [days, setDays] = useState(String(endpoint.policy.auditContentRetentionDays));
  const state = usePolicySave(endpoint);
  return (
    <SettingsSection
      title="Audit retention"
      description="Message text and tool arguments in the audit are removed after this many days. Metadata is kept."
      footer={<SaveRow label="Save retention" state={{ ...state, submit: () => state.save({ auditContentRetentionDays: wholeNumber(days) }) }} />}
    >
      <NumberField id="openwa-audit-retention" label="Keep content for (days)" value={days} error={fieldError(state.errors, "auditContentRetentionDays")} onChange={setDays} />
    </SettingsSection>
  );
}
