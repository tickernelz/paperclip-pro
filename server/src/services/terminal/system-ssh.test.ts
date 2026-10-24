import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemSshFiles } from "./system-ssh.js";

describe("system ssh file access", () => {
  const previous = { PATH: process.env.PATH, HOME: process.env.HOME };
  let work: string;
  let home: string;

  beforeAll(() => {
    work = mkdtempSync(path.join(tmpdir(), "system-ssh-"));
    const bin = path.join(work, "bin");
    home = path.join(work, "home");
    mkdirSync(bin);
    mkdirSync(home);
    writeFileSync(path.join(bin, "ssh"), "#!/bin/sh\nfor a; do last=\"$a\"; done\nexec sh -c \"$last\"\n");
    chmodSync(path.join(bin, "ssh"), 0o755);
    process.env.PATH = `${bin}${path.delimiter}${previous.PATH ?? ""}`;
    process.env.HOME = home;
  });

  afterAll(() => {
    process.env.PATH = previous.PATH;
    process.env.HOME = previous.HOME;
    rmSync(work, { recursive: true, force: true });
  });

  it("delivers the whole file even when the response starts reading after the remote command finished", async () => {
    const body = Buffer.alloc(300_000, 65);
    writeFileSync(path.join(home, "big.txt"), body);
    const files = systemSshFiles({ id: "saved:x", source: "saved", name: "x", destination: "fake", port: null });

    const download = await files.openDownload("big.txt");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const chunks: Buffer[] = [];
    await pipeline(download.stream, new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); } }));

    expect(download.size).toBe(body.length);
    expect(Buffer.concat(chunks).equals(body)).toBe(true);
  });

  it("refuses a download outside the remote home directory", async () => {
    const files = systemSshFiles({ id: "saved:x", source: "saved", name: "x", destination: "fake", port: null });

    await expect(files.openDownload("../outside.txt")).rejects.toMatchObject({ status: 400 });
  });
});
