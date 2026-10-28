// Tetris Royale (estilo TETR.IO): SRS + wall kicks, saco de 7, hold, fila, fantasma,
// T-spin, combos, back-to-back, perfect clear e lixo mandado para os outros.
// Cada jogador simula o próprio tabuleiro (sem lag); o servidor só arbitra a sala.
import { el, toast, store, save } from './ui.js';
import { api } from './api.js';
import { TETRIS_SKINS } from './tetris-skins.js';

const W = 10, H = 22, VIS = 20, HID = H - VIS;
const NAMES = ['', 'I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const COLORS = ['', '#38d6ff', '#ffd23f', '#b45cff', '#4ade80', '#ff4d6d', '#3d6bff', '#ff9f40', '#6b7280'];
// formas SRS (x, y com y para baixo) para os 4 estados de rotação
const SHAPES = {
  1: [[[0, 1], [1, 1], [2, 1], [3, 1]], [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]], [[1, 0], [1, 1], [1, 2], [1, 3]]],
  2: [[[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]]],
  3: [[[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [1, 2]]],
  4: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]], [[1, 1], [2, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1], [1, 2]]],
  5: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[2, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 0], [0, 1], [1, 1], [0, 2]]],
  6: [[[0, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [0, 2], [1, 2]]],
  7: [[[2, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [0, 2]], [[0, 0], [1, 0], [1, 1], [1, 2]]],
};
// wall kicks SRS (tabela oficial em y para cima; convertemos ao usar)
const KICK_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICK_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};
const KICK_180 = [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]];
const COMBO = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =====================================================================
// MOTOR
// =====================================================================
export class Engine {
  constructor(seed, opts = {}) {
    this.rand = mulberry32(seed);
    this.garbageRand = mulberry32((Math.random() * 2 ** 31) | 0);
    this.casual = Boolean(opts.casual);
    this.on = opts.on || {};
    this.board = new Uint8Array(W * H);
    this.bag = [];
    this.queue = [];
    this.hold = 0;
    this.holdUsed = false;
    this.combo = -1;
    this.b2b = false;
    this.lines = 0;
    this.pieces = 0;
    this.sent = 0;
    this.time = 0;
    this.level = 0;
    this.incoming = []; // [{ n, col }]
    this.dead = false;
    this.lockMs = this.casual ? 1000 : 500;
    this.gravAcc = 0;
    this.lockAcc = 0;
    this.resets = 0;
    this.lastRot = false;
    this.lastKick = 0;
    this.dirty = true;
    while (this.queue.length < 6) this.refill();
    this.spawn();
  }

  refill() {
    if (!this.bag.length) {
      this.bag = [1, 2, 3, 4, 5, 6, 7];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    this.queue.push(this.bag.shift());
  }

  get gravityMs() {
    if (this.casual) return 900;
    return Math.max(25, 1000 * Math.pow(0.8, this.level));
  }

  cells(t, r, x, y) {
    return SHAPES[t][r].map(([cx, cy]) => [x + cx, y + cy]);
  }

  collides(t, r, x, y) {
    for (const [cx, cy] of this.cells(t, r, x, y)) {
      if (cx < 0 || cx >= W || cy >= H) return true;
      if (cy >= 0 && this.board[cy * W + cx]) return true;
    }
    return false;
  }

  spawn(type) {
    const t = type || this.queue.shift();
    if (!type) while (this.queue.length < 6) this.refill();
    this.cur = { t, r: 0, x: 3, y: t === 1 ? HID - 2 : HID - 1 };
    this.gravAcc = 0;
    this.lockAcc = 0;
    this.resets = 0;
    this.lastRot = false;
    if (this.collides(t, 0, 3, this.cur.y)) {
      this.cur.y--;
      if (this.collides(t, 0, 3, this.cur.y)) return this.die();
    }
    this.dirty = true;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.dirty = true;
    this.on.dead?.();
  }

  onGround() {
    const c = this.cur;
    return this.collides(c.t, c.r, c.x, c.y + 1);
  }

  afterMove() {
    this.dirty = true;
    if (this.onGround() && this.resets < 15) {
      this.lockAcc = 0;
      this.resets++;
    }
  }

  move(dx) {
    const c = this.cur;
    if (this.dead || this.collides(c.t, c.r, c.x + dx, c.y)) return false;
    c.x += dx;
    this.lastRot = false;
    this.afterMove();
    return true;
  }

  rotate(dir) {
    const c = this.cur;
    if (this.dead || c.t === 2) return false;
    const to = (c.r + (dir === 2 ? 2 : dir) + 4) % 4;
    const kicks = dir === 2 ? KICK_180 : (c.t === 1 ? KICK_I : KICK_JLSTZ)[`${c.r}>${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      const nx = c.x + kx, ny = c.y - ky; // tabela em y para cima
      if (!this.collides(c.t, to, nx, ny)) {
        c.x = nx;
        c.y = ny;
        c.r = to;
        this.lastRot = true;
        this.lastKick = i;
        this.afterMove();
        this.on.rotate?.();
        return true;
      }
    }
    return false;
  }

  softStep() {
    const c = this.cur;
    if (this.dead || this.collides(c.t, c.r, c.x, c.y + 1)) return false;
    c.y++;
    this.lastRot = false;
    this.dirty = true;
    return true;
  }

  ghostY() {
    const c = this.cur;
    let y = c.y;
    while (!this.collides(c.t, c.r, c.x, y + 1)) y++;
    return y;
  }

  hardDrop() {
    if (this.dead) return;
    const y = this.ghostY();
    if (y !== this.cur.y) this.lastRot = false;
    this.cur.y = y;
    this.lock();
  }

  holdPiece() {
    if (this.dead || this.holdUsed) return;
    const t = this.cur.t;
    this.holdUsed = true;
    if (this.hold) {
      const h = this.hold;
      this.hold = t;
      this.spawn(h);
    } else {
      this.hold = t;
      this.spawn();
    }
    this.dirty = true;
  }

  tspin() {
    const c = this.cur;
    if (c.t !== 3 || !this.lastRot) return null;
    const filled = (x, y) => x < 0 || x >= W || y >= H || (y >= 0 && this.board[y * W + x]);
    const corners = [[c.x, c.y], [c.x + 2, c.y], [c.x + 2, c.y + 2], [c.x, c.y + 2]];
    const occ = corners.map(([x, y]) => filled(x, y));
    if (occ.filter(Boolean).length < 3) return null;
    // cantos "da frente" dependem da rotação (a ponta do T)
    const front = [[0, 1], [1, 2], [2, 3], [3, 0]][c.r];
    return (occ[front[0]] && occ[front[1]]) || this.lastKick === 4 ? 'full' : 'mini';
  }

  lock() {
    const c = this.cur;
    const ts = this.tspin();
    let allHidden = true;
    for (const [x, y] of this.cells(c.t, c.r, c.x, c.y)) {
      if (y >= 0) this.board[y * W + x] = c.t;
      if (y >= HID) allHidden = false;
    }
    this.pieces++;
    // limpa linhas
    let cleared = 0;
    for (let y = H - 1; y >= 0; y--) {
      let full = true;
      for (let x = 0; x < W; x++) if (!this.board[y * W + x]) { full = false; break; }
      if (full) {
        this.board.copyWithin(W, 0, y * W);
        this.board.fill(0, 0, W);
        cleared++;
        y++;
      }
    }
    let atk = 0;
    if (cleared) {
      this.lines += cleared;
      if (ts === 'full') atk = [0, 2, 4, 6][cleared] ?? 6;
      else if (ts === 'mini') atk = [0, 0, 1, 2][cleared] ?? 2;
      else atk = [0, 0, 1, 2, 4][cleared];
      const b2bMove = cleared >= 4 || Boolean(ts);
      if (b2bMove && this.b2b) atk += 1;
      this.b2b = b2bMove;
      this.combo++;
      atk += COMBO[Math.min(this.combo, COMBO.length - 1)];
      if (this.board.every((v) => !v)) atk += 10; // perfect clear
      // lixo que estava chegando é cancelado primeiro
      while (atk > 0 && this.incoming.length) {
        const g = this.incoming[0];
        const k = Math.min(g.n, atk);
        g.n -= k;
        atk -= k;
        if (!g.n) this.incoming.shift();
      }
      if (atk > 0) {
        this.sent += atk;
        this.on.attack?.(atk);
      }
      this.on.clear?.({ lines: cleared, tspin: ts, combo: this.combo, b2b: this.b2b, pc: this.board.every((v) => !v) });
    } else {
      this.combo = -1;
      this.applyGarbage();
      this.on.lock?.();
    }
    this.holdUsed = false;
    if (allHidden) return this.die(); // travou toda acima da área visível
    this.spawn();
  }

  receive(n) {
    this.incoming.push({ n, col: Math.floor(this.garbageRand() * W) });
    this.dirty = true;
  }

  get incomingTotal() {
    return this.incoming.reduce((a, g) => a + g.n, 0);
  }

  applyGarbage() {
    let budget = 8;
    while (budget > 0 && this.incoming.length) {
      const g = this.incoming[0];
      const n = Math.min(g.n, budget);
      for (let k = 0; k < n; k++) {
        for (let x = 0; x < W; x++) if (this.board[x]) return this.die();
        this.board.copyWithin(0, W);
        const row = (H - 1) * W;
        for (let x = 0; x < W; x++) this.board[row + x] = x === g.col ? 0 : 8;
      }
      g.n -= n;
      budget -= n;
      if (!g.n) this.incoming.shift();
      this.on.garbage?.(n);
    }
    this.dirty = true;
  }

  tick(dt, soft) {
    if (this.dead) return;
    this.time += dt;
    this.level = Math.floor(this.time / 30000);
    const grav = soft ? Math.min(this.gravityMs, soft) : this.gravityMs;
    if (this.onGround()) {
      this.lockAcc += dt;
      if (this.lockAcc >= this.lockMs) this.lock();
    } else {
      this.gravAcc += dt;
      while (this.gravAcc >= grav) {
        this.gravAcc -= grav;
        if (!this.softStep()) break;
      }
    }
  }

  // tabuleiro visível (com a peça atual) em texto: 200 dígitos
  snapshot() {
    const g = new Uint8Array(this.board.subarray(HID * W));
    if (!this.dead) {
      const c = this.cur;
      for (const [x, y] of this.cells(c.t, c.r, c.x, c.y)) if (y >= HID) g[(y - HID) * W + x] = c.t;
    }
    return Array.from(g).join('');
  }
}

// =====================================================================
// ESTILOS DE TORRE (skins)
// =====================================================================
const cache = new Map();
const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
const GB = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
const ANIMATED = new Set(['lava', 'hologram', 'galaxy']);

function paint(ctx, skin, x, y, s, type, t = 0) {
  const col = COLORS[type];
  const r = (rr) => {
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, rr);
  };
  switch (skin) {
    case 'flat':
      ctx.fillStyle = col;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      break;
    case 'neon':
      ctx.fillStyle = shade(col, -0.75);
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = s * 0.5;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, s * 0.1);
      ctx.strokeRect(x + s * 0.15, y + s * 0.15, s * 0.7, s * 0.7);
      ctx.restore();
      break;
    case 'glossy': {
      const g = ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, shade(col, 0.35));
      g.addColorStop(1, shade(col, -0.25));
      ctx.fillStyle = g;
      r(s * 0.18);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.beginPath();
      ctx.ellipse(x + s * 0.5, y + s * 0.28, s * 0.36, s * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'pixel': {
      const p = Math.max(1, Math.round(s / 8));
      ctx.fillStyle = shade(col, -0.45);
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = col;
      ctx.fillRect(x + p, y + p, s - 2 * p, s - 2 * p);
      ctx.fillStyle = shade(col, 0.5);
      ctx.fillRect(x + p, y + p, p * 2, p);
      ctx.fillRect(x + p, y + p, p, p * 2);
      break;
    }
    case 'glass':
      ctx.fillStyle = col + '55';
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 2);
      ctx.lineTo(x + s * 0.6, y + 2);
      ctx.lineTo(x + 2, y + s * 0.6);
      ctx.fill();
      break;
    case 'candy':
      ctx.save();
      r(s * 0.25);
      ctx.clip();
      ctx.fillStyle = col;
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = s * 0.14;
      for (let k = -s; k < s * 2; k += s * 0.4) {
        ctx.beginPath();
        ctx.moveTo(x + k, y);
        ctx.lineTo(x + k + s, y + s);
        ctx.stroke();
      }
      ctx.restore();
      break;
    case 'gameboy': {
      const c = GB[type === 8 ? 1 : 1 + (type % 3)];
      ctx.fillStyle = GB[0];
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = c;
      ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
      ctx.fillStyle = GB[0];
      ctx.fillRect(x + s * 0.35, y + s * 0.35, s * 0.3, s * 0.3);
      break;
    }
    case 'jelly': {
      const g = ctx.createRadialGradient(x + s * 0.35, y + s * 0.3, s * 0.05, x + s / 2, y + s / 2, s * 0.7);
      g.addColorStop(0, shade(col, 0.6));
      g.addColorStop(1, shade(col, -0.15));
      ctx.fillStyle = g;
      r(s * 0.4);
      ctx.fill();
      break;
    }
    case 'metal': {
      const g = ctx.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, shade(col, 0.55));
      g.addColorStop(0.5, shade(col, -0.35));
      g.addColorStop(1, shade(col, 0.2));
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      for (const [dx, dy] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
        ctx.beginPath();
        ctx.arc(x + s * dx, y + s * dy, s * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'sakura':
      ctx.fillStyle = shade(col, 0.55);
      r(s * 0.3);
      ctx.fill();
      ctx.fillStyle = '#ffffffcc';
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + s / 2 + Math.cos(a) * s * 0.14, y + s / 2 + Math.sin(a) * s * 0.14, s * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ff4fa3';
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'lava': {
      const k = (Math.sin(t / 400 + x * 0.05 + y * 0.07) + 1) / 2;
      const g = ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, `hsl(${20 + k * 25}, 100%, ${50 + k * 15}%)`);
      g.addColorStop(1, `hsl(${k * 10}, 100%, 35%)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.strokeStyle = shade(col, -0.2);
      ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
      break;
    }
    case 'galaxy': {
      ctx.fillStyle = '#120a2e';
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      const seed = (x * 73856093) ^ (y * 19349663);
      for (let k = 0; k < 3; k++) {
        const sx = ((seed >> (k * 5)) & 31) / 31, sy = ((seed >> (k * 7 + 3)) & 31) / 31;
        ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * Math.abs(Math.sin(t / 600 + k + seed))})`;
        ctx.fillRect(x + 2 + sx * (s - 5), y + 2 + sy * (s - 5), Math.max(1, s * 0.07), Math.max(1, s * 0.07));
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
      break;
    }
    case 'hologram': {
      const hue = (t / 12 + x + y) % 360;
      ctx.fillStyle = `hsla(${hue}, 100%, 60%, .28)`;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.strokeStyle = `hsl(${hue}, 100%, 70%)`;
      ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      for (let k = 2; k < s; k += 4) ctx.fillRect(x + 1, y + k, s - 2, 1);
      break;
    }
    case 'gold': {
      const g = ctx.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, '#fff3b0');
      g.addColorStop(0.45, '#d4a017');
      g.addColorStop(1, '#7a5a0a');
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.fillStyle = col;
      ctx.fillRect(x + s * 0.32, y + s * 0.32, s * 0.36, s * 0.36);
      break;
    }
    default: {
      // clássico com bisel
      ctx.fillStyle = col;
      ctx.fillRect(x, y, s, s);
      const b = Math.max(1, s * 0.14);
      ctx.fillStyle = shade(col, 0.4);
      ctx.fillRect(x, y, s, b);
      ctx.fillRect(x, y, b, s);
      ctx.fillStyle = shade(col, -0.35);
      ctx.fillRect(x, y + s - b, s, b);
      ctx.fillRect(x + s - b, y, b, s);
    }
  }
}

function drawCell(ctx, skin, x, y, s, type, t) {
  if (ANIMATED.has(skin)) return paint(ctx, skin, x, y, s, type, t);
  const key = `${skin}|${type}|${s}`;
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = Math.ceil(s);
    paint(c.getContext('2d'), skin, 0, 0, s, type, 0);
    cache.set(key, c);
  }
  ctx.drawImage(c, x, y);
}

// desenha um tabuleiro (texto de 200 dígitos ou o motor)
function drawBoard(canvas, { grid, skin, cell, ghost, dead, flash }) {
  const ctx = canvas.getContext('2d');
  const w = W * cell, h = VIS * cell;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const t = performance.now();
  ctx.fillStyle = '#070912';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < W; x++) {
    ctx.moveTo(x * cell + 0.5, 0);
    ctx.lineTo(x * cell + 0.5, h);
  }
  for (let y = 1; y < VIS; y++) {
    ctx.moveTo(0, y * cell + 0.5);
    ctx.lineTo(w, y * cell + 0.5);
  }
  ctx.stroke();
  if (ghost) {
    ctx.globalAlpha = 0.28;
    for (const [x, y] of ghost.cells) if (y >= HID) drawCell(ctx, skin, x * cell, (y - HID) * cell, cell, ghost.t, t);
    ctx.globalAlpha = 1;
  }
  for (let i = 0; i < W * VIS; i++) {
    const v = typeof grid === 'string' ? grid.charCodeAt(i) - 48 : grid[i];
    if (v > 0 && v < 9) drawCell(ctx, skin, (i % W) * cell, Math.floor(i / W) * cell, cell, v, t);
  }
  if (dead) {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(0, 0, w, h);
  }
  if (flash) {
    ctx.fillStyle = `rgba(255,77,109,${flash})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawMini(canvas, type, skin, cell = 14) {
  const ctx = canvas.getContext('2d');
  canvas.width = cell * 4;
  canvas.height = cell * 2.4;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!type) return;
  const cells = SHAPES[type][0];
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const ox = (canvas.width - (maxX - minX + 1) * cell) / 2, oy = (canvas.height - (maxY - minY + 1) * cell) / 2;
  for (const [x, y] of cells) drawCell(ctx, skin, ox + (x - minX) * cell, oy + (y - minY) * cell, cell, type, performance.now());
}

export function skinPreview(skin, size = 12) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  c.width = size * 4;
  c.height = size * 3;
  const layout = [[0, 2, 3], [1, 2, 3], [2, 2, 3], [3, 2, 1], [1, 1, 5], [2, 1, 5], [2, 0, 5], [0, 1, 7], [3, 1, 6], [3, 0, 6]];
  for (const [x, y, t] of layout) paint(ctx, skin, x * size, y * size, size, t, 0);
  return c;
}

// =====================================================================
// SONS
// =====================================================================
let actx;
function blip(freqs, dur = 0.08, type = 'square', vol = 0.05) {
  if (!store('tetris-cfg', {}).sound && store('tetris-cfg', {}).sound !== undefined) return;
  try {
    actx ||= new AudioContext();
    const t0 = actx.currentTime;
    freqs.forEach((f, i) => {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(vol, t0 + i * dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i + 1) * dur);
      o.connect(g).connect(actx.destination);
      o.start(t0 + i * dur);
      o.stop(t0 + (i + 1) * dur + 0.02);
    });
  } catch {}
}

// =====================================================================
// INTERFACE DO JOGO (montada pela aba Jogos)
// =====================================================================
const DEFAULT_CFG = { das: 133, arr: 10, sdf: 'fast', casual: false, sound: true };
const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'soft', Space: 'hard', ArrowUp: 'cw', KeyX: 'cw', KeyZ: 'ccw',
  ControlLeft: 'ccw', ControlRight: 'ccw', KeyA: 'r180', KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
};

export class TetrisGame {
  constructor(hub) {
    this.hub = hub;
    this.app = hub.app;
    this.socket = hub.socket;
    this.cfg = { ...DEFAULT_CFG, ...store('tetris-cfg', {}) };
    this.boards = {};
    this.flash = {};
    this.engine = null;
    this.round = 0;
    this.held = new Set();
    this.root = el('div', { class: 'game-body tetris-wrap' });
    this.topbar = el('div', { class: 'tt-top' });
    this.arena = el('div', { class: 'tt-arena' });
    this.root.append(this.topbar, this.arena);
    this.onKeyDown = (e) => this.key(e, true);
    this.onKeyUp = (e) => this.key(e, false);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    this.ro = new ResizeObserver(() => this.layoutOpponents());
    this.ro.observe(this.root);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    this.ro.disconnect();
    this.setFull(false);
  }

  saveCfg() {
    save('tetris-cfg', this.cfg);
  }

  setFull(on) {
    this.full = on;
    document.getElementById('games-view').classList.toggle('tetris-full', on);
    setTimeout(() => this.layoutOpponents(), 50);
  }

  mySkin() {
    return this.app.me.tetrisSkin || 'classic';
  }

  // ---------------- estado vindo do servidor ----------------
  update(s) {
    const prevPhase = this.s?.state.phase;
    this.s = s;
    const st = s.state;
    if (s.boards) for (const [i, b] of Object.entries(s.boards)) if (b.round === st.round) this.boards[i] = b;
    const iPlay = s.me >= 0 && st.playing?.[s.me];

    if (st.phase === 'countdown' && this.round !== st.round) {
      this.round = st.round;
      this.boards = {};
      this.engine = null;
      this.countdownEnd = performance.now() + 3400;
      if (iPlay) {
        this.engine = new Engine(st.seed, { casual: this.cfg.casual, on: this.engineEvents() });
        this.lastSent = 0;
        this.sendBoard(true);
        if (this.root.clientWidth < 760) this.setFull(true);
      }
    }
    if (st.phase === 'playing' && prevPhase !== 'playing') {
      this.startedAt = performance.now();
      blip([880], 0.12, 'sine', 0.06);
    }
    if (st.phase === 'over' && prevPhase !== 'over') {
      const mine = st.lastResults?.find((r) => r.idx === s.me);
      if (mine) {
        const before = this.app.me.tetrisXp || 0;
        this.app.me.tetrisXp = mine.totalXp;
        const unlocked = TETRIS_SKINS.filter((k) => k.xp > before && k.xp <= mine.totalXp);
        unlocked.forEach((k) => toast(`🔓 Novo estilo de torre liberado: ${k.name}!`, 'success', 6000));
      }
    }
    this.render();
  }

  engineEvents() {
    return {
      attack: (n) => this.socket.emit('tetris:attack', { groupId: this.s.groupId, lines: n }),
      dead: () => {
        blip([330, 247, 196, 147], 0.14, 'sawtooth', 0.05);
        this.hub.emit({ type: 'dead', lines: this.engine.lines });
        this.sendBoard(true);
      },
      clear: (c) => {
        this.lastClear = { ...c, at: performance.now() };
        if (c.lines >= 4 || c.tspin) blip([523, 659, 784, 1047], 0.07, 'square', 0.05);
        else blip([660 + c.combo * 40], 0.07, 'square', 0.04);
      },
      lock: () => blip([180], 0.03, 'triangle', 0.04),
      garbage: () => blip([110, 90], 0.06, 'sawtooth', 0.05),
    };
  }

  onBoardEvt({ idx, b }) {
    this.onBoard(idx, b);
  }

  onGarbageEvt({ lines }) {
    this.onGarbage(lines);
  }

  onBoard(idx, b) {
    if (b.round !== this.s?.state.round) return;
    this.boards[idx] = b;
    const c = this.oppCanvases?.get(Number(idx));
    if (c) this.drawOpp(Number(idx), c);
  }

  onGarbage(lines) {
    this.engine?.receive(lines);
  }

  onAttackFx({ from, to }) {
    this.flash[to] = performance.now();
    const c = this.oppCanvases?.get(to);
    if (c) c.parentElement.classList.add('hit');
    setTimeout(() => c?.parentElement.classList.remove('hit'), 250);
  }

  sendBoard(force) {
    const e = this.engine;
    if (!e) return;
    const now = performance.now();
    if (!force && now - this.lastSent < 70) return;
    this.lastSent = now;
    this.socket.emit('tetris:board', { groupId: this.s.groupId, b: { g: e.snapshot(), inc: e.incomingTotal, l: e.lines, skin: this.mySkin() } });
  }

  // ---------------- teclado (DAS/ARR) ----------------
  key(e, down) {
    if (!this.engine || this.engine.dead || this.s?.state.phase !== 'playing') return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    const act = KEYS[e.code];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    if (down && e.repeat) return;
    this.action(act, down);
  }

  action(act, down) {
    const eng = this.engine;
    if (!eng || eng.dead) return;
    if (!down) {
      this.held.delete(act);
      if (act === this.dasDir) this.dasDir = this.held.has('left') ? 'left' : this.held.has('right') ? 'right' : null;
      return;
    }
    this.held.add(act);
    if (act === 'left' || act === 'right') {
      eng.move(act === 'left' ? -1 : 1);
      this.dasDir = act;
      this.dasT = 0;
      this.arrT = 0;
    } else if (act === 'hard') eng.hardDrop();
    else if (act === 'cw') eng.rotate(1);
    else if (act === 'ccw') eng.rotate(-1);
    else if (act === 'r180') eng.rotate(2);
    else if (act === 'hold') eng.holdPiece();
    else if (act === 'soft' && this.cfg.sdf === 'instant') while (eng.softStep());
  }

  loop(t) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(100, t - (this.lastT || t));
    this.lastT = t;
    const eng = this.engine;
    if (eng && !eng.dead && this.s?.state.phase === 'playing') {
      // DAS / ARR
      if (this.dasDir && this.held.has(this.dasDir)) {
        this.dasT += dt;
        if (this.dasT >= this.cfg.das) {
          const dx = this.dasDir === 'left' ? -1 : 1;
          if (this.cfg.arr <= 0) while (eng.move(dx));
          else {
            this.arrT += dt;
            while (this.arrT >= this.cfg.arr) {
              this.arrT -= this.cfg.arr;
              if (!eng.move(dx)) break;
            }
          }
        }
      }
      const soft = this.held.has('soft') ? (this.cfg.sdf === 'instant' ? 1 : 22) : 0;
      if (soft === 1) while (eng.softStep());
      eng.tick(dt, soft);
      if (eng.dirty) {
        this.sendBoard();
      }
    }
    this.drawMine(t);
    // tabuleiros animados dos outros
    if (this.oppCanvases) for (const [i, c] of this.oppCanvases) {
      const b = this.boards[i];
      if (b && (ANIMATED.has(b.skin) || performance.now() - (this.flash[i] || 0) < 300)) this.drawOpp(i, c);
    }
    this.updateHud(t);
  }

  // ---------------- desenho ----------------
  drawMine() {
    const eng = this.engine;
    if (!eng || !this.myCanvas) return;
    if (!eng.dirty && !ANIMATED.has(this.mySkin())) return;
    eng.dirty = false;
    const c = eng.cur;
    const gy = eng.dead ? null : eng.ghostY();
    drawBoard(this.myCanvas, {
      grid: (() => {
        const g = new Uint8Array(eng.board.subarray(HID * W));
        if (!eng.dead) for (const [x, y] of eng.cells(c.t, c.r, c.x, c.y)) if (y >= HID) g[(y - HID) * W + x] = c.t;
        return g;
      })(),
      skin: this.mySkin(),
      cell: this.myCell,
      ghost: gy !== null ? { t: c.t, cells: eng.cells(c.t, c.r, c.x, gy) } : null,
      dead: eng.dead,
    });
    if (this.holdCanvas) drawMini(this.holdCanvas, eng.hold, this.mySkin(), Math.round(this.myCell * 0.55));
    this.nextCanvases?.forEach((cv, i) => drawMini(cv, eng.queue[i], this.mySkin(), Math.round(this.myCell * (i ? 0.45 : 0.55))));
    if (this.meter) this.meter.style.height = Math.min(100, (eng.incomingTotal / VIS) * 100) + '%';
  }

  drawOpp(i, canvas) {
    const b = this.boards[i];
    const st = this.s.state;
    const f = Math.max(0, 1 - (performance.now() - (this.flash[i] || 0)) / 300) * 0.35;
    drawBoard(canvas, { grid: b?.g || '0'.repeat(200), skin: b?.skin || 'classic', cell: this.oppCell, dead: !st.alive[i], flash: f });
    const meter = canvas.parentElement.querySelector('.tt-opp-meter');
    if (meter) meter.style.height = Math.min(100, ((b?.inc || 0) / VIS) * 100) + '%';
  }

  updateHud(t) {
    const eng = this.engine;
    if (this.cdEl) {
      const left = Math.ceil((this.countdownEnd - performance.now()) / 1000);
      const ph = this.s?.state.phase;
      this.cdEl.textContent = ph === 'countdown' ? (left > 0 ? left : 'VAI!') : '';
      this.cdEl.classList.toggle('hidden', ph !== 'countdown');
    }
    if (!eng || !this.statsEl) return;
    const sec = Math.max(0.001, eng.time / 1000);
    this.statsEl.replaceChildren(
      ...[['LINHAS', eng.lines], ['PPS', (eng.pieces / sec).toFixed(2)], ['APM', ((eng.sent / sec) * 60).toFixed(1)], ['TEMPO', `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`], ['NÍVEL', eng.level + 1]].map(([k, v]) =>
        el('div', { class: 'tt-stat' }, el('small', {}, k), el('b', {}, v)))
    );
    if (this.clearEl) {
      const c = this.lastClear;
      const show = c && t - c.at < 1400;
      this.clearEl.classList.toggle('show', Boolean(show));
      if (show && this.clearEl.dataset.at !== String(c.at)) {
        this.clearEl.dataset.at = String(c.at);
        const label = c.pc ? 'PERFECT CLEAR' : c.tspin ? `T-SPIN${c.tspin === 'mini' ? ' MINI' : ''} ${['', 'SINGLE', 'DOUBLE', 'TRIPLE'][c.lines] || ''}` : ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'][c.lines];
        this.clearEl.replaceChildren(el('b', {}, label), c.combo > 0 ? el('small', {}, `${c.combo} COMBO`) : '', c.b2b && (c.lines >= 4 || c.tspin) ? el('small', {}, 'B2B') : '');
      }
    }
  }

  // ---------------- layout ----------------
  render() {
    const s = this.s;
    const st = s.state;
    const iPlay = s.me >= 0 && st.playing?.[s.me];
    const xp = this.app.me.tetrisXp || 0;

    this.topbar.replaceChildren(
      el('span', { class: 'tt-xp' }, `⭐ ${xp} XP`, el('small', {}, nextUnlock(xp))),
      el('span', { class: 'tt-phase' }, { lobby: 'Sala de espera', countdown: 'Preparar…', playing: `${st.alive.filter(Boolean).length} vivo(s)`, over: 'Fim da rodada' }[st.phase]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.setFull(!this.full) }, this.full ? '🗗 Reduzir' : '⛶ Tela cheia')
    );

    if (st.phase === 'lobby' || (st.phase === 'over' && !this.engine && !Object.keys(this.boards).length)) return this.renderLobby();

    // área: meu tabuleiro (se jogo) + oponentes vivos
    this.arena.replaceChildren();
    this.myCanvas = null;
    const main = el('div', { class: 'tt-main' });
    if (iPlay && this.engine) {
      this.myCell = this.full ? 30 : 24;
      this.myCanvas = el('canvas', { class: 'tt-board' });
      this.holdCanvas = el('canvas', { class: 'tt-mini' });
      this.nextCanvases = [0, 1, 2, 3, 4].map(() => el('canvas', { class: 'tt-mini' }));
      this.meter = el('i');
      this.statsEl = el('div', { class: 'tt-stats' });
      this.clearEl = el('div', { class: 'tt-clear' });
      this.cdEl = el('div', { class: 'tt-countdown hidden' });
      this.myCanvas.addEventListener('pointerdown', () => this.cfg.casual && this.action('hard', true));
      main.append(
        el('div', { class: 'tt-side' }, el('div', { class: 'tt-box' }, el('small', {}, 'HOLD (C)'), this.holdCanvas), this.statsEl),
        el('div', { class: 'tt-board-wrap' }, el('div', { class: 'tt-meter' }, this.meter), el('div', { class: 'tt-board-inner' }, this.myCanvas, this.clearEl, this.cdEl,
          this.engine.dead ? el('div', { class: 'tt-dead' }, el('b', {}, st.places[s.me] ? `#${st.places[s.me]}` : 'K.O.'), el('small', {}, 'Você caiu — assistindo')) : null)),
        el('div', { class: 'tt-side' }, el('div', { class: 'tt-box' }, el('small', {}, 'PRÓXIMAS'), ...this.nextCanvases)),
      );
      this.engine.dirty = true;
      if (matchMedia('(pointer: coarse)').matches) main.append(this.touchControls());
    } else {
      this.cdEl = el('div', { class: 'tt-countdown hidden' });
      main.append(el('div', { class: 'tt-spectate' }, st.phase === 'over' ? '' : '👀 Assistindo esta rodada — você entra na próxima.'), this.cdEl);
    }
    this.oppWrap = el('div', { class: 'tt-opps' });
    this.arena.append(main, this.oppWrap);
    if (st.phase === 'over') this.arena.append(this.resultsPanel());
    this.layoutOpponents();
  }

  layoutOpponents() {
    if (!this.oppWrap || !this.s) return;
    const st = this.s.state;
    // quem ainda está vivo (eliminados saem da tela). No fim, mostra todos.
    const list = this.s.players.map((_, i) => i).filter((i) => i !== this.s.me && st.playing[i] && (st.alive[i] || st.phase === 'over'));
    const iPlay = this.s.me >= 0 && st.playing[this.s.me] && this.engine;
    const area = this.oppWrap.getBoundingClientRect();
    const availW = Math.max(120, area.width || this.root.clientWidth * (iPlay ? 0.4 : 1));
    const availH = Math.max(160, (this.root.clientHeight || 500) - 80);
    let cell = 4, cols = 1, fit = list.length;
    for (let c = iPlay ? 20 : 26; c >= 4; c--) {
      const bw = W * c + 16, bh = VIS * c + 30;
      cols = Math.max(1, Math.floor(availW / bw));
      const rows = Math.max(1, Math.floor(availH / bh));
      if (cols * rows >= list.length) { cell = c; fit = list.length; break; }
      cell = c;
      fit = cols * rows;
    }
    this.oppCell = cell;
    this.oppCanvases = new Map();
    this.oppWrap.replaceChildren(
      ...list.slice(0, fit).map((i) => {
        const cv = el('canvas', { class: 'tt-opp-board' });
        this.oppCanvases.set(i, cv);
        const node = el('div', { class: `tt-opp ${st.alive[i] ? '' : 'out'}` }, el('div', { class: 'tt-opp-meter' }), cv, el('span', { class: 'tt-opp-name' }, this.s.names[i], st.places[i] ? ` #${st.places[i]}` : ''));
        setTimeout(() => this.drawOpp(i, cv));
        return node;
      }),
      ...(list.length > fit ? [el('div', { class: 'tt-more' }, `+${list.length - fit}`)] : [])
    );
  }

  resultsPanel() {
    const st = this.s.state;
    const res = st.lastResults || [];
    return el('div', { class: 'tt-results' },
      el('h3', {}, st.winner !== null && st.playing.filter(Boolean).length > 1 ? `🏆 ${this.s.names[st.winner]} venceu!` : '🏁 Fim de jogo'),
      ...res.map((r) => el('div', { class: 'rank-row' }, `${['🥇', '🥈', '🥉'][r.place - 1] || `#${r.place}`} ${this.s.names[r.idx]}`, el('span', { class: 'muted small' }, `${r.lines} linhas`), el('b', {}, `+${r.xp} XP`))),
      this.s.me >= 0 ? el('button', { class: 'btn btn-primary btn-lg', onclick: () => { this.engine = null; this.boards = {}; this.hub.emit({ type: 'restart' }); } }, 'Jogar de novo') : null
    );
  }

  renderLobby() {
    const s = this.s;
    const xp = this.app.me.tetrisXp || 0;
    this.myCanvas = null;
    this.oppWrap = null;
    const skins = el('div', { class: 'tt-skins' },
      TETRIS_SKINS.map((k) => {
        const locked = xp < k.xp;
        const b = el('button', { class: `tt-skin ${this.mySkin() === k.id ? 'active' : ''} ${locked ? 'locked' : ''}`, title: locked ? `Libera com ${k.xp} XP` : k.name, disabled: locked,
          onclick: async () => {
            try {
              const { user } = await api.patch('/me', { tetrisSkin: k.id });
              this.app.setMe(user);
              this.render();
            } catch (err) {
              toast(err.message, 'error');
            }
          } }, skinPreview(k.id, 12), el('small', {}, locked ? `🔒 ${k.xp} XP` : k.name));
        return b;
      })
    );
    const num = (label, key, min, max) => {
      const out = el('span', {}, this.cfg[key] + ' ms');
      const r = el('input', { type: 'range', min, max, value: this.cfg[key] });
      r.addEventListener('input', () => { this.cfg[key] = Number(r.value); out.textContent = r.value + ' ms'; this.saveCfg(); });
      return el('label', { class: 'prop' }, el('div', { class: 'prop-head' }, el('span', {}, label), out), r);
    };
    const tog = (label, desc, key) => el('label', { class: 'switch-row compact' }, el('input', { type: 'checkbox', checked: this.cfg[key], onchange: (e) => { this.cfg[key] = e.target.checked; this.saveCfg(); } }), el('span', { class: 'switch' }), el('div', {}, el('b', {}, label), desc ? el('small', {}, desc) : null));
    this.arena.replaceChildren(
      el('div', { class: 'tt-lobby' },
        el('div', { class: 'tt-lobby-main' },
          el('h3', {}, '🧱 Tetris Royale'),
          el('p', { class: 'muted' }, `${s.players.length} jogador(es) na sala. Limpe linhas para mandar lixo nos outros — combos, T-spins e Tetris (4 linhas) atacam mais. O último de pé vence!`),
          s.me >= 0 ? el('button', { class: 'btn btn-primary btn-lg', onclick: () => this.hub.emit({ type: 'start' }) }, s.players.length > 1 ? '▶ Começar partida' : '▶ Treinar sozinho') : el('p', { class: 'muted' }, 'Entre na partida para jogar.'),
          el('div', { class: 'tt-keys' },
            ...[['← →', 'mover'], ['↓', 'descer'], ['Espaço', 'cair na hora'], ['↑ / X', 'girar'], ['Z / Ctrl', 'girar ao contrário'], ['A', 'girar 180°'], ['C / Shift', 'guardar (hold)']].map(([k, d]) => el('span', {}, el('kbd', {}, k), d))
          ),
          el('h4', {}, `Estilos de torre — você tem ${xp} XP`),
          skins
        ),
        el('div', { class: 'tt-lobby-side' },
          el('h4', {}, '⚙️ Controles'),
          num('DAS (atraso para repetir)', 'das', 40, 300),
          num('ARR (velocidade de repetição)', 'arr', 0, 60),
          el('label', { class: 'field' }, el('span', {}, 'Descer (↓)'), el('select', { class: 'input', onchange: (e) => { this.cfg.sdf = e.target.value; this.saveCfg(); } },
            el('option', { value: 'fast', selected: this.cfg.sdf === 'fast' }, 'Rápido'), el('option', { value: 'instant', selected: this.cfg.sdf === 'instant' }, 'Instantâneo'))),
          tog('Modo casual', 'Velocidade constante, mais tempo pra encaixar e toque no tabuleiro = cair na hora.', 'casual'),
          tog('Sons', null, 'sound')
        )
      )
    );
  }

  touchControls() {
    const b = (label, act) => {
      const n = el('button', { class: 'tt-touch-btn' }, label);
      n.addEventListener('pointerdown', (e) => { e.preventDefault(); this.action(act, true); });
      n.addEventListener('pointerup', () => this.action(act, false));
      n.addEventListener('pointercancel', () => this.action(act, false));
      return n;
    };
    return el('div', { class: 'tt-touch' }, b('⟲', 'ccw'), b('◀', 'left'), b('▼', 'soft'), b('▶', 'right'), b('⟳', 'cw'), b('⤓', 'hard'), b('H', 'hold'));
  }
}

function nextUnlock(xp) {
  const n = TETRIS_SKINS.find((k) => k.xp > xp);
  return n ? ` • próximo estilo (${n.name}) em ${n.xp - xp} XP` : ' • todos os estilos liberados!';
}
