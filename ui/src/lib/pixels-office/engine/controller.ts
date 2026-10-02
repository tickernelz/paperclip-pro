import type { PixelsOfficeSeatAssignment } from '@tickernelz/paperclip-pro-shared';
import type { CameraBounds, OfficeCameraBounds } from '../assetLoader';
import { getCatalogEntry } from '../layout/furnitureCatalog';
import type {
  AgentVisual,
  CharacterPose,
  OfficeCameraState,
  OfficeController,
  OfficeEffect,
  OfficeHit,
  OfficeObjectKind,
  OverlayLayer,
} from '../officeModel';
import { OFFICE_OBJECT_FURNITURE } from '../officeModel';
import type { Character, OfficeLayout } from '../types';
import { CharacterState, TILE_SIZE } from '../types';
import { Camera } from './camera';
import { GameLoop, LOOP_SLEEP_FOREVER } from './gameLoop';
import type { ObjectBox } from './hitTest';
import { hitTestWorld } from './hitTest';
import { Minimap } from './minimap';
import { OfficeState } from './officeState';
import { loadStoredPoses, PoseFlusher } from './persistence';
import type { SceneView } from './renderer';
import { SceneRenderer } from './renderer';
import type { StaticLayer } from './staticLayer';
import { buildStaticLayer, staticLayerTop } from './staticLayer';

const VISIT_LINGER_SEC = 3;
const VISIT_TRAVEL_TIMEOUT_SEC = 25;

type VisitPhase = 'travelling' | 'lingering';

export interface OfficeRoomAnchor {
  id: string;
  label: string;
  centerX: number;
  centerY: number;
}

interface Visit {
  toAgentId: string;
  phase: VisitPhase;
  timer: number;
}

export class OfficeControllerImpl implements OfficeController {
  readonly worldWidth: number;
  readonly worldHeight: number;

  private readonly state: OfficeState;
  private readonly cameraState: Camera;
  private readonly renderer = new SceneRenderer();
  private readonly minimap = new Minimap();
  private readonly loop: GameLoop;
  private readonly flusher: PoseFlusher;
  private readonly visuals = new Map<string, AgentVisual>();
  private readonly listeners = new Set<(effect: OfficeEffect) => void>();
  private readonly visits = new Map<string, Visit>();
  private readonly objectBoxes: ObjectBox[] = [];
  private readonly anchors = new Map<OfficeObjectKind, { x: number; y: number }>();
  private readonly officeRoom: CameraBounds;
  private readonly view: SceneView & { nowMs: number } = {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    width: 0,
    height: 0,
    nowMs: 0,
  };
  private renderedFrames = 0;

  get frameCount(): number {
    return this.renderedFrames;
  }
  private readonly poseScratch: CharacterPose = {
    agentId: '',
    x: 0,
    y: 0,
    moving: false,
    seated: false,
  };

  private readonly onVisibilityChange = () => {
    if (typeof document !== 'undefined' && !document.hidden) this.loop.wake();
  };

  private overlays: readonly OverlayLayer[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private staticLayer: StaticLayer | null = null;
  private syncKey = '';
  private fitted = false;

  readonly rooms: ReadonlyArray<OfficeRoomAnchor>;

  constructor(
    readonly companyId: string,
    layout: OfficeLayout,
    bounds: OfficeCameraBounds,
  ) {
    this.state = new OfficeState(layout);
    this.worldWidth = layout.cols * TILE_SIZE;
    this.worldHeight = layout.rows * TILE_SIZE;
    this.officeRoom = bounds.office;
    this.rooms = bounds.rooms.map((room, index) => ({
      id: index === 0 ? 'office' : index === 1 ? 'boardroom' : `overflow-${index - 1}`,
      label: index === 0 ? 'Office' : index === 1 ? 'Boardroom & Kitchen' : `Overflow ${index - 1}`,
      centerX: (room.col + room.cols / 2) * TILE_SIZE,
      centerY: (room.row + room.rows / 2) * TILE_SIZE,
    }));
    this.cameraState = new Camera(
      this.worldWidth,
      this.worldHeight,
      staticLayerTop(layout, this.state.tileMap, this.state.staticFurniture),
    );
    this.collectObjects(layout);
    this.flusher = new PoseFlusher(companyId, () => this.state.characters.values());
    this.loop = new GameLoop({
      step: (dt) => this.step(dt),
      render: () => this.render(),
    });
  }

  private collectObjects(layout: OfficeLayout): void {
    const kinds = Object.keys(OFFICE_OBJECT_FURNITURE) as OfficeObjectKind[];
    for (const kind of kinds) {
      const type = OFFICE_OBJECT_FURNITURE[kind];
      const item = layout.furniture.find((candidate) => candidate.type === type);
      if (!item) continue;
      const entry = getCatalogEntry(type);
      if (!entry) continue;
      const x = item.col * TILE_SIZE;
      const y = item.row * TILE_SIZE;
      const width = entry.footprintW * TILE_SIZE;
      const height = entry.sprite.length;
      this.objectBoxes.push({ kind, x, y, width, height });
      this.anchors.set(kind, { x: x + width / 2, y });
    }
  }

  syncAgents(
    visuals: readonly AgentVisual[],
    assignments: readonly PixelsOfficeSeatAssignment[],
  ): void {
    let key = '';
    for (const visual of visuals) {
      key += `${visual.agentId}:${visual.status}:${visual.activity?.icon ?? '-'};`;
    }
    for (const assignment of assignments) {
      key += `${assignment.agentId}@${assignment.seatId};`;
    }
    if (key === this.syncKey) return;
    this.syncKey = key;

    const seatByAgent = new Map<string, PixelsOfficeSeatAssignment>();
    for (const assignment of assignments) seatByAgent.set(assignment.agentId, assignment);

    const stored = this.visuals.size === 0 ? loadStoredPoses(this.companyId) : null;
    const incoming = new Set<string>();

    for (const visual of visuals) {
      incoming.add(visual.agentId);
      this.visuals.set(visual.agentId, visual);
      if (!this.state.characters.has(visual.agentId)) {
        const assignment = seatByAgent.get(visual.agentId);
        this.state.addAgent(visual.agentId, {
          palette: assignment?.characterIndex,
          seatId: assignment?.seatId,
          pose: stored?.get(visual.agentId),
        });
      }
      this.applyStatus(visual);
    }

    for (const agentId of Array.from(this.state.characters.keys())) {
      if (incoming.has(agentId)) continue;
      this.state.removeAgent(agentId);
      this.visuals.delete(agentId);
      this.visits.delete(agentId);
    }

    this.loop.wake();
  }

  private applyStatus(visual: AgentVisual): void {
    const status = visual.status;
    const wandering = status === 'idle';
    const still = status === 'paused' || status === 'budget_paused' || status === 'error';
    this.state.setAgentActive(visual.agentId, !wandering);
    this.state.setAgentStill(visual.agentId, still);
    const reading = visual.activity?.icon === 'read' && !wandering && !still;
    this.state.setAgentTool(visual.agentId, reading ? 'Read' : null);
  }

  readPlacements(): PixelsOfficeSeatAssignment[] {
    const placements: PixelsOfficeSeatAssignment[] = [];
    for (const [agentId, ch] of this.state.characters) {
      if (!ch.seatId) continue;
      placements.push({ agentId, characterIndex: ch.palette, seatId: ch.seatId });
    }
    return placements;
  }

  visual(agentId: string): AgentVisual | undefined {
    return this.visuals.get(agentId);
  }

  forEachPose(visit: (pose: CharacterPose) => void): void {
    for (const ch of this.state.characters.values()) {
      this.fillPose(this.poseScratch, ch);
      visit(this.poseScratch);
    }
  }

  pose(agentId: string): CharacterPose | undefined {
    const ch = this.state.characters.get(agentId);
    if (!ch) return undefined;
    return {
      agentId: ch.id,
      x: ch.x,
      y: ch.y,
      moving: ch.state === CharacterState.WALK,
      seated: ch.state === CharacterState.TYPE,
    };
  }

  private fillPose(pose: CharacterPose, ch: Character): void {
    pose.agentId = ch.id;
    pose.x = ch.x;
    pose.y = ch.y;
    pose.moving = ch.state === CharacterState.WALK;
    pose.seated = ch.state === CharacterState.TYPE;
  }

  objectAnchor(object: OfficeObjectKind): { x: number; y: number } | undefined {
    return this.anchors.get(object);
  }

  emit(effect: OfficeEffect): void {
    if (effect.kind === 'celebrate') {
      if (effect.big) {
        for (const agentId of this.state.characters.keys()) this.state.startHop(agentId);
      } else {
        this.state.startHop(effect.agentId);
      }
    } else if (effect.kind === 'visit') {
      this.startVisit(effect.fromAgentId, effect.toAgentId);
    }
    for (const listener of this.listeners) listener(effect);
    this.loop.wake();
  }

  onEffect(listener: (effect: OfficeEffect) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setOverlayLayers(layers: readonly OverlayLayer[]): void {
    this.overlays = layers;
    this.loop.wake();
  }

  hitTest(screenX: number, screenY: number): OfficeHit {
    const dpr = this.cameraState.dpr;
    const worldX = (screenX * dpr - this.view.offsetX) / this.view.zoom;
    const worldY = (screenY * dpr - this.view.offsetY) / this.view.zoom;
    return hitTestWorld(worldX, worldY, this.state.characters.values(), this.objectBoxes);
  }

  select(agentId: string | null): void {
    this.state.selectedAgentId = agentId;
    this.loop.wake();
  }

  get selectedAgentId(): string | null {
    return this.state.selectedAgentId;
  }

  hover(hit: OfficeHit): void {
    const next = hit !== null && hit.kind === 'agent' ? hit.agentId : null;
    if (next === this.state.hoveredAgentId) return;
    this.state.hoveredAgentId = next;
    this.loop.wake();
  }

  get hoveredAgentId(): string | null {
    return this.state.hoveredAgentId;
  }

  get camera(): OfficeCameraState {
    return this.cameraState;
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.cameraState.panBy(dxScreen, dyScreen);
    this.loop.wake();
  }

  zoomAt(screenX: number, screenY: number, steps: number): void {
    this.cameraState.zoomAt(screenX, screenY, steps);
    this.loop.wake();
  }

  centerOn(worldX: number, worldY: number): void {
    this.cameraState.centerOn(worldX, worldY);
    this.loop.wake();
  }

  follow(agentId: string | null): void {
    this.cameraState.follow(agentId);
    this.loop.wake();
  }

  drawMinimap(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.minimap.draw(ctx, width, height, this.staticLayer, this.state, this.view);
  }

  attach(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas) {
      this.loop.wake();
      return;
    }
    if (this.canvas) this.detach();

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    this.staticLayer ??= buildStaticLayer(
      this.state.getLayout(),
      this.state.tileMap,
      this.state.staticFurniture,
    );

    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
        this.loop.wake();
      });
      this.resizeObserver.observe(canvas);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.loop.start();
  }

  detach(): void {
    this.loop.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.flusher.flushNow();
    this.canvas = null;
    this.ctx = null;
  }

  wake(): void {
    this.loop.wake();
  }

  dispose(): void {
    this.detach();
    this.flusher.dispose();
    this.listeners.clear();
  }

  private resize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round((rect.width || canvas.clientWidth) * dpr));
    const height = Math.max(1, Math.round((rect.height || canvas.clientHeight) * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    this.cameraState.setViewport(width, height, dpr);
    if (!this.fitted) {
      this.cameraState.fitRoom(this.officeRoom);
      this.fitted = true;
    }
  }

  private startVisit(fromAgentId: string, toAgentId: string): void {
    if (this.visits.has(fromAgentId) || fromAgentId === toAgentId) return;
    const target = this.state.characters.get(toAgentId);
    if (!target) return;
    const tile = this.freeTileNear(target.tileCol, target.tileRow);
    if (!tile) return;
    this.state.setAgentPinned(fromAgentId, true);
    if (!this.state.walkToTile(fromAgentId, tile.col, tile.row)) {
      this.state.setAgentPinned(fromAgentId, false);
      return;
    }
    this.visits.set(fromAgentId, {
      toAgentId,
      phase: 'travelling',
      timer: VISIT_TRAVEL_TIMEOUT_SEC,
    });
  }

  private freeTileNear(col: number, row: number): { col: number; row: number } | null {
    const nav = this.state.nav;
    for (let radius = 1; radius <= 3; radius++) {
      for (let dRow = -radius; dRow <= radius; dRow++) {
        for (let dCol = -radius; dCol <= radius; dCol++) {
          if (Math.abs(dRow) !== radius && Math.abs(dCol) !== radius) continue;
          if (nav.isWalkable(col + dCol, row + dRow)) {
            return { col: col + dCol, row: row + dRow };
          }
        }
      }
    }
    return null;
  }

  private updateVisits(dt: number): boolean {
    if (this.visits.size === 0) return false;
    for (const [agentId, visit] of this.visits) {
      const ch = this.state.characters.get(agentId);
      if (!ch) {
        this.visits.delete(agentId);
        continue;
      }
      visit.timer -= dt;
      if (visit.phase === 'travelling') {
        if (ch.state !== CharacterState.WALK) {
          visit.phase = 'lingering';
          visit.timer = VISIT_LINGER_SEC;
        } else if (visit.timer <= 0) {
          this.endVisit(agentId);
        }
        continue;
      }
      if (visit.timer <= 0) this.endVisit(agentId);
    }
    return this.visits.size > 0;
  }

  private endVisit(agentId: string): void {
    this.visits.delete(agentId);
    this.state.setAgentPinned(agentId, false);
  }

  private step(dt: number): number {
    let busy = this.state.update(dt);
    if (this.updateVisits(dt)) busy = true;

    const followed = this.cameraState.followAgentId;
    const followChar = followed !== null ? this.state.characters.get(followed) : undefined;
    if (this.cameraState.update(dt, followChar?.x ?? null, followChar?.y ?? null)) busy = true;

    for (const layer of this.overlays) {
      if (layer.update(dt, this)) busy = true;
    }

    this.flusher.schedule();
    if (busy) return 0;

    const sleep = this.state.nextWakeSeconds();
    return sleep === Number.POSITIVE_INFINITY ? LOOP_SLEEP_FOREVER : Math.max(0.05, sleep);
  }

  private render(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    this.renderedFrames += 1;
    this.view.zoom = this.cameraState.zoom;
    this.view.offsetX = this.cameraState.offsetX;
    this.view.offsetY = this.cameraState.offsetY;
    this.view.width = canvas.width;
    this.view.height = canvas.height;
    this.view.nowMs = Date.now();

    this.renderer.render(ctx, this.state, this.staticLayer, this.view);
    for (const layer of this.overlays) layer.draw(ctx, this.view, this);
  }
}
