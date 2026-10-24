import serializeAddon from "@xterm/addon-serialize";
import type { SerializeAddon } from "@xterm/addon-serialize";
import headless from "@xterm/headless";
import type { ITerminalAddon, Terminal as HeadlessTerminal } from "@xterm/headless";
import { TERMINAL_SCROLLBACK_ROWS } from "@tickernelz/paperclip-pro-shared";

const { SerializeAddon: SerializeAddonImpl } = serializeAddon;
const { Terminal } = headless;

export class TerminalScreen {
  private readonly terminal: HeadlessTerminal;
  private readonly serializer: SerializeAddon;
  private readonly scrollbackRows: number;
  private readonly pending = new Set<() => void>();
  private disposed = false;

  constructor(cols: number, rows: number, scrollbackRows: number = TERMINAL_SCROLLBACK_ROWS) {
    this.scrollbackRows = scrollbackRows;
    this.terminal = new Terminal({ cols, rows, scrollback: scrollbackRows, allowProposedApi: true });
    this.serializer = new SerializeAddonImpl();
    this.terminal.loadAddon(this.serializer as unknown as ITerminalAddon);
  }

  write(data: string): Promise<void> {
    if (this.disposed || !data) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.pending.add(resolve);
      this.terminal.write(data, () => {
        this.pending.delete(resolve);
        resolve();
      });
    });
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    this.terminal.resize(cols, rows);
  }

  serialize(): string {
    if (this.disposed) return "";
    return this.serializer.serialize({ scrollback: this.scrollbackRows });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const waiting = [...this.pending];
    this.pending.clear();
    for (const resolve of waiting) resolve();
    this.terminal.dispose();
  }
}
