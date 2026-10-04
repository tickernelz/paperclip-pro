import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { OpenwaLinkedChat, OpenwaLinkedSessionView } from "@tickernelz/paperclip-pro-shared";
import { chatEndpointsApi } from "@/api/chatEndpoints";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { FieldMessage, SettingsSection, openwaSelectClass } from "./openwa-fields";

function failureMessage(failure: unknown, fallback: string): string {
  return failure instanceof Error && failure.message ? failure.message : fallback;
}

export function OpenwaLinkedNumbers({ endpointId }: { endpointId: string }) {
  const [linking, setLinking] = useState(false);
  const linked = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaLinkedSessions(endpointId),
    queryFn: () => chatEndpointsApi.listOpenwaLinkedSessions(endpointId),
  });
  return (
    <SettingsSection
      title="Linked numbers"
      description="Link another WhatsApp number on this gateway so the agent can read chats you choose, only when an owner asks. A linked number never sends, never wakes the agent, and starts with no chats allowed."
    >
      {linked.isPending ? (
        <p className="text-sm text-muted-foreground">Loading linked numbers…</p>
      ) : linked.isError ? (
        <p role="alert" className="text-sm text-destructive">Couldn't load linked numbers.</p>
      ) : linked.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No linked numbers.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {linked.data.map((entry) => (
            <LinkedNumberRow key={entry.id} endpointId={endpointId} linked={entry} />
          ))}
        </ul>
      )}
      <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
        Link a number
      </Button>
      {linking ? <LinkNumberDialog endpointId={endpointId} onClose={() => setLinking(false)} /> : null}
    </SettingsSection>
  );
}

function LinkNumberDialog({ endpointId, onClose }: { endpointId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string>();
  const sessions = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaLinkableSessions(endpointId),
    queryFn: () => chatEndpointsApi.listOpenwaLinkableSessions(endpointId),
  });
  const link = useMutation({
    mutationFn: () => chatEndpointsApi.linkOpenwaSession(endpointId, { sessionId, label: label.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaLinkedSessions(endpointId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaLinkableSessions(endpointId) });
      onClose();
    },
    onError: (failure) => setError(failureMessage(failure, "Couldn't link the number.")),
  });
  const submit = () => {
    if (!sessionId) return setError("Choose a WhatsApp session");
    if (!label.trim()) return setError("Give the number a label");
    if (label.trim().length > 120) return setError("Use at most 120 characters");
    setError(undefined);
    link.mutate();
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent aria-label="Link a number">
        <DialogHeader>
          <DialogTitle>Link a number</DialogTitle>
          <DialogDescription>
            Paperclip creates a read-only (viewer) OpenWA key for the chosen session with this channel's admin key and keeps it as a managed secret.
          </DialogDescription>
        </DialogHeader>
        {sessions.isPending ? (
          <p className="text-sm text-muted-foreground">Loading gateway sessions…</p>
        ) : sessions.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {failureMessage(sessions.error, "Couldn't read sessions from the gateway.")}
          </p>
        ) : sessions.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other session on this gateway can be linked.</p>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label htmlFor="openwa-linked-session" className="text-sm font-medium">
                WhatsApp session
              </label>
              <select id="openwa-linked-session" className={openwaSelectClass} value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
                <option value="">Choose a session</option>
                {sessions.data.map((session) => (
                  <option key={session.sessionId} value={session.sessionId}>
                    {[session.pushName ?? session.name, session.phoneMasked, session.status].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label htmlFor="openwa-linked-label" className="text-sm font-medium">
                Label
              </label>
              <Input
                id="openwa-linked-label"
                placeholder="Personal number"
                value={label}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "openwa-linked-label-error" : undefined}
                onChange={(event) => setLabel(event.target.value)}
              />
              <FieldMessage id="openwa-linked-label" error={error} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={link.isPending || !sessions.data?.length} onClick={submit}>
            {link.isPending ? "Linking…" : "Link number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkedNumberRow({ endpointId, linked }: { endpointId: string; linked: OpenwaLinkedSessionView }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const unlink = useMutation({
    mutationFn: () => chatEndpointsApi.unlinkOpenwaSession(endpointId, linked.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaLinkedSessions(endpointId) }),
    onError: (failure) => pushToast({ title: "Couldn't unlink the number", body: failureMessage(failure, "Try again."), tone: "error" }),
  });
  return (
    <li className="space-y-2 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{linked.label}</p>
          <p className="text-xs text-muted-foreground">
            {[linked.phoneMasked, linked.status === "active" ? "Read-only" : "Unavailable: link it again", linked.allowedChats.length + " chats allowed"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setPicking((value) => !value)}>
          {picking ? "Close chats" : "Choose chats"}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={"Unlink " + linked.label} disabled={unlink.isPending} onClick={() => setConfirming(true)}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {confirming ? (
        <div role="alertdialog" aria-label={"Unlink " + linked.label + "?"} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">Unlinking revokes the key on the gateway and the agent loses access to this number.</p>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={unlink.isPending}
            onClick={() => {
              setConfirming(false);
              unlink.mutate();
            }}
          >
            Unlink
          </Button>
        </div>
      ) : null}
      {picking ? <LinkedChatPicker endpointId={endpointId} linked={linked} onClose={() => setPicking(false)} /> : null}
    </li>
  );
}

function LinkedChatPicker({ endpointId, linked, onClose }: { endpointId: string; linked: OpenwaLinkedSessionView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<string, OpenwaLinkedChat>>(() => new Map(linked.allowedChats.map((chat) => [chat.chatId, chat])));
  const [error, setError] = useState<string>();
  const chats = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaLinkedGatewayChats(endpointId, linked.id),
    queryFn: () => chatEndpointsApi.listOpenwaLinkedGatewayChats(endpointId, linked.id),
  });
  const save = useMutation({
    mutationFn: () => chatEndpointsApi.updateOpenwaLinkedChats(endpointId, linked.id, [...selected.values()]),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaLinkedSessions(endpointId) });
      onClose();
    },
    onError: (failure) => setError(failureMessage(failure, "Couldn't save the chats.")),
  });
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const all = chats.data ?? [];
    return query ? all.filter((chat) => chat.name.toLowerCase().includes(query) || chat.chatId.toLowerCase().includes(query)) : all;
  }, [chats.data, search]);
  const groups = visible.filter((chat) => chat.isGroup);
  const contacts = visible.filter((chat) => !chat.isGroup);
  const toggle = (chat: { chatId: string; name: string; isGroup: boolean }, checked: boolean) =>
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(chat.chatId, { chatId: chat.chatId, label: chat.name.slice(0, 200), isGroup: chat.isGroup });
      else next.delete(chat.chatId);
      return next;
    });
  const list = (title: string, items: typeof visible) =>
    items.length === 0 ? null : (
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
        <ul className="divide-y divide-border">
          {items.map((chat) => {
            const id = "openwa-linked-chat-" + linked.id + "-" + chat.chatId;
            return (
              <li key={chat.chatId} className="flex items-center gap-2 py-1">
                <Checkbox id={id} checked={selected.has(chat.chatId)} onCheckedChange={(value) => toggle(chat, value === true)} />
                <label htmlFor={id} className="min-w-0 flex-1 truncate text-sm">
                  {chat.name}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    );
  return (
    <div aria-label={"Chats for " + linked.label} className="space-y-2 rounded-md border border-border p-3">
      <Input aria-label="Search chats" placeholder="Search chats" value={search} onChange={(event) => setSearch(event.target.value)} />
      {chats.isPending ? (
        <p className="text-sm text-muted-foreground">Loading chats from the linked number…</p>
      ) : chats.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {failureMessage(chats.error, "Couldn't read chats from the linked number.")}
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No chats match.</p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {list("Groups", groups)}
          {list("Contacts", contacts)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={save.isPending || chats.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save chats"}
        </Button>
        <span className="text-xs text-muted-foreground">{selected.size} selected</span>
        {error ? (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
