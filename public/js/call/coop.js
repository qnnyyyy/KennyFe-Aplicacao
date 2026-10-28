// Modo Jogo Coop: quem transmite deixa amigos jogarem no PC dele.
//   amigo (navegador) --P2P--> host (navegador) --localhost--> agente Kenfeh Coop --> SendInput / controle virtual
// Nada chega no PC sem o host aprovar, e ele pode cortar tudo na hora (Ctrl+Shift+X).
import { el, icon, toast, modal, sfx, store, save, $, IS_MOBILE } from '../ui.js';
import { api } from '../api.js';

const AGENT_URL = 'ws://localhost:47821';
// Teclado + mouse do convidado viram um controle de Xbox (o jogo vê um jogador separado).
// Cada convidado pode trocar as teclas (fica salvo no navegador dele).
export const PAD_ACTIONS = [
  ['ls_up', 'Analógico esquerdo ↑', 'Andar'], ['ls_down', 'Analógico esquerdo ↓', 'Andar'], ['ls_left', 'Analógico esquerdo ←', 'Andar'], ['ls_right', 'Analógico esquerdo →', 'Andar'],
  ['rs_up', 'Analógico direito ↑', 'Câmera'], ['rs_down', 'Analógico direito ↓', 'Câmera'], ['rs_left', 'Analógico direito ←', 'Câmera'], ['rs_right', 'Analógico direito →', 'Câmera'],
  ['b0', 'A', 'Botões'], ['b1', 'B', 'Botões'], ['b2', 'X', 'Botões'], ['b3', 'Y', 'Botões'],
  ['b4', 'LB', 'Gatilhos'], ['b5', 'RB', 'Gatilhos'], ['lt', 'LT (gatilho esquerdo)', 'Gatilhos'], ['rt', 'RT (gatilho direito)', 'Gatilhos'],
  ['b12', 'Direcional ↑', 'Direcional'], ['b13', 'Direcional ↓', 'Direcional'], ['b14', 'Direcional ←', 'Direcional'], ['b15', 'Direcional →', 'Direcional'],
  ['b9', 'Start / Menu', 'Outros'], ['b8', 'Select / View', 'Outros'], ['b10', 'L3 (apertar analógico esq.)', 'Outros'], ['b11', 'R3 (apertar analógico dir.)', 'Outros'],
];
export const DEFAULT_KEYMAP = {
  ls_up: ['KeyW'], ls_down: ['KeyS'], ls_left: ['KeyA'], ls_right: ['KeyD'],
  rs_up: ['KeyI'], rs_down: ['KeyK'], rs_left: ['KeyJ'], rs_right: ['KeyL'],
  b0: ['Space'], b1: ['KeyF', 'ShiftLeft'], b2: ['KeyE'], b3: ['KeyR'], b4: ['KeyQ'], b5: ['KeyG'],
  lt: ['Mouse2', 'KeyZ'], rt: ['Mouse0', 'KeyC'],
  b8: ['Tab'], b9: ['Enter', 'Escape'], b10: ['ControlLeft'], b11: ['KeyV', 'Mouse1'],
  b12: ['ArrowUp'], b13: ['ArrowDown'], b14: ['ArrowLeft'], b15: ['ArrowRight'],
};
export const keymap = () => ({ ...DEFAULT_KEYMAP, ...(store('coop-keymap', null) || {}) });
const KEY_NAMES = { Space: 'Espaço', ShiftLeft: 'Shift', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl dir.', AltLeft: 'Alt', AltRight: 'AltGr', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', CapsLock: 'Caps', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse0: '🖱️ esquerdo', Mouse1: '🖱️ meio', Mouse2: '🖱️ direito', Mouse3: '🖱️ lateral 1', Mouse4: '🖱️ lateral 2' };
// nome da tecla no teclado da pessoa (ABNT, US…), quando o navegador informa
let LAYOUT = null;
navigator.keyboard?.getLayoutMap?.().then((m) => (LAYOUT = m)).catch(() => {});
export const keyName = (c) => KEY_NAMES[c] || LAYOUT?.get(c)?.toUpperCase() || c.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
export const KB_LEGEND = [
  ['WASD', 'analógico esquerdo'], ['Mouse', 'analógico direito (câmera)'], ['Espaço', 'A'], ['F / Shift', 'B'], ['E', 'X'], ['R', 'Y'],
  ['Q / G', 'LB / RB'], ['Botão dir. / Z', 'LT'], ['Botão esq. / C', 'RT'], ['Setas', 'direcional'], ['Enter / Esc', 'Start'], ['Tab', 'Select'], ['Ctrl / V', 'L3 / R3'],
];
const CODE_RE = /^[A-Za-z0-9]{1,24}$/;

export class CoopController {
  constructor(call) {
    this.call = call;
    this.app = call.app;
    // host
    this.agent = null;
    this.agentState = 'off'; // off | connecting | on
    this.agentInfo = { vigem: false, monitors: [] };
    this.hosting = null; // { screenId, perms, monitor, game }
    this.guests = new Map(); // peerId -> { userId, status, slot, keys:Set, last }
    this.lastGame = null;
    // convidado
    this.controlling = null; // { peerId, screenId, perms }
    this.pending = new Set(); // `${peerId}:${screenId}`
    this.active = false;
    this.boundKeys = (e) => this.onKey(e);
    this.retry = setInterval(() => this.autoConnect(), 20000);
    setTimeout(() => this.autoConnect(), 1500);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyX' && this.hosting) {
        e.preventDefault();
        this.revokeAll();
        toast('🛑 Controle de todos os convidados cortado.', 'success');
      }
    });
  }

  // =================== AGENTE (host) ===================
  autoConnect() {
    const code = store('agent-code', null);
    if (code && this.agentState === 'off') this.connectAgent(code, true);
  }

  connectAgent(code, silent = false) {
    if (!code) return;
    try {
      this.agent?.close();
    } catch {}
    this.agentState = 'connecting';
    this.refreshDialog?.();
    let ws;
    try {
      ws = new WebSocket(AGENT_URL);
    } catch {
      this.agentState = 'off';
      return;
    }
    this.agent = ws;
    ws.onopen = () => ws.send(`auth ${code}`);
    ws.onmessage = (e) => {
      const [cmd, ...rest] = String(e.data).split(' ');
      if (cmd === 'ok') {
        this.agentState = 'on';
        save('agent-code', code);
        this.agentInfo.vigem = rest[1] === '1';
        this.agentInfo.monitors = (rest[2] || '').split(';').filter(Boolean).map((m) => {
          const [i, size, primary] = m.split(':');
          const [res] = size.split('@');
          return { index: Number(i), label: `Monitor ${Number(i) + 1} — ${res.replace('x', '×')}${primary === 'p' ? ' (principal)' : ''}` };
        });
        if (!silent) toast('🕹️ App Kenfeh Coop conectado!', 'success');
        if (this.hosting) this.sendAgent(`mon ${this.hosting.monitor}`);
        // app reaberto: manda de novo o nome de quem já está jogando
        for (const g of this.guests.values()) if (g.status === 'playing') this.sendAgent(`label ${g.slot} ${this.guestName(g)}`);
      } else if (cmd === 'err') {
        this.agentState = 'off';
        save('agent-code', null);
        if (!silent) toast('Código do agente incorreto. Confira o número na janela do Kenfeh Coop.', 'error', 6000);
        ws.close();
      } else if (cmd === 'stop') {
        this.revokeAll();
        toast('🛑 Você parou tudo pelo app Kenfeh Coop.', 'success');
      } else if (cmd === 'kick') {
        // o dono tirou alguém pela janela do app
        const slot = Number(rest[0]);
        const entry = [...this.guests.entries()].find(([, g]) => g.status === 'playing' && g.slot === slot);
        if (entry) {
          toast(`${this.guestName(entry[1])} foi tirado do jogo pelo app.`, 'info');
          this.revoke(entry[0]);
        }
      } else if (cmd === 'game') {
        this.onGameDetected(rest.join(' '));
      }
      this.refreshDialog?.();
    };
    ws.onclose = () => {
      if (this.agent !== ws) return;
      const was = this.agentState;
      this.agentState = 'off';
      this.agent = null;
      if (was === 'on' && this.hosting) toast('O agente Kenfeh Coop desconectou — os convidados não conseguem mais jogar.', 'error', 6000);
      if (was === 'connecting' && !silent) toast('Não achei o app Kenfeh Coop. Ele está aberto no seu PC?', 'error', 6000);
      this.refreshDialog?.();
    };
  }

  sendAgent(line) {
    if (this.agent?.readyState === WebSocket.OPEN) this.agent.send(line);
  }

  onGameDetected(name) {
    const game = name === '-' ? '' : name;
    if (game === this.lastGame) return;
    this.lastGame = game;
    if (this.app.me.showActivity === false) return;
    api.post('/me/activity', { name: game, source: 'agent' }).catch(() => {});
  }

  // =================== HOST ===================
  freeSlot() {
    const used = new Set([...this.guests.values()].filter((g) => g.status === 'playing').map((g) => g.slot));
    for (let i = 0; i < 4; i++) if (!used.has(i)) return i;
    return -1;
  }

  startHosting({ screenId, perms, monitor, game }) {
    const scr = this.call.media?.screens.get(screenId);
    if (!scr) return toast('Escolha uma tela compartilhada.', 'error');
    for (const s of this.call.media.screens.values()) s.coop = null;
    scr.coop = { ...perms };
    this.hosting = { screenId, perms, monitor: Number(monitor) || 0, game };
    this.sendAgent(`mon ${this.hosting.monitor}`);
    if (game && this.app.me.showActivity !== false) api.post('/me/activity', { name: game, source: 'stream' }).catch(() => {});
    this.call.localChanged();
    toast(`🎮 Modo Coop ligado em "${scr.name}". Os amigos já podem pedir para jogar.`, 'success', 5000);
  }

  stopHosting() {
    if (!this.hosting) return;
    this.revokeAll();
    const scr = this.call.media?.screens.get(this.hosting.screenId);
    if (scr) scr.coop = null;
    if (this.hosting.game) api.post('/me/activity', { name: '', source: 'stream' }).catch(() => {});
    this.hosting = null;
    this.guests.clear();
    this.call.localChanged?.();
    this.refreshDialog?.();
  }

  // a tela do Modo Coop foi fechada
  onScreensChanged() {
    if (this.hosting && !this.call.media?.screens.has(this.hosting.screenId)) this.stopHosting();
  }

  approve(peerId) {
    const g = this.guests.get(peerId);
    if (!g || !this.hosting) return;
    const slot = this.freeSlot();
    if (slot < 0) return toast('Máximo de 4 jogadores convidados.', 'error');
    g.status = 'playing';
    g.slot = slot;
    const name = this.guestName(g);
    this.sendAgent(`label ${slot} ${name}`);
    this.call.pm.sendData(peerId, { t: 'coop-grant', screenId: this.hosting.screenId, perms: this.hosting.perms, slot });
    toast(`${name} entrou no seu jogo como Jogador ${slot + 2} 🎮 (Ctrl+Shift+X corta o controle)`, 'success', 5000);
    this.refreshDialog?.();
  }

  // nome no Kenfeh = nome que aparece no app do PC
  guestName(g) {
    return this.app.userName(g.userId).replace(/\s+/g, ' ').trim().slice(0, 30) || 'Amigo';
  }

  deny(peerId) {
    this.guests.delete(peerId);
    this.call.pm.sendData(peerId, { t: 'coop-deny' });
    this.refreshDialog?.();
  }

  revoke(peerId) {
    const g = this.guests.get(peerId);
    if (!g) return;
    this.releaseGuest(g);
    if (g.status === 'playing' && g.slot >= 0) this.sendAgent(`padoff ${g.slot}`);
    this.guests.delete(peerId);
    this.call.pm?.sendData(peerId, { t: 'coop-revoke' });
    this.refreshDialog?.();
  }

  revokeAll() {
    for (const id of [...this.guests.keys()]) this.revoke(id);
    this.sendAgent('rel');
  }

  releaseGuest(g) {
    for (const c of g.keys) this.sendAgent(`ku ${c}`);
    g.keys.clear();
    if (g.slot >= 0 && g.status === 'playing') this.sendAgent(`pad ${g.slot} 0 0 0 0 0 0 0`);
  }

  onPeerLeft(peerId) {
    if (this.guests.has(peerId)) {
      const g = this.guests.get(peerId);
      this.releaseGuest(g);
      if (g.slot >= 0) this.sendAgent(`padoff ${g.slot}`);
      this.guests.delete(peerId);
      this.refreshDialog?.();
    }
    if (this.controlling?.peerId === peerId) this.stopControl(false);
    [...this.pending].filter((k) => k.startsWith(peerId + ':')).forEach((k) => this.pending.delete(k));
  }

  onData(peerId, m) {
    switch (m.t) {
      // ----- recebido pelo host -----
      case 'coop-req': {
        if (!this.hosting || m.screenId !== this.hosting.screenId) return this.call.pm.sendData(peerId, { t: 'coop-deny' });
        const userId = this.call.remotes.get(peerId)?.userId;
        if (this.guests.get(peerId)?.status === 'playing') return;
        this.guests.set(peerId, { userId, status: 'pending', slot: -1, keys: new Set(), last: 0 });
        sfx('ring');
        const name = this.app.userName(userId);
        toast(el('div', { class: 'ring-toast' }, el('span', {}, `🎮 ${name} quer jogar no seu PC`),
          el('button', { class: 'btn btn-primary btn-sm', onclick: (e) => { this.approve(peerId); e.target.closest('.toast')?.remove(); } }, 'Aceitar'),
          el('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { this.deny(peerId); e.target.closest('.toast')?.remove(); } }, 'Recusar')), 'info', 20000);
        this.refreshDialog?.();
        return;
      }
      case 'coop-stop': {
        const g = this.guests.get(peerId);
        if (g) {
          this.releaseGuest(g);
          this.guests.delete(peerId);
          this.refreshDialog?.();
        }
        return;
      }
      // ----- recebido pelo convidado -----
      case 'coop-grant':
        this.pending.delete(`${peerId}:${m.screenId}`);
        this.controlling = { peerId, screenId: m.screenId, perms: m.perms || {}, slot: m.slot };
        sfx('join');
        toast(m.perms?.mode === 'shared' ? '🎮 Liberado! Clique no vídeo para começar a jogar. Ctrl+Shift+Q para sair.' : `🎮 Liberado! Você é o Jogador ${m.slot + 2}. Clique no vídeo para jogar — "⌨️ Configurar teclas" no bloco troca os botões. Ctrl+Shift+Q sai.`, 'success', 7000);
        this.call.refreshTiles();
        return;
      case 'coop-deny':
        [...this.pending].filter((k) => k.startsWith(peerId + ':')).forEach((k) => this.pending.delete(k));
        toast('O host não liberou o controle agora.', 'info');
        this.call.refreshTiles();
        return;
      case 'coop-revoke':
        if (this.controlling?.peerId === peerId) {
          this.stopControl(false);
          toast('O host tirou o controle.', 'info');
        }
        return;
    }
    // ----- input do convidado (só no host, só para quem foi aprovado) -----
    const g = this.guests.get(peerId);
    if (!g || g.status !== 'playing' || !this.hosting) return;
    const p = this.hosting.perms;
    const shared = p.mode === 'shared';
    g.last = Date.now();
    if (m.t !== 'pad' && m.t !== 'rel' && !shared) return; // modo jogador separado: só controle
    switch (m.t) {
      case 'k':
        if (!p.kb || !CODE_RE.test(m.c) || /^(Meta|OS)/.test(m.c)) return;
        if (m.d) g.keys.add(m.c);
        else g.keys.delete(m.c);
        this.sendAgent(`${m.d ? 'kd' : 'ku'} ${m.c}`);
        break;
      case 'mm':
        if (p.mouse) this.sendAgent(`mm ${Math.round(m.x) || 0} ${Math.round(m.y) || 0}`);
        break;
      case 'ma':
        if (p.mouse) this.sendAgent(`ma ${(+m.x || 0).toFixed(5)} ${(+m.y || 0).toFixed(5)}`);
        break;
      case 'mb':
        if (p.mouse && [0, 1, 2].includes(m.b)) this.sendAgent(`${m.d ? 'md' : 'mu'} ${m.b}`);
        break;
      case 'mw':
        if (p.mouse) this.sendAgent(`mw ${Math.round(m.d) || 0}`);
        break;
      case 'pad':
        if (Array.isArray(m.s) && m.s.length === 7) this.sendAgent(`pad ${g.slot} ${m.s.map((v) => Math.round(+v) || 0).join(' ')}`);
        break;
      case 'rel':
        this.releaseGuest(g);
        break;
    }
  }

  // =================== CONVIDADO ===================
  tileState(peerId, screenId) {
    if (this.controlling?.peerId === peerId && this.controlling.screenId === screenId) return 'playing';
    if (this.pending.has(`${peerId}:${screenId}`)) return 'pending';
    return 'idle';
  }

  request(peerId, screenId) {
    if (IS_MOBILE) return this.mobileNotice();
    const st = this.tileState(peerId, screenId);
    if (st === 'playing') return this.stopControl();
    if (st === 'pending') return;
    if (!this.call.pm.sendData(peerId, { t: 'coop-req', screenId })) return toast('Conexão ainda não está pronta, tente de novo em 1 segundo.', 'error');
    this.pending.add(`${peerId}:${screenId}`);
    this.call.socket.emit('track', { feature: 'coop_guest' });
    toast('Pedido enviado — esperando o host aceitar…');
    this.call.refreshTiles();
  }

  send(m) {
    if (this.controlling) this.call.pm.sendData(this.controlling.peerId, m);
  }

  // Liga/desliga a captura conforme o tile atual
  bindTile(tile) {
    if (this.boundTile === tile) return;
    this.unbindTile();
    if (!tile) return;
    this.boundTile = tile;
    const v = tile.video;
    const c = this.controlling;
    const padMode = c.perms.mode !== 'shared';
    this.padKeys = new Set();
    this.padMouse = new Set();
    this.keymap = keymap();
    this.rs = [0, 0];
    // botão para trocar as teclas (só no modo controle)
    if (padMode) {
      this.keysBtn = el('button', { class: 'tile-coop-keys', title: 'Trocar quais teclas viram quais botões do controle', onclick: (e) => { e.stopPropagation(); this.openKeymap(); } }, '⌨️ Configurar teclas');
      tile.el.append(this.keysBtn);
    }
    tile.coopHint.textContent = padMode
      ? `🎮 Você é o Jogador ${c.slot + 2} — clique no vídeo para jogar (teclado e mouse viram controle) • Esc solta • Ctrl+Shift+Q sai`
      : '🎮 Jogando no teclado/mouse do host — clique no vídeo • Esc solta o mouse • Ctrl+Shift+Q sai';
    const relative = padMode || c.perms.mouseMode === 'rel';
    const useMouse = padMode || c.perms.mouse;
    const onDown = (e) => {
      if (e.target.closest('.tile-actions, .tile-coop, .tile-coop-keys')) return;
      this.setActive(true);
      if (useMouse && relative && document.pointerLockElement !== v) v.requestPointerLock?.();
      if (!useMouse) return;
      e.preventDefault();
      if (padMode) this.padKeys.add('Mouse' + e.button);
      else this.send({ t: 'mb', b: e.button, d: 1 });
    };
    const onUp = (e) => {
      if (!this.active || !useMouse) return;
      if (padMode) this.padKeys.delete('Mouse' + e.button);
      else this.send({ t: 'mb', b: e.button, d: 0 });
    };
    const onMove = (e) => {
      if (!this.active || !useMouse) return;
      if (relative) {
        this.acc.x += e.movementX;
        this.acc.y += e.movementY;
      } else {
        const pos = videoPoint(v, e.clientX, e.clientY);
        if (pos) this.absPos = pos;
      }
    };
    const onWheel = (e) => {
      if (!this.active || !useMouse || padMode) return;
      e.preventDefault();
      this.send({ t: 'mw', d: -Math.sign(e.deltaY) * 120 });
    };
    const onCtx = (e) => this.active && e.preventDefault();
    tile.el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);
    tile.el.addEventListener('wheel', onWheel, { passive: false });
    tile.el.addEventListener('contextmenu', onCtx, true);
    this.outside = (e) => !tile.el.contains(e.target) && this.setActive(false);
    document.addEventListener('pointerdown', this.outside, true);
    this.blur = () => this.setActive(false);
    window.addEventListener('blur', this.blur);
    this.lockChange = () => relative && useMouse && document.pointerLockElement !== v && this.setActive(false);
    document.addEventListener('pointerlockchange', this.lockChange);
    window.addEventListener('keydown', this.boundKeys, true);
    window.addEventListener('keyup', this.boundKeys, true);
    this.unbinders = () => {
      tile.el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointermove', onMove);
      tile.el.removeEventListener('wheel', onWheel);
      tile.el.removeEventListener('contextmenu', onCtx, true);
      document.removeEventListener('pointerdown', this.outside, true);
      window.removeEventListener('blur', this.blur);
      document.removeEventListener('pointerlockchange', this.lockChange);
      window.removeEventListener('keydown', this.boundKeys, true);
      window.removeEventListener('keyup', this.boundKeys, true);
    };
    this.acc = { x: 0, y: 0 };
    this.absPos = null;
    this.lastPad = '';
    this.lastPadAt = 0;
    let last = performance.now();
    const loop = (t = performance.now()) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.max(1, t - last);
      last = t;
      if (padMode) return this.pollPad(dt, true);
      if (this.acc.x || this.acc.y) {
        this.send({ t: 'mm', x: this.acc.x, y: this.acc.y });
        this.acc = { x: 0, y: 0 };
      }
      if (this.absPos) {
        this.send({ t: 'ma', x: this.absPos[0], y: this.absPos[1] });
        this.absPos = null;
      }
      this.pollPad(dt, false);
    };
    loop();
  }

  unbindTile() {
    if (!this.boundTile) return;
    cancelAnimationFrame(this.raf);
    this.unbinders?.();
    this.keysBtn?.remove();
    this.keysBtn = null;
    this.setActive(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.boundTile = null;
  }

  setActive(on) {
    if (this.active === on) return;
    this.active = on;
    this.boundTile?.el.classList.toggle('capturing', on);
    if (!on) {
      this.padKeys?.clear();
      this.padMouse?.clear();
      this.send({ t: 'rel' });
    }
  }

  onKey(e) {
    if (!this.controlling) return;
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyQ') {
      e.preventDefault();
      return this.stopControl();
    }
    const padMode = this.controlling.perms.mode !== 'shared';
    if (!this.active || (!padMode && !this.controlling.perms.kb)) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    e.stopPropagation();
    if (padMode) {
      if (e.type === 'keydown') this.padKeys.add(e.code);
      else this.padKeys.delete(e.code);
      return;
    }
    if (e.repeat) return;
    this.send({ t: 'k', d: e.type === 'keydown' ? 1 : 0, c: e.code });
  }

  pollPad(dt = 16, withKeyboard = false) {
    const pads = navigator.getGamepads?.() || [];
    const gp = [...pads].find((p) => p && p.connected);
    const dz = (v) => (Math.abs(v) < 0.08 ? 0 : v);
    let mask = 0, lx = 0, ly = 0, rx = 0, ry = 0, lt = 0, rt = 0;
    if (gp) {
      gp.buttons.forEach((b, i) => {
        if (i !== 6 && i !== 7 && i < 17 && b.pressed) mask |= 1 << i;
      });
      lx = dz(gp.axes[0] || 0);
      ly = -dz(gp.axes[1] || 0);
      rx = dz(gp.axes[2] || 0);
      ry = -dz(gp.axes[3] || 0);
      lt = gp.buttons[6]?.value || 0;
      rt = gp.buttons[7]?.value || 0;
    }
    if (withKeyboard && this.active) {
      const k = this.padKeys;
      const map = this.keymap || DEFAULT_KEYMAP;
      const on = (a) => (map[a] || []).some((c) => k.has(c)) ? 1 : 0;
      for (let b = 0; b < 16; b++) if (on('b' + b)) mask |= 1 << b;
      // teclas do analógico esquerdo (padrão WASD), diagonal normalizada
      let kx = on('ls_right') - on('ls_left');
      let ky = on('ls_up') - on('ls_down');
      if (kx && ky) { kx *= 0.7071; ky *= 0.7071; }
      if (kx || ky) { lx = kx; ly = ky; }
      // teclas do analógico direito (padrão IJKL)
      const ix = on('rs_right') - on('rs_left');
      const iy = on('rs_up') - on('rs_down');
      // mouse -> analógico direito (velocidade do mouse vira inclinação do stick)
      const look = store('coop-mouse-look', true);
      const sens = store('coop-mouse-sens', 1) * 0.045 * (store('coop-invert-y', false) ? -1 : 1);
      const tx = look ? Math.max(-1, Math.min(1, (this.acc.x / dt) * Math.abs(sens) * 16)) : 0;
      const ty = look ? Math.max(-1, Math.min(1, (-this.acc.y / dt) * sens * 16)) : 0;
      this.acc = { x: 0, y: 0 };
      this.rs = [this.rs[0] * 0.55 + tx * 0.45, this.rs[1] * 0.55 + ty * 0.45];
      if (Math.abs(this.rs[0]) < 0.02) this.rs[0] = 0;
      if (Math.abs(this.rs[1]) < 0.02) this.rs[1] = 0;
      if (ix || iy) { rx = ix; ry = iy; } else if (this.rs[0] || this.rs[1]) { rx = this.rs[0]; ry = this.rs[1]; }
      if (on('lt')) lt = 1;
      if (on('rt')) rt = 1;
    }
    if (!gp && !withKeyboard) return;
    const s = [mask, Math.round(lx * 32767), Math.round(ly * 32767), Math.round(rx * 32767), Math.round(ry * 32767), Math.round(lt * 255), Math.round(rt * 255)];
    const key = s.join(',');
    const now = performance.now();
    if (key !== this.lastPad || now - this.lastPadAt > 250) {
      this.send({ t: 'pad', s });
      this.lastPad = key;
      this.lastPadAt = now;
    }
  }

  // =================== TROCAR TECLAS (convidado) ===================
  openKeymap() {
    this.setActive(false);
    if (document.pointerLockElement) document.exitPointerLock();
    let map = keymap();
    let capturing = null; // ação esperando uma tecla
    const body = el('div', { class: 'keymap' });
    const save2 = () => {
      save('coop-keymap', map);
      this.keymap = map;
    };
    const stopCapture = () => {
      capturing = null;
      window.removeEventListener('keydown', onCapKey, true);
      window.removeEventListener('mousedown', onCapMouse, true);
    };
    const assign = (code) => {
      const a = capturing;
      stopCapture();
      // a mesma tecla não pode fazer duas coisas: sai da ação antiga
      for (const [k, list] of Object.entries(map)) if (k !== a && list.includes(code)) {
        map[k] = list.filter((c) => c !== code);
        toast(`"${keyName(code)}" saiu de ${PAD_ACTIONS.find((x) => x[0] === k)?.[1] || k}.`, 'info', 2500);
      }
      map[a] = [...new Set([...(map[a] || []), code])].slice(-3);
      save2();
      render();
    };
    const onCapKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      assign(e.code);
    };
    const onCapMouse = (e) => {
      if (!e.target.closest('.km-capture')) return;
      e.preventDefault();
      e.stopPropagation();
      assign('Mouse' + e.button);
    };
    const groups = [...new Set(PAD_ACTIONS.map((a) => a[2]))];
    const render = () => {
      body.replaceChildren(
        el('p', { class: 'muted small' }, 'Clique em "+" e aperte a tecla (ou o botão do mouse) que você quer usar. Cada ação aceita até 3 teclas. Fica salvo neste navegador.'),
        el('div', { class: 'km-grid' }, groups.map((gname) => el('div', { class: 'km-group' },
          el('h5', {}, gname),
          ...PAD_ACTIONS.filter((a) => a[2] === gname).map(([id, label]) => el('div', { class: `km-row ${capturing === id ? 'capturing' : ''}` },
            el('span', { class: 'km-label' }, label),
            el('div', { class: 'km-keys' },
              ...(map[id] || []).map((c) => el('button', { class: 'km-key', title: 'Clique para tirar', onclick: () => { map[id] = map[id].filter((x) => x !== c); save2(); render(); } }, keyName(c), el('i', {}, '×'))),
              capturing === id
                ? el('button', { class: 'km-capture', oncontextmenu: (e) => e.preventDefault() }, 'aperte uma tecla…')
                : el('button', { class: 'km-add', title: 'Adicionar tecla', onclick: () => { stopCapture(); capturing = id; window.addEventListener('keydown', onCapKey, true); window.addEventListener('mousedown', onCapMouse, true); render(); } }, '+'))))))),
        el('div', { class: 'km-opts' },
          el('label', { class: 'switch-row' }, el('input', { type: 'checkbox', checked: store('coop-mouse-look', true), onchange: (e) => save('coop-mouse-look', e.target.checked) }), el('span', { class: 'switch' }), el('div', {}, el('b', {}, 'Mouse mexe a câmera (analógico direito)'), el('small', {}, 'Desligue se o jogo não usa câmera.'))),
          el('label', { class: 'switch-row' }, el('input', { type: 'checkbox', checked: store('coop-invert-y', false), onchange: (e) => save('coop-invert-y', e.target.checked) }), el('span', { class: 'switch' }), el('div', {}, el('b', {}, 'Inverter o eixo vertical do mouse'), el('small', {}, 'Para quem joga com "câmera invertida".'))),
          el('label', { class: 'field' }, el('span', {}, 'Sensibilidade do mouse'), el('input', { type: 'range', min: 0.3, max: 3, step: 0.1, value: store('coop-mouse-sens', 1), oninput: (e) => save('coop-mouse-sens', Number(e.target.value)) })))
      );
    };
    render();
    modal({
      title: '⌨️ Suas teclas no Modo Coop',
      wide: true,
      content: body,
      onClose: stopCapture,
      actions: [
        { label: 'Restaurar padrão', onClick: () => { map = { ...DEFAULT_KEYMAP }; save('coop-keymap', null); this.keymap = keymap(); stopCapture(); render(); toast('Teclas voltaram ao padrão.', 'success'); } },
        { label: 'Pronto', primary: true, onClick: (c) => { stopCapture(); c(); toast('Teclas salvas! Clique no vídeo para voltar a jogar.', 'success'); } },
      ],
    });
  }

  stopControl(notify = true) {
    if (!this.controlling) return;
    this.send({ t: 'rel' });
    if (notify) this.send({ t: 'coop-stop' });
    this.unbindTile();
    this.controlling = null;
    this.call.refreshTiles();
  }

  // =================== DIÁLOGO DO HOST ===================
  mobileNotice() {
    modal({
      title: '🕹️ Modo Jogo Coop',
      content: el('div', { class: 'mobile-coop-note' },
        el('div', { class: 'mobile-coop-ic' }, '💻'),
        el('b', {}, 'O Modo Jogo Coop não está disponível no celular'),
        el('p', { class: 'muted' }, 'Para jogar junto no PC de alguém (como jogador 2, 3 ou 4), entre pelo computador. Quem transmite o jogo precisa de Windows com o app Kenfeh Coop; quem joga junto só precisa de um computador com navegador, com controle ou teclado e mouse.'),
        el('p', { class: 'muted' }, 'Os minijogos da aba Jogos (Tetris Royale, Desenha & Adivinha, Reflexo, Lig 4, Jogo da velha) funcionam normalmente no celular!')),
      actions: [{ label: 'Entendi', primary: true, onClick: (c) => c() }],
    });
  }

  openHostDialog() {
    if (IS_MOBILE) return this.mobileNotice();
    const body = el('div', { class: 'coop-dialog' });
    const st = {
      screenId: this.hosting?.screenId || [...(this.call.media?.screens.keys() || [])][0] || '',
      mode: this.hosting?.perms.mode || 'pad',
      kb: this.hosting?.perms.kb ?? true,
      mouse: this.hosting?.perms.mouse ?? true,
      mouseMode: this.hosting?.perms.mouseMode || 'abs',
      pad: this.hosting?.perms.pad ?? true,
      monitor: this.hosting?.monitor ?? 0,
      game: this.hosting?.game || this.lastGame || '',
    };
    const code = el('input', { class: 'input code-input sm', placeholder: '000000', maxlength: 6, inputmode: 'numeric', value: store('agent-code', '') || '' });
    const swRow = (key, label, desc) => el('label', { class: 'switch-row' }, el('input', { type: 'checkbox', checked: st[key], onchange: (e) => (st[key] = e.target.checked) }), el('span', { class: 'switch' }), el('div', {}, el('b', {}, label), desc ? el('small', {}, desc) : null));

    const render = () => {
      const agentOn = this.agentState === 'on';
      const screens = [...(this.call.media?.screens.values() || [])];
      const inCall = this.call.active;
      const guests = [...this.guests.entries()];
      body.replaceChildren(...[
        el('div', { class: 'coop-intro' },
          el('div', {}, el('b', {}, '🎮 Vocês jogam juntos no SEU PC'), el('small', {}, 'Você continua jogando normalmente (Jogador 1). Cada amigo vira um jogador separado (Jogador 2, 3, 4) — o jogo enxerga pessoas diferentes, como num coop local.')),
          el('div', {}, el('b', {}, '👥 Os amigos não instalam nada'), el('small', {}, 'Eles jogam pelo navegador, com controle ou com teclado e mouse.'))),

        el('div', { class: 'coop-step' },
          el('div', { class: 'coop-num' }, '1'),
          el('div', { class: 'coop-step-body' },
            el('b', {}, 'App Kenfeh Coop no seu PC (só quem transmite, Windows)'),
            el('small', { class: 'muted' }, 'Um app só, com tudo dentro. Na primeira vez ele ativa os controles virtuais sozinho (o Windows pede permissão uma vez).'),
            el('div', { class: 'coop-agent' },
              el('span', { class: `status-pill ${this.agentState}` }, agentOn ? '● Conectado' : this.agentState === 'connecting' ? '● Conectando…' : '● Desconectado'),
              agentOn ? el('span', { class: 'muted small' }, this.agentInfo.vigem ? '🎮 Controles virtuais prontos' : '⚠️ Clique em "Ativar controles" na janela do Kenfeh Coop') : null
            ),
            !agentOn
              ? el('div', { class: 'inline-form' },
                  el('a', { class: 'btn btn-ghost btn-sm', href: '/download/KenfehCoop.exe', download: 'KenfehCoop.exe' }, icon('download', 14), 'Baixar Kenfeh Coop (Windows)'),
                  el('a', { class: 'btn btn-ghost btn-sm', href: '/coop', target: '_blank', rel: 'noopener' }, 'Como funciona?'),
                  code,
                  el('button', { class: 'btn btn-primary btn-sm', onclick: () => this.connectAgent(code.value.trim()) }, 'Conectar'))
              : null,
            !agentOn ? el('small', { class: 'muted' }, 'Abra o KenfehCoop.exe (se o Windows avisar, clique em "Mais informações → Executar assim mesmo"), digite aqui o código de 6 números que aparece no app e clique em Conectar. Se o navegador perguntar sobre "dispositivos na rede local", permita.') : null
          )
        ),

        el('div', { class: 'coop-step' },
          el('div', { class: 'coop-num' }, '2'),
          el('div', { class: 'coop-step-body' },
            el('b', {}, 'Qual transmissão é o jogo?'),
            !inCall
              ? el('small', { class: 'muted' }, 'Entre na call e compartilhe a tela do jogo para continuar.')
              : screens.length
                ? el('div', { class: 'grid-2' },
                    el('select', { class: 'input', onchange: (e) => (st.screenId = e.target.value) }, screens.map((s) => el('option', { value: s.id, selected: s.id === st.screenId }, s.name))),
                    el('select', { class: 'input', title: 'Em qual monitor o jogo está (para o mouse cair no lugar certo)', onchange: (e) => (st.monitor = Number(e.target.value)) },
                      (this.agentInfo.monitors.length ? this.agentInfo.monitors : [{ index: 0, label: 'Monitor 1' }]).map((m) => el('option', { value: m.index, selected: m.index === st.monitor }, m.label))))
                : el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.call.shareDialog() }, icon('monitor-up', 14), 'Compartilhar a tela do jogo'),
            el('input', { class: 'input', placeholder: 'Nome do jogo (aparece no seu perfil) — opcional', value: st.game, list: 'kf-games-list', oninput: (e) => (st.game = e.target.value) })
          )
        ),

        el('div', { class: 'coop-step' },
          el('div', { class: 'coop-num' }, '3'),
          el('div', { class: 'coop-step-body' },
            el('b', {}, 'Como os amigos jogam'),
            el('div', { class: 'choice-row' },
              el('button', { class: `choice ${st.mode === 'pad' ? 'active' : ''}`, onclick: () => { st.mode = 'pad'; render(); } },
                el('span', { class: 'choice-emoji' }, '🎮'), el('b', {}, 'Jogador separado'), el('small', {}, 'Recomendado. Cada amigo vira um controle próprio no seu PC — com controle de verdade ou com o teclado e mouse dele convertidos.')),
              el('button', { class: `choice ${st.mode === 'shared' ? 'active' : ''}`, onclick: () => { st.mode = 'shared'; render(); } },
                el('span', { class: 'choice-emoji' }, '⌨️'), el('b', {}, 'Dividir meu teclado e mouse'), el('small', {}, 'O teclado/mouse do amigo apertam no seu, junto com você. Bom para jogos de teclado dividido (P1 WASD, P2 setas), turnos e menus.'))),
            st.mode === 'pad'
              ? el('div', { class: 'kb-legend' }, el('small', { class: 'muted' }, 'Amigo sem controle? O teclado e o mouse dele viram controle assim:'),
                  el('div', { class: 'kb-legend-grid' }, KB_LEGEND.map(([k, v]) => el('span', {}, el('kbd', {}, k), v))))
              : el('div', {},
                  swRow('kb', 'Teclado', 'A tecla Windows fica sempre bloqueada.'),
                  swRow('mouse', 'Mouse', null),
                  el('div', { class: 'seg' },
                    el('button', { class: st.mouseMode === 'abs' ? 'active' : '', onclick: () => { st.mouseMode = 'abs'; render(); } }, '🖱️ Absoluto (menus, estratégia)'),
                    el('button', { class: st.mouseMode === 'rel' ? 'active' : '', onclick: () => { st.mouseMode = 'rel'; render(); } }, '🎯 Relativo (FPS, câmera)')),
                  el('small', { class: 'muted' }, 'Se o amigo usar um controle de verdade, ele continua sendo um jogador separado.'))
          )
        ),

        guests.length
          ? el('div', { class: 'coop-guests' },
              el('b', {}, 'Jogadores'),
              guests.map(([pid, g]) => el('div', { class: 'coop-guest' },
                el('span', {}, `${g.status === 'playing' ? '🎮' : '⏳'} ${this.app.userName(g.userId)}`),
                el('small', { class: 'muted' }, g.status === 'playing' ? `Jogador ${g.slot + 2}` : 'pedindo para jogar'),
                g.status === 'pending' ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => this.approve(pid) }, 'Aceitar') : null,
                el('button', { class: 'btn btn-danger btn-sm', onclick: () => (g.status === 'pending' ? this.deny(pid) : this.revoke(pid)) }, g.status === 'pending' ? 'Recusar' : 'Tirar controle'))))
          : null,

        el('div', { class: 'callout' },
          el('b', {}, '⚠️ Importante'),
          el('p', {}, 'Use em jogos coop/single-player. Jogos com anti-cheat (Valorant, CS2, Fortnite…) podem bloquear ou punir input simulado. Se o jogo roda como Administrador, abra o Kenfeh Coop como Administrador também. Atalho de pânico: Ctrl+Shift+X corta todo mundo.')
        ),
      ].filter(Boolean));
    };
    this.refreshDialog = render;
    render();
    const m = modal({
      title: '🕹️ Modo Jogo Coop',
      wide: true,
      content: body,
      actions: [
        this.hosting ? { label: 'Desligar Modo Coop', danger: true, onClick: (c) => { this.stopHosting(); c(); } } : null,
        { label: 'Fechar', onClick: (c) => c() },
        {
          label: this.hosting ? 'Atualizar' : 'Ligar Modo Coop',
          primary: true,
          onClick: (c) => {
            if (!this.call.active) return toast('Entre na call primeiro.', 'error');
            if (!st.screenId || !this.call.media.screens.has(st.screenId)) return toast('Compartilhe a tela do jogo primeiro.', 'error');
            if (this.agentState !== 'on') toast('Atenção: o app Kenfeh Coop não está conectado, então ninguém vai conseguir jogar ainda.', 'error', 6000);
            this.startHosting({ screenId: st.screenId, perms: { mode: st.mode, kb: st.kb, mouse: st.mouse, mouseMode: st.mouseMode, pad: true }, monitor: st.monitor, game: st.game.trim() });
            c();
          },
        },
      ].filter(Boolean),
      onClose: () => (this.refreshDialog = null),
    });
    return m;
  }
}

// Converte o clique na tela do <video> (com faixas pretas do object-fit: contain) para 0..1 da imagem
function videoPoint(video, cx, cy) {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const fit = getComputedStyle(video).objectFit;
  const scale = fit === 'cover' ? Math.max(r.width / vw, r.height / vh) : Math.min(r.width / vw, r.height / vh);
  const w = vw * scale, h = vh * scale;
  const x = (cx - (r.left + (r.width - w) / 2)) / w;
  const y = (cy - (r.top + (r.height - h) / 2)) / h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [x, y];
}
