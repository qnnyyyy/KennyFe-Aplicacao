// Saída de áudio da call: volume por pessoa (0–200%), volume por transmissão,
// silenciar localmente, ensurdecer, escolher o alto-falante e detectar quem fala.
// Modo anti-eco (padrão no celular): a voz toca direto num <audio>, porque o cancelamento
// de eco do celular não "enxerga" o som que passa pelo Web Audio e a outra pessoa ouve eco.
import { store, save, bgInterval, clearBgInterval } from '../ui.js';

export class AudioOut {
  constructor({ onSpeaking, elementMode = false }) {
    this.elementMode = elementMode;
    this.sinkId = '';
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.onSpeaking = onSpeaking;
    this.tracks = new Map(); // trackId -> entrada
    this.userVol = store('user-volume', {}); // userId -> 0..2
    this.userMute = store('user-mute', {}); // userId -> bool
    this.streamVol = new Map(); // screenStreamId -> 0..2
    this.deafened = false;
    this.speaking = new Map(); // peerId -> bool
    this.buf = new Float32Array(1024);
    this.loop = bgInterval(() => this.tick(), 50);
    // o navegador pode suspender o áudio (celular em segundo plano, aba sem foco): volta sozinho
    this.ctx.addEventListener('statechange', () => this.ctx.state !== 'running' && this.ctx.state !== 'closed' && this.resume());
  }

  resume() {
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
    if (this.elementMode) for (const e of this.tracks.values()) if (e.el.paused) e.el.play().catch(() => {});
  }

  async setOutputDevice(deviceId) {
    try {
      this.sinkId = deviceId === 'default' ? '' : deviceId;
      if (this.elementMode) for (const e of this.tracks.values()) await e.el.setSinkId?.(this.sinkId).catch(() => {});
      else if (this.ctx.setSinkId) await this.ctx.setSinkId(this.sinkId);
    } catch (err) {
      console.warn('setSinkId', err);
    }
  }

  // kind: 'mic' (voz) ou 'screen' (áudio de transmissão)
  attach({ peerId, userId, track, stream, kind = 'mic', screenId = null }) {
    if (this.tracks.has(track.id)) return this.reclassify(track.id, kind, screenId);
    const ms = new MediaStream([track]);
    // Chrome só "puxa" áudio WebRTC para o Web Audio se houver um <audio> ligado a ele
    const elx = new Audio();
    elx.autoplay = true;
    elx.playsInline = true;
    elx.muted = !this.elementMode || this.deafened;
    elx.srcObject = ms;
    if (this.elementMode && this.sinkId) elx.setSinkId?.(this.sinkId).catch(() => {});
    elx.play().catch(() => {});
    const src = this.ctx.createMediaStreamSource(ms);
    const gain = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    // no modo anti-eco o Web Audio só "escuta" para saber quem está falando
    if (!this.elementMode) {
      src.connect(gain);
      gain.connect(this.master);
    }
    const entry = { peerId, userId, track, stream, kind, screenId, el: elx, src, gain, analyser, lastLoud: 0 };
    this.tracks.set(track.id, entry);
    this.applyGain(entry);
    return entry;
  }

  reclassify(trackId, kind, screenId) {
    const e = this.tracks.get(trackId);
    if (!e) return;
    e.kind = kind;
    e.screenId = screenId;
    this.applyGain(e);
    return e;
  }

  detach(trackId) {
    const e = this.tracks.get(trackId);
    if (!e) return;
    this.tracks.delete(trackId);
    try {
      e.src.disconnect();
      e.gain.disconnect();
    } catch {}
    e.el.srcObject = null;
  }

  detachPeer(peerId) {
    for (const [id, e] of this.tracks) if (e.peerId === peerId) this.detach(id);
    this.speaking.delete(peerId);
  }

  applyGain(e) {
    let v;
    if (this.userMute[e.userId]) v = 0;
    else if (e.kind === 'screen') v = this.streamVol.get(e.screenId) ?? 1;
    else v = this.userVol[e.userId] ?? 1;
    if (this.elementMode) {
      e.el.volume = Math.max(0, Math.min(1, v)); // <audio> vai até 100%
      e.el.muted = this.deafened || v === 0;
      return;
    }
    e.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  applyAll() {
    this.tracks.forEach((e) => this.applyGain(e));
  }

  getUserVolume(userId) {
    return this.userVol[userId] ?? 1;
  }
  setUserVolume(userId, v) {
    this.userVol[userId] = v;
    save('user-volume', this.userVol);
    this.applyAll();
  }
  isUserMuted(userId) {
    return Boolean(this.userMute[userId]);
  }
  setUserMuted(userId, m) {
    this.userMute[userId] = m;
    save('user-mute', this.userMute);
    this.applyAll();
  }
  getStreamVolume(screenId) {
    return this.streamVol.get(screenId) ?? 1;
  }
  setStreamVolume(screenId, v) {
    this.streamVol.set(screenId, v);
    this.applyAll();
  }
  hasStreamAudio(screenId) {
    for (const e of this.tracks.values()) if (e.screenId === screenId && e.kind === 'screen') return true;
    return false;
  }

  setDeafened(d) {
    this.deafened = d;
    if (this.elementMode) this.applyAll();
    this.master.gain.setTargetAtTime(d ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  tick() {
    const now = performance.now();
    const speakingNow = new Map();
    for (const e of this.tracks.values()) {
      if (e.kind !== 'mic') continue;
      e.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const db = 20 * Math.log10(Math.sqrt(sum / this.buf.length) + 1e-9);
      if (db > -50) e.lastLoud = now;
      if (now - e.lastLoud < 250) speakingNow.set(e.peerId, true);
    }
    const peers = new Set([...this.speaking.keys(), ...speakingNow.keys()]);
    for (const p of peers) {
      const s = Boolean(speakingNow.get(p));
      if (s !== Boolean(this.speaking.get(p))) {
        this.speaking.set(p, s);
        this.onSpeaking?.(p, s);
      }
    }
  }

  destroy() {
    clearBgInterval(this.loop);
    for (const id of [...this.tracks.keys()]) this.detach(id);
    this.ctx.close().catch(() => {});
  }
}
