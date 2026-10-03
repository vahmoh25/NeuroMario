/* ===========================================================
 * game.js — headless platformer: levels, physics, enemies, items
 * No rendering in here, so hundreds of agents can be simulated per frame.
 * =========================================================== */

const TILE = 32, ROWS = 15, GR = 12;           // GR = first ground row
const VIEW_W = 800, VIEW_H = ROWS * TILE;       // 25 x 15 tiles on screen
const MAX_FRAMES = 3600;                        // 60 s time limit per attempt
const STALL_FRAMES = 150;                       // killed after 2.5 s without progress

const T = { EMPTY: 0, GROUND: 1, BRICK: 2, QBLOCK: 3, USED: 4, PIPE: 5, SPIKE: 6, COIN: 7, FLAG: 8, PIPETOP: 9, STONE: 10 };
const SOLID = new Uint8Array(16);
[T.GROUND, T.BRICK, T.QBLOCK, T.USED, T.PIPE, T.PIPETOP, T.STONE].forEach(t => SOLID[t] = 1);

/* ---------- Level generation (deterministic, seeded) ---------- */

const LEVEL_DEFS = [
  { name: '1-1 Grassland', theme: 'grass', seed: 11, length: 140, maxGap: 3, spikeW: 0,
    weights: { flat: 2, gap: 3, pipe: 2, blocks: 2, enemies: 4, stairs: 1, spikes: 0 } },
  { name: '1-2 Underground', theme: 'cave', seed: 29, length: 160, maxGap: 4, spikeW: 1,
    weights: { flat: 2, gap: 3, pipe: 2, blocks: 2, enemies: 4, stairs: 2, spikes: 2 } },
  { name: '1-3 Castle', theme: 'castle', seed: 47, length: 160, maxGap: 4, spikeW: 2,
    weights: { flat: 1, gap: 4, pipe: 2, blocks: 1, enemies: 4, stairs: 3, spikes: 3 } },
];

function buildLevel(def) {
  const rng = new RNG(def.seed);
  const W = def.length;
  const tiles = new Uint8Array(W * ROWS);
  const enemies = [];
  const set = (x, y, t) => { if (x >= 0 && x < W && y >= 0 && y < ROWS) tiles[y * W + x] = t; };
  const ground = (x0, x1) => { for (let x = x0; x < x1; x++) for (let y = GR; y < ROWS; y++) set(x, y, T.GROUND); };
  const goomba = (x) => enemies.push({ x: x * TILE + 2, y: GR * TILE - 28 });
  const coinsRow = (x, n, y) => { for (let i = 0; i < n; i++) set(x + i, y, T.COIN); };

  ground(0, 14);
  coinsRow(8, 3, GR - 1);
  let x = 14;
  const end = W - 16;
  while (x < end) {
    const kind = rng.weighted(def.weights);
    switch (kind) {
      case 'flat': {
        const n = rng.int(3, 6);
        ground(x, x + n);
        if (rng.next() < 0.5) coinsRow(x + 1, Math.min(n - 1, 3), GR - 1);
        x += n; break;
      }
      case 'gap': {
        ground(x, x + 3); x += 3;
        const g = rng.int(2, def.maxGap);
        for (let i = 0; i < g; i++) set(x + i, GR - 3 - (i > 0 && i < g - 1 ? 1 : 0), T.COIN);
        x += g;
        ground(x, x + 4); x += 4; break;
      }
      case 'pipe': {
        ground(x, x + 3); x += 3;
        const h = rng.int(1, 2);
        for (let k = 1; k <= h; k++) { set(x, GR - k, k === h ? T.PIPETOP : T.PIPE); set(x + 1, GR - k, k === h ? T.PIPETOP : T.PIPE); }
        ground(x, x + 5); x += 5; break;
      }
      case 'stairs': {
        const k = rng.int(2, 3);
        ground(x, x + 2 * k + 3);
        for (let i = 0; i < k; i++) for (let h = 0; h <= i; h++) { set(x + 1 + i, GR - 1 - h, T.STONE); set(x + 2 * k - i, GR - 1 - h, T.STONE); }
        x += 2 * k + 3; break;
      }
      case 'blocks': {
        const n = rng.int(4, 6);
        ground(x, x + n + 3);
        for (let i = 0; i < n; i++) set(x + 1 + i, GR - 4, rng.next() < 0.4 ? T.QBLOCK : T.BRICK);
        coinsRow(x + 2, Math.min(n, 3), GR - 6);
        if (rng.next() < 0.5) goomba(x + n + 1);
        x += n + 3; break;
      }
      case 'enemies': {
        const n = rng.int(6, 9);
        ground(x, x + n);
        const cnt = rng.int(1, 2);
        for (let i = 0; i < cnt; i++) goomba(x + 2 + i * 3);
        x += n; break;
      }
      case 'spikes': {
        const n = 8;
        ground(x, x + n);
        const sw = Math.max(1, def.spikeW);
        for (let i = 0; i < sw; i++) set(x + 3 + i, GR - 1, T.SPIKE);
        coinsRow(x + 3, sw, GR - 3);
        x += n; break;
      }
    }
  }
  ground(x, W);
  const flagX = W - 6;
  for (let y = GR - 8; y < GR; y++) set(flagX, y, T.FLAG);
  return { def, name: def.name, theme: def.theme, w: W, tiles, enemies, flagX };
}

const LEVELS = LEVEL_DEFS.map(buildLevel);

/* ---------- Game instance (one per agent) ---------- */

class Game {
  constructor(level) {
    this.level = level;
    this.W = level.w;
    this.tiles = new Uint8Array(level.tiles.length);
    this.p = {};
    this.enemies = [];
    this.reset();
  }

  reset() {
    this.tiles.set(this.level.tiles);
    this.p = {
      x: 2 * TILE, y: GR * TILE - 30, w: 22, h: 30, vx: 0, vy: 0, onGround: true, facing: 1,
      alive: true, won: false, cause: '', frames: 0, maxX: 2 * TILE, coins: 0, stomps: 0, stall: 0, bumps: 0,
      deathAt: -1,
    };
    this.enemies = this.level.enemies.map(e => ({ x: e.x, y: e.y, w: 28, h: 28, vx: -0.8, vy: 0, alive: true, squash: 0 }));
    this.coinsTaken = 0;
  }

  solidAt(tx, ty) {
    if (tx < 0 || tx >= this.W) return true;
    if (ty < 0 || ty >= ROWS) return false;
    return SOLID[this.tiles[ty * this.W + tx]] === 1;
  }

  /** returns true when blocked */
  moveX(e, dx) {
    e.x += dx;
    const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 0.01) / TILE);
    if (dx > 0) {
      const tx = Math.floor((e.x + e.w) / TILE);
      for (let ty = y0; ty <= y1; ty++) if (this.solidAt(tx, ty)) { e.x = tx * TILE - e.w; return true; }
    } else if (dx < 0) {
      const tx = Math.floor(e.x / TILE);
      for (let ty = y0; ty <= y1; ty++) if (this.solidAt(tx, ty)) { e.x = (tx + 1) * TILE; return true; }
    }
    return false;
  }

  /** returns +1 if landed on ground, -1 if bumped head, 0 otherwise */
  moveY(e, dy) {
    e.y += dy;
    const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 0.01) / TILE);
    if (dy > 0) {
      const ty = Math.floor((e.y + e.h) / TILE);
      for (let tx = x0; tx <= x1; tx++) if (this.solidAt(tx, ty)) { e.y = ty * TILE - e.h; e.vy = 0; return 1; }
    } else if (dy < 0) {
      const ty = Math.floor(e.y / TILE);
      let hit = -1;
      for (let tx = x0; tx <= x1; tx++) if (this.solidAt(tx, ty)) {
        // prefer the block closest to the player's centre
        const cx = Math.floor((e.x + e.w / 2) / TILE);
        if (hit < 0 || Math.abs(tx - cx) < Math.abs(hit - cx)) hit = tx;
      }
      if (hit >= 0) {
        e.y = (ty + 1) * TILE; e.vy = 0;
        if (e === this.p) this.bump(hit, ty);
        return -1;
      }
    }
    return 0;
  }

  bump(tx, ty) {
    const idx = ty * this.W + tx;
    if (this.tiles[idx] === T.QBLOCK) { this.tiles[idx] = T.USED; this.p.coins++; this.p.bumps++; }
  }

  die(cause) { const p = this.p; if (!p.alive) return; p.alive = false; p.cause = cause; p.deathAt = p.frames; }

  step(inp) {
    const p = this.p;
    if (!p.alive || p.won) return;
    p.frames++;

    // --- horizontal control
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const maxSp = inp.run ? 4.2 : 2.6;
    if (dir !== 0) {
      const acc = p.onGround ? 0.35 : 0.22;
      const target = dir * maxSp;
      const d = target - p.vx;
      p.vx += Math.max(-acc, Math.min(acc, d));
      p.facing = dir;
    } else {
      const f = p.onGround ? 0.3 : 0.04;
      if (p.vx > 0) p.vx = Math.max(0, p.vx - f); else p.vx = Math.min(0, p.vx + f);
    }

    // --- jump (hold for a higher jump)
    if (inp.jump && p.onGround && !p.jumpHeld) { p.vy = -9.6; p.onGround = false; }
    p.jumpHeld = !!inp.jump;
    if (!inp.jump && p.vy < -3.2) p.vy = -3.2;
    p.vy = Math.min(p.vy + 0.5, 11);

    this.moveX(p, p.vx) && (p.vx = 0);
    const r = this.moveY(p, p.vy);
    p.onGround = r === 1;

    // --- tiles under the player
    const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + p.w - 0.01) / TILE);
    const y0 = Math.floor(p.y / TILE), y1 = Math.floor((p.y + p.h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || tx >= this.W || ty < 0 || ty >= ROWS) continue;
      const idx = ty * this.W + tx, t = this.tiles[idx];
      if (t === T.COIN) { this.tiles[idx] = T.EMPTY; p.coins++; }
      else if (t === T.FLAG) { p.won = true; p.cause = 'finished'; }
      else if (t === T.SPIKE) {
        const sx = tx * TILE + 5, sy = ty * TILE + 14;
        if (p.x < sx + 22 && p.x + p.w > sx && p.y < sy + 18 && p.y + p.h > sy) this.die('spikes');
      }
    }
    if (p.y > ROWS * TILE + 10) this.die('pit');

    // --- enemies
    for (const e of this.enemies) {
      if (!e.alive) { if (e.squash < 30) e.squash++; continue; }
      if (Math.abs(e.x - p.x) < 700) {
        const dirE = e.vx < 0 ? -1 : 1;
        if (this.moveX(e, e.vx)) e.vx = -e.vx;
        else if (e.onG) {
          const footX = dirE > 0 ? e.x + e.w + 1 : e.x - 1;
          if (!this.solidAt(Math.floor(footX / TILE), Math.floor((e.y + e.h + 2) / TILE))) { e.vx = -e.vx; }
        }
        e.vy = Math.min(e.vy + 0.5, 10);
        e.onG = this.moveY(e, e.vy) === 1;
        if (e.y > ROWS * TILE + 10) e.alive = false;
      }
      if (p.alive && p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
        if (p.vy > 0 && p.y + p.h - e.y < 18) { e.alive = false; p.vy = -6.5; p.stomps++; }
        else this.die('enemy');
      }
    }

    // --- progress / stall detection
    if (p.x > p.maxX + 0.5) { p.maxX = p.x; p.stall = 0; } else if (++p.stall > STALL_FRAMES) this.die('stalled');
    if (p.frames >= MAX_FRAMES && p.alive && !p.won) this.die('timeout');
  }

  /** Neural-net inputs: 8x5 tile grid around the player + 3 body-state values. */
  observe(out) {
    const p = this.p, W = this.W, tiles = this.tiles;
    const cx = Math.floor((p.x + p.w / 2) / TILE), cy = Math.floor((p.y + p.h / 2) / TILE);
    let k = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -1; dx <= 6; dx++) {
        const tx = cx + dx, ty = cy + dy;
        let v = 0;
        if (tx < 0 || tx >= W) v = 1;
        else if (ty >= 0 && ty < ROWS) {
          const t = tiles[ty * W + tx];
          if (SOLID[t]) v = 1;
          else if (t === T.SPIKE) v = -0.6;
          else if (t === T.COIN) v = 0.35;
          else if (t === T.FLAG) v = 0.7;
        }
        out[k++] = v;
      }
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const ex = Math.floor((e.x + e.w / 2) / TILE) - cx, ey = Math.floor((e.y + e.h / 2) / TILE) - cy;
      if (ex >= -1 && ex <= 6 && ey >= -2 && ey <= 2) out[(ey + 2) * VISION_COLS + ex + 1] = -1;
    }
    out[k++] = p.onGround ? 1 : 0;
    out[k++] = p.vy / 11;
    out[k++] = p.vx / 4.2;
    return out;
  }

  fitness() {
    const p = this.p;
    let f = (p.maxX - 2 * TILE) + p.coins * 40 + p.stomps * 80;
    if (p.won) f += 3000 + (MAX_FRAMES - p.frames) * 0.6;
    return f;
  }

  progress() { return Math.min(1, Math.max(0, (this.p.maxX - 2 * TILE) / ((this.level.flagX - 2) * TILE))); }
}
