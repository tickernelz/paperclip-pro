import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { OnboardingOmpLoginView } from "@tickernelz/wardmote-shared";
import { onboardingOmpApi } from "@/api/onboardingOmp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const POLL_MS = 2_000;
export const OMP_LOGIN_PROVIDERS_KEY = ["omp", "login-providers"] as const;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function OmpNote({ tone, children }: { tone: "info" | "ok" | "bad"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "bad" ? "border-bad text-ink" : tone === "ok" ? "border-ok text-ink" : "border-line text-ink-2",
      )}
    >
      {children}
    </div>
  );
}

export function OmpSignIn({ onSignedIn, autoFocus = false }: { onSignedIn?: () => void; autoFocus?: boolean }) {
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: OMP_LOGIN_PROVIDERS_KEY,
    queryFn: () => onboardingOmpApi.loginProviders(),
    staleTime: 10 * 60_000,
  });
  const [provider, setProvider] = useState("");
  const [session, setSession] = useState<OnboardingOmpLoginView | null>(null);
  const [answer, setAnswer] = useState("");
  const selected = provider || providers.data?.providers[0] || "";

  const start = useMutation({
    mutationFn: (input: { name: string; popup: Window | null }) => onboardingOmpApi.startLogin(input.name),
    onSuccess: (view, { popup }) => {
      setAnswer("");
      setSession(view);
      if (popup && view.url && view.state === "waiting") popup.location.href = view.url;
      else popup?.close();
    },
    onError: (_error, { popup }) => popup?.close(),
  });
  const reply = useMutation({
    mutationFn: (value: string) => onboardingOmpApi.answerLogin(session!.id, value),
    onSuccess: (view) => {
      setAnswer("");
      setSession(view);
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => onboardingOmpApi.cancelLogin(id),
    onSettled: () => setSession(null),
  });

  const waiting = session?.state === "waiting";
  const poll = useQuery({
    queryKey: ["omp", "login", session?.id ?? ""],
    queryFn: () => onboardingOmpApi.login(session!.id),
    enabled: waiting,
    refetchInterval: POLL_MS,
  });
  useEffect(() => {
    if (poll.data && poll.data.id === session?.id) setSession(poll.data);
  }, [poll.data, session?.id]);

  const announced = useRef<string | null>(null);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const succeededId = session?.state === "succeeded" ? session.id : null;
  useEffect(() => {
    if (!succeededId || announced.current === succeededId) return;
    announced.current = succeededId;
    void queryClient.invalidateQueries({ queryKey: ["agents"] });
    onSignedInRef.current?.();
  }, [succeededId, queryClient]);

  function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (answer.trim()) reply.mutate(answer.trim());
  }

  if (providers.isLoading) return <p className="text-sm text-ink-3">Asking OMP which providers it can sign in to...</p>;
  if (providers.error) {
    return (
      <OmpNote tone="bad">
        {errorText(providers.error)}{" "}
        <Button type="button" variant="link" size="xs" onClick={() => void providers.refetch()}>Try again</Button>
      </OmpNote>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!session || !waiting ? (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected) start.mutate({ name: selected, popup: window.open("about:blank", "_blank") });
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">
            Provider
            <NativeSelect
              value={selected}
              onChange={(event) => setProvider(event.target.value)}
              autoFocus={autoFocus}
              className="w-full"
            >
              {providers.data?.providers.map((name) => <option key={name} value={name}>{name}</option>)}
            </NativeSelect>
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={!selected || start.isPending} className="flex-1 sm:flex-none">
              {start.isPending ? "Starting..." : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Reload provider list"
              title="Reload provider list"
              onClick={() => void onboardingOmpApi.loginProviders(true).then((data) => queryClient.setQueryData(OMP_LOGIN_PROVIDERS_KEY, data))}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
          </div>
        </form>
      ) : null}

      {start.error ? <OmpNote tone="bad">{errorText(start.error)}</OmpNote> : null}

      {session ? (
        <section aria-label={`Sign-in to ${session.provider}`} className="flex flex-col gap-3 rounded-lg border border-line bg-bg-2 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="text-sm font-semibold">{session.provider}</b>
            {waiting ? (
              <Button type="button" variant="ghost" size="xs" disabled={cancel.isPending} onClick={() => cancel.mutate(session.id)}>
                Cancel
              </Button>
            ) : null}
          </div>

          {waiting && session.url ? (
            <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-sm text-ink-2">
              <li>
                <a
                  href={session.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent underline underline-offset-4"
                >
                  Open the sign-in page <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>{" "}
                (already opened in a new tab unless the browser blocked it) and approve access.
              </li>
              {session.prompt && !session.prompt.secret ? (
                <li>
                  If the page ends on an address that does not load (it starts with http://localhost), copy that whole address from the browser bar and paste it below. On the machine that runs Wardmote this step finishes by itself.
                </li>
              ) : (
                <li>Enter the code OMP shows below if the page asks for one. This panel moves on by itself once you approve.</li>
              )}
            </ol>
          ) : null}

          {waiting && session.prompt ? (
            <form onSubmit={submitAnswer} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">
                {session.prompt.label.replace(/:$/, "")}
                <Input
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  type={session.prompt.secret ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus={!session.url}
                />
              </label>
              <Button type="submit" disabled={!answer.trim() || reply.isPending}>
                {reply.isPending ? "Sending..." : "Send"}
              </Button>
            </form>
          ) : null}

          {waiting && !session.prompt && !session.url ? <p className="text-sm text-ink-3">Waiting for OMP...</p> : null}
          {waiting && session.message ? <OmpNote tone="bad">{session.message}</OmpNote> : null}
          {reply.error ? <OmpNote tone="bad">{errorText(reply.error)}</OmpNote> : null}
          {session.state === "succeeded" ? <OmpNote tone="ok">{session.message ?? "Signed in"}. Models from this provider are ready.</OmpNote> : null}
          {session.state === "failed" ? (
            <OmpNote tone="bad">
              {session.message ?? "Sign-in failed"}. Check the account on the provider's page, then press Sign in again.
            </OmpNote>
          ) : null}

          {waiting && !session.prompt && session.lines.length ? (
            <pre aria-label="OMP output" className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-bg-3 px-3 py-2 font-mono text-xs text-ink-2">{session.lines.join("\n")}</pre>
          ) : null}
          {(!waiting || session.prompt) && session.lines.length ? (
            <details className="text-xs text-ink-3">
              <summary className="cursor-pointer select-none">What OMP printed</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-bg-3 px-3 py-2 font-mono">{session.lines.join("\n")}</pre>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
