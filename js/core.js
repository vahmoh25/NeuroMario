/* ===========================================================
 * core.js — seeded RNG + neural-network genome
 * The genome is a small feed-forward network with a per-connection
 * on/off mask, so evolution changes both weights AND topology.
 * =========================================================== */

class RNG {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  gauss() {
    let u = 0;
    while (u === 0) u = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  weighted(obj) {
    let total = 0;
    for (const k in obj) total += obj[k];
    let r = this.next() * total;
    for (const k in obj) { r -= obj[k]; if (r <= 0) return k; }
    return Object.keys(obj)[0];
  }
}

// 8x5 vision grid + 3 proprioception inputs -> 14 -> 8 -> 4 buttons
const VISION_COLS = 8, VISION_ROWS = 5;
const NN_LAYERS = [VISION_COLS * VISION_ROWS + 3, 14, 8, 4];
const OUTPUT_NAMES = ['LEFT', 'RIGHT', 'JUMP', 'RUN'];

class Genome {
  constructor(layers) {
    this.layers = layers.slice();
    this.w = []; this.b = []; this.m = [];
    for (let l = 1; l < layers.length; l++) {
      const i = layers[l - 1], o = layers[l];
      this.w.push(new Float32Array(i * o));
      this.b.push(new Float32Array(o));
      this.m.push(new Uint8Array(i * o));
    }
  }

  static random(layers, rng, density = 0.45) {
    const g = new Genome(layers);
    for (let l = 0; l < g.w.length; l++) {
      const nIn = layers[l];
      const std = 1.6 / Math.sqrt(nIn * density);
      for (let i = 0; i < g.w[l].length; i++) {
        g.w[l][i] = rng.gauss() * std;
        g.m[l][i] = rng.next() < density ? 1 : 0;
      }
      for (let i = 0; i < g.b[l].length; i++) g.b[l][i] = rng.gauss() * 0.2;
    }
    // gentle nudge so some first-generation agents at least try to go right
    const last = g.b.length - 1;
    g.b[last][1] += 0.6;
    g.b[last][0] -= 0.3;
    return g;
  }

  clone() {
    const g = new Genome(this.layers);
    for (let l = 0; l < this.w.length; l++) {
      g.w[l].set(this.w[l]); g.b[l].set(this.b[l]); g.m[l].set(this.m[l]);
    }
    return g;
  }

  makeActs() { return this.layers.map(n => new Float32Array(n)); }

  forward(input, acts) {
    acts[0].set(input);
    for (let l = 0; l < this.w.length; l++) {
      const w = this.w[l], m = this.m[l], b = this.b[l];
      const prev = acts[l], cur = acts[l + 1];
      const nIn = this.layers[l], nOut = this.layers[l + 1];
      for (let o = 0; o < nOut; o++) {
        let s = b[o];
        const base = o * nIn;
        for (let i = 0; i < nIn; i++) if (m[base + i]) s += w[base + i] * prev[i];
        cur[o] = Math.tanh(s);
      }
    }
    return acts[acts.length - 1];
  }

  /** Neuron-wise crossover: each neuron inherits its whole incoming "row" from one parent. */
  static crossover(a, b, rng) {
    const g = new Genome(a.layers);
    for (let l = 0; l < a.w.length; l++) {
      const nIn = a.layers[l], nOut = a.layers[l + 1];
      for (let o = 0; o < nOut; o++) {
        const src = rng.next() < 0.5 ? a : b;
        const base = o * nIn;
        for (let i = 0; i < nIn; i++) {
          g.w[l][base + i] = src.w[l][base + i];
          g.m[l][base + i] = src.m[l][base + i];
        }
        g.b[l][o] = src.b[l][o];
      }
    }
    return g;
  }

  mutate(rng, rate, sigma, structRate) {
    for (let l = 0; l < this.w.length; l++) {
      const w = this.w[l], m = this.m[l], b = this.b[l];
      for (let i = 0; i < w.length; i++) {
        if (rng.next() < rate) {
          if (rng.next() < 0.06) w[i] = rng.gauss();
          else w[i] += rng.gauss() * sigma;
          if (w[i] > 4) w[i] = 4; else if (w[i] < -4) w[i] = -4;
        }
        if (rng.next() < structRate) m[i] ^= 1;
      }
      for (let i = 0; i < b.length; i++) {
        if (rng.next() < rate) {
          b[i] += rng.gauss() * sigma;
          if (b[i] > 3) b[i] = 3; else if (b[i] < -3) b[i] = -3;
        }
      }
    }
  }

  activeCount() { let n = 0; for (const m of this.m) for (let i = 0; i < m.length; i++) n += m[i]; return n; }
  totalCount() { let n = 0; for (const m of this.m) n += m.length; return n; }

  /** effective (masked) weight, used by the visualiser */
  eff(l, idx) { return this.m[l][idx] ? this.w[l][idx] : 0; }
}
