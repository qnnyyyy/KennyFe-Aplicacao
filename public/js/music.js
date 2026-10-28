// KenBeat 🎧 no navegador: toca o player do YouTube no mesmo ponto para todo mundo da call
// e mostra o bloco do bot no palco (capa, barra de progresso, fila e controles).
import { el, icon, toast, store, save } from './ui.js';
import { can } from './guild.js';

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0');
};

let apiPromise = null;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ||= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Não consegui carregar o player do YouTube.'));
    };
    document.head.append(s);
  });
  return apiPromise;
}

export class MusicClient {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    this.states = new Map(); // canal de voz -> estado
    this.offset = 0; // relógio do servidor - relógio local
    this.volume = store('music-volume', 60);
    this.player = null;
    this.playerVideo = null;
    this.host = el('div', { class: 'yt-host' }, el('div', { id: 'yt-player' }));
    document.body.append(this.host);
    this.socket.on('music:state', (st) => {
      this.offset = st.now - Date.now();
      if (st.current) this.states.set(st.channelId, st);
      else this.states.delete(st.channelId);
      this.app.renderVoiceUsers?.();
      if (this.app.call.active && st.channelId === this.app.call.channelId) {
        this.sync();
        this.app.call.refreshTiles();
      }
      if (!this.app.currentGroupId) this.app.renderAll?.();
    });
    setInterval(() => this.tick(), 1000);
  }

  stateOf(channelId) {
    return this.states.get(channelId) || null;
  }

  mine() {
    return this.app.call.active ? this.stateOf(this.app.call.channelId) : null;
  }

  position(st = this.mine()) {
    if (!st?.current) return 0;
    const now = st.pausedAt ?? Date.now() + this.offset;
    return (now - st.startedAt) / 1000;
  }

  onCallChanged() {
    this.sync();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(100, Math.round(v)));
    save('music-volume', this.volume);
    this.applyVolume();
  }

  applyVolume() {
    try {
      this.player?.setVolume?.(this.app.call.deafened ? 0 : this.volume);
    } catch {}
  }

  // ---------------- player ----------------
  async sync() {
    const st = this.mine();
    if (!st?.current) return this.stopPlayer();
    let YT;
    try {
      YT = await loadYouTube();
    } catch (err) {
      if (!this.warned) toast('🎧 ' + err.message + ' (algum bloqueador de anúncios?)', 'error', 6000);
      this.warned = true;
      return;
    }
    const cur = this.mine();
    if (!cur?.current) return this.stopPlayer();
    const vid = cur.current.videoId;
    const pos = this.position(cur);
    if (!this.player) {
      this.playerVideo = vid;
      this.player = new YT.Player('yt-player', {
        width: 320,
        height: 180,
        videoId: vid,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, start: Math.max(0, Math.floor(pos)) },
        events: {
          onReady: () => {
            this.ready = true;
            this.applyVolume();
            this.align(true);
          },
          onStateChange: (e) => this.onState(e),
          onError: (e) => {
            const s = this.mine();
            if (s?.current) this.socket.emit('music:error', { channelId: s.channelId, videoId: s.current.videoId, code: e.data });
          },
        },
      });
      return;
    }
    if (!this.ready) return;
    if (this.playerVideo !== vid) {
      this.playerVideo = vid;
      this.metaSent = null;
      if (pos < 0) {
        this.player.cueVideoById({ videoId: vid, startSeconds: 0 });
        clearTimeout(this.startTimer);
        this.startTimer = setTimeout(() => this.align(true), -pos * 1000);
      } else this.player.loadVideoById({ videoId: vid, startSeconds: pos });
      this.applyVolume();
      return;
    }
    this.align(true);
  }

  // corrige pausa/tempo quando alguém pausou, pulou ou a pessoa ficou dessincronizada
  align(force = false) {
    const st = this.mine();
    const p = this.player;
    if (!st?.current || !p || !this.ready || this.playerVideo !== st.current.videoId) return;
    const want = this.position(st);
    let state, have;
    try {
      state = p.getPlayerState();
      have = p.getCurrentTime();
    } catch {
      return;
    }
    if (st.pausedAt) {
      if (state === 1) p.pauseVideo();
      if (Math.abs(have - want) > 1.5) p.seekTo(Math.max(0, want), true);
      return;
    }
    if (want < 0) return; // ainda vai começar
    if (force || Math.abs(have - want) > 2.5) p.seekTo(want, true);
    if (state !== 1 && state !== 3) p.playVideo();
  }

  onState(e) {
    const st = this.mine();
    if (!st?.current) return;
    if (e.data === 1 && this.metaSent !== st.current.videoId) {
      this.metaSent = st.current.videoId;
      const d = this.player.getVideoData?.() || {};
      this.socket.emit('music:meta', { channelId: st.channelId, videoId: st.current.videoId, duration: this.player.getDuration?.(), title: d.title, author: d.author });
    }
    if (e.data === 0) this.socket.emit('music:ended', { channelId: st.channelId, videoId: st.current.videoId });
  }

  stopPlayer() {
    clearTimeout(this.startTimer);
    if (!this.player) return;
    try {
      this.player.destroy();
    } catch {}
    this.player = null;
    this.ready = false;
    this.playerVideo = null;
    this.host.replaceChildren(el('div', { id: 'yt-player' }));
  }

  tick() {
    const st = this.mine();
    if (!st?.current) return;
    this.applyVolume();
    if (Math.floor(Date.now() / 1000) % 4 === 0) this.align();
    // barra de progresso do bloco
    const t = this.app.call.stage.tiles.get('bot:music');
    if (t) {
      const pos = Math.max(0, this.position(st));
      const dur = st.current.duration || 0;
      const bar = t.custom.querySelector('.mb-bar i');
      if (bar) bar.style.width = dur ? Math.min(100, (pos / dur) * 100) + '%' : '0%';
      const time = t.custom.querySelector('.mb-time');
      if (time) time.textContent = `${fmt(pos)} / ${dur ? fmt(dur) : '--:--'}`;
    }
  }

  // ---------------- bloco no palco ----------------
  control(action, arg) {
    const st = this.mine();
    if (!st) return;
    this.socket.emit('music:control', { channelId: st.channelId, action, arg }, (r) => {
      if (r?.error) toast(r.error, 'error');
      else if (r?.text && action !== 'seek') toast(r.text.replace(/\*\*/g, ''), 'success', 2200);
    });
  }

  tileInfo() {
    const st = this.mine();
    if (!st?.current) return null;
    return {
      kind: 'custom',
      peerId: 'bot',
      name: `🎧 KenBeat — ${st.current.title}`,
      render: (box) => this.renderTile(box),
      menuItems: () => [
        { type: 'slider', label: '🎧 Volume do KenBeat (só para você)', min: 0, max: 100, value: this.volume, format: (v) => v + '%', onInput: (v) => this.setVolume(v) },
        { label: st.pausedAt ? 'Continuar' : 'Pausar', icon: st.pausedAt ? 'play' : 'pause', onClick: () => this.control('toggle') },
        { label: 'Pular música', icon: 'skip', onClick: () => this.control('skip') },
        { label: 'Parar e tirar o bot', icon: 'stop', danger: true, onClick: () => this.control('stop') },
        { type: 'sep' },
      ],
    };
  }

  renderTile(box) {
    const st = this.mine();
    if (!st?.current) return box.replaceChildren();
    const t = st.current;
    const g = this.app.group(st.groupId);
    const ctl = can(this.app, g, 'music');
    const key = JSON.stringify([t.key, t.title, st.pausedAt, st.loop, st.queue.map((q) => q.key), ctl, t.duration]);
    if (box.dataset.k === key) return;
    box.dataset.k = key;
    const b = (ic, title, action, on = false) => el('button', { class: `mb-btn ${on ? 'on' : ''}`, title, disabled: !ctl, onclick: (e) => { e.stopPropagation(); this.control(action); } }, icon(ic, 18));
    const bar = el('div', { class: 'mb-bar', title: ctl ? 'Clique para pular para esse ponto' : '' }, el('i'));
    if (ctl) bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = bar.getBoundingClientRect();
      if (t.duration) this.control('seek', ((e.clientX - r.left) / r.width) * t.duration);
    });
    box.replaceChildren(
      el('div', { class: 'mb-bg', style: { backgroundImage: `url(${t.thumb})` } }),
      el('div', { class: 'music-box' },
        el('div', { class: `mb-cover ${st.pausedAt ? 'paused' : ''}` }, el('img', { src: t.thumb, alt: '' }), el('span', { class: 'mb-disc' }, '🎧')),
        el('div', { class: 'mb-info' },
          el('small', { class: 'mb-bot' }, 'KenBeat ', el('span', { class: 'bot-tag' }, 'BOT'), st.pausedAt ? ' • pausado' : ' • tocando'),
          el('b', { class: 'mb-title', title: t.title }, t.title),
          el('small', { class: 'mb-sub' }, [t.author, t.by ? `pedida por ${t.by.name}` : null].filter(Boolean).join(' • ')),
          bar,
          el('div', { class: 'mb-row' },
            el('span', { class: 'mb-time' }, ''),
            el('div', { class: 'mb-ctl' },
              b('shuffle', 'Embaralhar fila', 'shuffle'),
              b(st.pausedAt ? 'play' : 'pause', st.pausedAt ? 'Continuar' : 'Pausar', 'toggle'),
              b('skip', 'Pular', 'skip'),
              b('repeat', { off: 'Repetir: desligado', track: 'Repetindo a música', queue: 'Repetindo a fila' }[st.loop], 'loop', st.loop !== 'off'),
              b('stop', 'Parar e tirar o bot', 'stop'))),
          st.queue.length
            ? el('div', { class: 'mb-queue' }, el('small', {}, `Próximas (${st.queueLength})`), ...st.queue.slice(0, 3).map((q, i) => el('div', { class: 'mb-q' }, el('span', {}, i + 1), el('span', { class: 'mb-q-t' }, q.title), el('small', {}, q.by?.name || ''))))
            : el('small', { class: 'mb-empty' }, 'Fila vazia — /botmusic <link ou nome> adiciona mais'),
          !ctl ? el('small', { class: 'muted' }, 'Sua classe não controla o bot de música.') : null)));
    this.tick();
  }
}
