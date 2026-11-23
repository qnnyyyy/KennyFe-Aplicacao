// 🍿 Assistir junto: um vídeo (YouTube ou link de arquivo) tocando no mesmo ponto para todo mundo da call.
// Igual ao KenBeat, cada navegador toca o vídeo sozinho; o servidor só guarda o vídeo, a fila e o relógio.
const guild = require('./guild');
const stats = require('./stats');
const { db } = require('./db');
const { resolve } = require('./music');

const START_DELAY = 2500; // tempo para todo mundo carregar antes de começar
const EMPTY_STOP = 10 * 60e3; // call vazia: guarda a sessão pausada por 10 min
const REACTIONS = ['😂', '😱', '😍', '🔥', '👏', '😭', '🍿', '💀', '❤️', '🤯', '👀', '😡'];
const FILE_RE = /\.(mp4|webm|m4v|mov|ogv|ogg)(?:[?#]|$)/i;

// link direto de vídeo (ou um vídeo que alguém mandou no chat)
function fileItem(input) {
  const s = String(input || '').trim();
  if (/^\/uploads\/[\w.-]+$/.test(s) && FILE_RE.test(s)) return { kind: 'file', url: s, title: decodeURIComponent(s.split('/').pop()) };
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !FILE_RE.test(u.pathname)) return null;
  return { kind: 'file', url: u.href, title: decodeURIComponent(u.pathname.split('/').pop() || 'Vídeo').slice(0, 120) };
}

function attachWatch(io, hub, { postBot } = {}) {
  const states = new Map(); // channelId -> sessão

  const pub = (st) => ({
    channelId: st.channelId,
    groupId: st.groupId,
    current: st.current,
    queue: st.queue.slice(0, 30),
    queueLength: st.queue.length,
    startedAt: st.startedAt,
    pausedAt: st.pausedAt,
    lock: st.lock,
    now: Date.now(),
  });
  const emit = (st) => {
    const ch = guild.getChannel(st.channelId);
    if (ch) hub.emitToChannel(ch, 'watch:state', st.current ? pub(st) : { channelId: st.channelId, groupId: st.groupId, current: null, queue: [], now: Date.now() });
  };
  const position = (st) => (st.current ? Math.max(0, ((st.pausedAt ?? Date.now()) - st.startedAt) / 1000) : 0);
  const nameOf = (userId) => db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || 'Alguém';

  function schedule(st) {
    clearTimeout(st.timer);
    if (!st.current || st.pausedAt || !st.current.duration) return;
    const left = st.current.duration * 1000 - (Date.now() - st.startedAt) + 2500;
    st.timer = setTimeout(() => next(st, true), Math.max(1000, left));
  }

  function start(st, item) {
    st.current = item;
    st.startedAt = Date.now() + START_DELAY - (item.start || 0) * 1000;
    st.pausedAt = null;
    schedule(st);
    emit(st);
  }

  function next(st) {
    clearTimeout(st.timer);
    const it = st.queue.shift();
    if (!it) {
      // acabou: deixa o último vídeo parado no fim (a pessoa decide se fecha ou põe outro)
      if (st.current) {
        st.pausedAt = Date.now();
        st.startedAt = st.pausedAt - (st.current.duration || position(st)) * 1000;
        st.ended = true;
      }
      return emit(st);
    }
    st.ended = false;
    start(st, it);
  }

  function stop(st) {
    clearTimeout(st.timer);
    clearTimeout(st.idle);
    st.current = null;
    st.queue = [];
    emit(st);
    states.delete(st.channelId);
  }

  const stateOf = (ch) => {
    if (!states.has(ch.id)) states.set(ch.id, { channelId: ch.id, groupId: ch.group_id, current: null, queue: [], startedAt: 0, pausedAt: null, lock: null, timer: null, idle: null });
    return states.get(ch.id);
  };

  // quem pode mexer: todo mundo da call, a não ser que quem começou tenha travado (admins sempre podem)
  const canControl = (st, userId) => !st.lock || st.lock === userId || guild.can(st.groupId, userId, 'move_members');

  const callChannelOf = (userId, socket) => {
    if (socket?.data.callChannel) return guild.getChannel(socket.data.callChannel);
    for (const [cid, c] of hub.calls) if ([...c.values()].some((x) => x.userId === userId)) return guild.getChannel(cid);
    return null;
  };

  const api = {
    get: (channelId) => states.get(channelId),
    position,
    // começa (ou põe na fila) um vídeo na call em que a pessoa está
    async play(userId, input, { now = false, socket = null, textChannelId = null } = {}) {
      const ch = callChannelOf(userId, socket);
      if (!ch) throw new Error('Entre num canal de voz primeiro — a sessão acontece na call em que você estiver.');
      const q = String(input || '').trim();
      if (!q) throw new Error('Cole um link do YouTube (ou de um arquivo .mp4/.webm), ou escreva o nome do vídeo.');
      let items;
      const f = fileItem(q);
      if (f) items = [f];
      else {
        if (/^https?:\/\//i.test(q) && !/youtu\.?be/i.test(q)) throw new Error('Esse link não toca aqui. Use YouTube ou um link direto de vídeo (.mp4/.webm). Netflix, Prime e afins: compartilhe a tela no modo 🍿 Filme / Série.');
        const { tracks } = await resolve(q);
        items = tracks.slice(0, 50).map((t) => ({ kind: 'youtube', videoId: t.videoId, title: t.title, author: t.author, duration: t.duration, thumb: t.thumb, start: t.start || 0 }));
      }
      const by = { id: userId, name: nameOf(userId) };
      items = items.map((it) => ({ ...it, by, key: Math.random().toString(36).slice(2, 10) }));
      const st = stateOf(ch);
      if (st.lock && !canControl(st, userId)) throw new Error('A sessão está travada: só quem começou pode trocar o vídeo.');
      if (st.queue.length + items.length > 100) throw new Error('A fila está cheia (100 vídeos).');
      stats.track(userId, 'watch_start');
      if (textChannelId && guild.getChannel(textChannelId)?.group_id === ch.group_id) st.textChannelId = textChannelId;
      if (!st.current || now || st.ended) {
        const [first, ...rest] = items;
        st.queue.unshift(...rest);
        st.ended = false;
        start(st, first);
        if (postBot && st.textChannelId) postBot(st.groupId, st.textChannelId, { bot: 'watch', kind: 'now', channelId: ch.id, text: `🍿 Sessão começou em **${ch.name}** — entra na call pra assistir junto!`, track: first }, userId);
        return { now: first, added: rest.length, channel: ch };
      }
      st.queue.push(...items);
      emit(st);
      return { queued: items[0], added: items.length, position: st.queue.length - items.length + 1, channel: ch };
    },
    control(userId, channelId, action, arg) {
      const st = states.get(Number(channelId));
      if (!st?.current) throw new Error('Não tem sessão rolando nesta call.');
      if (!canControl(st, userId) && action !== 'lock') throw new Error(`A sessão está travada por ${nameOf(st.lock)}.`);
      switch (action) {
        case 'pause':
          if (st.pausedAt) return null;
          st.pausedAt = Date.now();
          clearTimeout(st.timer);
          break;
        case 'play':
          if (!st.pausedAt) return null;
          if (st.ended) st.startedAt = Date.now() + 800;
          else st.startedAt += Date.now() - st.pausedAt + 800; // meio segundo para todo mundo sair do pause junto
          st.pausedAt = null;
          st.ended = false;
          schedule(st);
          break;
        case 'toggle':
          return api.control(userId, channelId, st.pausedAt ? 'play' : 'pause');
        case 'seek': {
          const sec = Math.max(0, Math.min(Number(arg) || 0, st.current.duration ? st.current.duration - 1 : 1e9));
          st.startedAt = (st.pausedAt ?? Date.now() + 600) - sec * 1000;
          st.ended = false;
          schedule(st);
          break;
        }
        case 'skip':
          next(st);
          return null;
        case 'stop':
          stop(st);
          return null;
        case 'remove': {
          const i = Number(arg);
          if (!(i >= 0 && i < st.queue.length)) throw new Error('Esse vídeo não está mais na fila.');
          st.queue.splice(i, 1);
          break;
        }
        case 'lock':
          // só quem começou (ou admin) trava/destrava
          if (st.lock && st.lock !== userId && !guild.can(st.groupId, userId, 'move_members')) throw new Error('Só quem travou pode destravar.');
          if (!st.lock && st.current.by?.id !== userId && !guild.can(st.groupId, userId, 'move_members')) throw new Error('Só quem começou a sessão pode travar os controles.');
          st.lock = st.lock ? null : userId;
          break;
        default:
          throw new Error('Ação inválida.');
      }
      emit(st);
      return null;
    },
  };

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    for (const st of states.values()) {
      const ch = guild.getChannel(st.channelId);
      if (st.current && ch && require('./routes').isMember(ch.group_id, userId) && guild.access(ch, userId).see) socket.emit('watch:state', pub(st));
    }
    const inCall = (p) => {
      const st = states.get(Number(p.channelId));
      return st && st.current && socket.data.callChannel === st.channelId ? st : null;
    };
    socket.on('watch:start', async (p = {}, ack) => {
      try {
        const r = await api.play(userId, p.input, { now: Boolean(p.now), socket, textChannelId: Number(p.textChannelId) || null });
        ack?.({ ok: true, now: r.now?.title, queued: r.queued?.title, position: r.position, added: r.added });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });
    socket.on('watch:control', (p = {}, ack) => {
      if (socket.data.callChannel !== Number(p.channelId)) return ack?.({ error: 'Entre na call para controlar a sessão.' });
      try {
        api.control(userId, p.channelId, String(p.action), p.arg);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });
    // o player conta a duração/título que o servidor não conseguiu descobrir
    socket.on('watch:meta', (p = {}) => {
      const st = inCall(p);
      if (!st || st.current.key !== p.key) return;
      let changed = false;
      const d = Number(p.duration);
      if (!st.current.duration && d > 0 && d < 24 * 3600) {
        st.current.duration = Math.round(d);
        schedule(st);
        changed = true;
      }
      if (p.title && (st.current.title === 'Vídeo do YouTube' || !st.current.title)) {
        st.current.title = String(p.title).slice(0, 200);
        changed = true;
      }
      if (changed) emit(st);
    });
    socket.on('watch:ended', (p = {}) => {
      const st = inCall(p);
      if (st && st.current.key === p.key && !st.pausedAt && position(st) > Math.max(5, (st.current.duration || 0) - 5)) next(st);
    });
    socket.on('watch:error', (p = {}) => {
      const st = inCall(p);
      if (!st || st.current.key !== p.key || st.erroredKey === p.key) return;
      st.erroredKey = p.key;
      const blocked = [100, 101, 150, 'embed'].includes(p.code);
      io.to(`call:${st.channelId}`).emit('watch:notice', { text: blocked ? `⚠️ "${st.current.title}" não deixa tocar fora do YouTube. Pulando…` : `⚠️ Não deu para tocar "${st.current.title}". Pulando…` });
      next(st);
    });
    // reações flutuantes por cima do vídeo (para todo mundo da call)
    let lastReact = 0;
    socket.on('watch:react', (p = {}) => {
      const channelId = socket.data.callChannel;
      if (!channelId || !REACTIONS.includes(p.emoji)) return;
      const now = Date.now();
      if (now - lastReact < 180) return;
      lastReact = now;
      io.to(`call:${channelId}`).emit('watch:react', { userId, emoji: p.emoji, x: Math.max(0.05, Math.min(0.95, Number(p.x) || Math.random())) });
    });
  });

  // call ficou vazia: pausa (ninguém perde o ponto) e encerra depois de 10 min
  const prevLeft = hub.onCallLeft;
  const prevJoined = hub.onCallJoined;
  const prevClosed = hub.onChannelClosed;
  hub.onCallLeft = (channelId) => {
    prevLeft?.(channelId);
    const st = states.get(channelId);
    if (!st || hub.calls.get(channelId)?.size) return;
    if (st.current && !st.pausedAt) {
      st.pausedAt = Date.now();
      clearTimeout(st.timer);
      emit(st);
    }
    clearTimeout(st.idle);
    st.idle = setTimeout(() => !hub.calls.get(channelId)?.size && states.has(channelId) && stop(st), EMPTY_STOP);
  };
  hub.onCallJoined = (channelId) => {
    prevJoined?.(channelId);
    clearTimeout(states.get(channelId)?.idle);
  };
  hub.onChannelClosed = (channelId) => {
    prevClosed?.(channelId);
    if (states.get(channelId)) stop(states.get(channelId));
  };
  return api;
}

module.exports = { attachWatch, REACTIONS, fileItem };
