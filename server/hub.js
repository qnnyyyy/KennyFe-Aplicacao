// Tempo real (Socket.IO): presença, chat ao vivo e sinalização WebRTC das chamadas.
const { db } = require('./db');
const auth = require('./auth');
const { isMember, createMessage, messagePayload, groupPayload } = require('./routes');

function createHub(io) {
  const online = new Map(); // userId -> Set<socket>
  const calls = new Map(); // groupId -> Map<peerId, { userId, state }>

  const userGroupIds = (userId) => db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(userId).map((r) => r.group_id);

  const callSnapshot = (groupId) => {
    const call = calls.get(groupId);
    if (!call) return [];
    return [...call.entries()].map(([peerId, p]) => ({ peerId, userId: p.userId, state: p.state }));
  };

  const emitCallList = (groupId) => io.to(`group:${groupId}`).emit('calls:update', { groupId, participants: callSnapshot(groupId) });

  const emitPresence = () => io.emit('presence', { online: [...online.keys()] });

  const hub = {
    refreshUserGroups(userId) {
      const sockets = online.get(userId);
      if (!sockets) return;
      const groups = db
        .prepare('SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = ? ORDER BY g.created_at')
        .all(userId)
        .map(groupPayload);
      for (const s of sockets) {
        groups.forEach((g) => s.join(`group:${g.id}`));
        s.emit('groups:update', { groups });
      }
    },
    broadcastMessage(msg) {
      io.to(`group:${msg.groupId}`).emit('chat:message', msg);
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
    online,
    friendsChanged(userIds, event) {
      for (const id of userIds) for (const s of online.get(id) || []) s.emit('friends:update', event);
    },
    leaveGroupRoom(userId, groupId) {
      for (const s of online.get(userId) || []) {
        s.leave(`group:${groupId}`);
        if (s.data.callGroup === groupId) leaveCall(s);
      }
    },
  };

  function leaveCall(socket) {
    const groupId = socket.data.callGroup;
    if (!groupId) return;
    const call = calls.get(groupId);
    socket.data.callGroup = null;
    socket.leave(`call:${groupId}`);
    if (call) {
      call.delete(socket.id);
      if (!call.size) calls.delete(groupId);
    }
    io.to(`call:${groupId}`).emit('call:peer-left', { peerId: socket.id });
    emitCallList(groupId);
  }

  io.use((socket, next) => {
    const token = auth.parseCookies(socket.handshake.headers.cookie)[auth.COOKIE];
    const user = auth.userFromToken(token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    if (!online.has(userId)) online.set(userId, new Set());
    online.get(userId).add(socket);

    userGroupIds(userId).forEach((gid) => socket.join(`group:${gid}`));
    hub.refreshUserGroups(userId);
    emitPresence();
    // Estado atual de todas as calls dos grupos do usuário
    userGroupIds(userId).forEach((gid) => socket.emit('calls:update', { groupId: gid, participants: callSnapshot(gid) }));

    // ---------- Chat ----------
    socket.on('chat:send', (p = {}, ack) => {
      const groupId = Number(p.groupId);
      if (!isMember(groupId, userId)) return ack?.({ error: 'Sem acesso.' });
      const type = ['text', 'sticker', 'gif', 'image', 'file', 'video', 'audio'].includes(p.type) ? p.type : 'text';
      const content = String(p.content || '').slice(0, 4000);
      const mediaUrl = p.mediaUrl && String(p.mediaUrl).startsWith('/uploads/') ? String(p.mediaUrl) : null;
      if (type === 'text' && !content.trim()) return ack?.({ error: 'Mensagem vazia.' });
      if (type !== 'text' && !mediaUrl) return ack?.({ error: 'Mídia inválida.' });
      let replyTo = Number(p.replyTo) || null;
      if (replyTo && !db.prepare('SELECT 1 FROM messages WHERE id = ? AND group_id = ?').get(replyTo, groupId)) replyTo = null;
      const msg = createMessage({ groupId, userId, type, content, mediaUrl, replyTo });
      hub.broadcastMessage(msg);
      ack?.({ message: msg });
    });

    socket.on('chat:typing', (p = {}) => {
      const groupId = Number(p.groupId);
      if (!isMember(groupId, userId)) return;
      socket.to(`group:${groupId}`).emit('chat:typing', { groupId, userId });
    });

    socket.on('chat:react', (p = {}) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(p.messageId));
      const emoji = String(p.emoji || '').slice(0, 16);
      if (!m || !emoji || !isMember(m.group_id, userId)) return;
      const exists = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(m.id, userId, emoji);
      if (exists) db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(m.id, userId, emoji);
      else db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(m.id, userId, emoji);
      io.to(`group:${m.group_id}`).emit('chat:update', messagePayload(m));
    });

    socket.on('chat:edit', (p = {}) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(p.messageId));
      const content = String(p.content || '').slice(0, 4000);
      if (!m || m.user_id !== userId || m.type !== 'text' || !content.trim()) return;
      db.prepare('UPDATE messages SET content = ?, edited_at = unixepoch() WHERE id = ?').run(content, m.id);
      io.to(`group:${m.group_id}`).emit('chat:update', messagePayload(db.prepare('SELECT * FROM messages WHERE id = ?').get(m.id)));
    });

    socket.on('chat:delete', (p = {}) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(p.messageId));
      if (!m || m.user_id !== userId) return;
      db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
      io.to(`group:${m.group_id}`).emit('chat:delete', { id: m.id, groupId: m.group_id });
    });

    // ---------- Chamadas ----------
    socket.on('call:join', (p = {}, ack) => {
      const groupId = Number(p.groupId);
      if (!isMember(groupId, userId)) return ack?.({ error: 'Sem acesso.' });
      if (socket.data.callGroup) leaveCall(socket);
      if (!calls.has(groupId)) calls.set(groupId, new Map());
      const call = calls.get(groupId);
      const peers = callSnapshot(groupId);
      const wasEmpty = call.size === 0;
      call.set(socket.id, { userId, state: p.state || {} });
      socket.data.callGroup = groupId;
      socket.join(`call:${groupId}`);
      socket.to(`call:${groupId}`).emit('call:peer-joined', { peerId: socket.id, userId, state: p.state || {} });
      emitCallList(groupId);
      if (wasEmpty) socket.to(`group:${groupId}`).emit('call:ring', { groupId, userId });
      ack?.({ peerId: socket.id, peers });
    });

    socket.on('call:leave', () => leaveCall(socket));

    socket.on('call:state', (p = {}) => {
      const groupId = socket.data.callGroup;
      const entry = groupId && calls.get(groupId)?.get(socket.id);
      if (!entry) return;
      entry.state = p.state || {};
      socket.to(`call:${groupId}`).emit('call:peer-state', { peerId: socket.id, state: entry.state });
      emitCallList(groupId);
    });

    socket.on('rtc:signal', (p = {}) => {
      const groupId = socket.data.callGroup;
      if (!groupId || !calls.get(groupId)?.has(p.to)) return;
      io.to(p.to).emit('rtc:signal', { from: socket.id, data: p.data });
    });

    socket.on('disconnect', () => {
      leaveCall(socket);
      const set = online.get(userId);
      if (set) {
        set.delete(socket);
        if (!set.size) {
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

  return hub;
}

module.exports = { createHub };
