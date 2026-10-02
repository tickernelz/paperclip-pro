export class TileClaims {
  private readonly owners = new Map<number, string>();
  private readonly mask: Uint8Array;

  constructor(private readonly cols: number, rows: number) {
    this.mask = new Uint8Array(cols * rows);
  }

  isFreeFor(id: string, col: number, row: number): boolean {
    const owner = this.owners.get(row * this.cols + col);
    return owner === undefined || owner === id;
  }

  claim(id: string, col: number, row: number): boolean {
    const index = row * this.cols + col;
    const owner = this.owners.get(index);
    if (owner !== undefined && owner !== id) return false;
    this.owners.set(index, id);
    return true;
  }

  release(id: string, col: number, row: number): void {
    const index = row * this.cols + col;
    if (this.owners.get(index) === id) this.owners.delete(index);
  }

  releaseAll(id: string): void {
    for (const [index, owner] of this.owners) {
      if (owner === id) this.owners.delete(index);
    }
  }

  blockedFor(id: string): Uint8Array {
    this.mask.fill(0);
    for (const [index, owner] of this.owners) {
      if (owner !== id) this.mask[index] = 1;
    }
    return this.mask;
  }
}
