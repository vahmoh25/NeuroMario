/* ===========================================================
 * render.js — draws the game world, agents, enemies, and the
 * "what the network sees" overlay. Pure canvas primitives, no assets.
 * =========================================================== */

const THEMES = {
  grass:  { sky: ['#5db4ff', '#bfe6ff'], hill: '#58b868', hill2: '#3f9a58', top: '#4caf50', dirt: '#9a6232', dirt2: '#7d4d26', brick: '#c8743a', stone: '#9aa3b2', cloud: true },
  cave:   { sky: ['#0a0f24', '#1b2a52'], hill: '#16254a', hill2: '#101b38', top: '#5d86c8', dirt: '#2a4170', dirt2: '#1f3358', brick: '#4f7fc0', stone: '#6c7da3', cloud: false },
  castle: { sky: ['#2a0d14', '#7a2a2a'], hill: '#4a1b22', hill2: '#35121a', top: '#8a8f99', dirt: '#4b4e57', dirt2: '#383a42', brick: '#7b4a4a', stone: '#8d8f99', cloud: false },
};

// activation -> colour (shared with the 3D network so the user can match them up)
function actRGB(a) {
  const hot = [255, 196, 64], cold = [64, 156, 255], base = [34, 42, 66];
  const t = Math.max(0, Math.min(1, Math.abs(a))), c = a >= 0 ? hot : cold;
  return [base[0] + (c[0] - base[0]) * t, base[1] + (c[1] - base[1]) * t, base[2] + (c[2] - base[2]) * t];
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = VIEW_W; canvas.height = VIEW_H;
    this.ctx.imageSmoothingEnabled = false;
    this.camX = 0;
  }

  followX(targetX, snap, levelW) {
    const maxCam = levelW * TILE - VIEW_W;
    const goal = Math.max(0, Math.min(maxCam, targetX - VIEW_W * 0.38));
    this.camX = snap ? goal : this.camX + (goal - this.camX) * 0.12;
  }

  draw(view) {
    const { ctx } = this;
    const game = view.watched, level = game.level, th = THEMES[level.theme];
    this.levelW = level.w;
    const cam = Math.round(this.camX), time = view.time;

    this.drawBackground(ctx, th, cam, level);
    this.drawTiles(ctx, game, th, cam, time, level);
    this.drawCastle(ctx, level, cam, th);

    // ghosts: the rest of the population
    if (view.showGhosts) {
      ctx.save();
      for (const a of view.agents) {
        if (a.game === game || !a.game.p.alive && !a.game.p.won) continue;
        const p = a.game.p;
        if (p.x - cam < -30 || p.x - cam > VIEW_W + 30) continue;
        ctx.globalAlpha = a.elite ? 0.55 : 0.3;
        ctx.fillStyle = `hsl(${a.hue},85%,60%)`;
        ctx.fillRect(p.x - cam, p.y, p.w, p.h);
        ctx.fillStyle = `hsl(${a.hue},90%,35%)`;
        ctx.fillRect(p.x - cam, p.y, p.w, 7);
      }
      ctx.restore();
    }

    this.drawEnemies(ctx, game, cam, time);
    if (view.showVision) this.drawVision(ctx, game, cam, view.obs);
    if (game.p.alive || game.p.won) this.drawPlayer(ctx, game.p, cam, time, view.watchedHue);
    else this.drawDeath(ctx, game.p, cam, time);

    if (view.outputs) this.drawController(ctx, view.outputs);
    if (view.banner) this.drawBanner(ctx, view.banner);
  }

  drawBackground(ctx, th, cam, level) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // parallax hills
    for (let layer = 0; layer < 2; layer++) {
      const sp = layer ? 0.5 : 0.25, hh = layer ? 70 : 110;
      ctx.fillStyle = layer ? th.hill2 : th.hill;
      ctx.beginPath(); ctx.moveTo(0, VIEW_H);
      for (let x = 0; x <= VIEW_W; x += 16) {
        const wx = x + cam * sp;
        const y = VIEW_H - GR * 0 - 3 * TILE - hh - Math.sin(wx * 0.011 + layer * 2) * 28 - Math.sin(wx * 0.027) * 12;
        ctx.lineTo(x, y + 60);
      }
      ctx.lineTo(VIEW_W, VIEW_H); ctx.fill();
    }
    if (th.cloud) {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 9; i++) {
        const wx = i * 330 + 80 - cam * 0.15, x = ((wx % (VIEW_W + 200)) + VIEW_W + 200) % (VIEW_W + 200) - 100;
        const y = 40 + (i * 53) % 90;
        ctx.beginPath(); ctx.ellipse(x, y, 34, 13, 0, 0, 7); ctx.ellipse(x + 22, y - 8, 22, 12, 0, 0, 7); ctx.ellipse(x - 20, y - 4, 18, 10, 0, 0, 7); ctx.fill();
      }
    } else if (level.theme === 'cave') {
      ctx.fillStyle = 'rgba(120,160,255,.35)';
      for (let i = 0; i < 40; i++) { const x = ((i * 197 - cam * 0.4) % VIEW_W + VIEW_W) % VIEW_W, y = (i * 83) % 260; ctx.fillRect(x, y, 2, 2); }
    } else {
      ctx.fillStyle = 'rgba(255,140,60,.5)';
      for (let i = 0; i < 30; i++) { const x = ((i * 151 - cam * 0.3) % VIEW_W + VIEW_W) % VIEW_W, y = (i * 61) % 380; ctx.fillRect(x, y, 3, 3); }
    }
  }

  drawTiles(ctx, game, th, cam, time, level) {
    const W = game.W, tiles = game.tiles;
    const x0 = Math.max(0, Math.floor(cam / TILE)), x1 = Math.min(W - 1, Math.floor((cam + VIEW_W) / TILE));
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = tiles[ty * W + tx];
        if (t === T.EMPTY) continue;
        const px = tx * TILE - cam, py = ty * TILE;
        switch (t) {
          case T.GROUND: {
            const above = ty > 0 && SOLID[tiles[(ty - 1) * W + tx]];
            ctx.fillStyle = th.dirt; ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = th.dirt2; ctx.fillRect(px + 4, py + 10, 6, 5); ctx.fillRect(px + 18, py + 21, 7, 5);
            if (!above) { ctx.fillStyle = th.top; ctx.fillRect(px, py, TILE, 9); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(px, py, TILE, 3); }
            break;
          }
          case T.BRICK:
            ctx.fillStyle = th.brick; ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = 'rgba(0,0,0,.35)';
            ctx.fillRect(px, py + 10, TILE, 2); ctx.fillRect(px, py + 21, TILE, 2);
            ctx.fillRect(px + 15, py, 2, 10); ctx.fillRect(px + 7, py + 12, 2, 9); ctx.fillRect(px + 23, py + 12, 2, 9); ctx.fillRect(px + 15, py + 23, 2, 9);
            ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(px, py, TILE, 2);
            break;
          case T.QBLOCK: {
            ctx.fillStyle = '#f2b632'; ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = '#b57a12'; ctx.fillRect(px, py + TILE - 3, TILE, 3); ctx.fillRect(px + TILE - 3, py, 3, TILE);
            ctx.fillStyle = '#ffe58a'; ctx.fillRect(px, py, TILE, 2);
            ctx.fillStyle = '#7a4b05'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('?', px + 16, py + 17 + Math.sin(time * 0.1 + tx) * 0.8);
            break;
          }
          case T.USED:
            ctx.fillStyle = '#6b5039'; ctx.fillRect(px, py, TILE, TILE); ctx.fillStyle = '#4a3624'; ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
            break;
          case T.PIPE: case T.PIPETOP: {
            const left = tx > 0 && (tiles[ty * W + tx - 1] === T.PIPE || tiles[ty * W + tx - 1] === T.PIPETOP);
            const top = t === T.PIPETOP;
            ctx.fillStyle = '#27a844'; ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = '#5fe07a'; ctx.fillRect(left ? px + 6 : px + 5, py, 5, TILE);
            ctx.fillStyle = '#167a2e'; ctx.fillRect(left ? px + TILE - 5 : px, py, 5, TILE);
            if (top) { ctx.fillStyle = '#1e8f3a'; ctx.fillRect(px, py, TILE, 8); ctx.fillStyle = '#7bf092'; ctx.fillRect(px + 2, py + 1, TILE - 4, 2); }
            ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(px, py + (top ? 8 : 0), 1, TILE);
            break;
          }
          case T.STONE:
            ctx.fillStyle = th.stone; ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(px, py, TILE, 3); ctx.fillRect(px, py, 3, TILE);
            ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(px, py + TILE - 3, TILE, 3); ctx.fillRect(px + TILE - 3, py, 3, TILE);
            break;
          case T.SPIKE:
            ctx.fillStyle = '#cfd6e6';
            for (let s = 0; s < 3; s++) { ctx.beginPath(); ctx.moveTo(px + s * 11 - 0.5, py + TILE); ctx.lineTo(px + s * 11 + 5.5, py + 12); ctx.lineTo(px + s * 11 + 11.5, py + TILE); ctx.fill(); }
            ctx.fillStyle = '#7d869c';
            for (let s = 0; s < 3; s++) { ctx.beginPath(); ctx.moveTo(px + s * 11 + 5.5, py + 12); ctx.lineTo(px + s * 11 + 11.5, py + TILE); ctx.lineTo(px + s * 11 + 6.5, py + TILE); ctx.fill(); }
            break;
          case T.COIN: {
            const w = Math.abs(Math.cos(time * 0.08 + tx * 0.7)) * 9 + 2;
            ctx.fillStyle = '#ffd23c'; ctx.beginPath(); ctx.ellipse(px + 16, py + 16, w, 10, 0, 0, 7); ctx.fill();
            ctx.fillStyle = '#fff3a8'; ctx.beginPath(); ctx.ellipse(px + 16 - w * 0.25, py + 13, w * 0.35, 4, 0, 0, 7); ctx.fill();
            break;
          }
          case T.FLAG: {
            ctx.fillStyle = '#e9edf5'; ctx.fillRect(px + 14, py, 4, TILE);
            if (ty === 0 || tiles[(ty - 1) * W + tx] !== T.FLAG) {
              ctx.fillStyle = '#ffd23c'; ctx.beginPath(); ctx.arc(px + 16, py + 3, 6, 0, 7); ctx.fill();
              ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(px + 18, py + 8); ctx.lineTo(px + 18 + 26 + Math.sin(time * 0.15) * 3, py + 18); ctx.lineTo(px + 18, py + 28); ctx.fill();
            }
            break;
          }
        }
      }
    }
  }

  drawCastle(ctx, level, cam, th) {
    const cx = (level.flagX + 3) * TILE - cam, gy = GR * TILE;
    if (cx > VIEW_W + 10 || cx < -200) return;
    ctx.fillStyle = '#8a6a55'; ctx.fillRect(cx, gy - 110, 110, 110);
    ctx.fillStyle = '#6e5242';
    for (let i = 0; i < 4; i++) ctx.fillRect(cx + i * 28 + 2, gy - 126, 18, 18);
    ctx.fillStyle = '#2b1d18'; ctx.beginPath(); ctx.moveTo(cx + 40, gy); ctx.lineTo(cx + 40, gy - 40); ctx.arc(cx + 55, gy - 40, 15, Math.PI, 0); ctx.lineTo(cx + 70, gy); ctx.fill();
  }

  drawEnemies(ctx, game, cam, time) {
    for (const e of game.enemies) {
      const px = e.x - cam;
      if (px < -40 || px > VIEW_W + 40) continue;
      if (!e.alive) {
        if (e.squash >= 30) continue;
        ctx.globalAlpha = 1 - e.squash / 30;
        ctx.fillStyle = '#8b5a2b'; ctx.fillRect(px, e.y + 20, 28, 8);
        ctx.globalAlpha = 1; continue;
      }
      const step = Math.floor(time / 8 + e.x / 20) % 2;
      ctx.fillStyle = '#3a2412';
      ctx.fillRect(px + (step ? 2 : 6), e.y + 22, 9, 6); ctx.fillRect(px + (step ? 17 : 13), e.y + 22, 9, 6);
      ctx.fillStyle = '#a8672e'; ctx.beginPath(); ctx.ellipse(px + 14, e.y + 12, 14, 12, 0, Math.PI, 0); ctx.fillRect(px, e.y + 12, 28, 6); ctx.fill();
      ctx.fillStyle = '#f0d0a8'; ctx.fillRect(px + 6, e.y + 14, 16, 8);
      ctx.fillStyle = '#fff'; ctx.fillRect(px + 6, e.y + 8, 6, 7); ctx.fillRect(px + 16, e.y + 8, 6, 7);
      ctx.fillStyle = '#111'; ctx.fillRect(px + 9, e.y + 10, 3, 4); ctx.fillRect(px + 16, e.y + 10, 3, 4);
      ctx.fillStyle = '#3a2412'; ctx.fillRect(px + 5, e.y + 6, 8, 2); ctx.fillRect(px + 15, e.y + 6, 8, 2);
    }
  }

  drawPlayer(ctx, p, cam, time, hue) {
    const x = Math.round(p.x - cam), y = Math.round(p.y);
    ctx.save();
    ctx.translate(x + p.w / 2, 0);
    ctx.scale(p.facing < 0 ? -1 : 1, 1);
    ctx.translate(-p.w / 2, 0);
    const moving = p.onGround && Math.abs(p.vx) > 0.3, step = moving ? Math.floor(time / 5) % 2 : 0;
    // soft glow ring in the agent's colour
    ctx.fillStyle = `hsla(${hue},90%,60%,.22)`; ctx.beginPath(); ctx.ellipse(p.w / 2, y + p.h, 18, 5, 0, 0, 7); ctx.fill();
    // legs/shoes
    ctx.fillStyle = '#5a2d0c';
    if (!p.onGround) { ctx.fillRect(1, y + 25, 10, 5); ctx.fillRect(12, y + 22, 10, 5); }
    else if (step) { ctx.fillRect(0, y + 26, 10, 4); ctx.fillRect(13, y + 26, 9, 4); }
    else { ctx.fillRect(3, y + 26, 8, 4); ctx.fillRect(11, y + 26, 8, 4); }
    ctx.fillStyle = '#2a5bd7'; ctx.fillRect(3, y + 17, 16, 9);              // overalls
    ctx.fillStyle = '#e63232'; ctx.fillRect(2, y + 13, 18, 5);               // shirt
    ctx.fillRect(p.onGround ? 0 : 0, y + (p.onGround ? 14 : 8), 4, p.onGround ? 6 : 8); // arm
    ctx.fillStyle = '#f3c28f'; ctx.fillRect(4, y + 5, 15, 9);               // face
    ctx.fillStyle = '#4a2a10'; ctx.fillRect(9, y + 11, 11, 2);              // moustache
    ctx.fillStyle = '#111'; ctx.fillRect(14, y + 7, 3, 3);                  // eye
    ctx.fillStyle = '#e63232'; ctx.fillRect(3, y + 1, 15, 5); ctx.fillRect(12, y + 4, 11, 3); // cap
    ctx.fillStyle = '#fff'; ctx.fillRect(8, y + 2, 4, 3);
    ctx.fillStyle = '#ffd23c'; ctx.fillRect(10, y + 18, 3, 3); ctx.fillRect(15, y + 18, 3, 3);
    ctx.restore();
    // marker above the watched agent
    ctx.fillStyle = `hsl(${hue},90%,65%)`;
    ctx.beginPath(); ctx.moveTo(x + 11, y - 6); ctx.lineTo(x + 5, y - 15); ctx.lineTo(x + 17, y - 15); ctx.fill();
  }

  drawDeath(ctx, p, cam, time) {
    const x = p.x - cam + p.w / 2, y = Math.min(p.y, ROWS * TILE - 20);
    ctx.fillStyle = 'rgba(255,90,90,.9)'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
    ctx.fillText('✖ ' + p.cause, x, y - 6);
  }

  /** The 8x5 window the network actually sees, coloured like the 3D input layer. */
  drawVision(ctx, game, cam, obs) {
    const p = game.p;
    const cx = Math.floor((p.x + p.w / 2) / TILE), cy = Math.floor((p.y + p.h / 2) / TILE);
    ctx.save();
    for (let r = 0; r < VISION_ROWS; r++) for (let c = 0; c < VISION_COLS; c++) {
      const v = obs[r * VISION_COLS + c];
      const px = (cx + c - 1) * TILE - cam, py = (cy + r - 2) * TILE;
      if (v !== 0) {
        const [R, G, B] = actRGB(v);
        ctx.fillStyle = `rgba(${R | 0},${G | 0},${B | 0},${0.12 + Math.abs(v) * 0.22})`;
        ctx.fillRect(px, py, TILE, TILE);
      }
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    ctx.strokeRect((cx - 1) * TILE - cam + 0.5, (cy - 2) * TILE + 0.5, VISION_COLS * TILE - 1, VISION_ROWS * TILE - 1);
    ctx.restore();
  }

  /** The AI's virtual gamepad: lights up with the network's output neurons. */
  drawController(ctx, o) {
    const x = 14, y = VIEW_H - 62;
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,28,.62)'; ctx.beginPath(); ctx.roundRect(x - 6, y - 8, 224, 60, 10); ctx.fill();
    const btn = (bx, by, w, label, on) => {
      ctx.fillStyle = on ? '#ffc840' : 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.roundRect(bx, by, w, 40, 8); ctx.fill();
      ctx.fillStyle = on ? '#2a1c00' : 'rgba(255,255,255,.55)'; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + w / 2, by + 21);
    };
    btn(x, y, 48, '◀', o.left); btn(x + 54, y, 48, '▶', o.right); btn(x + 108, y, 56, 'JUMP', o.jump); btn(x + 170, y, 44, 'RUN', o.run);
    ctx.restore();
  }

  drawBanner(ctx, b) {
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,28,.72)'; ctx.fillRect(0, VIEW_H / 2 - 58, VIEW_W, 116);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = b.color || '#ffd23c'; ctx.font = 'bold 30px system-ui, sans-serif'; ctx.fillText(b.title, VIEW_W / 2, VIEW_H / 2 - 20);
    ctx.fillStyle = '#dfe6ff'; ctx.font = '16px system-ui, sans-serif'; ctx.fillText(b.sub, VIEW_W / 2, VIEW_H / 2 + 18);
    if (b.sub2) { ctx.fillStyle = '#9fb0e6'; ctx.font = '13px system-ui, sans-serif'; ctx.fillText(b.sub2, VIEW_W / 2, VIEW_H / 2 + 42); }
    ctx.restore();
  }
}
