
"use strict";

const fs = require("node:fs");

const NAME = "auth.json";
const home = process.argv[1];
const max = Number.parseInt(process.argv[2], 10);
const expectedUid =
  process.argv[3] !== undefined ? Number.parseInt(process.argv[3], 10) : process.getuid();

function fail() {
  process.stderr.write("AUTH_READ_FAILED\n");
  process.exit(1);
}

if (!Number.isInteger(max) || max <= 0) fail();
if (typeof home !== "string" || !home.startsWith("/")) fail();
const parts = home.split("/").filter((component) => component.length > 0);
if (parts.length === 0) fail();

// Open each component with a no-follow, directory-only open relative to the
// previous descriptor. A symlink or a non-directory at any component throws, so
// the read fails closed and never leaves the trusted tree.
let dfd;
try {
  dfd = fs.openSync("/", fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
} catch {
  fail();
}
for (const part of parts) {
  try {
    dfd = fs.openSync(
      `/proc/self/fd/${dfd}/${part}`,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    fail();
  }
}

// Open the credential relative to the final directory descriptor with a no-follow
// open, so a symlink credential fails and a missing credential fails.
let ffd;
try {
  ffd = fs.openSync(`/proc/self/fd/${dfd}/${NAME}`, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
} catch {
  fail();
}

// Validate the opened descriptor, then read only from it.
const st = fs.fstatSync(ffd);
if (!st.isFile()) fail();
if (st.uid !== expectedUid) fail();
if ((st.mode & 0o7777) !== 0o600) fail();
if (st.size > max) fail();

const buffer = Buffer.allocUnsafe(65536);
const chunks = [];
let total = 0;
for (;;) {
  const read = fs.readSync(ffd, buffer, 0, buffer.length, null);
  if (read === 0) break;
  chunks.push(Buffer.from(buffer.subarray(0, read)));
  total += read;
  if (total > max) fail();
}

process.stdout.write(Buffer.concat(chunks).toString("base64"));
process.exit(0);
