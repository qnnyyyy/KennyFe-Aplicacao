// Controlador da call: junta mídia local, conexões, áudio, palco e controles.
import { el, $, icon, setIcon, toast, modal, contextMenu, popover, closeMenu, sfx, onContext } from '../ui.js';
import { api } from '../api.js';
import { PeerManager } from './rtc.js';
import { LocalMedia, listDevices, cleanLabel } from './media.js';
import { AudioOut } from './audio.js';
import { Stage } from './stage.js';
import { settings, updateSettings, onSettings, CAMERA_PRESETS, SCREEN_RESOLUTIONS } from './settings.js';
import { CoopController } from './coop.js';
import { BUILTIN_SOUNDS, renderSound, keyLabel } from './sounds.js';

const pct = (v) => `${Math.round(v * 100)}%`;

export class CallController {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    this.active = false;
    this.groupId = null;
    this.remotes = new Map(); // peerId -> { userId, state, streams: Map }
    this.muted = false;
    this.deafened = false;
    this.wrap = $('#stage-wrap');
    this.stage = new Stage($('#stage'), { onContext: (t, x, y) => this.tileMenu(t, x, y), onCoop: (t) => this.coop.request(t.info.peerId, t.info.screenId) });
    this.coop = new CoopController(this);
    this.recorders = new Map();
    this.soundCache = new Map();
    this.controls = $('#call-controls');

    const s = this.socket;
    s.on('call:peer-joined', ({ peerId, userId, state }) => {
      if (!this.active) return;
      this.remotes.set(peerId, { userId, state: state || {}, streams: new Map() });
      this.pm.addPeer(peerId);
      if (settings().joinSounds) sfx('join');
      this.refreshTiles();
    });
    s.on('call:peer-left', ({ peerId }) => {
      if (!this.active || !this.remotes.has(peerId)) return;
      this.dropPeer(peerId);
      if (settings().joinSounds) sfx('leave');
    });
    s.on('call:peer-state', ({ peerId, state }) => {
      const r = this.remotes.get(peerId);
      if (!r) return;
      r.state = state || {};
      this.reclassifyAudio(peerId);
      this.refreshTiles();
    });
    s.on('rtc:signal', ({ from, data }) => this.active && this.pm.handleSignal(from, data));
    s.on('disconnect', () => (this.lostConnection = this.active));
    s.on('connect', () => {
      if (this.lostConnection && this.active) this.rejoin();
      this.lostConnection = false;
    });

    onSettings((st, patch) => this.onSettingsChanged(st, patch));
    this.setupIdle();
    this.setupHotkeys();
    document.addEventListener('fullscreenchange', () => this.renderControls());
  }

  // ---------- Entrar / sair ----------
  async join(groupId) {
    if (this.active && this.groupId === groupId) return;
    if (this.active) this.leave();
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Seu navegador bloqueou câmera/microfone: abra pelo localhost ou HTTPS.', 'error', 6000);
    }
    const cfg = await api.get('/config').catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }));
    this.groupId = groupId;
    this.active = true;
    this.remotes.clear();

    this.audioOut = new AudioOut({ onSpeaking: (peerId, sp) => this.onSpeaking(peerId, sp) });
    this.audioOut.resume();
    this.audioOut.setOutputDevice(settings().outputDeviceId);
    this.audioOut.setDeafened(this.deafened);

    this.pm = new PeerManager({
      socket: this.socket,
      iceServers: cfg.iceServers,
      settings,
      onTrack: (peerId, track, stream) => this.onRemoteTrack(peerId, track, stream),
      onTrackRemoved: (peerId, track, stream) => this.onRemoteTrackRemoved(peerId, track, stream),
      onConnState: (peerId, st) => this.onConnState(peerId, st),
      onData: (peerId, m) => this.coop.onData(peerId, m),
    });

    this.media = new LocalMedia({
      onPublish: (t, st, o) => this.pm.addTrack(t, st, o),
      onUnpublish: (t) => this.pm.removeTrack(t),
      onUpdateOpts: (t, o) => this.pm.updateTrackOpts(t, o),
      onChange: () => this.localChanged(),
      onSpeaking: (sp) => this.onSpeaking('local', sp),
    });
    this.media.ctx.resume().catch(() => {});
    this.media.muted = this.muted || this.deafened;

    try {
      await this.media.addMic();
    } catch (err) {
      toast('Não consegui abrir o microfone: ' + (err.message || err.name), 'error', 5000);
    }

    const res = await this.socket.emitWithAck('call:join', { groupId, state: this.localState() });
    if (res?.error) {
      toast(res.error, 'error');
      return this.leave();
    }
    this.pm.selfId = res.peerId;
    for (const p of res.peers) {
      this.remotes.set(p.peerId, { userId: p.userId, state: p.state || {}, streams: new Map() });
      this.pm.addPeer(p.peerId);
    }
    if (settings().joinSounds) sfx('join');
    this.stage.showNonVideo = settings().showNonVideo;
    this.statsTimer = setInterval(() => this.updateStats(), 1000);
    this.pingTimer = setInterval(() => this.updatePings(), 3000);
    this.app.onCallChanged();
    this.renderControls();
    this.refreshTiles();
  }

  async rejoin() {
    toast('Reconectando a call…');
    for (const id of [...this.remotes.keys()]) this.dropPeer(id, false);
    const tracks = [...this.pm.localTracks.values()];
    this.pm.closeAll();
    tracks.forEach((t) => this.pm.localTracks.set(t.track.id, t));
    const res = await this.socket.emitWithAck('call:join', { groupId: this.groupId, state: this.localState() });
    if (res?.error) return this.leave();
    this.pm.selfId = res.peerId;
    for (const p of res.peers) {
      this.remotes.set(p.peerId, { userId: p.userId, state: p.state || {}, streams: new Map() });
      this.pm.addPeer(p.peerId);
    }
    this.refreshTiles();
  }

  leave() {
    if (!this.active) return;
    this.coop.stopControl(false);
    this.coop.stopHosting();
    for (const k of [...this.recorders.keys()]) this.stopRecording(k);
    this.active = false;
    this.socket.emit('call:leave');
    clearInterval(this.statsTimer);
    clearInterval(this.pingTimer);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.body.classList.remove('cinema');
    this.pm.closeAll();
    this.media.destroy();
    this.audioOut.destroy();
    this.stage.clear();
    this.remotes.clear();
    this.groupId = null;
    if (settings().joinSounds) sfx('leave');
    this.app.onCallChanged();
  }

  dropPeer(peerId, refresh = true) {
    this.coop.onPeerLeft(peerId);
    this.pm?.removePeer(peerId);
    this.audioOut?.detachPeer(peerId);
    this.remotes.delete(peerId);
    if (refresh) this.refreshTiles();
  }

  localState() {
    return { muted: this.muted || this.deafened, deafened: this.deafened, streams: this.media?.streamsMeta() || {} };
  }

  localChanged() {
    if (!this.active) return;
    this.coop.onScreensChanged();
    this.socket.emit('call:state', { state: this.localState() });
    this.refreshTiles();
    this.renderControls();
    this.mixerRefresh?.();
  }

  // ---------- Mídia remota ----------
  onRemoteTrack(peerId, track, stream) {
    const r = this.remotes.get(peerId);
    if (!r) return;
    r.streams.set(stream.id, stream);
    if (track.kind === 'audio') {
      const meta = r.state.streams?.[stream.id];
      this.audioOut.attach({
        peerId,
        userId: r.userId,
        track,
        stream,
        kind: !meta || meta.source === 'mic' ? 'mic' : 'screen',
        screenId: meta?.screenId || null,
      });
    }
    track.addEventListener('unmute', () => this.refreshTiles());
    track.addEventListener('ended', () => this.onRemoteTrackRemoved(peerId, track, stream));
    this.refreshTiles();
  }

  onRemoteTrackRemoved(peerId, track, stream) {
    const r = this.remotes.get(peerId);
    if (track.kind === 'audio') this.audioOut?.detach(track.id);
    if (r && !stream.getTracks().some((t) => t.readyState === 'live')) r.streams.delete(stream.id);
    this.refreshTiles();
  }

  reclassifyAudio(peerId) {
    const r = this.remotes.get(peerId);
    if (!r) return;
    for (const [streamId, stream] of r.streams) {
      const meta = r.state.streams?.[streamId];
      for (const t of stream.getAudioTracks()) this.audioOut.reclassify(t.id, !meta || meta.source === 'mic' ? 'mic' : 'screen', meta?.screenId || null);
    }
  }

  onConnState(peerId, st) {
    const r = this.remotes.get(peerId);
    if (!r) return;
    r.conn = st;
    if (st === 'failed') toast(`Conexão com ${this.app.userName(r.userId)} falhou. Tentando de novo… (se persistir, configure um servidor TURN)`, 'error', 6000);
    this.app.renderVoiceUsers?.();
  }

  onSpeaking(peerId, sp) {
    this.stage.setSpeaking(peerId, sp);
    const userId = peerId === 'local' ? this.app.me.id : this.remotes.get(peerId)?.userId;
    if (userId) document.querySelectorAll(`[data-voice-user="${userId}"]`).forEach((n) => n.classList.toggle('speaking', sp));
  }

  // ---------- Blocos do palco ----------
  refreshTiles() {
    if (!this.active) return;
    const st = settings();
    const want = new Map();
    const me = this.app.me;
    const m = this.media;
    const localMuted = this.muted || this.deafened;
    if (m.camera && st.showSelfPreview) {
      want.set('me:cam', { kind: 'camera', peerId: 'local', user: me, name: `${me.displayName} (você)`, stream: m.camera.stream, mirror: st.mirrorCam, isLocal: true, muted: localMuted });
    } else {
      want.set('me:avatar', { kind: 'avatar', peerId: 'local', user: me, name: `${me.displayName} (você)`, isLocal: true, muted: localMuted });
    }
    if (st.showSelfPreview) {
      for (const s of m.screens.values()) {
        want.set(`me:s:${s.id}`, { kind: 'screen', peerId: 'local', user: me, name: `${s.name} (você)`, stream: s.stream, isLocal: true, screenId: s.id });
      }
    }
    const seenUsers = new Map();
    for (const [peerId, r] of this.remotes) {
      const user = this.app.user(r.userId) || { id: r.userId, displayName: 'Alguém' };
      const n = (seenUsers.get(r.userId) || 0) + 1;
      seenUsers.set(r.userId, n);
      const base = n > 1 ? `p${peerId}` : `u${r.userId}`;
      const meta = r.state.streams || {};
      const hasLiveVideo = (s) => s && s.getVideoTracks().some((t) => t.readyState === 'live');
      let camId = Object.keys(meta).find((id) => meta[id].type === 'camera' && hasLiveVideo(r.streams.get(id)));
      const muted = Boolean(r.state.muted);
      if (camId) want.set(`${base}:cam`, { kind: 'camera', peerId, user, name: user.displayName, stream: r.streams.get(camId), muted });
      else want.set(`${base}:avatar`, { kind: 'avatar', peerId, user, name: user.displayName, muted });
      for (const [id, info] of Object.entries(meta)) {
        if (info.type !== 'screen' || !hasLiveVideo(r.streams.get(id))) continue;
        want.set(`${base}:s:${id}`, { kind: 'screen', peerId, user, name: `${user.displayName} — ${info.name || 'Tela'}`, stream: r.streams.get(id), screenId: id, userId: r.userId, coop: info.coop || null, coopState: info.coop ? this.coop.tileState(peerId, id) : null });
      }
    }
    for (const key of [...this.stage.tiles.keys()]) if (!want.has(key)) this.stage.remove(key);
    for (const [key, info] of want) this.stage.upsert(key, info);
    // tile que o convidado está controlando no Modo Coop
    const c = this.coop.controlling;
    const ctrlTile = c && [...this.stage.tiles.values()].find((t) => t.info.peerId === c.peerId && t.info.screenId === c.screenId && t.info.coop);
    if (c && !ctrlTile && !this.remotes.get(c.peerId)?.state.streams?.[c.screenId]?.coop) this.coop.stopControl(false);
    else this.coop.bindTile(ctrlTile || null);
    for (const t of this.stage.tiles.values()) t.el.classList.toggle('recording', this.recorders.has(t.key));
    $('#stage-title').textContent = this.app.group(this.groupId)?.name || '';
  }

  async updateStats() {
    const visible = this.stage.statsVisible();
    if (!visible.length) return;
    const byPeer = new Map();
    for (const t of visible) {
      const pid = t.info.peerId;
      if (pid === 'local') {
        const vt = t.info.stream?.getVideoTracks()[0];
        const s = vt?.getSettings();
        this.stage.setStats(t.key, s ? `Enviando ${s.width}×${s.height} @ ${Math.round(s.frameRate || 0)} fps` : '');
        continue;
      }
      if (!byPeer.has(pid)) byPeer.set(pid, await this.pm.stats(pid));
      const stats = byPeer.get(pid);
      const vt = t.info.stream?.getVideoTracks()[0];
      const v = vt && stats.get(vt.id);
      if (!v) {
        this.stage.setStats(t.key, 'sem vídeo');
        continue;
      }
      const mbps = (v.kbps / 1000).toFixed(1);
      this.stage.setStats(t.key, `${v.width || '?'}×${v.height || '?'} • ${Math.round(v.fps || 0)} fps • ${mbps} Mbps • ${v.codec || ''}${v.rtt != null ? ` • ${v.rtt} ms` : ''}`);
    }
  }

  // ---------- Ações ----------
  // Mudo efetivo = mutado OU ensurdecido (igual ao Discord)
  toggleMute(force) {
    if (this.deafened && force === undefined) {
      // clicar no mic enquanto ensurdecido: volta a ouvir e a falar
      this.deafened = false;
      this.muted = false;
      this.audioOut?.setDeafened(false);
    } else {
      this.muted = force ?? !this.muted;
    }
    this.media?.setMuted(this.muted || this.deafened);
    sfx(this.muted || this.deafened ? 'mute' : 'unmute');
    this.afterSelfState();
  }

  toggleDeafen(force) {
    this.deafened = force ?? !this.deafened;
    this.audioOut?.setDeafened(this.deafened);
    this.media?.setMuted(this.muted || this.deafened);
    sfx(this.deafened ? 'mute' : 'unmute');
    this.afterSelfState();
  }

  afterSelfState() {
    if (this.active) this.socket.emit('call:state', { state: this.localState() });
    this.app.renderMeBar();
    this.renderControls();
    this.refreshTiles();
  }

  async toggleCamera() {
    if (!this.active) return;
    if (this.media.camera) return this.media.stopCamera();
    try {
      await this.media.startCamera();
    } catch (err) {
      toast('Não consegui abrir a câmera: ' + (err.message || err.name), 'error', 5000);
    }
  }

  async startScreen(opts) {
    try {
      const scr = await this.media.startScreen(opts);
      const v = scr.track.getSettings();
      toast(`${scr.name} no ar: ${v.width}×${v.height} @ ${Math.round(v.frameRate || scr.fps)} fps${scr.audioSourceId ? ' com áudio 🔊' : ''}`, 'success');
    } catch (err) {
      if (err.name !== 'NotAllowedError') toast('Não foi possível compartilhar: ' + (err.message || err.name), 'error', 5000);
    }
  }

  toggleCinema(force) {
    document.body.classList.toggle('cinema', force);
    this.renderControls();
    this.stage.scheduleRender();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.wrap.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }

  onSettingsChanged(st, patch) {
    if (!this.active) return;
    if ('echoCancellation' in patch || 'noiseSuppression' in patch || 'autoGainControl' in patch || 'hifi' in patch) this.media.reopenAllMics();
    if ('micDeviceId' in patch) {
      const first = this.media.mics[0];
      if (first) this.media.reopenSource(first.id, st.micDeviceId).catch((e) => toast(e.message, 'error'));
    }
    if ('micVolume' in patch) {
      const first = this.media.mics[0];
      if (first) this.media.setVolume(first.id, st.micVolume);
    }
    if ('outputDeviceId' in patch) this.audioOut.setOutputDevice(st.outputDeviceId);
    if ('pttEnabled' in patch || 'pttKey' in patch) {
      this.media.pttDown = false;
      this.media.refreshEnabled();
      this.mixerRefresh?.();
    }
    if (('camQuality' in patch || 'camDeviceId' in patch) && this.media.camera) this.media.startCamera().catch((e) => toast(e.message, 'error'));
    if ('codec' in patch) this.pm.renegotiateAll();
    if ('showNonVideo' in patch) {
      this.stage.showNonVideo = st.showNonVideo;
      this.stage.render();
    }
    if ('showSelfPreview' in patch || 'mirrorCam' in patch) this.refreshTiles();
  }

  // ---------- Menus de contexto ----------
  userMenuItems(userId, peerId) {
    if (!this.active || userId === this.app.me.id) return [];
    const ao = this.audioOut;
    return [
      { type: 'slider', label: 'Volume do usuário', min: 0, max: 200, value: Math.round(ao.getUserVolume(userId) * 100), format: (v) => v + '%', onInput: (v) => ao.setUserVolume(userId, v / 100) },
      { label: 'Silenciar para mim', icon: ao.isUserMuted(userId) ? 'volume-x' : 'volume', checked: ao.isUserMuted(userId), onClick: () => ao.setUserMuted(userId, !ao.isUserMuted(userId)) },
    ];
  }

  tileMenu(t, x, y) {
    const { info, key } = t;
    const items = [{ type: 'title', label: info.name }];
    if (!info.isLocal && info.user) items.push(...this.userMenuItems(info.user.id, info.peerId));
    if (info.kind === 'screen' && !info.isLocal && this.audioOut.hasStreamAudio(info.screenId)) {
      items.push({ type: 'slider', label: '🔊 Volume da transmissão', min: 0, max: 200, value: Math.round(this.audioOut.getStreamVolume(info.screenId) * 100), format: (v) => v + '%', onInput: (v) => this.audioOut.setStreamVolume(info.screenId, v / 100) });
    }
    if (info.isLocal && info.kind === 'screen') {
      items.push({ label: 'Qualidade desta transmissão…', icon: 'sliders', onClick: () => this.screenQualityDialog(info.screenId) });
      items.push({ label: 'Parar esta transmissão', icon: 'stop', danger: true, onClick: () => this.media.stopScreen(info.screenId) });
    }
    items.push({ type: 'sep' });
    const hasVideo = info.kind !== 'avatar';
    items.push(
      { label: 'Focar neste bloco', icon: 'focus', onClick: () => this.stage.setFocus(key) },
      { label: 'Dividir 50 / 50', icon: 'columns', onClick: () => this.stage.setRatio(key, 0.5) },
      { label: 'Deixar maior (70 / 30)', icon: 'columns', onClick: () => this.stage.setRatio(key, 0.7) },
      { label: 'Deixar bem maior (85 / 15)', icon: 'columns', onClick: () => this.stage.setRatio(key, 0.85) },
      { label: this.stage.isFloating(key) ? 'Encaixar de volta' : 'Flutuar por cima (arrastável)', icon: 'float', onClick: () => this.stage.toggleFloat(key) }
    );
    if (hasVideo) {
      const fit = this.stage.fit[key] || (info.kind === 'screen' ? 'contain' : 'cover');
      items.push(
        { label: 'Ajustar (sem cortar)', checked: fit === 'contain', onClick: () => this.stage.setFit(key, 'contain') },
        { label: 'Preencher (corta bordas)', checked: fit === 'cover', onClick: () => this.stage.setFit(key, 'cover') },
        { type: 'sep' },
        { label: 'Tela cheia deste bloco', icon: 'maximize', onClick: () => this.stage.fullscreen(key) },
        { label: 'Abrir em outra janela', icon: 'popout', onClick: () => this.stage.popout(key) },
        { label: 'Picture-in-Picture', icon: 'pip', onClick: () => this.stage.pip(key) },
        { label: 'Estatísticas de qualidade', icon: 'activity', onClick: () => this.stage.toggleStats(key) && this.updateStats() }
      );
    }
    if (hasVideo && info.stream) {
      const rec = this.recorders.has(key);
      items.push({ label: rec ? '⏹ Parar gravação e baixar' : '⏺ Gravar clipe deste bloco', onClick: () => (rec ? this.stopRecording(key) : this.startRecording(t)) });
    }
    if (info.isLocal && info.kind === 'screen') items.push({ label: '🕹️ Modo Jogo Coop…', onClick: () => this.coop.openHostDialog() });
    items.push({ label: 'Ocultar este bloco', icon: 'x', onClick: () => this.stage.hide(key) });
    contextMenu(x, y, items);
  }

  // ---------- Barra de controles ----------
  renderControls() {
    const c = this.controls;
    if (!this.active) return c.replaceChildren();
    const m = this.media;
    const b = (ic, title, onClick, cls = '') => el('button', { class: `cc-btn ${cls}`, title, onclick: onClick }, icon(ic, 22));
    const split = (main, onArrow) => el('div', { class: 'cc-split' }, main, el('button', { class: 'cc-arrow', title: 'Opções', onclick: (e) => onArrow(e.currentTarget) }, icon('chevron-up', 14)));
    const screens = m.screens.size;
    const fs = Boolean(document.fullscreenElement);
    const cinema = document.body.classList.contains('cinema');

    c.replaceChildren(
      el('div', { class: 'cc-group' },
        split(b(this.muted || this.deafened ? 'mic-off' : 'mic', 'Microfone (Ctrl+Shift+M)', () => this.toggleMute(), this.muted || this.deafened ? 'off' : ''), (a) => this.micPopover(a)),
        b(this.deafened ? 'headphones-off' : 'headphones', 'Ensurdecer (Ctrl+Shift+D)', () => this.toggleDeafen(), this.deafened ? 'off' : ''),
        split(b(m.camera ? 'video' : 'video-off', 'Câmera', () => this.toggleCamera(), m.camera ? 'on' : ''), (a) => this.cameraPopover(a)),
        el('button', { class: `cc-btn ${screens ? 'on' : ''}`, title: 'Compartilhar tela (pode ser mais de uma)', onclick: (e) => (screens ? this.screensPopover(e.currentTarget) : this.shareDialog()) },
          icon('monitor-up', 22), screens ? el('span', { class: 'cc-count' }, screens) : null),
        b('sliders', 'Mixer: escolher quais áudios transmitir', () => this.openMixer()),
        el('button', { class: `cc-btn ${this.coop.hosting ? 'on' : ''}`, title: 'Modo Jogo Coop: deixar amigos jogarem no seu PC', onclick: () => this.coop.openHostDialog() }, el('span', { class: 'cc-emoji' }, '🕹️')),
        el('button', { class: 'cc-btn', title: 'Soundboard', onclick: (e) => this.soundboard(e.currentTarget) }, el('span', { class: 'cc-emoji' }, '📣'))
      ),
      el('div', { class: 'cc-group' },
        b(this.layoutIcon(), 'Layout', (e) => this.layoutPopover(e.currentTarget)),
        b('message', 'Mostrar/esconder chat', () => this.app.toggleChat()),
        b('cinema', cinema ? 'Sair do modo cinema' : 'Modo cinema (esconde as barras)', () => this.toggleCinema(), cinema ? 'on' : ''),
        b(fs ? 'minimize' : 'maximize', fs ? 'Sair da tela cheia (Esc)' : 'Tela cheia (F)', () => this.toggleFullscreen(), fs ? 'on' : ''),
        b('settings', 'Configurações de voz e vídeo', () => this.app.openSettings('voice'))
      ),
      el('div', { class: 'cc-group' }, b('phone-off', 'Sair da call', () => this.leave(), 'danger'))
    );
  }

  layoutIcon() {
    return { grid: 'grid', row: 'columns', column: 'rows', focus: 'focus' }[this.stage.layout] || 'grid';
  }

  layoutPopover(anchor) {
    const opt = (id, ic, label) => el('button', { class: `ctx-item ${this.stage.layout === id ? 'checked' : ''}`, onclick: () => { this.stage.setLayout(id); closeMenu(); this.renderControls(); } }, icon(ic, 16), el('span', { class: 'ctx-label' }, label), el('span', { class: 'ctx-check' }, this.stage.layout === id ? '✓' : ''));
    const st = settings();
    popover(anchor, el('div', {},
      el('div', { class: 'ctx-title' }, 'Layout'),
      opt('row', 'columns', 'Lado a lado (arraste as divisórias)'),
      opt('column', 'rows', 'Um em cima do outro'),
      opt('focus', 'focus', 'Foco: um grande + lateral'),
      opt('grid', 'grid', 'Grade automática'),
      el('div', { class: 'ctx-sep' }),
      el('button', { class: 'ctx-item', onclick: () => { this.stage.equalize(); closeMenu(); } }, icon('columns', 16), el('span', { class: 'ctx-label' }, 'Igualar tamanhos')),
      el('button', { class: 'ctx-item', onclick: () => { this.stage.showAll(); closeMenu(); } }, icon('layers', 16), el('span', { class: 'ctx-label' }, 'Mostrar blocos ocultos')),
      el('div', { class: 'ctx-sep' }),
      el('button', { class: 'ctx-item', onclick: () => { updateSettings({ showNonVideo: !st.showNonVideo }); closeMenu(); } }, icon('users', 16), el('span', { class: 'ctx-label' }, 'Mostrar quem está sem vídeo'), el('span', { class: 'ctx-check' }, st.showNonVideo ? '✓' : '')),
      el('button', { class: 'ctx-item', onclick: () => { updateSettings({ showSelfPreview: !st.showSelfPreview }); closeMenu(); } }, icon('monitor', 16), el('span', { class: 'ctx-label' }, 'Mostrar minha prévia'), el('span', { class: 'ctx-check' }, st.showSelfPreview ? '✓' : '')),
      el('p', { class: 'ctx-hint' }, 'Dica: clique com o botão direito (ou segure no celular) num bloco para flutuar, focar, mudar tamanho, volume e mais.')
    ));
  }

  async micPopover(anchor) {
    const devs = await listDevices();
    const st = settings();
    const current = this.media.mics[0]?.deviceId || st.micDeviceId;
    popover(anchor, el('div', {},
      el('div', { class: 'ctx-title' }, 'Microfone principal'),
      ...devs.audioinput.map((d) => el('button', { class: `ctx-item ${d.deviceId === current ? 'checked' : ''}`, onclick: () => { updateSettings({ micDeviceId: d.deviceId }); closeMenu(); } }, icon('mic', 16), el('span', { class: 'ctx-label' }, cleanLabel(d.label, 'Microfone')), el('span', { class: 'ctx-check' }, d.deviceId === current ? '✓' : ''))),
      el('div', { class: 'ctx-title' }, 'Saída (alto-falante / fone)'),
      ...devs.audiooutput.map((d) => el('button', { class: `ctx-item ${d.deviceId === st.outputDeviceId ? 'checked' : ''}`, onclick: () => { updateSettings({ outputDeviceId: d.deviceId }); closeMenu(); } }, icon('headphones', 16), el('span', { class: 'ctx-label' }, cleanLabel(d.label, 'Saída')), el('span', { class: 'ctx-check' }, d.deviceId === st.outputDeviceId ? '✓' : ''))),
      el('div', { class: 'ctx-sep' }),
      el('button', { class: 'ctx-item', onclick: () => { closeMenu(); this.openMixer(); } }, icon('sliders', 16), el('span', { class: 'ctx-label' }, 'Abrir mixer (vários mics / áudios)'))
    ));
  }

  async cameraPopover(anchor) {
    const devs = await listDevices();
    const st = settings();
    const current = this.media.camera?.deviceId || st.camDeviceId;
    popover(anchor, el('div', {},
      el('div', { class: 'ctx-title' }, 'Câmera'),
      ...devs.videoinput.map((d, i) => el('button', { class: `ctx-item ${d.deviceId === current ? 'checked' : ''}`, onclick: () => { updateSettings({ camDeviceId: d.deviceId }); closeMenu(); if (!this.media.camera) this.toggleCamera(); } }, icon('camera', 16), el('span', { class: 'ctx-label' }, cleanLabel(d.label, `Câmera ${i + 1}`)), el('span', { class: 'ctx-check' }, d.deviceId === current ? '✓' : ''))),
      el('div', { class: 'ctx-title' }, 'Qualidade'),
      ...Object.entries(CAMERA_PRESETS).map(([k, p]) => el('button', { class: `ctx-item ${st.camQuality === k ? 'checked' : ''}`, onclick: () => { updateSettings({ camQuality: k }); closeMenu(); } }, el('span', { class: 'ic-space' }), el('span', { class: 'ctx-label' }, p.label), el('span', { class: 'ctx-check' }, st.camQuality === k ? '✓' : ''))),
      el('div', { class: 'ctx-sep' }),
      el('button', { class: 'ctx-item', onclick: () => { updateSettings({ mirrorCam: !st.mirrorCam }); closeMenu(); } }, el('span', { class: 'ic-space' }), el('span', { class: 'ctx-label' }, 'Espelhar minha prévia'), el('span', { class: 'ctx-check' }, st.mirrorCam ? '✓' : ''))
    ));
  }

  screensPopover(anchor) {
    const list = [...this.media.screens.values()];
    popover(anchor, el('div', {},
      el('div', { class: 'ctx-title' }, 'Suas transmissões'),
      ...list.map((s) => {
        const v = s.track.getSettings();
        return el('div', { class: 'screen-row' },
          icon('monitor', 16),
          el('div', { class: 'screen-row-info' }, el('b', {}, s.name), el('small', {}, `${v.width}×${v.height} • ${Math.round(v.frameRate || s.fps)} fps${s.audioSourceId ? ' • com áudio' : ''}`)),
          el('button', { class: 'icon-btn sm', title: 'Qualidade', onclick: () => { closeMenu(); this.screenQualityDialog(s.id); } }, icon('sliders', 16)),
          el('button', { class: 'icon-btn sm danger', title: 'Parar', onclick: () => { this.media.stopScreen(s.id); closeMenu(); } }, icon('x', 16))
        );
      }),
      el('div', { class: 'ctx-sep' }),
      el('button', { class: 'ctx-item', onclick: () => { closeMenu(); this.shareDialog(); } }, icon('plus', 16), el('span', { class: 'ctx-label' }, 'Compartilhar outra tela/janela/aba'))
    ));
  }

  // ---------- Diálogo de compartilhamento ----------
  shareDialog() {
    const st = settings();
    const n = this.media.screenCounter + 1;
    const name = el('input', { class: 'input', value: `Tela ${n}`, maxlength: 30 });
    const content = { value: st.screenContent };
    const contentPick = el('div', { class: 'choice-row' });
    const renderContent = () => {
      contentPick.replaceChildren(
        ...[
          ['motion', '🎬', 'Filme / Jogo', 'Prioriza fluidez (fps)'],
          ['detail', '📝', 'Texto / Código', 'Prioriza nitidez'],
        ].map(([id, e, t, d]) => el('button', { class: `choice ${content.value === id ? 'active' : ''}`, onclick: () => { content.value = id; renderContent(); } }, el('span', { class: 'choice-emoji' }, e), el('b', {}, t), el('small', {}, d)))
      );
    };
    renderContent();
    const res = el('select', { class: 'input' }, ...Object.entries(SCREEN_RESOLUTIONS).map(([k, r]) => el('option', { value: k, selected: st.screenRes === k }, r.label)));
    const fps = el('select', { class: 'input' }, ...[15, 30, 60, 120].map((f) => el('option', { value: f, selected: Number(st.screenFps) === f }, `${f} fps${f === 120 ? ' (se o monitor/navegador suportar)' : ''}`)));
    const audio = el('input', { type: 'checkbox', checked: st.screenAudio });
    const antiEcho = el('input', { type: 'checkbox', checked: st.restrictOwnAudio });

    const m = modal({
      title: '🖥️ Compartilhar tela',
      wide: true,
      content: el('div', { class: 'share-dialog' },
        el('label', { class: 'field' }, el('span', {}, 'Nome da transmissão (aparece pra quem assiste)'), name),
        el('div', { class: 'field' }, el('span', {}, 'O que você vai mostrar?'), contentPick),
        el('div', { class: 'grid-2' },
          el('label', { class: 'field' }, el('span', {}, 'Resolução'), res),
          el('label', { class: 'field' }, el('span', {}, 'Quadros por segundo'), fps)
        ),
        el('label', { class: 'switch-row' }, audio, el('span', { class: 'switch' }), el('div', {}, el('b', {}, 'Transmitir áudio'), el('small', {}, 'Aba: só o som da aba • Janela: só o som do app (navegadores novos) • Tela inteira: som do sistema'))),
        el('label', { class: 'switch-row' }, antiEcho, el('span', { class: 'switch' }), el('div', {}, el('b', {}, 'Anti-eco: não capturar a voz da call'), el('small', {}, 'Tira o som desta página da captura, então quem fala na call não volta em eco.'))),
        el('details', { class: 'tips' },
          el('summary', {}, '💡 Dicas: Valorant, Netflix, eco e 2 monitores'),
          el('ul', {},
            el('li', {}, el('b', {}, 'Só o som do jogo (ex.: Valorant): '), 'escolha a aba "Janela" e marque "compartilhar áudio". Se seu navegador não oferecer, instale um cabo virtual (ex.: VB-CABLE), mande o jogo para ele em Configurações do Windows → Som → Volume do app, e adicione "CABLE Output" como fonte no ', el('b', {}, 'Mixer'), '.'),
            el('li', {}, el('b', {}, 'Netflix/Prime ficando preto: '), 'é a proteção DRM. No Chrome/Edge desative "Usar aceleração de hardware" (Configurações → Sistema) e reinicie o navegador.'),
            el('li', {}, el('b', {}, 'Sem eco: '), 'mantenha o anti-eco ligado ou use fone. Outra opção: escolha um fone como saída da call e compartilhe o áudio do sistema.'),
            el('li', {}, el('b', {}, 'Duas telas: '), 'depois de iniciar a primeira, clique de novo em compartilhar e escolha o outro monitor. Cada uma vira um bloco separado (e dá pra abrir cada uma em uma janela).')
          )
        )
      ),
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        {
          label: 'Escolher o que compartilhar',
          primary: true,
          onClick: (c) => {
            const opts = { name: name.value, res: res.value, fps: Number(fps.value), content: content.value, audio: audio.checked, restrictOwnAudio: antiEcho.checked };
            updateSettings({ screenRes: opts.res, screenFps: opts.fps, screenContent: opts.content, screenAudio: opts.audio, restrictOwnAudio: opts.restrictOwnAudio });
            c();
            this.startScreen(opts);
          },
        },
      ],
    });
    return m;
  }

  screenQualityDialog(id) {
    const s = this.media.screens.get(id);
    if (!s) return;
    const name = el('input', { class: 'input', value: s.name, maxlength: 30 });
    const res = el('select', { class: 'input' }, ...Object.entries(SCREEN_RESOLUTIONS).map(([k, r]) => el('option', { value: k, selected: s.res === k }, r.label)));
    const fps = el('select', { class: 'input' }, ...[15, 30, 60, 120].map((f) => el('option', { value: f, selected: s.fps === f }, `${f} fps`)));
    const content = el('select', { class: 'input' }, el('option', { value: 'motion', selected: s.content === 'motion' }, '🎬 Filme / Jogo (fluidez)'), el('option', { value: 'detail', selected: s.content === 'detail' }, '📝 Texto / Código (nitidez)'));
    modal({
      title: `Qualidade — ${s.name}`,
      content: el('div', {},
        el('label', { class: 'field' }, el('span', {}, 'Nome'), name),
        el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Resolução'), res), el('label', { class: 'field' }, el('span', {}, 'FPS'), fps)),
        el('label', { class: 'field' }, el('span', {}, 'Tipo de conteúdo'), content)
      ),
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        { label: 'Aplicar', primary: true, onClick: (c) => { this.media.updateScreen(id, { name: name.value, res: res.value, fps: fps.value, content: content.value }); c(); } },
      ],
    });
  }

  // ---------- Mixer de transmissão ----------
  async openMixer() {
    if (!this.active) return;
    const list = el('div', { class: 'mixer-list' });
    const add = el('div', { class: 'mixer-add' });
    let raf;
    const meters = new Map();

    const render = async () => {
      meters.clear();
      const sources = [...this.media.sources.values()];
      list.replaceChildren(
        ...(sources.length
          ? sources.map((s) => {
              const meter = el('div', { class: 'meter' }, el('span'));
              meters.set(s.id, meter);
              const toggle = el('input', { type: 'checkbox', checked: s.transmit, onchange: (e) => this.media.setTransmit(s.id, e.target.checked) });
              const vol = el('input', { type: 'range', min: 0, max: 200, value: Math.round(s.volume * 100) });
              const volOut = el('span', { class: 'mixer-vol' }, pct(s.volume));
              vol.addEventListener('input', () => {
                this.media.setVolume(s.id, vol.value / 100);
                volOut.textContent = vol.value + '%';
                if (s === this.media.mics[0]) updateSettings({ micVolume: vol.value / 100 });
              });
              const isMic = s.kind === 'mic';
              const removeBtn = isMic || s.kind === 'board'
                ? el('button', { class: 'icon-btn sm', title: 'Remover esta fonte', onclick: () => this.media.removeSource(s.id) }, icon('x', 16))
                : el('button', { class: 'icon-btn sm', title: 'Parar esta transmissão', onclick: () => this.media.stopScreen(s.screenId) }, icon('stop', 16));
              return el('div', { class: `mixer-row ${s.transmit ? '' : 'off'}` },
                el('div', { class: 'mixer-ic' }, icon(isMic ? 'mic' : s.kind === 'board' ? 'volume' : 'monitor', 18)),
                el('div', { class: 'mixer-main' },
                  el('div', { class: 'mixer-name' }, el('b', {}, s.label), el('small', {}, isMic ? (this.muted ? 'Microfone • você está mutado' : settings().pttEnabled ? `Microfone • push-to-talk (${keyLabel(settings().pttKey)})` : 'Microfone') : s.kind === 'board' ? 'Sons do soundboard' : 'Áudio da transmissão')),
                  meter,
                  el('div', { class: 'mixer-vol-row' }, icon('volume', 14), vol, volOut)
                ),
                el('label', { class: 'switch-row compact', title: 'Transmitir esta faixa' }, toggle, el('span', { class: 'switch' })),
                removeBtn
              );
            })
          : [el('p', { class: 'muted' }, 'Nenhuma fonte de áudio ativa.')])
      );
      const devs = await listDevices();
      const used = new Set(this.media.mics.map((s) => s.deviceId));
      const candidates = devs.audioinput.filter((d) => !used.has(d.deviceId) && !(d.deviceId === 'default' && used.has('default')));
      add.replaceChildren(
        el('h4', {}, 'Adicionar outra entrada de áudio'),
        ...(candidates.length
          ? candidates.map((d) =>
              el('button', { class: 'mixer-cand', onclick: async () => { try { await this.media.addMic(d.deviceId); } catch (e) { toast(e.message, 'error'); } } },
                icon(/cable|virtual|voicemeeter|vb-audio|loopback|stereo mix|mixagem/i.test(d.label) ? 'link' : 'mic', 16),
                el('span', {}, cleanLabel(d.label, 'Entrada de áudio')),
                el('span', { class: 'mixer-cand-add' }, '+ adicionar'))
            )
          : [el('p', { class: 'muted' }, 'Todas as entradas já estão no mixer.')]),
        el('p', { class: 'muted small' }, '🎮 Quer mandar só o som de um app (ex.: Valorant) sem a voz da pessoa? Mande o app para um cabo virtual (VB-CABLE / Voicemeeter) no Windows e adicione o "CABLE Output" aqui. Cada faixa liga/desliga separada.')
      );
    };

    const animate = () => {
      for (const [id, m] of meters) {
        const s = this.media.sources.get(id);
        if (s) m.firstChild.style.width = Math.round(s.level * 100) + '%';
      }
      raf = requestAnimationFrame(animate);
    };

    this.mixerRefresh = render;
    await render();
    animate();
    modal({
      title: '🎚️ Mixer — o que vai pra call',
      wide: true,
      content: el('div', { class: 'mixer' }, el('p', { class: 'muted' }, 'Ligue só as faixas que quer transmitir. Cada microfone e cada áudio de tela aparece com o nome que o seu PC usa.'), list, add),
      onClose: () => {
        cancelAnimationFrame(raf);
        this.mixerRefresh = null;
      },
    });
  }

  // ---------- Ping de cada pessoa ----------
  async updatePings() {
    for (const [peerId, r] of this.remotes) r.ping = await this.pm.rtt(peerId).catch(() => null);
    this.app.renderVoiceUsers?.();
  }

  // ---------- Gravar clipe de um bloco ----------
  startRecording(t) {
    const { info, key } = t;
    const tracks = [...info.stream.getVideoTracks()];
    // junta o áudio certo: da transmissão (telas) ou a voz da pessoa (câmera)
    if (info.isLocal) {
      const src = [...this.media.sources.values()].find((s) => (info.kind === 'screen' ? s.screenId === info.screenId : s.kind === 'mic'));
      if (src) tracks.push(src.outTrack);
    } else {
      const r = this.remotes.get(info.peerId);
      for (const [sid, st] of r?.streams || []) {
        const meta = r.state.streams?.[sid];
        if (meta?.type !== 'audio') continue;
        if (info.kind === 'screen' ? meta.screenId === info.screenId : meta.source === 'mic') tracks.push(...st.getAudioTracks());
      }
    }
    const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    const mimeType = types.find((m) => window.MediaRecorder?.isTypeSupported(m));
    if (!mimeType) return toast('Seu navegador não suporta gravação.', 'error');
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 256_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
      const a = el('a', { href: URL.createObjectURL(blob), download: `kenfeh-clip-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      toast(`Clipe salvo (${(blob.size / 1048576).toFixed(1)} MB) 🎬`, 'success');
    };
    rec.start(1000);
    this.recorders.set(key, rec);
    toast('⏺ Gravando… clique com o botão direito no bloco para parar.');
    this.refreshTiles();
  }

  stopRecording(key) {
    const rec = this.recorders.get(key);
    if (!rec) return;
    this.recorders.delete(key);
    if (rec.state !== 'inactive') rec.stop();
    this.refreshTiles();
  }

  // ---------- Soundboard ----------
  async loadSound(item) {
    if (this.soundCache.has(item.id)) return this.soundCache.get(item.id);
    let buf;
    if (item.url) {
      const data = await (await fetch(item.url)).arrayBuffer();
      buf = await this.media.ctx.decodeAudioData(data);
    } else buf = await renderSound(item.id);
    this.soundCache.set(item.id, buf);
    return buf;
  }

  async soundboard(anchor) {
    let mine = [];
    try {
      mine = (await api.get('/stickers')).stickers.filter((s) => s.kind === 'sound').map((s) => ({ id: 'u' + s.id, dbId: s.id, name: s.name || 'Som', icon: '🔉', url: s.url }));
    } catch {}
    const play = async (item, btn) => {
      try {
        btn.classList.add('playing');
        const src = this.media.playSound(await this.loadSound(item));
        src.onended = () => btn.classList.remove('playing');
      } catch (err) {
        btn.classList.remove('playing');
        toast('Não consegui tocar esse som: ' + err.message, 'error');
      }
    };
    const upload = el('input', { type: 'file', accept: 'audio/*', hidden: true });
    upload.addEventListener('change', async () => {
      const f = upload.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) return toast('Som muito grande (máx. 2 MB).', 'error');
      try {
        await api.upload(f, 'sound', f.name.replace(/\.[^.]+$/, '').slice(0, 30));
        toast('Som adicionado ao seu soundboard!', 'success');
        closeMenu();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    const btn = (item) => {
      const b = el('button', { class: 'sb-btn', title: item.name }, el('span', {}, item.icon), el('small', {}, item.name));
      b.addEventListener('click', () => play(item, b));
      if (item.dbId)
        onContext(b, (x, y) => contextMenu(x, y, [{ label: 'Remover do soundboard', icon: 'trash', danger: true, onClick: () => api.del(`/stickers/${item.dbId}`) }]));
      return b;
    };
    popover(anchor, el('div', { class: 'soundboard' },
      el('div', { class: 'ctx-title' }, '📣 Soundboard — todo mundo na call ouve'),
      el('div', { class: 'sb-grid' }, ...BUILTIN_SOUNDS.map(btn), ...mine.map(btn),
        el('button', { class: 'sb-btn add', onclick: () => upload.click() }, el('span', {}, '＋'), el('small', {}, 'Enviar som'))),
      upload,
      el('p', { class: 'ctx-hint' }, 'O volume do soundboard fica no Mixer. Botão direito num som seu para remover.')
    ), { className: 'sb-pop' });
  }

  // ---------- Controles somem quando o mouse fica parado ----------
  setupIdle() {
    let timer;
    const wake = () => {
      this.wrap.classList.remove('idle');
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!this.controls.matches(':hover') && !document.querySelector('.ctx-menu')) this.wrap.classList.add('idle');
      }, 2600);
    };
    this.wrap.addEventListener('pointermove', wake);
    this.wrap.addEventListener('pointerdown', wake);
    wake();
  }

  setupHotkeys() {
    // push-to-talk (teclado ou botões laterais do mouse)
    const ptt = (code, down) => {
      const st = settings();
      if (!this.active || !st.pttEnabled || code !== st.pttKey) return false;
      this.media.setPtt(down);
      return true;
    };
    document.addEventListener('keyup', (e) => ptt(e.code, false));
    document.addEventListener('pointerdown', (e) => e.button > 2 && ptt(`Mouse${e.button}`, true));
    document.addEventListener('pointerup', (e) => e.button > 2 && ptt(`Mouse${e.button}`, false));
    window.addEventListener('blur', () => this.active && this.media?.setPtt(false));
    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (!typing && !e.repeat && ptt(e.code, true)) return;
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault();
        this.toggleMute();
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        this.toggleDeafen();
      } else if (!typing && this.active && e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.toggleFullscreen();
      }
    });
  }
}
