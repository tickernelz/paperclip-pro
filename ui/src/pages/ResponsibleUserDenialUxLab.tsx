import type { ReactNode } from "react";
import { ResponsibleUserDenialNotice } from "@/components/ResponsibleUserDenialNotice";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * UX lab for PAP-12462 (P7): run "on behalf of {user}" surfacing + responsible-user
 * denial copy. Renders before/after of both surfaces with real design tokens so the
 * states can be captured for UX review. Route: /ux-lab/responsible-user-denial
 */

function LabSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line/70 bg-bg/85 p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-3">{description}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function BeforeAfter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-(length:--text-micro) font-semibold uppercase tracking-(--tracking-caps) text-ink-3">
        {label}
      </div>
      <Card className="block border-line/60 p-3">{children}</Card>
    </div>
  );
}

/** A faithful copy of a run ledger row header (see IssueRunLedger.tsx). */
function RunLedgerRow({
  onBehalfOf,
  denial,
}: {
  onBehalfOf?: string | null;
  denial?: ReactNode;
}) {
  return (
    <article className="space-y-1.5 rounded-lg border border-line/60 px-3 py-2 text-xs text-ink-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-ink">Run</span>
        <span className="min-w-0 max-w-full truncate font-mono text-ink">a1b2c3d4</span>
        <span>by CodexCoder</span>
        {onBehalfOf ? (
          <span className="min-w-0 max-w-full truncate text-ink-3">
            on behalf of <span className="text-ink">{onBehalfOf}</span>
          </span>
        ) : null}
        <span className="rounded-md border border-line px-1.5 py-0.5 text-(length:--text-micro) capitalize text-ink-3">
          {denial ? "Failed" : "Succeeded"}
        </span>
        <span className="ml-auto shrink-0">2m ago</span>
      </div>
      <div className="grid gap-2 text-xs text-ink-3 sm:grid-cols-3">
        <div className="min-w-0">
          <span className="text-ink">Elapsed</span> 1m 4s
        </div>
        <div className="min-w-0">
          <span className="text-ink">Last useful action</span> 2m ago
        </div>
        <div className="min-w-0">
          <span className="text-ink">Stop</span> {denial ? "Denied" : "Completed"}
        </div>
      </div>
      {denial}
    </article>
  );
}

/** A faithful copy of the run-detail header identity block (see AgentDetail.tsx RunDetail). */
function RunDetailHeader({ onBehalfOf, denial }: { onBehalfOf?: string | null; denial?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold text-ink">Run a1b2c3d4</span>
        <span className="rounded-md border border-line px-1.5 py-0.5 text-(length:--text-micro) capitalize text-ink-3">
          {denial ? "failed" : "succeeded"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-(length:--text-micro) text-ink-3">
        <span className="rounded bg-bg-3 px-1.5 py-0.5 text-(length:--text-nano) font-medium uppercase tracking-wide">
          codex local
        </span>
        <span>anthropic/claude-opus-4-8</span>
      </div>
      {onBehalfOf ? (
        <div className="text-xs text-ink-3">
          On behalf of <span className="text-ink">{onBehalfOf}</span>
        </div>
      ) : null}
      {denial}
    </div>
  );
}

export function ResponsibleUserDenialUxLab() {
  return (
    <div className="min-h-screen bg-bg-3/20 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <div className="text-(length:--text-micro) font-semibold uppercase tracking-(--tracking-caps) text-ink-3">
            PAP-12462 · P7
          </div>
          <h1 className="mt-1 text-xl font-semibold text-ink">
            Run "on behalf of" surfacing + denial copy
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            Before/after of the two run surfaces and the four denial-related states.
          </p>
        </header>

        <LabSection
          title="1 · Run identity — “on behalf of {user}”"
          description="A run acting for a human now names that user on both the issue run ledger and the run detail header."
        >
          <BeforeAfter label="Before — run ledger">
            <RunLedgerRow />
          </BeforeAfter>
          <BeforeAfter label="After — run ledger">
            <RunLedgerRow onBehalfOf="Ada Lovelace" />
          </BeforeAfter>
          <BeforeAfter label="Before — run detail">
            <RunDetailHeader />
          </BeforeAfter>
          <BeforeAfter label="After — run detail">
            <RunDetailHeader onBehalfOf="Ada Lovelace" />
          </BeforeAfter>
        </LabSection>

        <LabSection
          title="2 · Denial state — responsible user not authorized"
          description="The agent is allowed, but the user the run acts for is not. Distinct from a plain agent-lacks-permission failure."
        >
          <BeforeAfter label="Before — generic failure text">
            <div className="text-xs">
              <span className="text-red-600 dark:text-red-400">
                Forbidden: action not permitted
              </span>
              <span className="ml-1 text-ink-3">(RESPONSIBLE_USER_UNAUTHORIZED)</span>
            </div>
          </BeforeAfter>
          <BeforeAfter label="After — actionable denial copy">
            <ResponsibleUserDenialNotice
              code="RESPONSIBLE_USER_UNAUTHORIZED"
              userName="Ada Lovelace"
            />
          </BeforeAfter>
        </LabSection>

        <LabSection
          title="3 · Denial state — agent lacks permission (unchanged)"
          description="A denial that is NOT a responsible-user code keeps the existing generic error copy — no responsible-user notice."
        >
          <BeforeAfter label="Agent-lacks-permission failure">
            <div className="text-xs">
              <span className="text-red-600 dark:text-red-400">
                Forbidden: agent is not permitted to perform this action
              </span>
              <span className="ml-1 text-ink-3">(deny_missing_membership)</span>
            </div>
          </BeforeAfter>
          <BeforeAfter label="No responsible-user notice rendered">
            <div className="text-xs text-ink-3">
              Responsible-user denial notice intentionally absent for non-responsible-user codes.
            </div>
          </BeforeAfter>
        </LabSection>

        <LabSection
          title="4 · Denial state — responsible user unavailable"
          description="The user this run acts for was removed or deactivated. Steers the agent to mark work blocked."
        >
          <BeforeAfter label="Before — generic failure text">
            <div className="text-xs">
              <span className="text-red-600 dark:text-red-400">
                Forbidden: responsible user unavailable
              </span>
              <span className="ml-1 text-ink-3">(RESPONSIBLE_USER_UNAVAILABLE)</span>
            </div>
          </BeforeAfter>
          <BeforeAfter label="After — actionable denial copy">
            <ResponsibleUserDenialNotice
              code="RESPONSIBLE_USER_UNAVAILABLE"
              userName="Grace Hopper"
            />
          </BeforeAfter>
        </LabSection>

        <LabSection
          title="In-context — denial inside a failed run ledger row"
          description="How the notice reads within a run row on the issue timeline."
        >
          <BeforeAfter label="Unauthorized">
            <RunLedgerRow
              onBehalfOf="Ada Lovelace"
              denial={
                <ResponsibleUserDenialNotice
                  code="RESPONSIBLE_USER_UNAUTHORIZED"
                  userName="Ada Lovelace"
                />
              }
            />
          </BeforeAfter>
          <BeforeAfter label="Unavailable">
            <RunLedgerRow
              onBehalfOf="Grace Hopper"
              denial={
                <ResponsibleUserDenialNotice
                  code="RESPONSIBLE_USER_UNAVAILABLE"
                  userName="Grace Hopper"
                />
              }
            />
          </BeforeAfter>
        </LabSection>

        <p className={cn("text-center text-(length:--text-micro) text-ink-3")}>
          Copy is sourced from the shared <code>describeResponsibleUserDenial</code> contract.
        </p>
      </div>
    </div>
  );
}
