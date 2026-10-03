/* ===========================================================
 * main.js — wires game + evolution + renderers + UI together
 * Fixed 60 Hz simulation clock, independent of display refresh.
 * =========================================================== */

const $ = id => document.getElementById(id);
const renderer = new Renderer($('gameCanvas'));
const viz = new NetViz3D($('netCanvas'));

const S = {
  mode: 'evolve', running: true, speed: 1, level: 0, popSize: 60, mutation: 0.08,
  evo: null, cooldown: 0, cooldownMax: 1, watch: 0, pinned: false, skipping: false,
  celebrate: 0, snapCam: true, time: 0, human: null, showGhosts: true, showVision: true,
};
const obsTmp = new Float32Array(NN_LAYERS[0]);
const keys = { left: false, right: false, jump: false, run: false, restart: false };
const fmt = n => Math.round(n).toLocaleString('en-US');

/* ---------------- setup ---------------- */

LEVELS.forEach((l, i) => { const o = document.createElement('option'); o.value = i; o.textContent = l.name; $('selLevel').appendChild(o); });

function newEvolution() {
  S.evo = new Evolution(LEVELS[S.level], { size: S.popSize, mutation: S.mutation });
  S.cooldown = 0; S.watch = 0; S.pinned = false; S.snapCam = true; S.celebrate = 0;
  viz.initialised = false;
}

function newHuman() {
  const lv = LEVELS[S.level], evo = S.evo;
  const h = { game: new Game(lv), ghost: null, endTimer: 0, raceMsg: '' };
  if (evo.champion) {
    h.ghost = { game: new Game(lv), genome: evo.champion, acts: evo.champion.makeActs(), obs: new Float32Array(NN_LAYERS[0]), out: { left: false, right: false, jump: false, run: false } };
  }
  S.human = h; S.snapCam = true;
}

/* ---------------- simulation stepping ---------------- */

function advanceEvolution() {
  const evo = S.evo;
  if (evo.finished) {
    if (S.cooldown > 0) { S.cooldown--; return; }
    evo.nextGeneration();
    if (!S.pinned) S.watch = 0;
    S.skipping = false;
    return;
  }
  const hadWin = evo.firstWinGen;
  evo.tick();
  if (evo.finished) {
    S.cooldownMax = S.speed === 1 ? 110 : S.speed === 2 ? 60 : S.speed === 5 ? 24 : 4;
    if (S.speed === 0 || S.skipping) S.cooldownMax = S.skipping ? 40 : 0;
    S.cooldown = S.cooldownMax;
    if (!hadWin && evo.firstWinGen) S.celebrate = 260;
  }
}

function stepHuman() {
  const h = S.human, p = h.game.p;
  if (keys.restart) { keys.restart = false; newHuman(); return; }
  h.game.step(keys);
  const gg = h.ghost;
  if (gg && gg.game.p.alive && !gg.game.p.won) {
    gg.game.observe(gg.obs);
    const o = gg.genome.forward(gg.obs, gg.acts);
    gg.out.left = o[0] > 0; gg.out.right = o[1] > 0; gg.out.jump = o[2] > 0; gg.out.run = o[3] > 0;
    gg.game.step(gg.out);
  }
  if (!p.alive || p.won) {
    h.endTimer++;
    if (p.won && !h.raceMsg) {
      const t = (p.frames / 60).toFixed(1);
      const g = gg && gg.game.p;
      h.raceMsg = g ? (g.won ? `You: ${t}s · AI: ${(g.frames / 60).toFixed(1)}s` : `You: ${t}s · the AI never finished — you win!`) : `Finished in ${t}s`;
    }
    if (h.endTimer > (p.won ? 280 : 80)) newHuman();
  }
}

/* ---------------- frame loop ---------------- */

let last = performance.now(), acc = 0, uiTick = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(100, now - last); last = now;
  S.time = now / 16.667;
  const STEP = 1000 / 60;

  if (S.running) {
    if (S.mode === 'evolve') {
      if (S.speed === 0 || S.skipping) {
        const t0 = performance.now();
        while (performance.now() - t0 < 13) advanceEvolution();
      } else {
        acc += dt;
        let n = 0;
        while (acc >= STEP && n < 4) { acc -= STEP; n++; for (let k = 0; k < S.speed; k++) advanceEvolution(); }
        if (acc > STEP * 4) acc = 0;
      }
      if (S.celebrate > 0) S.celebrate--;
    } else {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 4) { acc -= STEP; n++; stepHuman(); }
      if (acc > STEP * 4) acc = 0;
    }
  } else acc = 0;

  S.mode === 'evolve' ? drawEvolve() : drawPlay();
  drawChart(); drawStrip();
  if (++uiTick % 6 === 0) updateStats();
}

/* ---------------- drawing ---------------- */

function updateWatch() {
  const evo = S.evo, gs = evo.games;
  if (S.watch >= gs.length) S.watch = 0;
  if (S.pinned) return;
  const done = i => !(gs[i].p.alive && !gs[i].p.won);
  let lead = -1, lx = -1;
  for (let i = 0; i < gs.length; i++) if (!done(i) && gs[i].p.x > lx) { lx = gs[i].p.x; lead = i; }
  if (lead < 0) { let bf = -1; for (let i = 0; i < gs.length; i++) { const f = gs[i].fitness(); if (f > bf) { bf = f; lead = i; } } }
  const cur = S.watch;
  if ((done(cur) && lead !== cur) || (!done(lead) && gs[lead].p.x > gs[cur].p.x + 96)) S.watch = lead;
}

function drawEvolve() {
  const evo = S.evo;
  updateWatch();
  const g = evo.games[S.watch];
  renderer.followX(g.p.x, S.snapCam, g.W); S.snapCam = false;
  const agents = evo.games.map((game, i) => ({ game, hue: evo.hues[i], elite: evo.origin[i] === 'elite' }));

  let banner = null;
  if (S.celebrate > 0) banner = { title: `🏁 First finisher in generation ${evo.firstWinGen}!`, sub: 'A brain has learned to beat the level — evolution keeps polishing it.', color: '#7dff9b' };
  else if (evo.finished && S.cooldown > 0 && S.cooldownMax >= 24 && S.speed <= 5 && !S.skipping) {
    const s = evo.lastSummary;
    banner = {
      title: `Generation ${s.gen} complete`,
      sub: `best ${fmt(s.best)} · avg ${fmt(s.avg)} · ${(s.bestX * 100).toFixed(0)}% of the level · ${s.wins} finished`,
      sub2: `top ${Math.max(2, Math.round(evo.size * 0.08))} survive unchanged · the rest are bred (crossover + mutation) → generation ${s.gen + 1}`,
    };
  } else if (!S.running && !S.quiet) banner = { title: '⏸ Paused', sub: 'Press Start to keep evolving', color: '#cdd7ff' };

  renderer.draw({
    watched: g, agents, showGhosts: S.showGhosts, showVision: S.showVision, obs: evo.acts[S.watch][0],
    outputs: evo.outs[S.watch], time: S.time, watchedHue: evo.hues[S.watch], banner,
  });
  viz.render(evo.pop[S.watch], evo.acts[S.watch], S.time);
  $('watchInfo').textContent = S.pinned ? `watching agent #${S.watch + 1} (pinned)` : `watching the leader · agent #${S.watch + 1}`;
  $('btnFollow').classList.toggle('hidden', !S.pinned);
}

function drawPlay() {
  const h = S.human, evo = S.evo, g = h.game;
  renderer.followX(g.p.x, S.snapCam, g.W); S.snapCam = false;
  const agents = h.ghost ? [{ game: h.ghost.game, hue: 285, elite: true }] : [];
  let banner = null;
  if (g.p.won) banner = { title: '🏁 Level complete!', sub: h.raceMsg, color: '#7dff9b' };
  else if (!g.p.alive) banner = { title: `💀 ${g.p.cause === 'pit' ? 'Fell into a pit' : g.p.cause === 'enemy' ? 'Squashed by an enemy' : g.p.cause === 'spikes' ? 'Spiked' : g.p.cause}`, sub: 'Restarting… (or press R)', color: '#ff7b7b' };
  else if (!S.running) banner = { title: '⏸ Paused', sub: 'Press Start to continue', color: '#cdd7ff' };
  const vObs = g.observe(obsTmp);
  const out = h.ghost ? h.ghost.out : { left: keys.left, right: keys.right, jump: keys.jump, run: keys.run };
  renderer.draw({ watched: g, agents, showGhosts: true, showVision: S.showVision, obs: vObs, outputs: { left: keys.left, right: keys.right, jump: keys.jump, run: keys.run }, time: S.time, watchedHue: 5, banner });
  const genome = h.ghost ? h.ghost.genome : evo.pop[0], acts = h.ghost ? h.ghost.acts : evo.acts[0];
  viz.render(genome, acts, S.time);
  $('watchInfo').textContent = h.ghost ? `you (red) vs the evolved champion from gen ${evo.championGen} (purple ghost)` : 'no champion yet — evolve one in the AI tab, then come back to race it';
  $('btnFollow').classList.add('hidden');
}

function drawChart() {
  const c = $('chart'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, w, h);
  const H = S.evo.history, padL = 46 * dpr, padR = 12 * dpr, padT = 22 * dpr, padB = 20 * dpr;
  ctx.font = `${10.5 * dpr}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
  const maxV = Math.max(1000, ...H.map(e => e.best)) * 1.08;
  const X = i => padL + (H.length <= 1 ? 0.5 : i / (H.length - 1)) * (w - padL - padR);
  const Y = v => h - padB - (v / maxV) * (h - padT - padB);
  ctx.strokeStyle = 'rgba(140,170,255,.12)'; ctx.fillStyle = 'rgba(160,175,220,.7)'; ctx.lineWidth = dpr; ctx.textAlign = 'right';
  for (let k = 0; k <= 4; k++) { const v = maxV * k / 4, y = Y(v); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.fillText(fmt(v), padL - 6 * dpr, y); }
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(200,212,255,.85)';
  ctx.fillText('fitness per generation', padL, 10 * dpr);
  const lg = (x, col, t) => { ctx.fillStyle = col; ctx.fillRect(x, 6 * dpr, 12 * dpr, 4 * dpr); ctx.fillStyle = 'rgba(200,212,255,.7)'; ctx.fillText(t, x + 16 * dpr, 10 * dpr); return x + 16 * dpr + ctx.measureText(t).width + 12 * dpr; };
  let lx = padL + 140 * dpr; lx = lg(lx, '#ffc440', 'best'); lx = lg(lx, '#409cff', 'average'); lg(lx, 'rgba(93,255,155,.7)', 'finishers');
  if (!H.length) { ctx.fillStyle = 'rgba(160,175,220,.6)'; ctx.textAlign = 'center'; ctx.fillText('waiting for the first generation to finish…', w / 2, h / 2); return; }
  const bw = Math.max(2 * dpr, (w - padL - padR) / Math.max(H.length, 12) * 0.6);
  ctx.fillStyle = 'rgba(93,255,155,.3)';
  H.forEach((e, i) => { const fh = (e.wins / S.evo.size) * (h - padT - padB) * 0.5; ctx.fillRect(X(i) - bw / 2, h - padB - fh, bw, fh); });
  const line = (key, col, wd) => {
    ctx.strokeStyle = col; ctx.lineWidth = wd * dpr; ctx.lineJoin = 'round'; ctx.beginPath();
    H.forEach((e, i) => i ? ctx.lineTo(X(i), Y(e[key])) : ctx.moveTo(X(i), Y(e[key]))); ctx.stroke();
    const e = H[H.length - 1]; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(H.length - 1), Y(e[key]), 3 * dpr, 0, 7); ctx.fill();
  };
  line('avg', '#409cff', 2); line('best', '#ffc440', 2.4);
  ctx.fillStyle = 'rgba(160,175,220,.7)'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('gen 1', padL, h - 4 * dpr); ctx.fillText(`gen ${H[H.length - 1].gen}`, w - padR - 12 * dpr, h - 4 * dpr);
}

let stripRects = [];
function drawStrip() {
  const c = $('strip'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, w, h);
  const evo = S.evo, n = evo.size, bw = w / n;
  for (let i = 0; i < n; i++) {
    const g = evo.games[i], p = g.p, prog = g.progress();
    const bh = Math.max(3 * dpr, prog * (h - 14 * dpr)), alive = p.alive && !p.won;
    ctx.globalAlpha = alive || p.won ? 1 : 0.38;
    ctx.fillStyle = p.won ? '#5dff9b' : `hsl(${evo.hues[i]},80%,60%)`;
    ctx.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh);
    ctx.globalAlpha = 1;
    if (evo.origin[i] === 'elite') { ctx.fillStyle = '#ffc440'; ctx.fillRect(i * bw + 1, 1, Math.max(1, bw - 2), 4 * dpr); }
    else if (evo.origin[i] === 'new') { ctx.fillStyle = '#fff'; ctx.fillRect(i * bw + 1, 1, Math.max(1, bw - 2), 2 * dpr); }
    if (i === S.watch && S.mode === 'evolve') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; ctx.strokeRect(i * bw + 1, 1, Math.max(1, bw - 2), h - 2); }
  }
}

function updateStats() {
  const evo = S.evo, last = evo.history[evo.history.length - 1];
  const playing = S.mode === 'play';
  const pills = document.querySelectorAll('.pill');
  const setPill = (k, label, val) => { pills[k].querySelector('i').textContent = label; pills[k].querySelector('b').textContent = val; };
  if (!playing) {
    const g = evo.games[S.watch];
    setPill(0, 'GEN', evo.generation); setPill(1, 'ALIVE', `${evo.aliveCount()}/${evo.size}`);
    setPill(2, 'BEST', fmt(Math.max(...evo.games.map(x => x.fitness())))); setPill(3, 'TIME', `${(evo.frame / 60).toFixed(0)}s`);
  } else {
    const g = S.human.game;
    setPill(0, 'AI GEN', S.evo.championGen || '–'); setPill(1, 'COINS', g.p.coins); setPill(2, 'DIST', `${(g.progress() * 100).toFixed(0)}%`); setPill(3, 'TIME', `${(g.p.frames / 60).toFixed(0)}s`);
  }
  $('sGen').textContent = evo.generation;
  $('sAlive').textContent = `${evo.aliveCount()} / ${evo.size}`;
  $('sGenBest').textContent = last ? fmt(last.best) : '–';
  $('sEver').textContent = evo.bestEver ? `${fmt(evo.bestEver)} (g${evo.championGen})` : '–';
  $('sAvg').textContent = last ? fmt(last.avg) : '–';
  $('sWins').textContent = last ? `${last.wins} / ${evo.size}` : '–';
  $('sMut').textContent = `${(evo.mutationRate * 100).toFixed(1)}%`;
  $('sStag').textContent = evo.stagnation;
  const gen = playing ? (S.human.ghost ? S.human.ghost.genome : evo.pop[0]) : evo.pop[S.watch];
  $('netStats').textContent = `${gen.activeCount()}/${gen.totalCount()} connections · ${NN_LAYERS.join('-')}`;
}

/* ---------------- UI wiring ---------------- */

function setRunning(v) { S.running = v; $('btnRun').textContent = v ? '⏸ Pause' : '▶ Start'; }
$('btnRun').onclick = () => setRunning(!S.running);
$('btnStep').onclick = () => { if (S.mode === 'evolve') { setRunning(true); S.skipping = true; S.cooldown = 0; } };
$('btnReset').onclick = () => { if (S.mode === 'evolve') newEvolution(); else newHuman(); };
$('speedSeg').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  S.speed = +b.dataset.s;
  document.querySelectorAll('#speedSeg button').forEach(x => x.classList.toggle('on', x === b));
};
$('selLevel').onchange = e => { S.level = +e.target.value; newEvolution(); if (S.mode === 'play') newHuman(); };
$('selPop').onchange = e => { S.popSize = +e.target.value; newEvolution(); if (S.mode === 'play') newHuman(); };
$('rngMut').oninput = e => { S.mutation = +e.target.value / 100; $('valMut').textContent = `${e.target.value}%`; S.evo.baseMutation = S.mutation; };
$('chkGhost').onchange = e => S.showGhosts = e.target.checked;
$('chkVision').onchange = e => S.showVision = e.target.checked;
$('chkRotate').onchange = e => viz.autoRotate = e.target.checked;
$('rngCut').oninput = e => viz.minW = e.target.value / 100;
$('btnFollow').onclick = () => { S.pinned = false; };

function setMode(m) {
  S.mode = m;
  $('tabEvolve').classList.toggle('active', m === 'evolve'); $('tabPlay').classList.toggle('active', m === 'play');
  document.body.classList.toggle('playing', m === 'play');
  $('btnStep').disabled = m === 'play'; $('btnStep').style.opacity = m === 'play' ? .4 : 1;
  if (m === 'play') newHuman(); else S.snapCam = true;
}
$('tabEvolve').onclick = () => setMode('evolve');
$('tabPlay').onclick = () => setMode('play');

$('strip').addEventListener('click', e => {
  if (S.mode !== 'evolve') return;
  const r = $('strip').getBoundingClientRect();
  S.watch = Math.max(0, Math.min(S.evo.size - 1, Math.floor((e.clientX - r.left) / r.width * S.evo.size)));
  S.pinned = true; S.snapCam = true;
});

const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump', Shift: 'run', z: 'run', Z: 'run', x: 'run', X: 'run' };
addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' && e.target.type === 'range') return;
  if (S.mode === 'play') {
    const k = KEYMAP[e.key];
    if (k) { keys[k] = true; e.preventDefault(); }
    if (e.key === 'r' || e.key === 'R') keys.restart = true;
  } else if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); setRunning(!S.running); }
});
addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });
addEventListener('blur', () => { keys.left = keys.right = keys.jump = keys.run = false; });

/* ---------------- go ---------------- */
newEvolution();

// Optional URL parameters (used to capture README screenshots, handy for demos):
//   ?level=1  ?seed=5  ?warmup=30 (pre-evolve N generations)  ?frames=240 (run N frames into the next one)
//   ?mode=play  ?only=game|brain|stats (show a single panel)  ?pause=1
(function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  if (q.has('level')) { S.level = +q.get('level'); $('selLevel').value = S.level; }
  if (q.has('level') || q.has('seed')) {
    S.evo = new Evolution(LEVELS[S.level], { size: S.popSize, mutation: S.mutation, seed: q.has('seed') ? +q.get('seed') : undefined });
  }
  const warm = +q.get('warmup') || 0;
  S.speed = 0;
  for (let guard = 0; S.evo.generation < warm && guard < 5e6; guard++) { S.cooldown = 0; advanceEvolution(); }
  S.cooldown = 0; S.speed = 1;
  for (let i = 0; i < (+q.get('frames') || 0); i++) advanceEvolution();
  S.celebrate = 0; updateStats();
  if (q.get('pause')) { setRunning(false); S.quiet = true; }
  if (q.get('mode') === 'play') setMode('play');
  if (q.get('only')) document.body.classList.add('only', 'only-' + q.get('only'));
  if (q.has('level') || warm) { viz.initialised = false; viz.autoRotate = false; $('chkRotate').checked = false; }
})();

requestAnimationFrame(loop);
