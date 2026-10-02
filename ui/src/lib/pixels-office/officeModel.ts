import type { PixelsOfficeSeatAssignment } from "@tickernelz/paperclip-pro-shared";

export type AgentVisualStatus =
  | "running"
  | "queued"
  | "idle"
  | "paused"
  | "error"
  | "pending_approval"
  | "awaiting_board"
  | "budget_paused";

export type ActivityIcon = "read" | "write" | "run" | "web" | "think" | "comment" | "other";

export interface AgentActivity {
  icon: ActivityIcon;
  message: string | null;
  updatedAtMs: number;
}

export interface AgentVisual {
  agentId: string;
  shortName: string;
  status: AgentVisualStatus;
  activity: AgentActivity | null;
  attention: boolean;
}

export type OfficeObjectKind = "kanban" | "mailbox" | "clock" | "coins" | "alarm";

export const OFFICE_OBJECT_FURNITURE: Readonly<Record<OfficeObjectKind, string>> = {
  kanban: "KANBAN_BOARD",
  mailbox: "MAILBOX",
  clock: "CLOCK",
  coins: "COIN_STACK",
  alarm: "ALARM_LIGHT",
};

export type OfficeEffect =
  | { kind: "celebrate"; agentId: string; big: boolean }
  | { kind: "error"; agentId: string; runId: string }
  | { kind: "visit"; fromAgentId: string; toAgentId: string; reason: "interaction" | "delegation" }
  | { kind: "mention"; agentId: string };

export type OfficeHit =
  | { kind: "agent"; agentId: string }
  | { kind: "object"; object: OfficeObjectKind }
  | null;

export interface OfficeView {
  zoom: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  nowMs: number;
}

export interface OverlayLayer {
  update(dt: number, office: OfficeController): boolean;
  draw(ctx: CanvasRenderingContext2D, view: OfficeView, office: OfficeController): void;
}

export interface CharacterPose {
  agentId: string;
  x: number;
  y: number;
  moving: boolean;
  seated: boolean;
}

export interface OfficeCameraState {
  centerX: number;
  centerY: number;
  zoom: number;
  followAgentId: string | null;
}

export interface OfficeController {
  readonly companyId: string;
  readonly worldWidth: number;
  readonly worldHeight: number;
  syncAgents(visuals: readonly AgentVisual[], assignments: readonly PixelsOfficeSeatAssignment[]): void;
  readPlacements(): PixelsOfficeSeatAssignment[];
  visual(agentId: string): AgentVisual | undefined;
  forEachPose(visit: (pose: CharacterPose) => void): void;
  pose(agentId: string): CharacterPose | undefined;
  objectAnchor(object: OfficeObjectKind): { x: number; y: number } | undefined;
  emit(effect: OfficeEffect): void;
  onEffect(listener: (effect: OfficeEffect) => void): () => void;
  setOverlayLayers(layers: readonly OverlayLayer[]): void;
  hitTest(screenX: number, screenY: number): OfficeHit;
  select(agentId: string | null): void;
  readonly selectedAgentId: string | null;
  hover(hit: OfficeHit): void;
  readonly camera: OfficeCameraState;
  panBy(dxScreen: number, dyScreen: number): void;
  zoomAt(screenX: number, screenY: number, steps: number): void;
  centerOn(worldX: number, worldY: number): void;
  follow(agentId: string | null): void;
  drawMinimap(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  attach(canvas: HTMLCanvasElement): void;
  detach(): void;
  wake(): void;
}
