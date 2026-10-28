// Mídia local: microfones (vários ao mesmo tempo), câmera e várias telas.
// Cada fonte de áudio vira uma "faixa" separada que pode ser ligada/desligada
// e ter volume próprio antes de ir pra call (mixer de transmissão).
import { settings, micConstraints, cameraConstraints, CAMERA_PRESETS, SCREEN_RESOLUTIONS } from './settings.js';

const SURFACE_LABEL = { monitor: 'tela inteira', window: 'janela', browser: 'aba do navegador' };

export async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    audioinput: all.filter((d) => d.kind === 'audioinput'),
    videoinput: all.filter((d) => d.kind === 'videoinput'),
    audiooutput: all.filter((d) => d.kind === 'audiooutput'),
  };
}

export function cleanLabel(label, fallback) {
  if (!label) return fallback;
  return label.replace(/^(Padrão|Default|Comunicações|Communications) - /i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
}

export class LocalMedia {
  constructor({ onPublish, onUnpublish, onUpdateOpts, onChange, onSpeaking }) {
    this.onPublish = onPublish;
    this.onUnpublish = onUnpublish;
    this.onUpdateOpts = onUpdateOpts;
    this.onChange = onChange;
    this.onSpeaking = onSpeaking;
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    this.sources = new Map(); // fontes de áudio
    this.camera = null;
    this.screens = new Map();
    this.muted = false;
    this.screenCounter = 0;
    this.speaking = false;
    this.loop = setInterval(() => this.tick(), 40);
    this.buf = new Float32Array(1024);
  }

  // ---------- Áudio ----------
  async addMic(deviceId = settings().micDeviceId, { transmit = true } = {}) {
    for (const s of this.sources.values()) if (s.kind === 'mic' && s.deviceId === deviceId) return s;
    const raw = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
    const t = raw.getAudioTracks()[0];
    const isFirst = ![...this.sources.values()].some((s) => s.kind === 'mic');
    return this._addAudioSource({
      kind: 'mic',
      deviceId,
      label: cleanLabel(t.label, 'Microfone'),
      rawStream: raw,
      transmit,
      volume: isFirst ? settings().micVolume : 1,
    });
  }

  _addAudioSource({ kind, deviceId = null, label, rawStream, transmit = true, volume = 1, screenId = null }) {
    const ctx = this.ctx;
    const id = 'src_' + Math.random().toString(36).slice(2, 9);
    const src = ctx.createMediaStreamSource(rawStream);
    const vol = ctx.createGain();
    vol.gain.value = volume;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    const gate = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 2;
    src.connect(vol);
    vol.connect(analyser);
    vol.connect(gate);
    gate.connect(dest);
    const outTrack = dest.stream.getAudioTracks()[0];
    const stream = new MediaStream([outTrack]);
    const s = { id, kind, deviceId, label, rawStream, src, vol, analyser, gate, dest, outTrack, stream, transmit, volume, screenId, level: 0, lastLoud: 0 };
    this.sources.set(id, s);
    this.applyEnabled(s);
    rawStream.getAudioTracks()[0]?.addEventListener('ended', () => this.sources.has(id) && this.removeSource(id));
    this.onPublish(outTrack, stream, { maxBitrate: kind === 'mic' ? 192000 : 510000, priority: 'high' });
    this.onChange();
    return s;
  }

  removeSource(id) {
    const s = this.sources.get(id);
    if (!s) return;
    this.sources.delete(id);
    s.rawStream.getTracks().forEach((t) => t.stop());
    try {
      s.src.disconnect();
      s.gate.disconnect();
    } catch {}
    this.onUnpublish(s.outTrack);
    s.outTrack.stop();
    this.onChange();
  }

  // Troca o dispositivo/processamento sem renegociar (a faixa enviada continua a mesma)
  async reopenSource(id, deviceId = null) {
    const s = this.sources.get(id);
    if (!s || s.kind !== 'mic') return;
    const dev = deviceId ?? s.deviceId;
    const raw = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(dev) });
    const src = this.ctx.createMediaStreamSource(raw);
    src.connect(s.vol);
    try {
      s.src.disconnect();
    } catch {}
    s.rawStream.getTracks().forEach((t) => t.stop());
    Object.assign(s, { src, rawStream: raw, deviceId: dev, label: cleanLabel(raw.getAudioTracks()[0].label, 'Microfone') });
    this.onChange();
  }

  async reopenAllMics() {
    for (const s of this.sources.values()) if (s.kind === 'mic') await this.reopenSource(s.id).catch(() => {});
  }

  applyEnabled(s) {
    const pttBlocked = s.kind === 'mic' && settings().pttEnabled && !this.pttDown;
    s.outTrack.enabled = s.transmit && !(s.kind === 'mic' && this.muted) && !pttBlocked;
  }

  // Push-to-talk: o mic só abre enquanto a tecla está pressionada
  setPtt(down) {
    if (this.pttDown === down) return;
    this.pttDown = down;
    for (const s of this.sources.values()) this.applyEnabled(s);
    this.onChange();
  }

  refreshEnabled() {
    for (const s of this.sources.values()) this.applyEnabled(s);
  }

  // ---------- Soundboard: sons tocados direto na call ----------
  ensureBoard() {
    if (this.board && this.sources.has(this.board.sourceId)) return this.board;
    const bus = this.ctx.createGain();
    const out = this.ctx.createMediaStreamDestination();
    bus.connect(out);
    const s = this._addAudioSource({ kind: 'board', label: 'Soundboard', rawStream: out.stream, transmit: true });
    this.board = { bus, sourceId: s.id };
    return this.board;
  }

  playSound(buffer, { local = true } = {}) {
    const board = this.ensureBoard();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(board.bus);
    if (local) {
      const g = this.ctx.createGain();
      g.gain.value = 0.6;
      src.connect(g).connect(this.ctx.destination);
    }
    src.start();
    return src;
  }

  setTransmit(id, on) {
    const s = this.sources.get(id);
    if (!s) return;
    s.transmit = on;
    this.applyEnabled(s);
    this.onChange();
  }

  setVolume(id, v) {
    const s = this.sources.get(id);
    if (!s) return;
    s.volume = v;
    s.vol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setMuted(m) {
    this.muted = m;
    for (const s of this.sources.values()) this.applyEnabled(s);
    this.onChange();
  }

  get mics() {
    return [...this.sources.values()].filter((s) => s.kind === 'mic');
  }

  tick() {
    const st = settings();
    const now = performance.now();
    let speaking = false;
    for (const s of this.sources.values()) {
      s.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const rms = Math.sqrt(sum / this.buf.length);
      const db = 20 * Math.log10(rms + 1e-9);
      s.db = db;
      s.level = Math.max(0, Math.min(1, (db + 60) / 60));
      if (s.kind !== 'mic') continue;
      const threshold = st.gateEnabled ? st.gateDb : -48;
      if (db > threshold) s.lastLoud = now;
      const open = !st.gateEnabled || now - s.lastLoud < 300;
      s.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, open ? 0.005 : 0.05);
      if (now - s.lastLoud < 250 && s.outTrack.enabled) speaking = true;
    }
    if (speaking !== this.speaking) {
      this.speaking = speaking;
      this.onSpeaking?.(speaking);
    }
  }

  // ---------- Câmera ----------
  async startCamera(deviceId = settings().camDeviceId) {
    if (this.camera) this.stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(deviceId) });
    const track = stream.getVideoTracks()[0];
    track.contentHint = 'motion';
    const p = CAMERA_PRESETS[settings().camQuality] || CAMERA_PRESETS['1080p60'];
    this.camera = { track, stream, deviceId: track.getSettings().deviceId || deviceId };
    track.addEventListener('ended', () => this.camera?.track === track && this.stopCamera());
    this.onPublish(track, stream, { maxBitrate: p.kbps * 1000, maxFramerate: p.fps, degradationPreference: 'balanced', priority: 'medium' });
    this.onChange();
    return this.camera;
  }

  stopCamera() {
    if (!this.camera) return;
    const { track } = this.camera;
    this.camera = null;
    this.onUnpublish(track);
    track.stop();
    this.onChange();
  }

  // ---------- Compartilhamento de tela (quantas quiser) ----------
  async startScreen(opt = {}) {
    const st = settings();
    const resKey = opt.res || st.screenRes;
    const fps = Number(opt.fps || st.screenFps);
    const content = opt.content || st.screenContent;
    const wantAudio = opt.audio ?? st.screenAudio;
    const r = SCREEN_RESOLUTIONS[resKey] || SCREEN_RESOLUTIONS.native;

    const video = { frameRate: { ideal: fps, max: fps } };
    if (r.width) {
      video.width = { ideal: r.width, max: r.width };
      video.height = { ideal: r.height, max: r.height };
    } else {
      // sem limite: pega a resolução real do monitor (até 8K)
      video.width = { max: 7680 };
      video.height = { max: 4320 };
    }
    const audio = wantAudio
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48000,
          suppressLocalAudioPlayback: false,
          // Chrome: não captura o áudio que ESTA página toca (a voz da call) → sem eco
          restrictOwnAudio: opt.restrictOwnAudio ?? st.restrictOwnAudio,
        }
      : false;

    const base = {
      video,
      audio,
      systemAudio: wantAudio ? 'include' : 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
      preferCurrentTab: false,
    };
    let captured;
    try {
      // Navegadores novos: ao escolher uma JANELA (ex.: Valorant), captura só o áudio dela
      captured = await navigator.mediaDevices.getDisplayMedia({ ...base, windowAudio: wantAudio ? 'window' : 'exclude' });
    } catch (err) {
      if (err.name !== 'TypeError') throw err;
      captured = await navigator.mediaDevices.getDisplayMedia(base);
    }
    const vt = captured.getVideoTracks()[0];
    vt.contentHint = content === 'detail' ? 'detail' : 'motion';
    const surface = vt.getSettings().displaySurface;
    const n = ++this.screenCounter;
    const stream = new MediaStream([vt]);
    const scr = {
      id: stream.id,
      n,
      name: opt.name?.trim() || `Tela ${n}`,
      track: vt,
      stream,
      surface,
      res: resKey,
      fps,
      content,
      audioSourceId: null,
      opts: this._screenOpts(r, fps, content),
    };
    this.screens.set(scr.id, scr);
    vt.addEventListener('ended', () => this.stopScreen(scr.id));
    this.onPublish(vt, stream, scr.opts);

    const at = captured.getAudioTracks()[0];
    if (at) {
      const s = this._addAudioSource({
        kind: 'screen',
        label: `${scr.name} — áudio da ${SURFACE_LABEL[surface] || 'captura'}`,
        rawStream: new MediaStream([at]),
        transmit: true,
        screenId: scr.id,
      });
      scr.audioSourceId = s.id;
    }
    this.onChange();
    return scr;
  }

  _screenOpts(r, fps, content) {
    const cap = Math.min(r.kbps, settings().maxBitrateKbps || r.kbps);
    return {
      maxBitrate: cap * 1000,
      maxFramerate: fps,
      degradationPreference: content === 'detail' ? 'maintain-resolution' : 'maintain-framerate',
      priority: 'high',
    };
  }

  async updateScreen(id, { res, fps, content, name }) {
    const scr = this.screens.get(id);
    if (!scr) return;
    if (name) scr.name = name.trim() || scr.name;
    if (res) scr.res = res;
    if (fps) scr.fps = Number(fps);
    if (content) scr.content = content;
    const r = SCREEN_RESOLUTIONS[scr.res] || SCREEN_RESOLUTIONS.native;
    const c = { frameRate: { ideal: scr.fps, max: scr.fps } };
    if (r.width) Object.assign(c, { width: { ideal: r.width, max: r.width }, height: { ideal: r.height, max: r.height } });
    else Object.assign(c, { width: { max: 7680 }, height: { max: 4320 } });
    await scr.track.applyConstraints(c).catch(() => {});
    scr.track.contentHint = scr.content === 'detail' ? 'detail' : 'motion';
    scr.opts = this._screenOpts(r, scr.fps, scr.content);
    this.onUpdateOpts(scr.track, scr.opts);
    this.onChange();
  }

  stopScreen(id) {
    const scr = this.screens.get(id);
    if (!scr) return;
    this.screens.delete(id);
    if (scr.audioSourceId) this.removeSource(scr.audioSourceId);
    this.onUnpublish(scr.track);
    scr.track.stop();
    this.onChange();
  }

  // Metadados enviados aos outros para saberem o que é cada stream
  streamsMeta() {
    const meta = {};
    if (this.camera) meta[this.camera.stream.id] = { type: 'camera' };
    for (const s of this.screens.values()) meta[s.id] = { type: 'screen', name: s.name, surface: s.surface, coop: s.coop || null };
    for (const a of this.sources.values()) meta[a.stream.id] = { type: 'audio', source: a.kind, screenId: a.screenId, label: a.label };
    return meta;
  }

  destroy() {
    clearInterval(this.loop);
    for (const id of [...this.screens.keys()]) this.stopScreen(id);
    this.stopCamera();
    for (const id of [...this.sources.keys()]) this.removeSource(id);
    this.ctx.close().catch(() => {});
  }
}
