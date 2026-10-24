import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { TerminalSshHost } from "@tickernelz/paperclip-pro-shared";
import { terminalApi, terminalQueryKeys } from "@/api/terminal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { terminalAccessErrorMessage } from "./terminal-access";

interface SshHostDialogProps {
  companyId: string;
  open: boolean;
  savedHosts: TerminalSshHost[];
  onOpenChange: (open: boolean) => void;
  onConnect: (host: TerminalSshHost) => void;
}

export function SshHostDialog({ companyId, open, savedHosts, onOpenChange, onConnect }: SshHostDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [port, setPort] = useState("");
  const [error, setError] = useState<string | null>(null);
  const trimmedPort = port.trim();

  const refreshHosts = () => queryClient.invalidateQueries({ queryKey: terminalQueryKeys.sshHosts(companyId) });

  const saveMutation = useMutation({
    mutationFn: () =>
      terminalApi.createSshHost(companyId, {
        name: name.trim(),
        destination: destination.trim(),
        ...(trimmedPort ? { port: Number.parseInt(trimmedPort, 10) } : {}),
      }),
    onSuccess: (host) => {
      setError(null);
      setName("");
      setDestination("");
      setPort("");
      void refreshHosts();
      onOpenChange(false);
      onConnect(host);
    },
    onError: (err) => setError(terminalAccessErrorMessage(err, "Could not save the SSH host.")),
  });

  const removeMutation = useMutation({
    mutationFn: (hostId: string) => terminalApi.removeSshHost(companyId, hostId),
    onSuccess: () => {
      setError(null);
      void refreshHosts();
    },
    onError: (err) => setError(terminalAccessErrorMessage(err, "Could not remove the saved SSH host.")),
  });

  const portInvalid = trimmedPort.length > 0 && !/^[0-9]+$/.test(trimmedPort);
  const submitDisabled = saveMutation.isPending || !name.trim() || !destination.trim() || portInvalid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect to host</DialogTitle>
          <DialogDescription>
            The session starts this server's ssh client with its own keys, agent and known hosts.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!submitDisabled) saveMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="ssh-host-name">Name</Label>
            <Input
              id="ssh-host-name"
              value={name}
              placeholder="prod-db"
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ssh-host-destination">Destination</Label>
            <Input
              id="ssh-host-destination"
              value={destination}
              placeholder="user@host"
              autoComplete="off"
              onChange={(event) => setDestination(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ssh-host-port">Port</Label>
            <Input
              id="ssh-host-port"
              value={port}
              placeholder="22"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={portInvalid}
              onChange={(event) => setPort(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {savedHosts.length > 0 ? (
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-xs font-medium text-foreground">Saved hosts</p>
              <ul className="space-y-1">
                {savedHosts.map((host) => (
                  <li key={host.id} className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:underline"
                      onClick={() => {
                        onOpenChange(false);
                        onConnect(host);
                      }}
                    >
                      {host.name}
                      <span className="ml-2 text-muted-foreground">
                        {host.destination}
                        {host.port === null ? "" : `:${host.port}`}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${host.name}`}
                      disabled={removeMutation.isPending && removeMutation.variables === host.id}
                      onClick={() => removeMutation.mutate(host.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              Save and connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
