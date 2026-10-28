// KenBeat 🎧 — bot de música. Toca vídeos do YouTube sincronizados para todo mundo do canal de voz
// (cada navegador toca o player do YouTube no mesmo ponto; o servidor só guarda a fila e o relógio).
const guild = require('./guild');
const stats = require('./stats');

const BOT = { name: 'KenBeat', icon: '🎧' };
const START_DELAY = 1500; // tempo para todos carregarem o vídeo antes de começar
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------------- YouTube ----------------
function parseYouTube(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return { videoId: s };
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
  let videoId = null;
  if (host === 'youtu.be') videoId = u.pathname.slice(1, 12);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    videoId = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/) || [])[1] || null;
  } else return null;
  const listId = u.searchParams.get('list');
  const t = u.searchParams.get('t') || u.searchParams.get('start');
  const start = t ? (/^\d+$/.test(t) ? Number(t) : (Number(t.match(/(\d+)m/)?.[1] || 0) * 60 + Number(t.match(/(\d+)s/)?.[1] || 0))) : 0;
  if (videoId && !/^[\w-]{11}$/.test(videoId)) videoId = null;
  if (!videoId && !listId) return null;
  return { videoId, listId, start };
}

async function get(url, ms = 8000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: 'CONSENT=YES+1' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
const unescape = (s) => {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
};
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

async function videoInfo(videoId) {
  const base = { videoId, title: 'Vídeo do YouTube', author: '', duration: 0, thumb: thumb(videoId) };
  try {
    const html = await get(`https://www.youtube.com/watch?v=${videoId}&hl=pt-BR`);
    const details = html.match(/"videoDetails":\{"videoId":"[\w-]{11}","title":"((?:[^"\\]|\\.)*)","lengthSeconds":"(\d+)"/);
    const author = html.match(/"videoDetails":\{.*?"author":"((?:[^"\\]|\\.)*)"/s);
    if (details) return { ...base, title: unescape(details[1]), duration: Number(details[2]), author: author ? unescape(author[1]) : '' };
  } catch {}
  try {
    const o = JSON.parse(await get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, 5000));
    return { ...base, title: o.title || base.title, author: o.author_name || '' };
  } catch {}
  return base; // o player de quem estiver na call manda título e duração depois
}

async function search(q) {
  const html = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D&hl=pt-BR`);
  const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/);
  if (!m) throw new Error('nada encontrado');
  return m[1];
}

async function playlist(listId) {
  const html = await get(`https://www.youtube.com/playlist?list=${listId}&hl=pt-BR`);
  const out = [];
  const re = /"playlistVideoRenderer":\{"videoId":"([\w-]{11})".*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"\}\].*?(?:"lengthSeconds":"(\d+)")?/gs;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) && out.length < 50) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ videoId: m[1], title: unescape(m[2]), author: '', duration: Number(m[3] || 0), thumb: thumb(m[1]) });
  }
  return out;
}

// texto do comando -> lista de faixas
async function resolve(input) {
  const p = parseYouTube(input);
  if (p?.listId && (!p.videoId || /^(PL|OL)/.test(p.listId))) {
    try {
      const list = await playlist(p.listId);
      if (list.length) {
        if (p.videoId) {
          const i = list.findIndex((x) => x.videoId === p.videoId);
          if (i > 0) list.unshift(...list.splice(i, 1));
        }
        return { tracks: list, playlist: true };
      }
    } catch {}
    if (!p.videoId) throw new Error('Não consegui abrir essa playlist (ela é pública?).');
  }
  if (p?.videoId) return { tracks: [{ ...(await videoInfo(p.videoId)), start: p.start || 0 }] };
  if (/^https?:\/\//i.test(String(input).trim())) throw new Error('Por enquanto só links do YouTube (youtube.com ou youtu.be).');
  let id;
  try {
    id = await search(input);
  } catch {
    throw new Error(`Não achei "${input}" no YouTube. Tente colar o link do vídeo.`);
  }
  return { tracks: [await videoInfo(id)] };
}

// ---------------- estado por canal de voz ----------------
function attachMusic(io, hub, { postBot }) {
  const states = new Map(); // channelId -> estado

  const pub = (st) =>
    st && {
      channelId: st.channelId,
      groupId: st.groupId,
      current: st.current,
      queue: st.queue.slice(0, 50),
      queueLength: st.queue.length,
      startedAt: st.startedAt,
      pausedAt: st.pausedAt,
      loop: st.loop,
      now: Date.now(),
      bot: BOT,
    };
  const emit = (st) => {
    const ch = guild.getChannel(st.channelId);
    if (ch) hub.emitToChannel(ch, 'music:state', pub(st) || { channelId: st.channelId, groupId: st.groupId, current: null, queue: [], bot: BOT, now: Date.now() });
  };
  const stateOf = (ch) => {
    if (!states.has(ch.id)) states.set(ch.id, { channelId: ch.id, groupId: ch.group_id, queue: [], current: null, startedAt: 0, pausedAt: null, loop: 'off', timer: null, textChannelId: null });
    return states.get(ch.id);
  };
  const position = (st) => (st.current ? Math.max(0, ((st.pausedAt ?? Date.now()) - st.startedAt) / 1000) : 0);

  function schedule(st) {
    clearTimeout(st.timer);
    if (!st.current || st.pausedAt || !st.current.duration) return;
    const left = st.current.duration * 1000 - (Date.now() - st.startedAt) + 1200;
    st.timer = setTimeout(() => next(st, true), Math.max(500, left));
  }

  function start(st, track, offset = 0) {
    st.current = track;
    st.startedAt = Date.now() + START_DELAY - (offset || track.start || 0) * 1000;
    st.pausedAt = null;
    schedule(st);
    emit(st);
  }

  function next(st, natural = false) {
    clearTimeout(st.timer);
    const prev = st.current;
    if (prev && natural && st.loop === 'track') return start(st, prev);
    if (prev && st.loop === 'queue') st.queue.push({ ...prev, start: 0 });
    const t = st.queue.shift();
    if (!t) {
      st.current = null;
      emit(st);
      if (natural && st.textChannelId) postBot(st.groupId, st.textChannelId, { bot: 'music', text: 'A fila acabou. Manda mais com **/botmusic** 🎶' });
      return;
    }
    start(st, t);
    if (st.textChannelId) postBot(st.groupId, st.textChannelId, { bot: 'music', kind: 'now', text: 'Tocando agora', track: t });
  }

  function stop(st) {
    clearTimeout(st.timer);
    st.queue = [];
    st.current = null;
    emit(st);
    states.delete(st.channelId);
  }

  // canal de voz em que a pessoa está (o bot toca lá)
  const callChannelOf = (userId) => {
    for (const [cid, c] of hub.calls) if ([...c.values()].some((x) => x.userId === userId)) return guild.getChannel(cid);
    return null;
  };

  // ações usadas pelos comandos (/botmusic etc.) e pelos botões do bloco do bot
  const api = {
    BOT,
    parseYouTube,
    callChannelOf,
    get: (channelId) => states.get(channelId),
    position,
    async play(userId, groupId, textChannelId, query) {
      const ch = callChannelOf(userId);
      if (!ch || ch.group_id !== groupId) throw new Error('Entre num canal de voz deste grupo primeiro — o KenBeat toca na call em que você estiver.');
      if (!String(query || '').trim()) throw new Error('Use assim: /botmusic <link do YouTube ou nome da música>');
      const { tracks, playlist } = await resolve(query);
      const by = { id: userId, name: require('./db').db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || 'Alguém' };
      const st = stateOf(ch);
      st.textChannelId = textChannelId || st.textChannelId;
      const list = tracks.map((t) => ({ ...t, by, key: Math.random().toString(36).slice(2, 10) }));
      if (st.queue.length + list.length > 200) throw new Error('A fila está cheia (200 músicas).');
      stats.track(userId, 'music_play');
      if (!st.current) {
        const [first, ...rest] = list;
        st.queue.push(...rest);
        start(st, first);
        return { now: first, added: rest.length, playlist, channel: ch };
      }
      st.queue.push(...list);
      emit(st);
      return { queued: list[0], added: list.length, position: st.queue.length - list.length + 1, playlist, channel: ch };
    },
    control(userId, channelId, action, arg) {
      const st = states.get(Number(channelId));
      if (!st) throw new Error('Não tem música tocando aqui.');
      const ch = callChannelOf(userId);
      if (!ch || ch.id !== st.channelId) throw new Error('Entre na call onde a música está tocando para controlar.');
      switch (action) {
        case 'skip':
          next(st);
          stats.track(userId, 'music_skip');
          return st.current ? `⏭️ Pulou! Agora: **${st.current.title}**` : '⏭️ Pulou! A fila acabou.';
        case 'pause':
          if (!st.current || st.pausedAt) return 'Já está pausado.';
          st.pausedAt = Date.now();
          clearTimeout(st.timer);
          emit(st);
          return '⏸️ Pausado.';
        case 'resume':
          if (!st.current || !st.pausedAt) return 'Já está tocando.';
          st.startedAt += Date.now() - st.pausedAt;
          st.pausedAt = null;
          schedule(st);
          emit(st);
          return '▶️ Continuando.';
        case 'toggle':
          return api.control(userId, channelId, st.pausedAt ? 'resume' : 'pause');
        case 'stop':
          stop(st);
          return '⏹️ Parei a música e limpei a fila. Até mais! 👋';
        case 'shuffle':
          for (let i = st.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [st.queue[i], st.queue[j]] = [st.queue[j], st.queue[i]];
          }
          emit(st);
          return `🔀 Fila embaralhada (${st.queue.length}).`;
        case 'loop': {
          const modes = ['off', 'track', 'queue'];
          st.loop = modes.includes(arg) ? arg : modes[(modes.indexOf(st.loop) + 1) % 3];
          emit(st);
          return { off: '➡️ Repetição desligada.', track: '🔂 Repetindo esta música.', queue: '🔁 Repetindo a fila.' }[st.loop];
        }
        case 'remove': {
          const i = Number(arg) - 1;
          if (!(i >= 0 && i < st.queue.length)) throw new Error(`Número inválido (a fila tem ${st.queue.length}).`);
          const [t] = st.queue.splice(i, 1);
          emit(st);
          return `🗑️ Tirei **${t.title}** da fila.`;
        }
        case 'seek': {
          if (!st.current) throw new Error('Nada tocando.');
          const sec = Math.max(0, Number(arg) || 0);
          st.startedAt = (st.pausedAt ?? Date.now()) - sec * 1000;
          schedule(st);
          emit(st);
          return null;
        }
        default:
          throw new Error('Ação inválida.');
      }
    },
  };

  // o player de quem está na call avisa: duração/título, fim do vídeo, erro (vídeo que não deixa tocar fora do YouTube)
  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    for (const st of states.values()) {
      const ch = guild.getChannel(st.channelId);
      if (ch && require('./routes').isMember(ch.group_id, userId) && guild.access(ch, userId).see) socket.emit('music:state', pub(st));
    }
    const mine = (p) => {
      const st = states.get(Number(p.channelId));
      return st && st.current && st.current.videoId === p.videoId && socket.data.callChannel === st.channelId ? st : null;
    };
    socket.on('music:meta', (p = {}) => {
      const st = mine(p);
      if (!st) return;
      let changed = false;
      const d = Number(p.duration);
      if (!st.current.duration && d > 0 && d < 24 * 3600) {
        st.current.duration = Math.round(d);
        schedule(st);
        changed = true;
      }
      if (st.current.title === 'Vídeo do YouTube' && p.title) {
        st.current.title = String(p.title).slice(0, 200);
        st.current.author = String(p.author || '').slice(0, 100);
        changed = true;
      }
      if (changed) emit(st);
    });
    socket.on('music:ended', (p = {}) => {
      const st = mine(p);
      if (st && !st.pausedAt && position(st) > Math.max(5, (st.current.duration || 0) - 4)) next(st, true);
    });
    socket.on('music:error', (p = {}) => {
      const st = mine(p);
      if (!st || ![2, 5, 100, 101, 150].includes(Number(p.code))) return;
      const t = st.current;
      if (st.textChannelId) postBot(st.groupId, st.textChannelId, { bot: 'music', text: `⚠️ **${t.title}** não pode ser tocado fora do YouTube (o dono bloqueou). Pulando…` });
      next(st);
    });
    socket.on('music:control', (p = {}, ack) => {
      const st = states.get(Number(p.channelId));
      if (!st) return ack?.({ error: 'Não tem música tocando aqui.' });
      if (!guild.can(st.groupId, userId, 'music')) return ack?.({ error: 'Sua classe não pode controlar o bot de música.' });
      try {
        const text = api.control(userId, p.channelId, String(p.action), p.arg);
        ack?.({ ok: true, text });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });
  });

  // call ficou vazia: o bot sai depois de 1 minuto sozinho
  hub.onCallLeft = (channelId) => {
    const st = states.get(channelId);
    if (!st || hub.calls.get(channelId)?.size) return;
    clearTimeout(st.idle);
    st.idle = setTimeout(() => !hub.calls.get(channelId)?.size && states.has(channelId) && stop(st), 60e3);
  };
  hub.onCallJoined = (channelId) => clearTimeout(states.get(channelId)?.idle);
  hub.onChannelClosed = (channelId) => states.get(channelId) && stop(states.get(channelId));
  return api;
}

module.exports = { attachMusic, parseYouTube, BOT };
