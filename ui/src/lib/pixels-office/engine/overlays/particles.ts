export class ParticlePool {
  readonly capacity: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly tint: Uint8Array;
  count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.tint = new Uint8Array(capacity);
  }

  spawn(x: number, y: number, vx: number, vy: number, life: number, tint: number): boolean {
    if (this.count >= this.capacity) return false;
    const i = this.count;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.tint[i] = tint;
    this.count += 1;
    return true;
  }

  step(dt: number, gravity: number, drag: number): boolean {
    let i = 0;
    while (i < this.count) {
      const remaining = this.life[i] - dt;
      if (remaining <= 0) {
        const last = this.count - 1;
        this.x[i] = this.x[last];
        this.y[i] = this.y[last];
        this.vx[i] = this.vx[last];
        this.vy[i] = this.vy[last];
        this.life[i] = this.life[last];
        this.maxLife[i] = this.maxLife[last];
        this.tint[i] = this.tint[last];
        this.count = last;
        continue;
      }
      this.life[i] = remaining;
      this.vy[i] += gravity * dt;
      this.vx[i] *= drag;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i += 1;
    }
    return this.count > 0;
  }

  clear(): void {
    this.count = 0;
  }
}
