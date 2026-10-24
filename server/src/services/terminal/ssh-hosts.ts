import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { terminalSshHosts } from "@tickernelz/paperclip-pro-db";
import type {
  CreateTerminalSshHostRequest,
  TerminalSshHost,
  TerminalSshHostList,
} from "@tickernelz/paperclip-pro-shared";

export const SSH_CONFIG_HOST_ID_PREFIX = "config:";
export const SSH_SAVED_HOST_ID_PREFIX = "saved:";
export const SSH_CONFIG_MAX_INCLUDE_DEPTH = 8;

export interface SshConfigParseResult {
  hosts: TerminalSshHost[];
  configPath: string;
  configError: string | null;
}

export function defaultSshConfigPath(home: string = homedir()): string {
  return path.join(home, ".ssh", "config");
}

interface ParseContext {
  hosts: Map<string, TerminalSshHost>;
  baseDir: string;
  depth: number;
  seen: Set<string>;
}

interface PendingHost {
  aliases: string[];
  hostname: string | null;
  user: string | null;
  port: number | null;
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"' && index + 1 < line.length) {
        current += line[index + 1];
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === " " || char === "\t") {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    if (char === "#" && !started) break;
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

function splitKeyword(tokens: string[]): string[] {
  const first = tokens[0];
  if (first === undefined) return tokens;
  const equals = first.indexOf("=");
  if (equals <= 0) return tokens;
  return [first.slice(0, equals), first.slice(equals + 1), ...tokens.slice(1)];
}

function isLiteralAlias(pattern: string): boolean {
  if (!pattern || pattern.startsWith("-") || pattern.startsWith("!")) return false;
  if (/[*?]/.test(pattern)) return false;
  return !/[\s\x00-\x1f\x7f]/.test(pattern);
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function commitBlock(pending: PendingHost, hosts: Map<string, TerminalSshHost>) {
  for (const alias of pending.aliases) {
    if (hosts.has(alias)) continue;
    const hostname = pending.hostname ?? alias;
    hosts.set(alias, {
      id: `${SSH_CONFIG_HOST_ID_PREFIX}${alias}`,
      source: "config",
      name: alias,
      destination: pending.user ? `${pending.user}@${hostname}` : hostname,
      port: pending.port,
    });
  }
}

async function readConfigFile(file: string): Promise<string | null> {
  return fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
}

function expandIncludePath(pattern: string, baseDir: string): string {
  const trimmed = pattern.replace(/^~(?=\/|$)/, homedir());
  return path.isAbsolute(trimmed) ? trimmed : path.join(baseDir, trimmed);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

async function expandIncludeGlob(target: string): Promise<string[]> {
  const name = path.basename(target);
  if (!/[*?]/.test(name)) return [target];
  const directory = path.dirname(target);
  const matcher = globToRegExp(name);
  const entries = await fs.readdir(directory).catch(() => []);
  return entries
    .filter((entry) => matcher.test(entry))
    .sort()
    .map((entry) => path.join(directory, entry));
}

async function includeFiles(patterns: string[], context: ParseContext): Promise<void> {
  if (context.depth >= SSH_CONFIG_MAX_INCLUDE_DEPTH) return;
  for (const pattern of patterns) {
    for (const file of await expandIncludeGlob(expandIncludePath(pattern, context.baseDir))) {
      const real = await fs.realpath(file).catch(() => null);
      if (real === null || context.seen.has(real)) continue;
      context.seen.add(real);
      const text = await readConfigFile(file).catch(() => null);
      if (text === null) continue;
      await parseConfigText(text, { ...context, depth: context.depth + 1 });
    }
  }
}

async function parseConfigText(text: string, context: ParseContext): Promise<void> {
  let pending: PendingHost | null = null;
  let skipping = false;
  const finalize = () => {
    if (pending) commitBlock(pending, context.hosts);
    pending = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const tokens = splitKeyword(tokenize(raw));
    if (tokens.length === 0) continue;
    const keyword = tokens[0]!.toLowerCase();
    if (keyword === "host") {
      finalize();
      skipping = false;
      const aliases = tokens.slice(1).filter(isLiteralAlias);
      pending = aliases.length > 0 ? { aliases, hostname: null, user: null, port: null } : null;
      continue;
    }
    if (keyword === "match") {
      finalize();
      skipping = true;
      continue;
    }
    if (keyword === "include") {
      if (!skipping) await includeFiles(tokens.slice(1), context);
      continue;
    }
    if (skipping || !pending) continue;
    if (keyword === "hostname") {
      if (pending.hostname === null && tokens[1]) pending.hostname = tokens[1];
    } else if (keyword === "user") {
      if (pending.user === null && tokens[1]) pending.user = tokens[1];
    } else if (keyword === "port") {
      const port = parsePort(tokens[1]);
      if (pending.port === null && port !== null) pending.port = port;
    }
  }
  finalize();
}

export async function readSshConfigHosts(options: { configPath?: string } = {}): Promise<SshConfigParseResult> {
  const configPath = options.configPath ?? defaultSshConfigPath();
  const hosts = new Map<string, TerminalSshHost>();
  let configError: string | null = null;
  try {
    const text = await readConfigFile(configPath);
    if (text !== null) {
      await parseConfigText(text, { hosts, baseDir: path.dirname(configPath), depth: 0, seen: new Set() });
    }
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }
  const listed = [...hosts.values()].sort((left, right) => left.name.localeCompare(right.name));
  return { hosts: configError === null ? listed : [], configPath, configError };
}

export function savedSshHostId(id: string): string {
  return `${SSH_SAVED_HOST_ID_PREFIX}${id}`;
}

export function parseSavedSshHostId(hostId: string): string | null {
  if (!hostId.startsWith(SSH_SAVED_HOST_ID_PREFIX)) return null;
  const id = hostId.slice(SSH_SAVED_HOST_ID_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export interface TerminalSshHostStore {
  list(companyId: string): Promise<TerminalSshHostList>;
  create(
    companyId: string,
    input: CreateTerminalSshHostRequest,
    createdByUserId: string | null,
  ): Promise<TerminalSshHost | null>;
  remove(companyId: string, hostId: string): Promise<boolean>;
  resolve(companyId: string, hostId: string): Promise<TerminalSshHost | null>;
}

export interface SshHostStoreOptions {
  configPath?: string;
  readConfig?: (configPath: string) => Promise<SshConfigParseResult>;
}

function savedRow(row: { id: string; name: string; destination: string; port: number | null }): TerminalSshHost {
  return {
    id: savedSshHostId(row.id),
    source: "saved",
    name: row.name,
    destination: row.destination,
    port: row.port,
  };
}

export function databaseSshHostStore(db: Db, options: SshHostStoreOptions = {}): TerminalSshHostStore {
  const readConfig = options.readConfig ?? ((configPath: string) => readSshConfigHosts({ configPath }));
  const configPath = options.configPath ?? defaultSshConfigPath();
  const loadConfig = () => readConfig(configPath);

  async function savedHosts(companyId: string): Promise<TerminalSshHost[]> {
    const rows = await db
      .select({
        id: terminalSshHosts.id,
        name: terminalSshHosts.name,
        destination: terminalSshHosts.destination,
        port: terminalSshHosts.port,
      })
      .from(terminalSshHosts)
      .where(eq(terminalSshHosts.companyId, companyId))
      .orderBy(asc(terminalSshHosts.name));
    return rows.map(savedRow);
  }

  return {
    async list(companyId) {
      const [config, saved] = await Promise.all([loadConfig(), savedHosts(companyId)]);
      return {
        hosts: [...config.hosts, ...saved],
        configPath: config.configPath,
        configError: config.configError,
      };
    },
    async create(companyId, input, createdByUserId) {
      const rows = await db
        .insert(terminalSshHosts)
        .values({
          companyId,
          name: input.name,
          destination: input.destination,
          port: input.port ?? null,
          createdByUserId,
        })
        .onConflictDoNothing()
        .returning({
          id: terminalSshHosts.id,
          name: terminalSshHosts.name,
          destination: terminalSshHosts.destination,
          port: terminalSshHosts.port,
        });
      const row = rows[0];
      return row ? savedRow(row) : null;
    },
    async remove(companyId, hostId) {
      const id = parseSavedSshHostId(hostId);
      if (!id) return false;
      const rows = await db
        .delete(terminalSshHosts)
        .where(and(eq(terminalSshHosts.companyId, companyId), eq(terminalSshHosts.id, id)))
        .returning({ id: terminalSshHosts.id });
      return rows.length > 0;
    },
    async resolve(companyId, hostId) {
      const id = parseSavedSshHostId(hostId);
      if (id) {
        const rows = await db
          .select({
            id: terminalSshHosts.id,
            name: terminalSshHosts.name,
            destination: terminalSshHosts.destination,
            port: terminalSshHosts.port,
          })
          .from(terminalSshHosts)
          .where(and(eq(terminalSshHosts.companyId, companyId), eq(terminalSshHosts.id, id)))
          .limit(1);
        const row = rows[0];
        return row ? savedRow(row) : null;
      }
      const config = await loadConfig();
      return config.hosts.find((host) => host.id === hostId) ?? null;
    },
  };
}
