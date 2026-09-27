export interface LiveStdinChannel {
  write(data: string): Promise<void>;
  close(): void;
  readonly closed: boolean;
}

export interface BoundLiveStdinChannel extends LiveStdinChannel {
  bind(stream: NodeJS.WritableStream | null | undefined): void;
  unbind(): void;
}

export function createLiveStdinChannel(): BoundLiveStdinChannel {
  let stream: NodeJS.WritableStream | null = null;
  let closed = false;
  let writeTail: Promise<unknown> = Promise.resolve();
  const failClosed = () => {
    closed = true;
    stream = null;
  };
  return {
    bind(next) {
      stream = next ?? null;
      if (!stream) {
        failClosed();
        return;
      }
      stream.on("error", failClosed);
      stream.on("close", failClosed);
    },
    unbind: failClosed,
    get closed() {
      return closed;
    },
    write(data) {
      if (closed || !stream) {
        return Promise.reject(new Error("live_stdin_channel_closed"));
      }
      const target = stream;
      const flushed = writeTail.then(
        () =>
          new Promise<void>((resolve, reject) => {
            if (closed || stream !== target) {
              reject(new Error("live_stdin_channel_closed"));
              return;
            }
            target.write(data, (error?: Error | null) => {
              if (error) reject(error);
              else resolve();
            });
          }),
      );
      writeTail = flushed.catch(() => undefined);
      return flushed;
    },
    close() {
      if (closed) return;
      closed = true;
      const target = stream;
      stream = null;
      try {
        target?.end();
      } catch {}
    },
  };
}
