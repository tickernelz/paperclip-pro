import { useEffect, useRef } from "react";
import { usePageVisibility } from "@/lib/page-visibility";
import type { OfficeController } from "@/lib/pixels-office/officeModel";

const MINIMAP_WIDTH = 160;
const MINIMAP_HEIGHT = 112;
const MINIMAP_INTERVAL_MS = 250;

export function OfficeMinimap({ office }: { office: OfficeController | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visibility = usePageVisibility();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !office || !visibility.visible) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, Math.round(window.devicePixelRatio || 1));
    canvas.width = MINIMAP_WIDTH * dpr;
    canvas.height = MINIMAP_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let paintedFrame = -1;
    const paint = () => {
      if (office.frameCount === paintedFrame) return;
      paintedFrame = office.frameCount;
      office.drawMinimap(ctx, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    };
    paint();
    const timer = setInterval(paint, MINIMAP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [office, visibility.visible]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Office minimap"
      className="h-(--sz-7rem) w-(--sz-160px) cursor-pointer rounded-md border border-border bg-card"
      onClick={(domEvent) => {
        if (!office) return;
        const rect = domEvent.currentTarget.getBoundingClientRect();
        const ratioX = (domEvent.clientX - rect.left) / rect.width;
        const ratioY = (domEvent.clientY - rect.top) / rect.height;
        office.centerOn(ratioX * office.worldWidth, ratioY * office.worldHeight);
      }}
    />
  );
}
