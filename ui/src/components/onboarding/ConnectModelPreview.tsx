import { AgentCharacter } from "../AgentCharacter";
import { useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";

import { Checkbox } from "../ui/checkbox";
import { AgentPreview } from "./AgentPreview";
import { CredentialModeLink } from "./CredentialModeLink";
import { FooterNav } from "./FooterNav";
import {
  ModelSourceTiles,
  type CredentialMode,
  type ModelSource,
} from "./ModelSourceTiles";
import { OnboardingHeading } from "./OnboardingPrimitives";
import { AnotherAdapterDisclosure, OmpSetupCard } from "./OmpSetupCard";
import { ompModelOptions, type OmpSetupStatus } from "./omp-setup";
import { PillGuy } from "./PillGuy";
import { SleepingZs } from "./SleepingZs";
import { Stepper } from "./Stepper";

/**
 * A prototype of the connect step, from the PCLP-Onboarding file (nodes
 * 2941:8291 and 2933:4592).
 *
 * It lives in `components/` rather than beside a story because two surfaces
 * render it: the Storybook stories, and the standalone
 * `connect-model-preview.html` entry that gets deployed for review. A copy in
 * each would have drifted the moment one was tweaked.
 *
 * Nothing here reaches a backend, and it needs none of the app's providers —
 * every piece it composes is presentational.
 */

const PREVIEW_OMP_MODELS = ompModelOptions([
  { id: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", provider: "anthropic" },
  { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "anthropic" },
  { id: "openai-codex/gpt-5.5", label: "GPT-5.5", provider: "openai-codex" },
  { id: "openai-codex/gpt-5.5-mini", label: "GPT-5.5 mini", provider: "openai-codex" },
  { id: "openrouter/deepseek/deepseek-v3.2", label: "DeepSeek V3.2", provider: "openrouter" },
]);

const PREVIEW_OMP_READY: OmpSetupStatus = { kind: "ready", version: "18.9.0" };

/**
 * The two sources the step offers, matching the shipped step's own list.
 *
 * Claude Code and Codex are the only adapters the display registry marks
 * `recommended`, and the real step builds its row from exactly that filter — so
 * a third tile here would be a design the wizard could never render. OpenCode
 * was drawn at one point and is deliberately gone.
 */
const MODEL_SOURCES: ModelSource[] = [
  {
    id: "claude_local",
    label: "Claude Code",
    icon: <img src="/brands/claude-color.svg" alt="" className="size-full" />,
  },
  {
    id: "codex_local",
    label: "Codex",
    icon: <img src="/brands/codex-color.svg" alt="" className="size-full" />,
  },
];

/**
 * Which control flips the credential mode. Two alternates of the same
 * behaviour, kept side by side so they can be compared rather than argued
 * about:
 *
 * `checkbox` is the Figma frames — a ticked box reading "Use API keys instead",
 * which shows the current state plainly and costs a row of chrome.
 *
 * `link` is a line of text that renames itself on press. Lighter, and it turns
 * the row into a single sentence, but it can only ever name the destination —
 * so where you are now is left entirely to the tiles' tags.
 */
export type CredentialControl = "checkbox" | "link";

export function ConnectModelPreview({
  initialSourceId = null,
  initialUseApiKeys = false,
  control = "checkbox",
  ompStatus = PREVIEW_OMP_READY,
  initialModel = "",
  initialOtherAdaptersOpen = false,
}: {
  initialSourceId?: string | null;
  initialUseApiKeys?: boolean;
  control?: CredentialControl;
  ompStatus?: OmpSetupStatus;
  initialModel?: string;
  initialOtherAdaptersOpen?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSourceId);
  const [useApiKeys, setUseApiKeys] = useState(initialUseApiKeys);
  const [otherAdaptersOpen, setOtherAdaptersOpen] = useState(initialOtherAdaptersOpen || initialSourceId !== null);
  const [status, setStatus] = useState<OmpSetupStatus>(ompStatus);
  const [rechecking, setRechecking] = useState(false);
  const [model, setModel] = useState(initialModel);
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const recheckTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mode: CredentialMode = useApiKeys ? "api" : "subscription";
  const ompSelected = selectedId === null;

  useEffect(() => () => clearTimeout(recheckTimer.current), []);

  const checkAgain = () => {
    setRechecking(true);
    clearTimeout(recheckTimer.current);
    recheckTimer.current = setTimeout(() => {
      setRechecking(false);
      setStatus(PREVIEW_OMP_READY);
    }, 900);
  };

  return (
    // The arc's own convention: OS-level reduced motion neutralises the
    // movement, and every piece below still arrives in its final state.
    <MotionConfig reducedMotion="user">
      <div className="w-(--sz-560px) max-w-full p-6 sm:p-10">
        {/* Connect is the arc's second step. `Stepper` carries its own bottom
            margin, which is the gap the frame wants under the dots. */}
        <Stepper step={2} />

        <div className="flex flex-col items-center">
          {/* `relative` is load-bearing: the sleep marks anchor to this box and
              travel out past its top-right corner. */}
          <div className="relative size-(--sz-72px)">
            <AgentCharacter state="sleepy" muted size={128} className="size-full" />
            <SleepingZs />
          </div>
          <AgentPreview agentName="Darnold" agentRole="" />
        </div>

        <div className="pt-6">
          <OnboardingHeading
            center
            title="Connect a model"
            lede="Your agent runs on OMP. Pick the model it should use."
          />
        </div>

        <div className="space-y-6 pt-12">
          <OmpSetupCard
            selected={ompSelected}
            onSelect={() => setSelectedId(null)}
            status={status}
            rechecking={rechecking}
            onCheckAgain={checkAgain}
            options={PREVIEW_OMP_MODELS}
            model={ompSelected ? model : ""}
            onModelChange={setModel}
            fallbackModels={fallbackModels}
            onFallbackModelsChange={setFallbackModels}
          />

          <AnotherAdapterDisclosure
            open={otherAdaptersOpen}
            onOpenChange={(open) => {
              setOtherAdaptersOpen(open);
              if (!open) setSelectedId(null);
            }}
          >
            <div className="space-y-2">
              <ModelSourceTiles
                label="Model source"
                sources={MODEL_SOURCES}
                mode={mode}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />

              {control === "link" ? (
                <CredentialModeLink
                  mode={mode}
                  onChange={(next) => setUseApiKeys(next === "api")}
                />
              ) : (
                <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={useApiKeys}
                    onCheckedChange={(checked) => setUseApiKeys(checked === true)}
                  />
                  <span className="text-sm font-medium text-foreground">
                    Use API keys instead
                  </span>
                </label>
              )}
            </div>
          </AnotherAdapterDisclosure>
        </div>

        <FooterNav
          onBack={() => {}}
          primaryLabel={ompSelected ? "Continue" : "Connect"}
          primaryDisabled={ompSelected ? status.kind !== "ready" || !model : false}
          onPrimary={() => {}}
        />
      </div>
    </MotionConfig>
  );
}
