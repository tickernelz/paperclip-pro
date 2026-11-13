import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "wardmote-omp-local-home-"));
process.env.HOME = home;
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
