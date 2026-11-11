import { posix as pathPosix } from "node:path";

const INIT_RE =
  /^mkdir -p '([^']+)' && rm -f '([^']+)\.wardmote-upload\.b64' && : > '\2\.wardmote-upload\.b64'$/;
const CHUNK_RE =
  /^printf '%s' '([A-Za-z0-9+/=]+)' >> '([^']+)\.wardmote-upload\.b64'$/;
const FINALIZE_RE =
  /^base64 -d < '([^']+)\.wardmote-upload\.b64' > '\1' && rm -f '\1\.wardmote-upload\.b64'$/;

const MAX_BUFFER_BYTES = 100 * 1024 * 1024; // 100MB safety cap

export interface InterceptStateFlush {
  /** Final target path on the remote (decoded payload goes here). */
  targetPath: string;
  /** Decoded payload bytes. */
  payload: Buffer;
}

export type InterceptDecision =
  /** Pattern recognized; respond with success without running the command. */
  | { action: "ack"; reason: string }
  /** Pattern recognized; flush via single exec. Caller does the exec. */
  | { action: "flush"; flush: InterceptStateFlush }
  /** Pattern not recognized; pass through to the normal exec path. */
  | { action: "passthrough"; reason: string };

interface BufferState {
  targetPath: string;
  chunks: string[];
  totalChars: number;
}

export class FastUploadInterceptor {
  private buffers = new Map<string, BufferState>();

  /**
   * Inspect a single shell command (the literal argument to `sh -c <cmd>`).
   * Returns the action the plugin should take.
   */
  decide(command: string): InterceptDecision {
    // 1. INIT
    const initMatch = INIT_RE.exec(command);
    if (initMatch) {
      const dir = initMatch[1];
      const targetPath = initMatch[2];
      const b64Path = `${targetPath}.wardmote-upload.b64`;
      // Sanity: dir should be the parent of target. If not, fall through.
      if (pathPosix.dirname(targetPath) !== dir) {
        return { action: "passthrough", reason: "init dir/target mismatch" };
      }
      this.buffers.set(b64Path, { targetPath, chunks: [], totalChars: 0 });
      return { action: "ack", reason: `init upload to ${targetPath}` };
    }

    // 2. CHUNK
    const chunkMatch = CHUNK_RE.exec(command);
    if (chunkMatch) {
      const base64 = chunkMatch[1];
      const targetPath = chunkMatch[2];
      const b64Path = `${targetPath}.wardmote-upload.b64`;
      const state = this.buffers.get(b64Path);
      if (!state) {
        // Chunk arrived without init — must passthrough (the upload was started
        // some other way, perhaps before we started tracking).
        return { action: "passthrough", reason: "chunk without prior init" };
      }
      if (state.totalChars + base64.length > MAX_BUFFER_BYTES * 4 / 3) {
        // base64 is ~4/3 of binary size; cap memory.
        this.buffers.delete(b64Path);
        return { action: "passthrough", reason: "buffer cap exceeded" };
      }
      state.chunks.push(base64);
      state.totalChars += base64.length;
      return { action: "ack", reason: `buffered ${base64.length} b64 chars` };
    }

    // 3. FINALIZE
    const finalizeMatch = FINALIZE_RE.exec(command);
    if (finalizeMatch) {
      const targetPath = finalizeMatch[1];
      const b64Path = `${targetPath}.wardmote-upload.b64`;
      const state = this.buffers.get(b64Path);
      if (!state) {
        return { action: "passthrough", reason: "finalize without buffered state" };
      }
      this.buffers.delete(b64Path);
      // Decode in one go. base64.decode handles concatenated base64 strings
      // because each chunk was emitted from the encoder in fixed-size pieces.
      const joined = state.chunks.join("");
      const payload = Buffer.from(joined, "base64");
      return {
        action: "flush",
        flush: {
          targetPath: state.targetPath,
          payload,
        },
      };
    }

    return { action: "passthrough", reason: "no upload pattern" };
  }

  /**
   * Drop all buffered state. Called on releaseLease so a new lease doesn't
   * inherit stale buffers (lease IDs are unique so target paths shouldn't
   * collide, but cleanup is hygiene).
   */
  reset(): void {
    this.buffers.clear();
  }

  /** Number of in-flight uploads being tracked. Mostly for tests / diagnostics. */
  get pendingCount(): number {
    return this.buffers.size;
  }
}
