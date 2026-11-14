import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { SshConfigHostSettings } from "@tickernelz/wardmote-shared";
import { ZodError } from "zod";
import { SSH_CONFIG_ALLOWED_OPTIONS, SSH_IDENTITY_FILE_PATTERN, sshConfigHostInputSchema } from "./schema.js";
import { defaultSshConfigPath, readSshConfigHosts } from "./ssh-hosts.js";

export type SshConfigWriteErrorCode = "duplicate_alias" | "not_found" | "not_managed" | "conflict" | "invalid" | "locked";

export class SshConfigWriteError extends Error {
  constructor(
    readonly code: SshConfigWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SshConfigWriteError";
  }
}

export interface ManagedSshHostBlock {
  alias: string;
  start: number;
  end: number;
  settings: SshConfigHostSettings | null;
}

export interface SshConfigWriterOptions {
  configPath?: string;
  now?: () => Date;
  lockWaitMs?: number;
}

export interface SshConfigReferenceContext {
  reservedAliases?: Iterable<string>;
}

export interface SshConfigWriter {
  readonly configPath: string;
  readonly sshDir: string;
  readManaged(): Promise<ManagedSshHostBlock[]>;
  add(input: SshConfigHostSettings, context?: SshConfigReferenceContext): Promise<SshConfigHostSettings>;
  update(alias: string, input: SshConfigHostSettings, context?: SshConfigReferenceContext): Promise<SshConfigHostSettings>;
  remove(alias: string): Promise<SshConfigHostSettings>;
}

type AllowedOption = (typeof SSH_CONFIG_ALLOWED_OPTIONS)[number];

const ALLOWED_OPTIONS: ReadonlySet<string> = new Set(SSH_CONFIG_ALLOWED_OPTIONS);
const ALLOWED_BY_LOWER = new Map(SSH_CONFIG_ALLOWED_OPTIONS.map((option) => [option.toLowerCase(), option]));
const BEGIN_PATTERN = /^# >>> wardmote host (\S+)(?: .*)?$/;
const END_PATTERN = /^# <<< wardmote host (\S+)\s*$/;
const BEGIN_NOTE = "(added from the Wardmote Terminal; edit it there)";
const LOCK_STALE_MS = 30_000;
const DEFAULT_LOCK_WAIT_MS = 5_000;

const processQueues = new Map<string, Promise<void>>();

function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

export function splitConfigLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function lineBody(raw: string): string {
  return raw.replace(/\r?\n$/, "");
}

function parseCount(value: string | undefined): number | null {
  if (value === undefined) return null;
  return /^[0-9]{1,6}$/.test(value) ? Number(value) : Number.NaN;
}

function parseBlockSettings(alias: string, body: string[]): SshConfigHostSettings | null {
  const values = new Map<AllowedOption, string>();
  let hostSeen = false;
  for (const raw of body) {
    const line = lineBody(raw).trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z]+)(?:\s*=\s*|\s+)(\S+)$/.exec(line);
    if (!match) return null;
    const keyword = match[1]!.toLowerCase();
    const value = match[2]!;
    if (keyword === "host") {
      if (hostSeen || value !== alias) return null;
      hostSeen = true;
      continue;
    }
    const option = ALLOWED_BY_LOWER.get(keyword);
    if (!option || values.has(option) || !hostSeen) return null;
    values.set(option, value);
  }
  const hostName = values.get("HostName");
  if (!hostSeen || hostName === undefined) return null;
  const identitiesOnly = values.get("IdentitiesOnly");
  if (identitiesOnly !== undefined && identitiesOnly !== "yes") return null;
  const candidate = {
    alias,
    hostName,
    user: values.get("User") ?? null,
    port: parseCount(values.get("Port")),
    identityFile: values.get("IdentityFile") ?? null,
    proxyJump: values.get("ProxyJump") ?? null,
    serverAliveInterval: parseCount(values.get("ServerAliveInterval")),
    serverAliveCountMax: parseCount(values.get("ServerAliveCountMax")),
  };
  const parsed = sshConfigHostInputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function findManagedBlocks(lines: string[]): ManagedSshHostBlock[] {
  const blocks: ManagedSshHostBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const begin = BEGIN_PATTERN.exec(lineBody(lines[index]!));
    if (!begin) continue;
    const alias = begin[1]!;
    let end = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const body = lineBody(lines[cursor]!);
      if (BEGIN_PATTERN.test(body)) break;
      const close = END_PATTERN.exec(body);
      if (close) {
        if (close[1] === alias) end = cursor;
        break;
      }
    }
    if (end < 0) continue;
    blocks.push({ alias, start: index, end, settings: parseBlockSettings(alias, lines.slice(index + 1, end)) });
    index = end;
  }
  return blocks;
}

function optionLines(settings: SshConfigHostSettings): Array<[AllowedOption, string]> {
  const options: Array<[AllowedOption, string]> = [["HostName", settings.hostName]];
  if (settings.user !== null) options.push(["User", settings.user]);
  if (settings.port !== null) options.push(["Port", String(settings.port)]);
  if (settings.identityFile !== null) {
    options.push(["IdentityFile", settings.identityFile]);
    options.push(["IdentitiesOnly", "yes"]);
  }
  if (settings.proxyJump !== null) options.push(["ProxyJump", settings.proxyJump]);
  if (settings.serverAliveInterval !== null) options.push(["ServerAliveInterval", String(settings.serverAliveInterval)]);
  if (settings.serverAliveCountMax !== null) options.push(["ServerAliveCountMax", String(settings.serverAliveCountMax)]);
  return options;
}

export function renderManagedBlock(settings: SshConfigHostSettings, eol = "\n"): string {
  const options = optionLines(settings);
  for (const [option, value] of options) {
    if (!ALLOWED_OPTIONS.has(option) || !/^[\x21-\x7e]+$/.test(value)) {
      throw new SshConfigWriteError("invalid", `Refusing to write ssh option ${option}`);
    }
  }
  return [
    `# >>> wardmote host ${settings.alias} ${BEGIN_NOTE}`,
    `Host ${settings.alias}`,
    ...options.map(([option, value]) => `    ${option} ${value}`),
    `# <<< wardmote host ${settings.alias}`,
  ]
    .map((line) => line + eol)
    .join("");
}

function insertionIndex(lines: string[], blocks: ManagedSshHostBlock[]): number {
  const inBlock = (index: number) => blocks.some((block) => index >= block.start && index <= block.end);
  for (let index = 0; index < lines.length; index += 1) {
    if (inBlock(index)) continue;
    if (!/^(host|match)(\s|=)/i.test(lineBody(lines[index]!).trim())) continue;
    let start = index;
    while (start > 0 && !inBlock(start - 1) && lineBody(lines[start - 1]!).trim().startsWith("#")) start -= 1;
    return start;
  }
  return lines.length;
}

function parseInput(input: SshConfigHostSettings): SshConfigHostSettings {
  try {
    return sshConfigHostInputSchema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue?.path.join(".") || "host";
      throw new SshConfigWriteError("invalid", `${field}: ${issue?.message ?? "invalid value"}`);
    }
    throw err;
  }
}

async function readText(file: string): Promise<string | null> {
  return fs.readFile(file, "utf8").catch((err: unknown) => {
    if (errnoCode(err) === "ENOENT") return null;
    throw err;
  });
}

export async function resolveConfigWriteTarget(configPath: string): Promise<string> {
  try {
    return await fs.realpath(configPath);
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") throw err;
  }
  const link = await fs.lstat(configPath).catch(() => null);
  if (link?.isSymbolicLink()) {
    return path.resolve(path.dirname(configPath), await fs.readlink(configPath));
  }
  return configPath;
}

async function withLockFile<T>(lockPath: string, waitMs: number, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (err) {
      if (errnoCode(err) !== "EEXIST") throw err;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() > deadline) {
        throw new SshConfigWriteError("locked", `${lockPath} is held by another writer. Try again in a moment.`);
      }
      await delay(50);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.unlink(lockPath).catch(() => undefined);
  }
}

export async function withSshFileLock<T>(target: string, fn: () => Promise<T>, waitMs = DEFAULT_LOCK_WAIT_MS): Promise<T> {
  const previous = processQueues.get(target) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const current = previous.then(() => gate);
  processQueues.set(target, current);
  await previous;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    return await withLockFile(`${target}.wardmote.lock`, waitMs, fn);
  } finally {
    release();
    if (processQueues.get(target) === current) processQueues.delete(target);
  }
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function writeFileAtomically(target: string, original: string | null, next: string, beforeRename?: () => Promise<void>) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.wardmote-${randomUUID()}.tmp`);
  const handle = await fs.open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(next, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if ((await readText(target)) !== original) {
      throw new SshConfigWriteError("conflict", `${target} changed while saving. Reload and try again.`);
    }
    await beforeRename?.();
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
  await fs.chmod(target, 0o600);
}

export function sshConfigWriter(options: SshConfigWriterOptions = {}): SshConfigWriter {
  const configPath = options.configPath ?? defaultSshConfigPath();
  const sshDir = path.dirname(configPath);
  const now = options.now ?? (() => new Date());
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  const backedUp = new Set<string>();

  async function backup(target: string) {
    if (backedUp.has(target)) return;
    const copy = `${target}.wardmote-backup-${timestamp(now())}`;
    await fs.copyFile(target, copy, fsConstants.COPYFILE_EXCL).catch((err: unknown) => {
      if (errnoCode(err) !== "EEXIST") throw err;
    });
    await fs.chmod(copy, 0o600);
    backedUp.add(target);
  }

  async function mutate(
    change: (lines: string[], blocks: ManagedSshHostBlock[], eol: string, aliases: Set<string>) => Promise<string[]>,
  ) {
    const target = await resolveConfigWriteTarget(configPath);
    return withSshFileLock(
      target,
      async () => {
        const original = await readText(target);
        const text = original ?? "";
        const lines = splitConfigLines(text);
        const blocks = findManagedBlocks(lines);
        const listed = await readSshConfigHosts({ configPath });
        const aliases = new Set(listed.hosts.map((host) => host.name.toLowerCase()));
        for (const block of blocks) aliases.add(block.alias.toLowerCase());
        const next = await change(lines, blocks, text.includes("\r\n") ? "\r\n" : "\n", aliases);
        await writeFileAtomically(target, original, next.join(""), original === null ? undefined : () => backup(target));
      },
      lockWaitMs,
    );
  }

  async function checkReferences(settings: SshConfigHostSettings, aliases: Set<string>) {
    if (settings.proxyJump !== null && !aliases.has(settings.proxyJump.toLowerCase())) {
      throw new SshConfigWriteError("invalid", `proxyJump: ${settings.proxyJump} is not a host in ${configPath}`);
    }
    if (settings.identityFile !== null) {
      const name = SSH_IDENTITY_FILE_PATTERN.exec(settings.identityFile)?.[1];
      const stat = name ? await fs.stat(path.join(sshDir, name)).catch(() => null) : null;
      if (!stat?.isFile()) throw new SshConfigWriteError("invalid", `identityFile: ${settings.identityFile} does not exist`);
    }
  }

  function managedBlock(blocks: ManagedSshHostBlock[], alias: string): ManagedSshHostBlock & { settings: SshConfigHostSettings } {
    const block = blocks.find((entry) => entry.alias === alias);
    if (!block) throw new SshConfigWriteError("not_found", `${alias} is not a host added from the Wardmote Terminal`);
    if (!block.settings) {
      throw new SshConfigWriteError("not_managed", `${alias} was edited by hand. Change it in ${configPath}.`);
    }
    return block as ManagedSshHostBlock & { settings: SshConfigHostSettings };
  }

  function assertNotJumpTarget(blocks: ManagedSshHostBlock[], alias: string) {
    const user = blocks.find((block) => block.alias !== alias && block.settings?.proxyJump === alias);
    if (user) throw new SshConfigWriteError("invalid", `${user.alias} connects via ${alias}. Change ${user.alias} first.`);
  }

  function reserved(context: SshConfigReferenceContext | undefined): Set<string> {
    return new Set([...(context?.reservedAliases ?? [])].map((alias) => alias.toLowerCase()));
  }

  return {
    configPath,
    sshDir,
    async readManaged() {
      const target = await resolveConfigWriteTarget(configPath);
      const text = await readText(target);
      return text === null ? [] : findManagedBlocks(splitConfigLines(text));
    },
    async add(input, context) {
      const settings = parseInput(input);
      await mutate(async (lines, blocks, eol, aliases) => {
        const key = settings.alias.toLowerCase();
        if (aliases.has(key) || reserved(context).has(key)) {
          throw new SshConfigWriteError("duplicate_alias", `A host named ${settings.alias} already exists`);
        }
        await checkReferences(settings, aliases);
        const index = insertionIndex(lines, blocks);
        const block = renderManagedBlock(settings, eol);
        if (index < lines.length) return [...lines.slice(0, index), block + eol, ...lines.slice(index)];
        const last = lines.at(-1);
        const prefix = last === undefined ? "" : (last.endsWith("\n") ? "" : eol) + (lineBody(last).trim() ? eol : "");
        return [...lines, prefix + block];
      });
      return settings;
    },
    async update(alias, input, context) {
      const settings = parseInput(input);
      await mutate(async (lines, blocks, eol, aliases) => {
        const block = managedBlock(blocks, alias);
        if (settings.alias !== alias) {
          const key = settings.alias.toLowerCase();
          if (aliases.has(key) || reserved(context).has(key)) {
            throw new SshConfigWriteError("duplicate_alias", `A host named ${settings.alias} already exists`);
          }
          assertNotJumpTarget(blocks, alias);
        }
        await checkReferences(settings, aliases);
        return [...lines.slice(0, block.start), renderManagedBlock(settings, eol), ...lines.slice(block.end + 1)];
      });
      return settings;
    },
    async remove(alias) {
      let removed: SshConfigHostSettings | null = null;
      await mutate(async (lines, blocks) => {
        const block = managedBlock(blocks, alias);
        assertNotJumpTarget(blocks, alias);
        removed = block.settings;
        const after = lines[block.end + 1];
        const end = after !== undefined && lineBody(after).trim() === "" ? block.end + 2 : block.end + 1;
        return [...lines.slice(0, block.start), ...lines.slice(end)];
      });
      return removed!;
    },
  };
}
