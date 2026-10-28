// Tempo real (Socket.IO): presença, chat ao vivo por canal e sinalização WebRTC das calls (uma por canal de voz).
const { db } = require('./db');
const auth = require('./auth');
const { isMember, createMessage, messagePayload, groupPayload } = require('./routes');
const stats = require('./stats');
const guild = require('./guild');

// o que a pessoa ligou na call (para as estatísticas): conta cada tela/câmera nova uma vez
function trackStreams(socket, userId, state) {
  const seen = socket.data.seenStreams || (socket.data.seenStreams = new Set());
  for (const [id, m] of Object.entries(state?.streams || {})) {
    if (seen.has(id) || !m || (m.type !== 'screen' && m.type !== 'camera')) continue;
    seen.add(id);
    stats.track(userId, m.type === 'camera' ? 'camera' : 'screen_share');
  }
  for (const [id, m] of Object.entries(state?.streams || {})) {
    const key = 'coop:' + id;
    if (m?.coop && !seen.has(key)) {
      seen.add(key);
      stats.track(userId, 'coop_host');
    }
  }
}

function createHub(io) {
  const online = new Map(); // userId -> Set<socket>
  const calls = new Map(); // channelId -> Map<peerId, { userId, state }>

  const userGroupIds = (userId) => db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(userId).map((r) => r.group_id);

  const callSnapshot = (channelId) => {
    const call = calls.get(channelId);
    if (!call) return [];
    return [...call.entries()].map(([peerId, p]) => ({ peerId, userId: p.userId, state: p.state }));
  };

  // manda um evento só para quem enxerga o canal (canais invisíveis não vazam)
  function emitToChannel(ch, event, data) {
    if (!ch) return;
    if (!ch.hidden) return io.to(`group:${ch.group_id}`).emit(event, data);
    for (const uid of guild.viewers(ch)) for (const s of online.get(uid) || []) s.emit(event, data);
  }

  const emitCallList = (channelId) => {
    const ch = guild.getChannel(channelId);
    if (ch) emitToChannel(ch, 'calls:update', { groupId: ch.group_id, channelId, participants: callSnapshot(channelId) });
  };

  const emitPresence = () => io.emit('presence', { online: [...online.keys()] });

  const hub = {
    usage: null,
    calls,
    online,
    emitToChannel,
    callSnapshot,
    refreshUserGroups(userId) {
      const sockets = online.get(userId);
      if (!sockets) return;
      const groups = db
        .prepare('SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = ? ORDER BY g.created_at')
        .all(userId)
        .map((g) => groupPayload(g, userId));
      for (const s of sockets) {
        groups.forEach((g) => s.join(`group:${g.id}`));
        s.emit('groups:update', { groups });
      }
    },
    broadcastMessage(msg) {
      const ch = msg.channelId && guild.getChannel(msg.channelId);
      if (ch) emitToChannel(ch, 'chat:message', msg);
      else io.to(`group:${msg.groupId}`).emit('chat:message', msg);
    },
    // Manda o perfil atualizado para quem divide algum grupo com o usuário
    broadcastUser(userId) {
      const u = auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
      if (!u) return;
      const ids = new Set([userId]);
      db.prepare(
        `SELECT DISTINCT gm2.user_id AS id FROM group_members gm1 JOIN group_members gm2 ON gm1.group_id = gm2.group_id WHERE gm1.user_id = ?`
      ).all(userId).forEach((r) => ids.add(r.id));
      for (const id of ids) for (const s of online.get(id) || []) s.emit('user:update', { user: u });
    },
    friendsChanged(userIds, event) {
      for (const id of userIds) for (const s of online.get(id) || []) s.emit('friends:update', event);
    },
    leaveGroupRoom(userId, groupId) {
      for (const s of online.get(userId) || []) {
        s.leave(`group:${groupId}`);
        if (s.data.callGroup === groupId) kick(s, 'Você saiu do grupo.');
      }
    },
    socketsInCall(channelId) {
      return [...(calls.get(channelId)?.keys() || [])].map((id) => io.sockets.sockets.get(id)).filter(Boolean);
    },
    // canal apagado: todo mundo sai da call
    closeChannel(channelId) {
      for (const s of hub.socketsInCall(channelId)) kick(s, 'O canal de voz foi apagado.');
      hub.onChannelClosed?.(channelId);
    },
    // classes/canal mudaram: quem perdeu o acesso sai da call
    recheckChannel(channelId) {
      const ch = guild.getChannel(channelId);
      if (!ch) return;
      for (const s of hub.socketsInCall(channelId)) if (!guild.access(ch, s.data.userId).see) kick(s, 'Você perdeu o acesso a esse canal.');
    },
    recheckGroup(groupId) {
      for (const ch of guild.channelsOf(groupId)) if (ch.kind === 'voice') hub.recheckChannel(ch.id);
    },
  };

  function kick(socket, reason) {
    if (!socket.data.callChannel) return;
    leaveCall(socket);
    socket.emit('call:kicked', { reason });
  }

  function leaveCall(socket) {
    const channelId = socket.data.callChannel;
    if (!channelId) return;
    const call = calls.get(channelId);
    hub.usage?.flush(socket.data.userId);
    socket.data.callChannel = null;
    socket.data.callGroup = null;
    socket.leave(`call:${channelId}`);
    if (call) {
      call.delete(socket.id);
      if (!call.size) calls.delete(channelId);
    }
    io.to(`call:${channelId}`).emit('call:peer-left', { peerId: socket.id });
    emitCallList(channelId);
    hub.onCallLeft?.(channelId);
  }

  io.use((socket, next) => {
    const token = auth.parseCookies(socket.handshake.headers.cookie)[auth.COOKIE];
    const user = auth.userFromToken(token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });

  // canal de texto (ou de voz, que também tem chat) onde a pessoa pode escrever
  hub.textChannel = (userId, groupId, channelId, write = true) => {
    const ch = channelId ? guild.getChannel(channelId) : guild.defaultText(groupId);
    if (!ch || ch.group_id !== groupId || !isMember(groupId, userId)) return null;
    const a = guild.access(ch, userId);
    return a.see && (!write || a.enter || ch.kind === 'voice') ? ch : null;
  };

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    if (!online.has(userId)) online.set(userId, new Set());
    online.get(userId).add(socket);
    hub.usage.connected(userId);

    userGroupIds(userId).forEach((gid) => socket.join(`group:${gid}`));
    hub.refreshUserGroups(userId);
    emitPresence();
    // Estado atual de todas as calls que a pessoa enxerga
    for (const gid of userGroupIds(userId))
      for (const ch of guild.channelsOf(gid))
        if (calls.has(ch.id) && guild.access(ch, userId).see) socket.emit('calls:update', { groupId: gid, channelId: ch.id, participants: callSnapshot(ch.id) });

    // ---------- Chat ----------
    socket.on('chat:send', (p = {}, ack) => {
      const groupId = Number(p.groupId);
      if (!isMember(groupId, userId)) return ack?.({ error: 'Sem acesso.' });
      const ch = hub.textChannel(userId, groupId, Number(p.channelId) || null);
      if (!ch) return ack?.({ error: 'Esse canal é só leitura para a sua classe.' });
      const type = ['text', 'sticker', 'gif', 'image', 'file', 'video', 'audio'].includes(p.type) ? p.type : 'text';
      const content = String(p.content || '').slice(0, 4000);
      const mediaUrl = p.mediaUrl && String(p.mediaUrl).startsWith('/uploads/') ? String(p.mediaUrl) : null;
      if (type === 'text' && !content.trim()) return ack?.({ error: 'Mensagem vazia.' });
      if (type !== 'text' && !mediaUrl) return ack?.({ error: 'Mídia inválida.' });
      let replyTo = Number(p.replyTo) || null;
      if (replyTo && !db.prepare('SELECT 1 FROM messages WHERE id = ? AND channel_id = ?').get(replyTo, ch.id)) replyTo = null;
      const msg = createMessage({ groupId, channelId: ch.id, userId, type, content, mediaUrl, replyTo });
      hub.broadcastMessage(msg);
      const isDm = db.prepare('SELECT is_dm FROM groups WHERE id = ?').get(groupId)?.is_dm;
      stats.track(userId, type === 'text' ? (isDm ? 'dm_message' : 'message') : type === 'sticker' || type === 'gif' ? type : 'media');
      ack?.({ message: msg });
    });

    socket.on('chat:typing', (p = {}) => {
      const groupId = Number(p.groupId);
      const ch = hub.textChannel(userId, groupId, Number(p.channelId) || null, false);
      if (!ch) return;
      const data = { groupId, channelId: ch.id, userId };
      if (ch.hidden) {
        for (const uid of guild.viewers(ch)) if (uid !== userId) for (const s of online.get(uid) || []) s.emit('chat:typing', data);
      } else socket.to(`group:${groupId}`).emit('chat:typing', data);
    });

    const msgChannelOk = (m) => {
      const ch = m.channel_id && guild.getChannel(m.channel_id);
      return isMember(m.group_id, userId) && (!ch || guild.access(ch, userId).see);
    };
    const emitUpdate = (id) => {
      const msg = messagePayload(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
      const ch = msg.channelId && guild.getChannel(msg.channelId);
      if (ch) emitToChannel(ch, 'chat:update', msg);
      else io.to(`group:${msg.groupId}`).emit('chat:update', msg);
    };

    socket.on('chat:react', (p = {}) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(p.messageId));
      const emoji = String(p.emoji || '').slice(0, 16);
      if (!m || !emoji || !msgChannelOk(m)) return;
      const exists = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(m.id, userId, emoji);
      if (exists) db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(m.id, userId, emoji);
      else {
        // enquete: um voto por pessoa
        if (m.type === 'poll' && emoji.startsWith('opt:')) db.prepare("DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji LIKE 'opt:%'").run(m.id, userId);
        db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(m.id, userId, emoji);
        stats.track(userId, m.type === 'poll' ? 'poll_vote' : 'reaction');
      }
      emitUpdate(m.id);
    });

    socket.on('chat:edit', (p = {}) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(p.messageId));
      const content = String(p.content || '').slice(0, 4000);
      if (!m || m.user_id !== userId || m.type !== 'text' || !content.trim()) return;
      db.prepare('UPDATE messages SET content = ?, edited_at = unixepoch() WHERE id = ?').run(content, m.id);
      emitUpdate(m.id);
    });

    socket.on('chat:delete', (p = {}) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(p.messageId));
      if (!m || !msgChannelOk(m)) return;
      if (m.user_id !== userId && !guild.can(m.group_id, userId, 'manage_messages')) return;
      db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
      io.to(`group:${m.group_id}`).emit('chat:delete', { id: m.id, groupId: m.group_id, channelId: m.channel_id });
    });

    // ---------- Chamadas (uma por canal de voz) ----------
    socket.on('call:join', (p = {}, ack) => {
      const ch = p.channelId ? guild.getChannel(p.channelId) : guild.defaultVoice(Number(p.groupId));
      if (!ch || ch.kind !== 'voice' || !isMember(ch.group_id, userId)) return ack?.({ error: 'Canal de voz não encontrado.' });
      const a = guild.access(ch, userId);
      if (!a.see) return ack?.({ error: 'Canal de voz não encontrado.' });
      if (!a.enter) return ack?.({ error: 'Essa call está trancada para a sua classe.', locked: true, channelId: ch.id });
      const call = calls.get(ch.id) || new Map();
      const others = [...call.values()].filter((x) => x.userId !== userId).length;
      if (ch.user_limit && others >= ch.user_limit && !a.bypassLimit && socket.data.callChannel !== ch.id)
        return ack?.({ error: `Call lotada (${ch.user_limit} pessoas).`, full: true, channelId: ch.id });
      if (socket.data.callChannel) leaveCall(socket);
      calls.set(ch.id, call);
      const peers = callSnapshot(ch.id);
      const wasEmpty = call.size === 0;
      hub.usage.flush(userId);
      stats.track(userId, 'call');
      trackStreams(socket, userId, p.state);
      call.set(socket.id, { userId, state: p.state || {} });
      socket.data.callChannel = ch.id;
      socket.data.callGroup = ch.group_id;
      socket.join(`call:${ch.id}`);
      socket.to(`call:${ch.id}`).emit('call:peer-joined', { peerId: socket.id, userId, state: p.state || {} });
      emitCallList(ch.id);
      if (wasEmpty) {
        const ring = { groupId: ch.group_id, channelId: ch.id, userId };
        if (ch.hidden) {
          for (const uid of guild.viewers(ch)) for (const s of online.get(uid) || []) if (s !== socket) s.emit('call:ring', ring);
        } else socket.to(`group:${ch.group_id}`).emit('call:ring', ring);
      }
      ack?.({ peerId: socket.id, peers, channelId: ch.id, groupId: ch.group_id });
      hub.onCallJoined?.(ch.id, socket);
    });

    socket.on('call:leave', () => leaveCall(socket));

    socket.on('call:state', (p = {}) => {
      const channelId = socket.data.callChannel;
      const entry = channelId && calls.get(channelId)?.get(socket.id);
      if (!entry) return;
      const serverMuted = Boolean(entry.state.serverMuted);
      entry.state = { ...(p.state || {}), serverMuted, muted: Boolean(p.state?.muted) || serverMuted };
      trackStreams(socket, userId, entry.state);
      socket.to(`call:${channelId}`).emit('call:peer-state', { peerId: socket.id, state: entry.state });
      emitCallList(channelId);
    });

    socket.on('rtc:signal', (p = {}) => {
      const channelId = socket.data.callChannel;
      if (!channelId || !calls.get(channelId)?.has(p.to)) return;
      io.to(p.to).emit('rtc:signal', { from: socket.id, data: p.data });
    });

    // ---------- Moderação de call: disconnect | move | mute | unmute ----------
    socket.on('call:mod', (p = {}, ack) => {
      const target = Number(p.userId);
      const fromCh = [...calls.entries()].find(([, c]) => [...c.values()].some((x) => x.userId === target));
      const ch = fromCh && guild.getChannel(fromCh[0]);
      if (!ch || !isMember(ch.group_id, userId)) return ack?.({ error: 'A pessoa não está em call.' });
      const perm = p.action === 'mute' || p.action === 'unmute' ? 'mute_members' : 'move_members';
      if (!guild.can(ch.group_id, userId, perm)) return ack?.({ error: 'Sua classe não tem essa permissão.' });
      if (target !== userId && guild.topPosition(ch.group_id, target) >= guild.topPosition(ch.group_id, userId))
        return ack?.({ error: 'Essa pessoa está no seu nível ou acima.' });
      const sockets = hub.socketsInCall(ch.id).filter((s) => s.data.userId === target);
      const by = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || 'Alguém';
      if (p.action === 'disconnect') sockets.forEach((s) => kick(s, `${by} tirou você da call.`));
      else if (p.action === 'move') {
        const to = guild.getChannel(p.channelId);
        if (!to || to.kind !== 'voice' || to.group_id !== ch.group_id) return ack?.({ error: 'Canal inválido.' });
        guild.grant(to.id, target);
        sockets.forEach((s) => s.emit('call:move', { channelId: to.id, groupId: to.group_id, by }));
      } else {
        const muted = p.action === 'mute';
        for (const s of sockets) {
          const e = calls.get(ch.id)?.get(s.id);
          if (!e) continue;
          e.state = { ...e.state, serverMuted: muted, muted: muted || e.state.muted };
          s.emit('call:server-mute', { muted, by });
          io.to(`call:${ch.id}`).emit('call:peer-state', { peerId: s.id, state: e.state });
        }
        emitCallList(ch.id);
      }
      ack?.({ ok: true });
    });

    // "bater na porta" de uma call trancada / lotada: quem está dentro pode abrir
    socket.on('call:knock', (p = {}, ack) => {
      const ch = guild.getChannel(p.channelId);
      if (!ch || ch.kind !== 'voice' || !isMember(ch.group_id, userId) || !guild.access(ch, userId).see) return ack?.({ error: 'Canal não encontrado.' });
      if (!calls.get(ch.id)?.size) return ack?.({ error: 'Não tem ninguém na call para abrir a porta.' });
      if (Date.now() - (socket.data.lastKnock || 0) < 8000) return ack?.({ error: 'Espere um pouquinho para bater de novo.' });
      socket.data.lastKnock = Date.now();
      io.to(`call:${ch.id}`).emit('call:knock', { channelId: ch.id, userId });
      ack?.({ ok: true });
    });
    socket.on('call:let-in', (p = {}) => {
      const ch = socket.data.callChannel && guild.getChannel(socket.data.callChannel);
      const target = Number(p.userId);
      if (!ch || !isMember(ch.group_id, target)) return;
      guild.grant(ch.id, target);
      const by = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || 'Alguém';
      hub.refreshUserGroups(target);
      for (const s of online.get(target) || []) s.emit('call:let-in', { channelId: ch.id, groupId: ch.group_id, by });
    });

    // funções que só o navegador sabe que foram usadas (lista fechada)
    socket.on('track', (p = {}) => {
      if (stats.CLIENT_FEATURES.has(p.feature)) stats.track(userId, p.feature);
    });

    socket.on('disconnect', () => {
      leaveCall(socket);
      const set = online.get(userId);
      if (set) {
        set.delete(socket);
        if (!set.size) {
          hub.usage.disconnected(userId);
          online.delete(userId);
          // saiu de vez: limpa o "jogando agora" automático (o escrito à mão fica)
          const row = db.prepare('SELECT activity FROM users WHERE id = ?').get(userId);
          let act = null;
          try {
            act = JSON.parse(row?.activity || 'null');
          } catch {}
          if (act && act.source !== 'manual') {
            db.prepare('UPDATE users SET activity = NULL WHERE id = ?').run(userId);
            hub.broadcastUser(userId);
          }
        }
      }
      emitPresence();
    });
  });

  hub.usage = stats.attachUsage(hub);
  return hub;
}

module.exports = { createHub };
