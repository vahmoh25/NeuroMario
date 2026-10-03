/* ===========================================================
 * evolution.js — population of agents + neuroevolution loop
 *   evaluate (all agents play at once) -> rank by fitness ->
 *   keep elites -> select parents (tournament) -> crossover -> mutate
 * =========================================================== */

class Evolution {
  constructor(level, opts = {}) {
    this.level = level;
    this.size = opts.size || 60;
    this.baseMutation = opts.mutation ?? 0.08;
    this.sigma = 0.35;
    this.seed = opts.seed || (Date.now() & 0xffffff);
    this.rng = new RNG(this.seed);

    this.generation = 1;
    this.history = [];            // {gen,best,avg,wins,bestX}
    this.bestEver = 0;
    this.champion = null;         // best genome ever seen
    this.championGen = 0;
    this.stagnation = 0;
    this.totalEvals = 0;
    this.lastSummary = null;
    this.firstWinGen = 0;

    this.pop = [];
    for (let i = 0; i < this.size; i++) this.pop.push(Genome.random(NN_LAYERS, this.rng));
    this.origin = new Array(this.size).fill('new');
    this.hues = Array.from({ length: this.size }, (_, i) => (i * 137.5) % 360);
    this.games = this.pop.map(() => new Game(level));
    this.acts = this.pop.map(g => g.makeActs());
    this.obs = new Float32Array(NN_LAYERS[0]);
    this.outs = this.pop.map(() => ({ left: false, right: false, jump: false, run: false }));
    this.frame = 0;
    this.finished = false;
  }

  get mutationRate() { return this.baseMutation * (1 + Math.min(2, this.stagnation * 0.2)); }

  aliveCount() { let n = 0; for (const g of this.games) if (g.p.alive && !g.p.won) n++; return n; }
  winCount() { let n = 0; for (const g of this.games) if (g.p.won) n++; return n; }

  /** advance every agent by exactly one game frame */
  tick() {
    if (this.finished) return;
    this.frame++;
    let active = 0;
    for (let i = 0; i < this.size; i++) {
      const g = this.games[i];
      if (!g.p.alive || g.p.won) continue;
      g.observe(this.obs);
      const o = this.pop[i].forward(this.obs, this.acts[i]);
      const inp = this.outs[i];
      inp.left = o[0] > 0; inp.right = o[1] > 0; inp.jump = o[2] > 0; inp.run = o[3] > 0;
      g.step(inp);
      if (g.p.alive && !g.p.won) active++;
    }
    if (active === 0) this.finish();
  }

  /** score the generation and store a summary (breeding happens in nextGeneration) */
  finish() {
    if (this.finished) return;
    this.finished = true;
    const fits = this.games.map(g => g.fitness());
    const order = fits.map((_, i) => i).sort((a, b) => fits[b] - fits[a]);
    const avg = fits.reduce((a, b) => a + b, 0) / fits.length;
    const wins = this.winCount();
    const best = fits[order[0]];
    const entry = { gen: this.generation, best, avg, wins, bestX: this.games[order[0]].progress() };
    this.history.push(entry);
    this.totalEvals += this.size;
    if (wins > 0 && !this.firstWinGen) this.firstWinGen = this.generation;
    if (best > this.bestEver) {
      this.bestEver = best; this.champion = this.pop[order[0]].clone(); this.championGen = this.generation; this.stagnation = 0;
    } else this.stagnation++;
    this.lastSummary = { ...entry, order, fits };
  }

  nextGeneration() {
    if (!this.finished) this.finish();
    const { order, fits } = this.lastSummary;
    const n = this.size, rng = this.rng;
    const next = [], origin = [];

    const elites = Math.max(2, Math.round(n * 0.08));
    for (let e = 0; e < elites; e++) { next.push(this.pop[order[e]].clone()); origin.push('elite'); }

    const poolSize = Math.max(4, Math.round(n * 0.4));
    const pool = order.slice(0, poolSize);
    const tournament = () => {
      let best = pool[rng.int(0, pool.length - 1)];
      for (let k = 0; k < 2; k++) { const c = pool[rng.int(0, pool.length - 1)]; if (fits[c] > fits[best]) best = c; }
      return this.pop[best];
    };
    const immigrants = Math.max(1, Math.round(n * 0.04));
    const rate = this.mutationRate, structRate = rate * 0.12;
    while (next.length < n - immigrants) {
      const a = tournament();
      let child = rng.next() < 0.6 ? Genome.crossover(a, tournament(), rng) : a.clone();
      child.mutate(rng, rate, this.sigma, structRate);
      next.push(child); origin.push('child');
    }
    while (next.length < n) { next.push(Genome.random(NN_LAYERS, rng)); origin.push('new'); }

    this.pop = next; this.origin = origin;
    this.generation++;
    for (const g of this.games) g.reset();
    this.frame = 0;
    this.finished = false;
  }
}
