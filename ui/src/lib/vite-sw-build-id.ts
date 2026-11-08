import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { serviceWorkerBuildIdFromFileName } from "./service-worker-build-id";

/**
 * Stamp the service worker with a per-build id so bundle-only deploys still
 * refresh parked tabs.
 *
 * `sw.js` is a static public asset copied verbatim into the build, and its
 * update machinery (`service-worker-updates.ts`) only reloads a parked tab when
 * a *new* worker takes control — which happens only when `sw.js` changes
 * byte-for-byte. Without this, a deploy that ships a new app bundle but the same
 * `sw.js` installs no new worker, so an open tab keeps running the old bundle
 * until someone reloads by hand. Rewriting the placeholder with a value derived
 * from the bundle makes `sw.js` change exactly when the app does.
 */

export const SERVICE_WORKER_BUILD_ID_PLACEHOLDER = "__PAPERCLIP_BUILD_ID__";

/**
 * Replace the build-id placeholder in a service-worker source string.
 *
 * Throws when the placeholder is absent: that means the worker drifted away
 * from the contract (renamed or removed placeholder) and would ship a service
 * worker that never rotates — the exact bug this plugin exists to prevent — so
 * a loud build failure beats a silent no-op.
 */
export function stampServiceWorkerBuildId(source: string, buildId: string): string {
  if (!source.includes(SERVICE_WORKER_BUILD_ID_PLACEHOLDER)) {
    throw new Error(
      `service worker is missing the ${SERVICE_WORKER_BUILD_ID_PLACEHOLDER} placeholder; ` +
        "the build cannot stamp a build id and parked tabs would not refresh after a deploy",
    );
  }
  if (!buildId) {
    throw new Error("refusing to stamp the service worker with an empty build id");
  }
  return source.split(SERVICE_WORKER_BUILD_ID_PLACEHOLDER).join(buildId);
}

export function serviceWorkerBuildIdPlugin(
  options: { serviceWorkerFileName?: string } = {},
): Plugin {
  const serviceWorkerFileName = options.serviceWorkerFileName ?? "sw.js";
  let buildId: string | null = null;
  let bundleGenerated = false;
  let outDir = "dist";

  return {
    name: "paperclip-sw-build-id",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      bundleGenerated = true;
      const entry = Object.values(bundle).find(
        (chunk) => chunk.type === "chunk" && chunk.isEntry,
      );
      if (entry) {
        buildId = serviceWorkerBuildIdFromFileName(entry.fileName);
      }
    },
    closeBundle() {
      if (!bundleGenerated) return;
      const swPath = path.resolve(outDir, serviceWorkerFileName);
      const source = fs.readFileSync(swPath, "utf8");
      const stamped = stampServiceWorkerBuildId(source, buildId ?? "build");
      fs.writeFileSync(swPath, stamped);
    },
  };
}
