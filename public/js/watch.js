// 🍿 Assistir junto: o vídeo da sessão tocando no mesmo ponto para todo mundo da call.
// Cada navegador toca o próprio player (qualidade máxima, sem compressão de transmissão);
// o servidor guarda o vídeo, a fila e o relógio. O player fica numa camada por cima do bloco
// "watch" do palco (assim o iframe do YouTube nunca é recarregado quando o palco se reorganiza).
import { el, icon, toast, store, save, bgInterval, contextMenu, popover, closeMenu, modal, IS_MOBILE } from './ui.js';
import { loadYouTube } from './music.js';

export const REACTIONS = ['😂', '😱', '😍', '🔥', '👏', '😭', '🍿', '💀', '❤️', '🤯', '👀', '😡'];
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const DUCK_LEVEL = 0.3; // volume do filme enquanto alguém fala (30%)

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0');
};

export class WatchClient {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    this.states = new Map(); // canal de voz -> sessão
    this.offset = 0; // relógio do servidor - relógio local
    this.volume = store('watch-volume', 85);
    this.muted = store('watch-muted', false);
    this.duckOn = store('watch-duck', true);
    this.duck = 1; // multiplicador atual (anda suave até o alvo)
    this.speakers = new Set();
    this.player = null; // adaptador do player atual
    this.blocked = false; // navegador bloqueou o som: precisa de um clique
    this.lastSeek = 0;
    this.socket.on('watch:state', (st) => this.onState(st));
    this.socket.on('watch:react', (r) => this.spawnReaction(r));
    this.socket.on('watch:notice', (n) => toast(n.text, 'info', 5000));
    bgInterval(() => this.tick(), 500);
    setInterval(() => this.stepDuck(), 100);
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  // ---------------- estado ----------------
  stateOf(channelId) {
    return this.states.get(channelId) || null;
  }

  mine() {
    const c = this.app.call;
    return c.active ? this.stateOf(c.channelId) : null;
  }

  position(st = this.mine()) {
    if (!st?.current) return 0;
    const now = st.pausedAt ?? Date.now() + this.offset;
    return (now - st.startedAt) / 1000;
  }

  canControl(st = this.mine()) {
    return Boolean(st) && (!st.lock || st.lock === this.app.me.id);
  }

  onState(st) {
    this.offset = st.now - Date.now();
    const prev = this.states.get(st.channelId);
    if (st.current) this.states.set(st.channelId, st);
    else this.states.delete(st.channelId);
    this.app.renderVoiceUsers?.();
    const call = this.app.call;
    if (!call.active || st.channelId !== call.channelId) return;
    if (prev?.current?.key !== st.current?.key && st.current) this.blocked = false;
    this.sync();
    call.refreshTiles();
    // sessão começou/acabou nesta call: entra/sai do layout de assistir
    if (!prev?.current && st.current) call.enterWatchLayout?.();
    if (prev?.current && !st.current) call.leaveWatchLayout?.();
    this.paintUI(true);
  }

  onCallChanged() {
    this.speakers.clear();
    if (!this.mine()) this.destroyPlayer();
    else this.sync();
  }

  // ---------------- ações (vão para o servidor e voltam para todos) ----------------
  control(action, arg) {
    const st = this.mine();
    if (!st) return;
    this.socket.emit('watch:control', { channelId: st.channelId, action, arg }, (r) => r?.error && toast(r.error, 'error'));
  }

  start(input, now = false) {
    return new Promise((resolve) => {
      this.socket.emit('watch:start', { input, now, textChannelId: this.app.currentChannelId || null }, (r) => {
        if (r?.error) toast(r.error, 'error', 5000);
        else if (r?.queued) toast(r.added > 1 ? `🍿 ${r.added} vídeos na fila` : `🍿 Na fila (#${r.position}): ${r.queued}`, 'success');
        resolve(r);
      });
    });
  }

  react(emoji) {
    const x = 0.15 + Math.random() * 0.7;
    this.socket.emit('watch:react', { emoji, x });
  }

  // ---------------- volume (só seu) + abaixar quando alguém fala ----------------
  get silent() {
    return this.muted || this.volume === 0 || this.app.call.deafened;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    save('watch-volume', this.volume);
    if (this.volume > 0 && this.muted) this.muted = false;
    save('watch-muted', this.muted);
    this.applyVolume();
    this.paintUI(true);
  }

  setMuted(m) {
    this.muted = Boolean(m);
    save('watch-muted', this.muted);
    this.applyVolume();
    this.paintUI(true);
  }

  setDuckOn(on) {
    this.duckOn = Boolean(on);
    save('watch-duck', this.duckOn);
    this.paintUI(true);
    toast(this.duckOn ? '🗣️ O filme abaixa sozinho quando alguém fala' : '🗣️ O filme fica no mesmo volume quando alguém fala', 'info', 2500);
  }

  // chamado pela call quando alguém começa/para de falar
  onSpeaking(peerId, speaking) {
    if (peerId === 'local') return;
    clearTimeout(this.releaseTimer);
    if (speaking) this.speakers.add(peerId);
    else this.speakers.delete(peerId);
  }

  stepDuck() {
    const active = this.app.call.active;
    const target = active && this.duckOn && this.speakers.size ? DUCK_LEVEL : 1;
    // abaixa rápido, volta devagar (para não "bombar" entre as frases)
    const k = target < this.duck ? 0.35 : 0.08;
    const next = Math.abs(target - this.duck) < 0.02 ? target : this.duck + (target - this.duck) * k;
    if (next === this.duck) return;
    this.duck = next;
    this.applyVolume();
    this.app.call.audioOut?.setDuck?.(next); // áudio de telas compartilhadas também abaixa
  }

  applyVolume() {
    const p = this.player;
    if (!p?.ready) return;
    if (this.silent) p.mute(true);
    else {
      p.mute(false);
      p.setVolume(Math.round(this.volume * this.duck));
    }
  }

  // ---------------- player ----------------
  hostEl() {
    if (this.host) return this.host;
    const stage = this.app.call.stage;
    this.box = el('div', { class: 'watch-player' });
    this.shield = el('div', { class: 'watch-shield' });
    this.cover = el('div', { class: 'watch-cover hidden' });
    this.ui = el('div', { class: 'watch-ui' });
    this.host = el('div', { class: 'watch-host hidden' }, this.box, this.shield, this.cover, this.ui);
    // clique simples mostra os controles; duplo clique = tela cheia (com os rostos e as reações)
    this.shield.addEventListener('dblclick', () => this.app.call.toggleFullscreen());
    this.shield.addEventListener('click', () => this.app.call.wakeIdle?.());
    this.shield.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, this.menuItems());
    });
    stage.root.append(this.host);
    this.reactLayer = el('div', { class: 'watch-reactions' });
    stage.root.append(this.reactLayer);
    return this.host;
  }

  async sync() {
    const st = this.mine();
    if (!st?.current) return this.destroyPlayer();
    this.hostEl();
    const item = st.current;
    if (this.player && this.player.key === item.key) return this.align(true);
    if (this.player && this.player.kind === item.kind && item.kind === 'youtube' && this.player.ready) {
      // mesmo tipo: troca o vídeo sem recriar o player
      this.player.key = item.key;
      this.player.metaSent = false;
      const pos = this.position(st);
      this.player.load(item.videoId, Math.max(0, pos));
      this.applyVolume();
      setTimeout(() => this.align(true), 800);
      return;
    }
    this.destroyPlayer(true);
    this.player = item.kind === 'file' ? this.fileAdapter(item) : await this.ytAdapter(item);
    if (this.player) this.player.key = item.key;
    this.startFollow();
    this.paintUI(true);
  }

  async ytAdapter(item) {
    let YT;
    try {
      YT = await loadYouTube();
    } catch (err) {
      toast('🍿 ' + err.message + ' (algum bloqueador de anúncios?)', 'error', 6000);
      return null;
    }
    const cur = this.mine();
    if (!cur?.current || cur.current.key !== item.key) return null;
    const mount = el('div');
    this.box.replaceChildren(mount);
    const a = { kind: 'youtube', ready: false, metaSent: false };
    const pos = Math.max(0, this.position(cur));
    a.yt = new YT.Player(mount, {
      width: '100%',
      height: '100%',
      videoId: item.videoId,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, start: Math.floor(pos) },
      events: {
        onReady: () => {
          a.ready = true;
          this.applyVolume();
          this.align(true);
        },
        onStateChange: (e) => {
          if (e.data === 1) {
            this.blocked = false;
            this.cover.classList.add('hidden');
            if (!a.metaSent) {
              a.metaSent = true;
              const d = a.yt.getVideoData?.() || {};
              const st = this.mine();
              if (st?.current) this.socket.emit('watch:meta', { channelId: st.channelId, key: a.key, duration: a.yt.getDuration?.(), title: d.title });
            }
          }
          if (e.data === 0) {
            const st = this.mine();
            if (st?.current) this.socket.emit('watch:ended', { channelId: st.channelId, key: a.key });
          }
        },
        onError: (e) => {
          const st = this.mine();
          if (st?.current) this.socket.emit('watch:error', { channelId: st.channelId, key: a.key, code: e.data });
        },
      },
    });
    const S = () => {
      try {
        return a.yt.getPlayerState();
      } catch {
        return -1;
      }
    };
    Object.assign(a, {
      time: () => a.yt.getCurrentTime?.() || 0,
      duration: () => a.yt.getDuration?.() || 0,
      state: () => ({ 1: 'playing', 2: 'paused', 3: 'buffering', 0: 'ended' })[S()] || 'idle',
      play: () => a.yt.playVideo?.(),
      pause: () => a.yt.pauseVideo?.(),
      seek: (s) => a.yt.seekTo?.(s, true),
      setVolume: (v) => a.yt.setVolume?.(v),
      mute: (m) => (m ? a.yt.mute?.() : a.yt.unMute?.()),
      setRate: () => {},
      load: (id, start) => a.yt.loadVideoById?.({ videoId: id, startSeconds: start }),
      destroy: () => {
        try {
          a.yt.destroy();
        } catch {}
      },
    });
    return a;
  }

  fileAdapter(item) {
    const v = el('video', { playsinline: true, preload: 'auto' });
    v.src = item.url;
    this.box.replaceChildren(v);
    const a = { kind: 'file', ready: true, video: v };
    v.addEventListener('loadedmetadata', () => {
      const st = this.mine();
      if (st?.current) this.socket.emit('watch:meta', { channelId: st.channelId, key: a.key, duration: v.duration });
      this.align(true);
    });
    v.addEventListener('playing', () => {
      this.blocked = false;
      this.cover.classList.add('hidden');
    });
    v.addEventListener('ended', () => {
      const st = this.mine();
      if (st?.current) this.socket.emit('watch:ended', { channelId: st.channelId, key: a.key });
    });
    v.addEventListener('error', () => {
      const st = this.mine();
      if (st?.current) this.socket.emit('watch:error', { channelId: st.channelId, key: a.key, code: 'file' });
    });
    Object.assign(a, {
      time: () => v.currentTime || 0,
      duration: () => (Number.isFinite(v.duration) ? v.duration : 0),
      state: () => (v.ended ? 'ended' : v.paused ? 'paused' : v.readyState < 3 ? 'buffering' : 'playing'),
      play: () =>
        v.play().catch((err) => {
          if (err?.name === 'NotAllowedError') this.showBlocked();
        }),
      pause: () => v.pause(),
      seek: (s) => (v.currentTime = s),
      setVolume: (x) => (v.volume = Math.max(0, Math.min(1, x / 100))),
      mute: (m) => (v.muted = m),
      setRate: (r) => (v.playbackRate = r),
      destroy: () => {
        v.pause();
        v.removeAttribute('src');
        v.load();
      },
    });
    this.applyVolume();
    return a;
  }

  destroyPlayer(keepHost = false) {
    this.player?.destroy?.();
    this.player = null;
    this.blocked = false;
    if (this.box) this.box.replaceChildren();
    if (!keepHost && this.host) this.host.classList.add('hidden');
    cancelAnimationFrame(this.followRaf);
    this.followRaf = null;
  }

  showBlocked() {
    if (this.blocked) return;
    this.blocked = true;
    this.cover.classList.remove('hidden');
    this.cover.replaceChildren(el('button', { class: 'watch-join-btn', onclick: () => this.unblock() }, '🍿 Clique para assistir junto', el('small', {}, 'o navegador pediu um clique antes de tocar com som')));
  }

  unblock() {
    this.blocked = false;
    this.cover.classList.add('hidden');
    this.app.call.resumeAudio?.();
    this.applyVolume();
    this.player?.play();
    this.align(true);
  }

  // deixa o player no ponto do servidor (pausa, tempo e começo sincronizado)
  align(force = false) {
    const st = this.mine();
    const p = this.player;
    if (!st?.current || !p?.ready || p.key !== st.current.key) return;
    const want = this.position(st);
    const state = p.state();
    const have = p.time();
    if (st.pausedAt) {
      if (state === 'playing' || state === 'buffering') p.pause();
      if (Math.abs(have - want) > 0.6) p.seek(Math.max(0, want));
      p.setRate(1);
      return;
    }
    if (want < 0) {
      // contagem para todos começarem juntos
      if (state === 'playing') p.pause();
      if (have > 0.5) p.seek(0);
      return;
    }
    const drift = have - want;
    const now = performance.now();
    if (state === 'buffering' && Math.abs(drift) < 5 && !force) return;
    if ((force || Math.abs(drift) > (p.kind === 'file' ? 1.5 : 1.2)) && now - this.lastSeek > 1500) {
      this.lastSeek = now;
      p.seek(want + (p.kind === 'youtube' ? 0.35 : 0.1));
      p.setRate(1);
    } else if (p.kind === 'file') {
      // diferença pequena: acelera/desacelera um pouco em vez de pular
      p.setRate(Math.abs(drift) < 0.12 ? 1 : drift > 0 ? 0.94 : 1.06);
    }
    if (state !== 'playing' && state !== 'buffering') {
      p.play();
      clearTimeout(this.blockCheck);
      this.blockCheck = setTimeout(() => {
        const s = this.mine();
        if (s?.current && !s.pausedAt && this.position(s) > 0 && this.player?.state() !== 'playing' && this.player?.state() !== 'buffering') this.showBlocked();
      }, 2500);
    }
  }

  // a camada do player acompanha o bloco "watch" do palco (dock, flutuando, lateral...)
  startFollow() {
    if (this.followRaf) return;
    const loop = () => {
      this.followRaf = requestAnimationFrame(loop);
      this.follow();
    };
    this.followRaf = requestAnimationFrame(loop);
  }

  follow() {
    const host = this.host;
    if (!host) return;
    const stage = this.app.call.stage;
    const t = stage.tiles.get('watch');
    if (!t || !t.el.isConnected || !this.mine()) {
      if (!host.classList.contains('hidden')) host.classList.add('hidden');
      return;
    }
    const r = t.el.getBoundingClientRect();
    const rr = stage.root.getBoundingClientRect();
    const key = `${r.left - rr.left}|${r.top - rr.top}|${r.width}|${r.height}|${t.el.classList.contains('floating')}`;
    host.classList.remove('hidden');
    if (key === this.lastRect) return;
    this.lastRect = key;
    Object.assign(host.style, { left: r.left - rr.left + 'px', top: r.top - rr.top + 'px', width: r.width + 'px', height: r.height + 'px', zIndex: t.el.classList.contains('floating') ? 6 : 2 });
    host.classList.toggle('compact', r.width < 780);
    host.classList.toggle('tiny', r.width < 470);
  }

  tick() {
    const st = this.mine();
    if (!st?.current) return;
    this.applyVolume();
    this.align();
    this.paintUI();
  }

  // ---------------- controles por cima do vídeo ----------------
  paintUI(full = false) {
    const st = this.mine();
    if (!this.ui || !st?.current) return;
    const t = st.current;
    const ctl = this.canControl(st);
    const key = JSON.stringify([t.key, t.title, Boolean(st.pausedAt), st.lock, ctl, st.queueLength, this.silent, this.duckOn, t.duration, IS_MOBILE]);
    if (full || this.ui.dataset.k !== key) {
      this.ui.dataset.k = key;
      this.buildUI(st, ctl);
    }
    // tempo, barra e contagem (todo tick)
    const pos = this.position(st);
    const dur = t.duration || this.player?.duration?.() || 0;
    const fill = this.ui.querySelector('.wu-bar i');
    if (fill && !this.dragging) fill.style.width = dur ? Math.min(100, (Math.max(0, pos) / dur) * 100) + '%' : '0%';
    const time = this.ui.querySelector('.wu-time');
    if (time) time.textContent = `${fmt(Math.max(0, pos))} / ${dur ? fmt(dur) : '--:--'}`;
    const cd = this.ui.querySelector('.wu-countdown');
    if (cd) {
      const show = !st.pausedAt && pos < 0;
      cd.classList.toggle('hidden', !show);
      if (show) cd.textContent = `Começando em ${Math.ceil(-pos)}…`;
    }
  }

  buildUI(st, ctl) {
    const t = st.current;
    const b = (ic, title, fn, cls = '', disabled = false) => el('button', { class: `wu-btn ${cls}`, title, disabled, onclick: (e) => { e.stopPropagation(); fn(e.currentTarget); } }, /^[a-z-]+$/.test(ic) ? icon(ic, 20) : el('span', { class: 'wu-emoji' }, ic));
    const bar = el('div', { class: `wu-bar ${ctl ? '' : 'locked'}`, title: ctl ? 'Clique ou arraste para pular para esse ponto (para todos)' : 'Controles travados' }, el('i'));
    if (ctl) this.bindSeek(bar, st);
    const vol = IOS ? null : el('input', { type: 'range', min: 0, max: 100, value: this.volume, class: 'wu-vol', title: 'Volume do filme (só para você)', oninput: (e) => this.setVolume(e.target.value), onpointerdown: (e) => e.stopPropagation(), onclick: (e) => e.stopPropagation() });
    const quick = REACTIONS.slice(0, IS_MOBILE ? 3 : 5).map((e) => el('button', { class: 'wu-react', title: 'Reagir (todo mundo vê)', onclick: (ev) => { ev.stopPropagation(); this.react(e); } }, e));
    const by = t.by?.name ? `por ${t.by.name}` : '';
    this.ui.replaceChildren(...[
      el('div', { class: 'wu-top' },
        el('div', { class: 'wu-title' }, el('b', {}, '🍿 ', t.title || 'Vídeo'), el('small', {}, [by, st.lock ? `🔒 controles com ${this.app.userName(st.lock)}` : null].filter(Boolean).join(' • '))),
        el('div', { class: 'wu-top-btns' },
          b('list', `Fila (${st.queueLength || 0})`, (a) => this.queuePopover(a), st.queueLength ? 'has' : ''),
          b('x', 'Encerrar a sessão (para todos)', () => this.confirmStop(), 'danger', !ctl))),
      el('div', { class: 'wu-countdown hidden' }),
      st.pausedAt && ctl ? el('button', { class: 'wu-big-play', title: 'Continuar para todos', onclick: (e) => { e.stopPropagation(); this.control('play'); } }, icon('play', 34)) : st.pausedAt ? el('div', { class: 'wu-big-play passive' }, icon('pause', 30)) : null,
      el('div', { class: 'wu-bottom' },
        bar,
        el('div', { class: 'wu-row' },
          b(st.pausedAt ? 'play' : 'pause', st.pausedAt ? 'Continuar (para todos) — Espaço' : 'Pausar (para todos) — Espaço', () => this.control('toggle'), '', !ctl),
          b('rewind', 'Voltar 10s (para todos) — ←', () => this.control('seek', Math.max(0, this.position() - 10)), 'hide-tiny', !ctl),
          b('forward', 'Avançar 10s (para todos) — →', () => this.control('seek', this.position() + 10), 'hide-tiny', !ctl),
          st.queueLength ? b('skip', 'Próximo vídeo da fila', () => this.control('skip'), '', !ctl) : null,
          b(this.silent ? 'volume-x' : 'volume', this.muted ? 'Tirar do mudo' : 'Silenciar o filme (só para você) — M', () => this.setMuted(!this.muted), this.silent ? 'on' : ''),
          vol,
          el('span', { class: 'wu-time' }),
          el('span', { class: 'wu-spacer' }),
          el('div', { class: 'wu-reacts hide-compact' }, ...quick, b('smile-plus', 'Mais reações', (a) => this.reactPopover(a))),
          b('smile-plus', 'Reagir', (a) => this.reactPopover(a), 'show-compact'),
          b('🗣️', this.duckOn ? 'Abaixar o filme quando alguém fala: ligado' : 'Abaixar o filme quando alguém fala: desligado', () => this.setDuckOn(!this.duckOn), `hide-compact ${this.duckOn ? 'on' : ''}`),
          b(this.app.call.media?.camera ? 'video' : 'video-off', this.app.call.media?.camera ? 'Desligar minha câmera' : 'Ligar minha câmera (aparece nas bolhas)', () => this.app.call.toggleCamera().then(() => this.paintUI(true)), `hide-compact ${this.app.call.media?.camera ? 'on' : ''}`),
          b('users', 'Rostos: bolhas, lateral ou escondidos', (a) => this.app.call.facesPopover(a), 'hide-compact'),
          b('more', 'Mais opções', (a) => { const r = a.getBoundingClientRect(); contextMenu(r.left, r.top, this.menuItems()); }),
          b(document.fullscreenElement ? 'minimize' : 'maximize', 'Tela cheia com os rostos (F)', () => this.app.call.toggleFullscreen()))),
    ].filter(Boolean));
  }

  bindSeek(bar, st) {
    const dur = () => st.current.duration || this.player?.duration?.() || 0;
    const at = (e) => {
      const r = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    bar.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!dur()) return;
      bar.setPointerCapture(e.pointerId);
      this.dragging = true;
      const fill = bar.querySelector('i');
      const move = (ev) => (fill.style.width = at(ev) * 100 + '%');
      move(e);
      const up = (ev) => {
        this.dragging = false;
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        if (ev.type === 'pointerup') this.control('seek', at(ev) * dur());
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
  }

  reactPopover(anchor) {
    popover(anchor, el('div', { class: 'react-grid' }, ...REACTIONS.map((e) => el('button', { class: 'react-pick', onclick: () => this.react(e) }, e))));
  }

  queuePopover(anchor) {
    const st = this.mine();
    if (!st) return;
    const ctl = this.canControl(st);
    const input = el('input', { class: 'input', placeholder: 'Link do YouTube, .mp4 ou nome do vídeo', onkeydown: (e) => e.key === 'Enter' && add(false) });
    const add = async (now) => {
      if (!input.value.trim()) return;
      const r = await this.start(input.value.trim(), now);
      if (r?.ok) closeMenu();
    };
    popover(anchor, el('div', { class: 'watch-queue' },
      el('div', { class: 'ctx-title' }, 'Assistindo agora'),
      el('div', { class: 'wq-item now' }, st.current.thumb ? el('img', { src: st.current.thumb, alt: '' }) : el('span', { class: 'wq-ph' }, '🎬'), el('div', {}, el('b', {}, st.current.title), el('small', {}, st.current.by?.name ? `por ${st.current.by.name}` : ''))),
      el('div', { class: 'ctx-title' }, `Fila (${st.queueLength || 0})`),
      ...(st.queue.length
        ? st.queue.map((q, i) => el('div', { class: 'wq-item' }, q.thumb ? el('img', { src: q.thumb, alt: '' }) : el('span', { class: 'wq-ph' }, '🎬'), el('div', {}, el('b', {}, q.title), el('small', {}, q.by?.name || '')),
            ctl ? el('button', { class: 'icon-btn sm', title: 'Tirar da fila', onclick: () => { this.control('remove', i); closeMenu(); } }, icon('x', 14)) : null))
        : [el('p', { class: 'muted small' }, 'Nada na fila. Adicione abaixo ou use /assistir no chat.')]),
      el('div', { class: 'ctx-sep' }),
      input,
      el('div', { class: 'row-actions' },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => add(false) }, 'Pôr na fila'),
        ctl ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => add(true) }, 'Tocar agora') : null)));
    setTimeout(() => input.focus(), 30);
  }

  confirmStop() {
    modal({
      title: 'Encerrar a sessão?',
      content: el('p', {}, 'O vídeo fecha para todo mundo da call.'),
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        { label: 'Encerrar', primary: true, onClick: (c) => { this.control('stop'); c(); } },
      ],
    });
  }

  menuItems() {
    const st = this.mine();
    if (!st) return [];
    const ctl = this.canControl(st);
    const items = [{ type: 'title', label: '🍿 ' + (st.current.title || 'Sessão').slice(0, 50) }];
    if (!IOS) items.push({ type: 'slider', label: '🔊 Volume do filme (só para você)', min: 0, max: 100, value: this.volume, format: (v) => v + '%', onInput: (v) => this.setVolume(v) });
    items.push(
      { label: 'Abaixar o filme quando alguém fala', checked: this.duckOn, onClick: () => this.setDuckOn(!this.duckOn) },
      { label: this.muted ? 'Tirar do mudo' : 'Silenciar o filme (só para você)', icon: this.muted ? 'volume' : 'volume-x', onClick: () => this.setMuted(!this.muted) },
      { type: 'sep' },
      { label: st.pausedAt ? 'Continuar para todos' : 'Pausar para todos', icon: st.pausedAt ? 'play' : 'pause', disabled: !ctl, onClick: () => this.control('toggle') },
      { label: 'Ressincronizar comigo', icon: 'repeat', onClick: () => { this.lastSeek = 0; this.align(true); } },
      { type: 'sep' },
      { label: this.app.call.media?.camera ? 'Desligar minha câmera' : 'Ligar minha câmera (bolha)', icon: this.app.call.media?.camera ? 'video-off' : 'video', onClick: () => this.app.call.toggleCamera().then(() => this.paintUI(true)) },
      { label: 'Rostos em bolhas', checked: this.app.call.stage.layout === 'watch' && this.app.call.stage.faces === 'bubbles', onClick: () => { this.app.call.enterWatchLayout(); this.app.call.stage.setFaces('bubbles'); } },
      { label: 'Rostos numa coluna do lado', checked: this.app.call.stage.layout === 'watch' && this.app.call.stage.faces === 'side', onClick: () => { this.app.call.enterWatchLayout(); this.app.call.stage.setFaces('side'); } },
      { label: 'Esconder os rostos', checked: this.app.call.stage.layout === 'watch' && this.app.call.stage.faces === 'hidden', onClick: () => { this.app.call.enterWatchLayout(); this.app.call.stage.setFaces('hidden'); } }
    );
    const mineStart = st.current.by?.id === this.app.me.id;
    if (st.lock || mineStart) items.push({ label: st.lock ? '🔓 Destravar os controles' : '🔒 Travar os controles (só eu mexo)', disabled: Boolean(st.lock) && st.lock !== this.app.me.id, onClick: () => this.control('lock') });
    items.push({ type: 'sep' }, { label: 'Encerrar a sessão', icon: 'stop', danger: true, disabled: !ctl, onClick: () => this.confirmStop() });
    return items;
  }

  // ---------------- reações flutuantes ----------------
  spawnReaction({ userId, emoji, x }) {
    const c = this.app.call;
    if (!c.active) return;
    this.hostEl();
    const name = userId === this.app.me.id ? 'você' : this.app.userName(userId);
    const node = el('div', { class: 'watch-react', style: { left: x * 100 + '%', '--drift': (Math.random() * 60 - 30).toFixed(0) + 'px' } }, el('span', { class: 'wr-emoji' }, emoji), el('small', {}, name));
    this.reactLayer.append(node);
    while (this.reactLayer.childElementCount > 40) this.reactLayer.firstElementChild.remove();
    setTimeout(() => node.remove(), 3200);
  }

  // ---------------- atalhos ----------------
  onKey(e) {
    const st = this.mine();
    if (!st || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    if (document.querySelector('#layer .backdrop')) return;
    const ctl = this.canControl(st);
    if ((e.code === 'Space' || e.code === 'KeyK') && ctl) {
      e.preventDefault();
      this.control('toggle');
    } else if (e.code === 'ArrowLeft' && ctl) {
      e.preventDefault();
      this.control('seek', Math.max(0, this.position() - 10));
    } else if (e.code === 'ArrowRight' && ctl) {
      e.preventDefault();
      this.control('seek', this.position() + 10);
    } else if (e.code === 'KeyM') this.setMuted(!this.muted);
  }

  // ---------------- bloco no palco ----------------
  tileInfo() {
    const st = this.mine();
    if (!st?.current) return null;
    return {
      kind: 'custom',
      peerId: 'watch',
      watch: true,
      name: `🍿 ${st.current.title}`,
      render: (box) => {
        if (box.dataset.k === st.current.key) return;
        box.dataset.k = st.current.key;
        box.replaceChildren(el('div', { class: 'watch-tile-bg', style: st.current.thumb ? { backgroundImage: `url(${st.current.thumb})` } : {} }));
      },
      menuItems: () => [...this.menuItems().slice(1), { type: 'sep' }],
    };
  }

  // diálogo de começar uma sessão
  openDialog() {
    const st = this.mine();
    const input = el('input', { class: 'input', placeholder: 'Cole o link do YouTube (ou de um .mp4) ou escreva o nome do vídeo', onkeydown: (e) => e.key === 'Enter' && go(false) });
    const go = async (queue) => {
      const v = input.value.trim();
      if (!v) return input.focus();
      const r = await this.start(v, !queue);
      if (r?.ok) m.close();
    };
    const m = modal({
      title: '🍿 Assistir junto',
      wide: true,
      content: el('div', { class: 'watch-dialog' },
        el('p', { class: 'muted' }, 'Todo mundo da call assiste o mesmo vídeo, no mesmo segundo, na qualidade máxima (cada um carrega o vídeo direto, sem a compressão de compartilhar tela). Quem pausar ou pular, pausa e pula pra todos.'),
        el('label', { class: 'field' }, el('span', {}, 'O que vamos assistir?'), input),
        el('div', { class: 'watch-tips' },
          el('div', {}, el('b', {}, '▶️ YouTube'), el('small', {}, 'vídeos, lives, playlists inteiras (viram fila) e links com tempo (…&t=90)')),
          el('div', {}, el('b', {}, '🎞️ Arquivo de vídeo'), el('small', {}, 'link direto de .mp4/.webm, ou mande o vídeo no chat e use o link dele')),
          el('div', {}, el('b', {}, '📺 Netflix, Prime, Disney+…'), el('small', {}, 'essas não tocam fora do site delas: use ', el('a', { href: '#', onclick: (e) => { e.preventDefault(); m.close(); this.app.call.shareDialog('movie'); } }, 'Compartilhar tela no modo Filme'), '.'))),
        st?.current ? el('p', { class: 'muted small' }, `Já tem uma sessão: "${st.current.title}". "Pôr na fila" adiciona depois dela.`) : null),
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        st?.current ? { label: 'Pôr na fila', onClick: () => go(true) } : null,
        { label: st?.current ? 'Trocar e assistir agora' : 'Começar a sessão', primary: true, onClick: () => go(false) },
      ].filter(Boolean),
    });
    setTimeout(() => input.focus(), 50);
  }
}
