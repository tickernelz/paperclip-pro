import { z } from "zod";
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  TERMINAL_WEBSOCKET_PATH,
} from "@tickernelz/wardmote-shared";

export const createTerminalSessionSchema = z
  .object({
    kind: z.enum(["local", "ssh"]),
    issueId: z.string().uuid().optional(),
    environmentId: z.string().uuid().optional(),
    sshHostId: z.string().trim().min(1).max(300).optional(),
    cols: z.number().int().min(TERMINAL_MIN_COLS).max(TERMINAL_MAX_COLS).optional(),
    rows: z.number().int().min(TERMINAL_MIN_ROWS).max(TERMINAL_MAX_ROWS).optional(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "ssh" && !value.environmentId) {
      ctx.addIssue({ code: "custom", path: ["environmentId"], message: "SSH terminals require environmentId" });
    }
    if (value.sshHostId && value.kind !== "local") {
      ctx.addIssue({ code: "custom", path: ["sshHostId"], message: "sshHostId opens a host-side ssh client and needs kind \"local\"" });
    }
    if (value.sshHostId && value.issueId) {
      ctx.addIssue({ code: "custom", path: ["issueId"], message: "sshHostId cannot be combined with issueId" });
    }
  });

export const terminalSessionResponseSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  kind: z.enum(["local", "ssh"]),
  title: z.string(),
  cwd: z.string().nullable(),
  issueId: z.string().nullable(),
  environmentId: z.string().nullable(),
  status: z.enum(["running", "exited"]),
  exitCode: z.number().int().nullable(),
  cols: z.number().int(),
  rows: z.number().int(),
  attachedClients: z.number().int(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  createdByUserId: z.string().nullable(),
  sshHost: z.string().nullable(),
});

export const sshConfigHostSettingsSchema = z.object({
  alias: z.string(),
  hostName: z.string(),
  user: z.string().nullable(),
  port: z.number().int().nullable(),
  identityFile: z.string().nullable(),
  proxyJump: z.string().nullable(),
  serverAliveInterval: z.number().int().nullable(),
  serverAliveCountMax: z.number().int().nullable(),
});

export const terminalSshHostSchema = z.object({
  id: z.string(),
  source: z.enum(["config", "saved"]),
  name: z.string(),
  destination: z.string(),
  port: z.number().int().nullable(),
  managed: z.boolean().optional(),
  settings: sshConfigHostSettingsSchema.nullable().optional(),
});

export const terminalSshHostListSchema = z.object({
  hosts: z.array(terminalSshHostSchema),
  configPath: z.string(),
  configError: z.string().nullable(),
});

export const createTerminalSshHostSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    destination: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^(?:[A-Za-z0-9._][A-Za-z0-9._-]*@)?[A-Za-z0-9._][A-Za-z0-9._:-]*$/, "Destination must look like host or user@host"),
    port: z.number().int().min(1).max(65535).optional(),
  })
  .strict();

export const SSH_CONFIG_ALLOWED_OPTIONS = [
  "HostName",
  "User",
  "Port",
  "IdentityFile",
  "IdentitiesOnly",
  "ProxyJump",
  "ServerAliveInterval",
  "ServerAliveCountMax",
] as const;

export const SSH_ALIAS_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,62}$/;
const SSH_HOSTNAME_PATTERN = /^(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)*$/;
const SSH_IPV6_PATTERN = /^(?=.*:)[0-9A-Fa-f:.]{2,45}$/;
const SSH_USER_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
export const SSH_KEY_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
export const SSH_IDENTITY_FILE_PATTERN = /^~\/\.ssh\/([A-Za-z0-9_][A-Za-z0-9._-]{0,63})$/;

export const sshAliasSchema = z
  .string()
  .regex(SSH_ALIAS_PATTERN, "Use letters, digits, '.', '_' or '-', starting with a letter, digit or '_'");

export const sshConfigHostInputSchema = z
  .object({
    alias: sshAliasSchema,
    hostName: z
      .string()
      .max(253)
      .refine((value) => SSH_HOSTNAME_PATTERN.test(value) || SSH_IPV6_PATTERN.test(value), "Enter a hostname or IP address"),
    user: z.string().regex(SSH_USER_PATTERN, "Use letters, digits, '.', '_' or '-'").nullable(),
    port: z.number().int().min(1).max(65535).nullable(),
    identityFile: z.string().regex(SSH_IDENTITY_FILE_PATTERN, "Pick a key file inside ~/.ssh").nullable(),
    proxyJump: sshAliasSchema.nullable(),
    serverAliveInterval: z.number().int().min(0).max(86400).nullable(),
    serverAliveCountMax: z.number().int().min(1).max(1000).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.proxyJump !== null && value.proxyJump === value.alias) {
      ctx.addIssue({ code: "custom", path: ["proxyJump"], message: "A host cannot connect via itself" });
    }
    if (value.identityFile !== null && value.identityFile.endsWith(".pub")) {
      ctx.addIssue({ code: "custom", path: ["identityFile"], message: "Pick the private key, not the .pub file" });
    }
  });

export const sshConnectionTargetSchema = z.union([
  z.object({ alias: sshAliasSchema }).strict(),
  z.object({ host: sshConfigHostInputSchema }).strict(),
]);

const SSH_PRIVATE_KEY_MAX_BYTES = 16 * 1024;

const sshKeyNameSchema = z
  .string()
  .regex(SSH_KEY_NAME_PATTERN, "Use letters, digits, '.', '_' or '-'")
  .refine((value) => !value.endsWith(".pub"), "Key names cannot end in .pub")
  .refine(
    (value) => !["config", "known_hosts", "known_hosts2", "known_hosts.old", "authorized_keys", "authorized_keys2", "environment", "rc"].includes(value),
    "That name is reserved by ssh",
  );

export const createSshKeySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("generate"),
      name: sshKeyNameSchema,
      comment: z.string().regex(/^[A-Za-z0-9 @._:+-]{0,100}$/, "Comments may use letters, digits, spaces and @._:+-").optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("import"),
      name: sshKeyNameSchema,
      privateKey: z.string().min(1).max(SSH_PRIVATE_KEY_MAX_BYTES),
    })
    .strict(),
]);

export const trustSshHostKeySchema = z
  .object({
    target: sshConnectionTargetSchema,
    fingerprints: z.array(z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/)).min(1).max(10),
  })
  .strict();

export const sshKeyInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string().nullable(),
  fingerprint: z.string().nullable(),
  comment: z.string().nullable(),
  encrypted: z.boolean().nullable(),
  publicKey: z.string().nullable(),
});

export const sshKeyListSchema = z.object({ keys: z.array(sshKeyInfoSchema), sshDir: z.string() });

const sshHostKeySchema = z.object({ type: z.string(), fingerprint: z.string() });

export const sshConnectionTestResultSchema = z.object({
  status: z.enum([
    "ok",
    "host_key_unknown",
    "host_key_changed",
    "auth_failed",
    "dns_failed",
    "unreachable",
    "timeout",
    "key_unusable",
    "failed",
  ]),
  message: z.string(),
  detail: z.string().nullable(),
  hostKeys: z.array(sshHostKeySchema),
  durationMs: z.number().int(),
});

export const trustSshHostKeyResultSchema = z.object({
  added: z.array(sshHostKeySchema),
  knownHostsPath: z.string(),
});

export const terminalAttachTokenResponseSchema = z.object({
  sessionId: z.string(),
  token: z.string(),
  expiresAt: z.string(),
  websocketPath: z.literal(TERMINAL_WEBSOCKET_PATH),
});

export const terminalUploadResultSchema = z.object({
  path: z.string(),
  bytes: z.number().int(),
});

export const terminalDownloadQuerySchema = z.object({
  path: z.string().min(1),
});
