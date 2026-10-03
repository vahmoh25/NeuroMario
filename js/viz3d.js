/* ===========================================================
 * viz3d.js — interactive 3D view of the neural network.
 * Custom perspective engine on a 2D canvas (no dependencies).
 *  - drag to orbit, wheel to zoom, double-click to reset
 *  - node colour = live activation, line colour = weight sign,
 *    line brightness / pulses = signal actually flowing right now
 *  - weights glide toward whichever genome is being watched, and
 *    connections that just changed flash white (mutation made visible)
 * =========================================================== */

class NetViz3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.yaw0 = 0.42; this.pitch = 0.26; this.dist = 9.5;
    this.autoRotate = true; this.autoPhase = 0; this.pauseAuto = 0;
    this.minW = 0.12;
    this.layers = NN_LAYERS;
    this.buildLayout();
    this.dispW = []; this.prevT = []; this.flash = [];
    for (let l = 0; l < this.layers.length - 1; l++) {
      const n = this.layers[l] * this.layers[l + 1];
      this.dispW.push(new Float32Array(n)); this.prevT.push(new Float32Array(n)); this.flash.push(new Float32Array(n));
    }
    this.initialised = false;
    this.mouse = null; this.hover = null;
    this.dpr = 1; this.W = 300; this.H = 300;
    this.bindEvents();
    this.resize();
  }

  buildLayout() {
    const xs = [-4.1, -1.4, 1.4, 4.1];
    const nodes = [];
    const L0 = [];
    for (let r = 0; r < VISION_ROWS; r++) for (let c = 0; c < VISION_COLS; c++) L0.push({ x: xs[0], y: (2 - r) * 0.36 + 0.35, z: (c - 3.5) * 0.36, kind: 'vision', r, c });
    ['on ground', 'vert. speed', 'horiz. speed'].forEach((nm, i) => L0.push({ x: xs[0], y: -1.3, z: (i - 1) * 0.95, kind: 'body', label: nm }));
    nodes.push(L0);
    for (let l = 1; l < this.layers.length - 1; l++) {
      const n = this.layers[l], cols = Math.ceil(Math.sqrt(n * 1.6)), rows = Math.ceil(n / cols), L = [];
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        L.push({ x: xs[l], y: ((rows - 1) / 2 - r) * 0.56, z: (c - (cols - 1) / 2) * 0.56, kind: 'hidden' });
      }
      nodes.push(L);
    }
    const nOut = this.layers[this.layers.length - 1], O = [];
    for (let i = 0; i < nOut; i++) O.push({ x: xs[3], y: ((nOut - 1) / 2 - i) * 0.62, z: 0, kind: 'output', label: OUTPUT_NAMES[i] });
    nodes.push(O);
    this.nodes = nodes;
    for (const L of nodes) for (const n of L) { n.sx = 0; n.sy = 0; n.sc = 1; n.zd = 0; }
    this.titles = ['INPUT', 'HIDDEN 1', 'HIDDEN 2', 'OUTPUT'];
    this.bounds = nodes.map(L => {
      let y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const n of L) { y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
      const pad = 0.34; return { x: L[0].x, y0: y0 - pad, y1: y1 + pad, z0: z0 - pad - 0.1, z1: z1 + pad + 0.1 };
    });
  }

  bindEvents() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: this.yaw0, pitch: this.pitch }; c.setPointerCapture(e.pointerId); this.pauseAuto = 240; c.style.cursor = 'grabbing'; });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      this.mouse = { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr };
      if (drag) {
        this.yaw0 = drag.yaw + (e.clientX - drag.x) * 0.008;
        this.pitch = Math.max(-1.3, Math.min(1.3, drag.pitch + (e.clientY - drag.y) * 0.008));
        this.pauseAuto = 240;
      }
    });
    const up = () => { drag = null; c.style.cursor = 'grab'; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.mouse = null; });
    c.addEventListener('wheel', e => { e.preventDefault(); this.dist = Math.max(4.5, Math.min(18, this.dist * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });
    c.addEventListener('dblclick', () => { this.yaw0 = 0.42; this.pitch = 0.26; this.dist = 9.5; this.autoPhase = 0; });
    c.style.cursor = 'grab';
    new ResizeObserver(() => this.resize()).observe(c);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(200, Math.round(r.width * this.dpr)); this.H = Math.max(200, Math.round(r.height * this.dpr));
    if (this.canvas.width !== this.W || this.canvas.height !== this.H) { this.canvas.width = this.W; this.canvas.height = this.H; }
  }

  project(n, cs, sn, cp, sp, F, cx, cy) {
    const x1 = n.x * cs + n.z * sn, z1 = -n.x * sn + n.z * cs;
    const y2 = n.y * cp - z1 * sp, z2 = n.y * sp + z1 * cp;
    const s = F / (this.dist + z2);
    n.sx = cx + x1 * s; n.sy = cy - y2 * s; n.sc = s; n.zd = z2;
  }
  proj3(x, y, z, cs, sn, cp, sp, F, cx, cy) {
    const x1 = x * cs + z * sn, z1 = -x * sn + z * cs, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp, s = F / (this.dist + z2);
    return [cx + x1 * s, cy - y2 * s];
  }

  /** @param genome the network being watched; acts its live activations */
  render(genome, acts, time, outputsOn) {
    const { ctx, W, H, dpr } = this;
    ctx.clearRect(0, 0, W, H);
    if (!genome) return;

    // glide displayed weights toward the genome, flash what changed
    for (let l = 0; l < genome.w.length; l++) {
      const w = genome.w[l], m = genome.m[l], d = this.dispW[l], pt = this.prevT[l], fl = this.flash[l];
      for (let i = 0; i < w.length; i++) {
        const t = m[i] ? w[i] : 0;
        if (!this.initialised) { d[i] = t; pt[i] = t; continue; }
        if (Math.abs(t - pt[i]) > 0.18) fl[i] = 1;
        pt[i] = t;
        d[i] += (t - d[i]) * 0.1;
        fl[i] *= 0.975;
      }
    }
    this.initialised = true;

    if (this.pauseAuto > 0) this.pauseAuto--; else if (this.autoRotate) this.autoPhase += 0.0045;
    const yaw = this.yaw0 + (this.autoRotate ? Math.sin(this.autoPhase) * 0.3 : 0);
    const cs = Math.cos(yaw), sn = Math.sin(yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const F = this.dist * Math.min(W / 10.4, H / 6.0), cx = W * 0.43, cy = H * 0.5;

    for (const L of this.nodes) for (const n of L) this.project(n, cs, sn, cp, sp, F, cx, cy);

    // --- layer planes + titles
    ctx.lineWidth = dpr;
    for (let l = 0; l < this.bounds.length; l++) {
      const b = this.bounds[l];
      const c1 = this.proj3(b.x, b.y1, b.z0, cs, sn, cp, sp, F, cx, cy), c2 = this.proj3(b.x, b.y1, b.z1, cs, sn, cp, sp, F, cx, cy);
      const c3 = this.proj3(b.x, b.y0, b.z1, cs, sn, cp, sp, F, cx, cy), c4 = this.proj3(b.x, b.y0, b.z0, cs, sn, cp, sp, F, cx, cy);
      ctx.beginPath(); ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]); ctx.lineTo(c4[0], c4[1]); ctx.closePath();
      ctx.fillStyle = 'rgba(140,170,255,.045)'; ctx.fill();
      ctx.strokeStyle = 'rgba(140,170,255,.22)'; ctx.stroke();
      const top = this.proj3(b.x, b.y1 + 0.25, (b.z0 + b.z1) / 2, cs, sn, cp, sp, F, cx, cy);
      ctx.fillStyle = 'rgba(190,205,255,.8)'; ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(this.titles[l], top[0], top[1]);
    }

    // --- connections
    ctx.lineCap = 'round';
    let pulses = 0;
    const pulseList = [];
    for (let l = 0; l < genome.w.length; l++) {
      const d = this.dispW[l], fl = this.flash[l];
      const A = this.nodes[l], B = this.nodes[l + 1], nIn = A.length;
      const src = acts[l];
      for (let o = 0; o < B.length; o++) {
        const nb = B[o], base = o * nIn;
        for (let i = 0; i < nIn; i++) {
          const we = d[base + i], f = fl[base + i];
          const aw = Math.abs(we);
          if (aw < this.minW && f < 0.05) continue;
          const na = A[i];
          const flow = src[i] * we, af = Math.min(1, Math.abs(flow));
          const wn = Math.min(1, aw / 2);
          let a = 0.05 + 0.26 * wn + 0.6 * af + 0.5 * f;
          let r = we > 0 ? 255 : 90, g = we > 0 ? 170 : 170, b = we > 0 ? 60 : 255;
          if (f > 0.02) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
          ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${Math.min(1, a).toFixed(2)})`;
          ctx.lineWidth = (0.5 + 1.3 * wn + 1.8 * af + 2 * f) * dpr * 0.8;
          ctx.beginPath(); ctx.moveTo(na.sx, na.sy); ctx.lineTo(nb.sx, nb.sy); ctx.stroke();
          if (af > 0.4 && pulses < 160) { pulses++; pulseList.push(na, nb, (i * 0.37 + o * 0.61 + l * 0.2), flow > 0); }
        }
      }
    }
    for (let k = 0; k < pulseList.length; k += 4) {
      const na = pulseList[k], nb = pulseList[k + 1], ph = pulseList[k + 2], pos = pulseList[k + 3];
      const t = (time * 0.012 + ph) % 1;
      ctx.fillStyle = pos ? 'rgba(255,225,140,.95)' : 'rgba(150,210,255,.95)';
      ctx.beginPath(); ctx.arc(na.sx + (nb.sx - na.sx) * t, na.sy + (nb.sy - na.sy) * t, 2.1 * dpr, 0, 7); ctx.fill();
    }

    // --- nodes, far to near
    const all = [];
    for (let l = 0; l < this.nodes.length; l++) for (let i = 0; i < this.nodes[l].length; i++) all.push([this.nodes[l][i], l, i]);
    all.sort((a, b) => b[0].zd - a[0].zd);
    let hover = null, hd = 14 * dpr;
    for (const [n, l, i] of all) {
      const a = acts[l][i];
      const base = n.kind === 'output' ? 0.2 : n.kind === 'hidden' ? 0.15 : n.kind === 'body' ? 0.1 : 0.085;
      const rad = Math.max(2 * dpr, base * n.sc);
      const [R, G, B] = actRGB(a);
      if (Math.abs(a) > 0.3) {
        ctx.fillStyle = `rgba(${R | 0},${G | 0},${B | 0},${(0.22 * Math.abs(a)).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(n.sx, n.sy, rad * 2.1, 0, 7); ctx.fill();
      }
      ctx.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
      ctx.beginPath(); ctx.arc(n.sx, n.sy, rad, 0, 7); ctx.fill();
      const on = n.kind === 'output' && a > 0;
      ctx.lineWidth = (on ? 2.5 : 1) * dpr; ctx.strokeStyle = on ? '#7dff9b' : 'rgba(255,255,255,.35)'; ctx.stroke();
      if (n.kind === 'output') {
        ctx.fillStyle = on ? '#9dffb4' : 'rgba(210,220,255,.8)'; ctx.font = `700 ${12 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(n.label, n.sx + rad + 8 * dpr, n.sy);
      } else if (n.kind === 'body') {
        ctx.fillStyle = 'rgba(190,205,255,.65)'; ctx.font = `${9.5 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(n.label, n.sx, n.sy + rad + 3 * dpr);
      }
      if (this.mouse) { const dd = Math.hypot(this.mouse.x - n.sx, this.mouse.y - n.sy); if (dd < hd) { hd = dd; hover = [n, l, i, a]; } }
    }

    // --- hover tooltip
    if (hover) {
      const [n, l, i, a] = hover;
      let name = l === 0 ? (n.kind === 'vision' ? `vision tile (${n.c - 1 >= 0 ? '+' : ''}${n.c - 1}, ${n.r - 2 >= 0 ? '+' : ''}${n.r - 2})` : n.label) : l === this.nodes.length - 1 ? `output: ${n.label}` : `hidden L${l} #${i}`;
      const txt = `${name}   ${a >= 0 ? '+' : ''}${a.toFixed(2)}`;
      ctx.font = `600 ${11.5 * dpr}px system-ui, sans-serif`;
      const w = ctx.measureText(txt).width + 14 * dpr, x = Math.min(this.mouse.x + 12 * dpr, W - w - 4), y = Math.max(this.mouse.y - 30 * dpr, 4);
      ctx.fillStyle = 'rgba(10,14,32,.92)'; ctx.beginPath(); ctx.roundRect(x, y, w, 22 * dpr, 6 * dpr); ctx.fill();
      ctx.strokeStyle = 'rgba(160,185,255,.5)'; ctx.lineWidth = dpr; ctx.stroke();
      ctx.fillStyle = '#eaf0ff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + 7 * dpr, y + 11.5 * dpr);
    }

    // --- legend
    ctx.font = `${10.5 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const ly = H - 14 * dpr; let lx = 12 * dpr;
    const item = (color, text) => { ctx.fillStyle = color; ctx.fillRect(lx, ly - 2 * dpr, 16 * dpr, 4 * dpr); ctx.fillStyle = 'rgba(200,212,255,.75)'; ctx.fillText(text, lx + 21 * dpr, ly); lx += ctx.measureText(text).width + 36 * dpr; };
    item('rgb(255,170,60)', 'excitatory (+)'); item('rgb(90,170,255)', 'inhibitory (−)'); item('#fff', 'just mutated');
  }
}
