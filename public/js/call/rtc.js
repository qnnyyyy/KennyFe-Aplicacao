// Conexões WebRTC em malha (cada participante conecta direto com os outros).
// Usa o padrão "perfect negotiation" para renegociar sem conflito quando
// alguém liga/desliga câmera, adiciona uma segunda tela, etc.

const VIDEO_CODECS = ['video/AV1', 'video/VP9', 'video/H264', 'video/VP8'];

function mergeFmtp(line, params) {
  // line: "a=fmtp:111 minptime=10;useinbandfec=1"
  const [head, ...rest] = line.split(' ');
  const map = new Map();
  rest.join(' ').split(';').filter(Boolean).forEach((kv) => {
    const [k, v] = kv.split('=');
    map.set(k.trim(), v);
  });
  for (const [k, v] of Object.entries(params)) map.set(k, String(v));
  return `${head} ${[...map].map(([k, v]) => (v === undefined ? k : `${k}=${v}`)).join(';')}`;
}

function setCodecParams(sdp, codecRegex, params) {
  const lines = sdp.split('\r\n');
  const pts = [];
  lines.forEach((l) => {
    const m = l.match(/^a=rtpmap:(\d+) ([^/]+)\//);
    if (m && codecRegex.test(m[2])) pts.push(m[1]);
  });
  for (const pt of pts) {
    const idx = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
    if (idx >= 0) lines[idx] = mergeFmtp(lines[idx], params);
    else {
      const r = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
      lines.splice(r + 1, 0, mergeFmtp(`a=fmtp:${pt} `, params).replace(/ $/, ''));
    }
  }
  return lines.join('\r\n');
}

// Ajusta a descrição REMOTA: o que está nela define como NÓS vamos enviar.
// Opus estéreo a 510 kbps com FEC e bitrate inicial alto para vídeo (sem
// aquela "rampa" borrada dos primeiros segundos).
function mungeRemote(desc, settings) {
  if (!desc?.sdp) return desc;
  let sdp = desc.sdp;
  sdp = setCodecParams(sdp, /^opus$/i, {
    stereo: 1,
    'sprop-stereo': 1,
    maxaveragebitrate: 510000,
    maxplaybackrate: 48000,
    useinbandfec: 1,
    usedtx: 0,
  });
  const maxKbps = Math.max(2000, Number(settings().maxBitrateKbps) || 50000);
  sdp = setCodecParams(sdp, /^(VP8|VP9|H264|AV1)$/i, {
    'x-google-start-bitrate': Math.min(6000, maxKbps),
    'x-google-max-bitrate': maxKbps,
  });
  return { type: desc.type, sdp };
}

function orderedVideoCodecs(preferred) {
  const caps = RTCRtpReceiver.getCapabilities?.('video');
  if (!caps) return null;
  const order = [`video/${preferred}`, ...VIDEO_CODECS.filter((c) => c !== `video/${preferred}`)];
  const rank = (c) => {
    const i = order.indexOf(c.mimeType);
    return i < 0 ? 100 : i;
  };
  return [...caps.codecs].sort((a, b) => rank(a) - rank(b));
}

class Peer {
  constructor(mgr, peerId) {
    this.mgr = mgr;
    this.peerId = peerId;
    this.polite = mgr.selfId > peerId;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.senders = new Map(); // trackId -> RTCRtpSender
    this.lastStats = new Map();

    const pc = (this.pc = new RTCPeerConnection({ iceServers: mgr.iceServers, bundlePolicy: 'max-bundle' }));

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        this.applyCodecPrefs();
        await pc.setLocalDescription();
        this.send({ description: pc.localDescription });
      } catch (err) {
        console.warn('[rtc] negotiation', err);
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => candidate && this.send({ candidate });
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      if (!stream.__kfWatched) {
        stream.__kfWatched = true;
        stream.addEventListener('removetrack', (e) => mgr.onTrackRemoved?.(peerId, e.track, stream));
      }
      mgr.onTrack?.(peerId, track, stream);
    };
    pc.onconnectionstatechange = () => {
      mgr.onConnState?.(peerId, pc.connectionState);
      if (pc.connectionState === 'failed') pc.restartIce();
      if (pc.connectionState === 'connected') this.applyAllParams();
    };
    pc.onsignalingstatechange = () => pc.signalingState === 'stable' && this.applyAllParams();

    for (const t of mgr.localTracks.values()) this.addTrack(t);
  }

  send(data) {
    this.mgr.socket.emit('rtc:signal', { to: this.peerId, data: JSON.parse(JSON.stringify(data)) });
  }

  applyCodecPrefs() {
    const codecs = orderedVideoCodecs(this.mgr.settings().codec || 'VP9');
    if (!codecs) return;
    for (const tr of this.pc.getTransceivers()) {
      const kind = tr.receiver.track?.kind || tr.sender.track?.kind;
      if (kind !== 'video' || tr.stopped || !tr.setCodecPreferences) continue;
      try {
        tr.setCodecPreferences(codecs);
      } catch {}
    }
  }

  addTrack(t) {
    if (this.senders.has(t.track.id)) return;
    const sender = this.pc.addTrack(t.track, t.stream);
    this.senders.set(t.track.id, sender);
    this.applyParams(sender, t.opts);
  }

  removeTrack(track) {
    const sender = this.senders.get(track.id);
    if (!sender) return;
    this.senders.delete(track.id);
    try {
      this.pc.removeTrack(sender);
    } catch {}
  }

  async applyParams(sender, opts = {}) {
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      const e = p.encodings[0];
      if (opts.maxBitrate) e.maxBitrate = opts.maxBitrate;
      if (opts.maxFramerate) e.maxFramerate = opts.maxFramerate;
      if (opts.priority) {
        e.priority = opts.priority;
        e.networkPriority = opts.priority;
      }
      if (sender.track?.kind === 'video') e.scaleResolutionDownBy = 1;
      if (opts.degradationPreference) p.degradationPreference = opts.degradationPreference;
      await sender.setParameters(p);
    } catch {
      // Alguns navegadores só aceitam depois da negociação; tentamos de novo quando "stable"
    }
  }

  applyAllParams() {
    for (const [trackId, sender] of this.senders) {
      const t = this.mgr.localTracks.get(trackId);
      if (t) this.applyParams(sender, t.opts);
    }
  }

  async handle({ description, candidate }) {
    const pc = this.pc;
    try {
      if (description) {
        const collision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(mungeRemote(description, this.mgr.settings));
        if (description.type === 'offer') {
          this.applyCodecPrefs();
          await pc.setLocalDescription();
          this.send({ description: pc.localDescription });
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn('[rtc] signal', err);
    }
  }

  // Estatísticas de recepção (resolução, fps, bitrate) por track remota
  async inboundStats() {
    const out = new Map();
    const report = await this.pc.getStats();
    let rtt = null;
    report.forEach((s) => {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated && s.currentRoundTripTime != null) rtt = s.currentRoundTripTime;
    });
    report.forEach((s) => {
      if (s.type !== 'inbound-rtp') return;
      const prev = this.lastStats.get(s.id);
      const kbps = prev ? ((s.bytesReceived - prev.bytes) * 8) / (s.timestamp - prev.ts) : 0;
      this.lastStats.set(s.id, { bytes: s.bytesReceived, ts: s.timestamp });
      const codec = s.codecId ? report.get(s.codecId)?.mimeType?.split('/')[1] : '';
      out.set(s.trackIdentifier, {
        kind: s.kind,
        width: s.frameWidth,
        height: s.frameHeight,
        fps: s.framesPerSecond,
        kbps: Math.round(kbps),
        codec,
        lost: s.packetsLost,
        rtt: rtt != null ? Math.round(rtt * 1000) : null,
      });
    });
    return out;
  }

  close() {
    try {
      this.pc.close();
    } catch {}
  }
}

export class PeerManager {
  constructor({ socket, iceServers, settings, onTrack, onTrackRemoved, onConnState }) {
    this.socket = socket;
    this.iceServers = iceServers;
    this.settings = settings;
    this.onTrack = onTrack;
    this.onTrackRemoved = onTrackRemoved;
    this.onConnState = onConnState;
    this.selfId = null;
    this.peers = new Map();
    this.localTracks = new Map(); // trackId -> { track, stream, opts }
  }

  addPeer(peerId) {
    if (this.peers.has(peerId) || peerId === this.selfId) return this.peers.get(peerId);
    const p = new Peer(this, peerId);
    this.peers.set(peerId, p);
    return p;
  }

  removePeer(peerId) {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
  }

  handleSignal(from, data) {
    const peer = this.peers.get(from) || this.addPeer(from);
    peer?.handle(data);
  }

  addTrack(track, stream, opts = {}) {
    const t = { track, stream, opts };
    this.localTracks.set(track.id, t);
    for (const p of this.peers.values()) p.addTrack(t);
  }

  removeTrack(track) {
    this.localTracks.delete(track.id);
    for (const p of this.peers.values()) p.removeTrack(track);
  }

  updateTrackOpts(track, opts) {
    const t = this.localTracks.get(track.id);
    if (!t) return;
    t.opts = { ...t.opts, ...opts };
    for (const p of this.peers.values()) {
      const s = p.senders.get(track.id);
      if (s) p.applyParams(s, t.opts);
    }
  }

  // Força nova negociação (ex.: trocou o codec preferido)
  renegotiateAll() {
    for (const p of this.peers.values()) p.pc.onnegotiationneeded?.();
  }

  async stats(peerId) {
    return this.peers.get(peerId)?.inboundStats() ?? new Map();
  }

  closeAll() {
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.localTracks.clear();
  }
}
