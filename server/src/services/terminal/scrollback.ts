export class TerminalScrollback {
  private chunks: string[] = [];
  private sizes: number[] = [];
  private head = 0;
  private bytes = 0;

  constructor(private readonly limitBytes: number) {}

  get byteLength(): number {
    return this.bytes;
  }

  append(data: string): void {
    if (!data) return;
    let chunk = data;
    let size = Buffer.byteLength(chunk, "utf8");
    if (size >= this.limitBytes) {
      const encoded = Buffer.from(chunk, "utf8");
      chunk = encoded.subarray(encoded.length - this.limitBytes).toString("utf8");
      size = Buffer.byteLength(chunk, "utf8");
      this.chunks = [];
      this.sizes = [];
      this.head = 0;
      this.bytes = 0;
    }
    this.chunks.push(chunk);
    this.sizes.push(size);
    this.bytes += size;
    while (this.bytes > this.limitBytes && this.chunks.length - this.head > 1) {
      this.bytes -= this.sizes[this.head]!;
      this.head += 1;
    }
    if (this.head > 1024 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.sizes = this.sizes.slice(this.head);
      this.head = 0;
    }
  }

  read(): string {
    if (this.chunks.length - this.head > 1) {
      const joined = this.chunks.slice(this.head).join("");
      this.chunks = [joined];
      this.sizes = [this.bytes];
      this.head = 0;
    }
    return this.chunks[this.head] ?? "";
  }
}
