import { randomBytes } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { resolveDefaultSecretsKeyFilePath } from "../../home-paths.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export const DEFAULT_VAPID_SUBJECT = "mailto:admin@localhost";

export function resolveVapidKeyFilePath() {
  return path.join(path.dirname(resolveDefaultSecretsKeyFilePath()), "web-push-vapid.json");
}

function isErrno(error: unknown, code: string) {
  return (error as NodeJS.ErrnoException).code === code;
}

function readVapidKeys(filePath: string): VapidKeys {
  const stats = lstatSync(filePath);
  if (!stats.isFile()) throw new Error(`Web Push VAPID key file at ${filePath} must be a regular file`);
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) chmodSync(filePath, 0o600);
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<VapidKeys>;
  if (typeof parsed.publicKey !== "string" || typeof parsed.privateKey !== "string" || !parsed.publicKey || !parsed.privateKey) {
    throw new Error(`Invalid Web Push VAPID key file at ${filePath}; remove it to regenerate`);
  }
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}

export function loadOrCreateVapidKeys(filePath = resolveVapidKeyFilePath()): VapidKeys {
  try {
    return readVapidKeys(filePath);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const generated = webpush.generateVAPIDKeys();
  const keys: VapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(keys)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      linkSync(temporaryPath, filePath);
      return keys;
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      return readVapidKeys(filePath);
    }
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
    }
  }
}

export function resolveVapidSubject(publicBaseUrl: string | null | undefined) {
  if (!publicBaseUrl) return DEFAULT_VAPID_SUBJECT;
  try {
    const url = new URL(publicBaseUrl);
    if (url.protocol === "https:" && url.hostname !== "localhost") return url.origin;
  } catch {
    return DEFAULT_VAPID_SUBJECT;
  }
  return DEFAULT_VAPID_SUBJECT;
}
