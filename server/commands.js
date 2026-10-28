// Comandos com "/" no chat (estilo Discord). O navegador mostra a lista e o servidor executa.
const { db } = require('./db');
const guild = require('./guild');
const stats = require('./stats');
const { isMember, createMessage } = require('./routes');
const { attachMusic } = require('./music');

const GAME_ALIASES = { tetris: 'tetris', velha: 'tictactoe', 'jogo-da-velha': 'tictactoe', lig4: 'connect4', 'lig-4': 'connect4', desenho: 'draw', gartic: 'draw', reflexo: 'reaction' };
const BALL = ['Com certeza! ✅', 'Pode apostar 😎', 'Sem dúvida.', 'Sim!', 'Os astros dizem que sim ✨', 'Talvez… 🤔', 'Pergunta de novo depois.', 'Melhor não te contar agora 🙊', 'Não conta com isso.', 'Minhas fontes dizem que não.', 'Nem a pau 😂', 'Muito duvidoso.'];

// grupo: só para organizar a lista; perm: precisa dessa permissão; client: o navegador resolve sozinho
const COMMANDS = [
  { name: 'botmusic', aliases: ['play', 'tocar', 'musica', 'p'], args: '<link do YouTube ou nome>', desc: 'O KenBeat 🎧 entra na sua call e toca a música', perm: 'music', group: 'Música' },
  { name: 'pular', aliases: ['skip', 'next', 's'], desc: 'Pula para a próxima música', perm: 'music', group: 'Música' },
  { name: 'pausar', aliases: ['pause'], desc: 'Pausa a música', perm: 'music', group: 'Música' },
  { name: 'continuar', aliases: ['resume', 'despausar'], desc: 'Continua de onde parou', perm: 'music', group: 'Música' },
  { name: 'parar', aliases: ['stop', 'sair', 'leave'], desc: 'Para tudo e o KenBeat sai da call', perm: 'music', group: 'Música' },
  { name: 'fila', aliases: ['queue', 'q'], desc: 'Mostra a fila de músicas', group: 'Música' },
  { name: 'tocando', aliases: ['np', 'agora'], desc: 'O que está tocando agora', group: 'Música' },
  { name: 'embaralhar', aliases: ['shuffle'], desc: 'Embaralha a fila', perm: 'music', group: 'Música' },
  { name: 'repetir', aliases: ['loop'], args: '[musica | fila | off]', desc: 'Repete a música ou a fila', perm: 'music', group: 'Música' },
  { name: 'remover', aliases: ['remove'], args: '<número na fila>', desc: 'Tira uma música da fila', perm: 'music', group: 'Música' },
  { name: 'volume', aliases: ['vol'], args: '<0-100 | +10 | -10 | mudo | on>', desc: 'Volume do KenBeat só para você', group: 'Música', client: true },

  { name: 'enquete', aliases: ['poll', 'votacao'], args: '<pergunta> | <opção 1> | <opção 2> …', desc: 'Cria uma votação (até 10 opções)', group: 'Diversão' },
  { name: 'dado', aliases: ['roll', 'd'], args: '[2d6]', desc: 'Rola dados (padrão 1d6)', group: 'Diversão' },
  { name: 'moeda', aliases: ['coin', 'flip'], desc: 'Cara ou coroa', group: 'Diversão' },
  { name: 'escolher', aliases: ['choose'], args: '<a, b, c>', desc: 'Escolhe uma das opções por você', group: 'Diversão' },
  { name: 'sortear', aliases: ['sorteio'], desc: 'Sorteia alguém do grupo (online)', group: 'Diversão' },
  { name: 'bola8', aliases: ['8ball'], args: '<pergunta>', desc: 'A bola mágica responde', group: 'Diversão' },
  { name: 'jogar', aliases: ['game'], args: '<tetris | velha | lig4 | desenho | reflexo>', desc: 'Abre um jogo para o grupo', perm: 'start_games', group: 'Diversão' },

  { name: 'me', aliases: ['acao'], args: '<ação>', desc: 'Manda uma ação: *Kenny está dançando*', group: 'Chat' },
  { name: 'shrug', aliases: [], args: '[texto]', desc: 'Manda ¯\\_(ツ)_/¯', group: 'Chat', client: true },
  { name: 'lembrar', aliases: ['remind', 'lembrete'], args: '<minutos> <texto>', desc: 'O bot te lembra daqui a X minutos', group: 'Chat' },
  { name: 'limpar', aliases: ['clear', 'purge'], args: '<quantidade>', desc: 'Apaga as últimas mensagens deste canal', perm: 'manage_messages', group: 'Moderação' },
  { name: 'convite', aliases: ['invite'], desc: 'Mostra o código de convite (só para você)', perm: 'invite', group: 'Moderação' },
  { name: 'ajuda', aliases: ['help', 'comandos'], desc: 'Lista os comandos', group: 'Chat' },
];
const byName = new Map();
for (const c of COMMANDS) [c.name, ...c.aliases].forEach((n) => byName.set(n, c));

const fmtTime = (s) => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0');
};

function attachCommands(io, hub, { createGame } = {}) {
  // mensagem do bot: autor é quem usou o comando (aparece "usou /comando"), conteúdo em JSON
  const postBot = (groupId, channelId, data, userId = null) => {
    const ch = guild.getChannel(channelId);
    const uid = userId || db.prepare('SELECT owner_id FROM groups WHERE id = ?').get(groupId)?.owner_id;
    if (!ch || !uid) return null;
    const msg = createMessage({ groupId, channelId, userId: uid, type: 'bot', content: JSON.stringify(data) });
    hub.broadcastMessage(msg);
    return msg;
  };
  const music = attachMusic(io, hub, { postBot });
  const reminders = new Set();

  const handlers = {
    async botmusic(c) {
      const r = await music.play(c.userId, c.groupId, c.channelId, c.args);
      const chName = `${r.channel.emoji || '🔊'} ${r.channel.name}`;
      if (r.now) {
        postBot(c.groupId, c.channelId, { bot: 'music', kind: 'now', text: `Tocando agora em ${chName}`, track: r.now, extra: r.added ? `+${r.added} da playlist na fila` : '' }, c.userId);
      } else {
        postBot(c.groupId, c.channelId, { bot: 'music', kind: 'queued', text: r.added > 1 ? `Adicionei ${r.added} músicas na fila` : `Na fila (#${r.position})`, track: r.queued }, c.userId);
      }
    },
    pular: (c) => musicCtl(c, 'skip'),
    pausar: (c) => musicCtl(c, 'pause'),
    continuar: (c) => musicCtl(c, 'resume'),
    parar: (c) => musicCtl(c, 'stop'),
    embaralhar: (c) => musicCtl(c, 'shuffle'),
    repetir: (c) => musicCtl(c, 'loop', { musica: 'track', 'música': 'track', track: 'track', fila: 'queue', queue: 'queue', off: 'off', nao: 'off', 'não': 'off' }[c.args.toLowerCase()]),
    remover: (c) => musicCtl(c, 'remove', c.args),
    fila(c) {
      const st = musicState(c);
      if (!st?.current) return { ephemeral: 'Nada tocando agora. Use **/botmusic** <link ou nome>.' };
      const lines = [`🎧 **Tocando:** ${st.current.title} \`${fmtTime(music.position(st))}/${fmtTime(st.current.duration)}\``];
      st.queue.slice(0, 15).forEach((t, i) => lines.push(`**${i + 1}.** ${t.title} ${t.duration ? '`' + fmtTime(t.duration) + '`' : ''} — ${t.by.name}`));
      if (st.queue.length > 15) lines.push(`… e mais ${st.queue.length - 15}`);
      if (!st.queue.length) lines.push('A fila está vazia.');
      return { ephemeral: lines.join('\n') };
    },
    tocando(c) {
      const st = musicState(c);
      if (!st?.current) return { ephemeral: 'Nada tocando agora.' };
      return { ephemeral: `🎧 **${st.current.title}** ${st.current.author ? '— ' + st.current.author : ''}\n\`${fmtTime(music.position(st))} / ${fmtTime(st.current.duration)}\` • pedida por ${st.current.by.name}${st.pausedAt ? ' • ⏸️ pausada' : ''}` };
    },

    enquete(c) {
      const parts = c.args.split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) throw new Error('Use assim: /enquete Pergunta? | opção 1 | opção 2');
      const [q, ...options] = parts;
      if (options.length > 10) throw new Error('No máximo 10 opções.');
      const msg = createMessage({ groupId: c.groupId, channelId: c.channelId, userId: c.userId, type: 'poll', content: JSON.stringify({ q: q.slice(0, 200), options: options.map((o) => o.slice(0, 80)) }) });
      hub.broadcastMessage(msg);
      stats.track(c.userId, 'poll_create');
    },
    dado(c) {
      const m = (c.args || '1d6').toLowerCase().match(/^(\d{0,2})d(\d{1,4})$/) || (c.args.match(/^\d{1,4}$/) ? [null, '1', c.args] : null);
      if (!m) throw new Error('Use assim: /dado 2d6 (2 dados de 6 lados)');
      const n = Math.min(20, Math.max(1, Number(m[1] || 1))), sides = Math.min(1000, Math.max(2, Number(m[2])));
      const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      postBot(c.groupId, c.channelId, { bot: 'kenfeh', kind: 'dice', text: `🎲 rolou **${n}d${sides}**: ${n > 1 ? rolls.join(' + ') + ' = ' : ''}**${total}**` }, c.userId);
    },
    moeda(c) {
      postBot(c.groupId, c.channelId, { bot: 'kenfeh', text: Math.random() < 0.5 ? '🪙 jogou a moeda: **CARA**!' : '🪙 jogou a moeda: **COROA**!' }, c.userId);
    },
    escolher(c) {
      const opts = c.args.split(/[,|]| ou /).map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) throw new Error('Use assim: /escolher pizza, hambúrguer, sushi');
      postBot(c.groupId, c.channelId, { bot: 'kenfeh', text: `🤔 Entre ${opts.map((o) => `"${o}"`).join(', ')}… eu escolho **${opts[Math.floor(Math.random() * opts.length)]}**!` }, c.userId);
    },
    sortear(c) {
      const members = db.prepare('SELECT u.id, u.display_name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?').all(c.groupId);
      const pool = members.filter((m) => hub.online.has(m.id));
      const list = pool.length ? pool : members;
      const win = list[Math.floor(Math.random() * list.length)];
      postBot(c.groupId, c.channelId, { bot: 'kenfeh', text: `🎉 Sorteio entre ${list.length} pessoa(s)${pool.length ? ' online' : ''}… quem ganhou foi **${win.display_name}**!` }, c.userId);
    },
    bola8(c) {
      if (!c.args) throw new Error('Faça uma pergunta: /bola8 vou ganhar no Tetris hoje?');
      postBot(c.groupId, c.channelId, { bot: 'kenfeh', text: `🎱 "${c.args.slice(0, 200)}"\n**${BALL[Math.floor(Math.random() * BALL.length)]}**` }, c.userId);
    },
    jogar(c) {
      const type = GAME_ALIASES[c.args.toLowerCase().trim()];
      if (!type) throw new Error('Jogos: /jogar tetris | velha | lig4 | desenho | reflexo');
      const r = createGame?.(c.userId, c.groupId, type);
      if (r?.error) throw new Error(r.error);
      return { ephemeral: '🎮 Partida aberta! Veja na aba **Jogos**.', openGames: true };
    },
    me(c) {
      if (!c.args) throw new Error('Use assim: /me está dançando');
      postBot(c.groupId, c.channelId, { bot: 'me', text: c.args.slice(0, 300) }, c.userId);
    },
    lembrar(c) {
      const m = c.args.match(/^(\d{1,4})\s*(?:m|min|minutos?)?\s+(.+)$/i);
      if (!m) throw new Error('Use assim: /lembrar 10 tirar a pizza do forno');
      const min = Math.min(24 * 60, Math.max(1, Number(m[1])));
      if ([...reminders].filter((r) => r.userId === c.userId).length >= 10) throw new Error('Você já tem 10 lembretes ativos.');
      const r = { userId: c.userId };
      reminders.add(r);
      r.t = setTimeout(() => {
        reminders.delete(r);
        if (isMember(c.groupId, c.userId)) postBot(c.groupId, c.channelId, { bot: 'kenfeh', kind: 'remind', text: `⏰ Lembrete: **${m[2].slice(0, 300)}**`, mention: c.userId }, c.userId);
      }, min * 60e3);
      return { ephemeral: `⏰ Combinado! Te lembro daqui a ${min} min (se o servidor não reiniciar até lá).` };
    },
    limpar(c) {
      const n = Math.min(100, Math.max(1, Number(c.args) || 0));
      if (!Number(c.args)) throw new Error('Use assim: /limpar 20');
      const ids = db.prepare('SELECT id FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?').all(c.channelId, n).map((r) => r.id);
      for (const id of ids) {
        db.prepare('DELETE FROM messages WHERE id = ?').run(id);
        io.to(`group:${c.groupId}`).emit('chat:delete', { id, groupId: c.groupId, channelId: c.channelId });
      }
      return { ephemeral: `🧹 Apaguei ${ids.length} mensagem(ns).` };
    },
    convite(c) {
      const g = db.prepare('SELECT invite_code, name FROM groups WHERE id = ?').get(c.groupId);
      return { ephemeral: `🔗 Código de convite de **${g.name}**: \`${g.invite_code}\` — quem tiver o código entra pelo botão + → "Tenho um convite".` };
    },
    ajuda(c) {
      const perms = guild.permsOf(c.groupId, c.userId);
      const groups = {};
      for (const cmd of COMMANDS) if (!cmd.perm || perms.has(cmd.perm)) (groups[cmd.group] ||= []).push(`**/${cmd.name}** ${cmd.args || ''} — ${cmd.desc}`);
      return { ephemeral: Object.entries(groups).map(([g, l]) => `__${g}__\n${l.join('\n')}`).join('\n\n') };
    },
  };

  const musicState = (c) => {
    const ch = music.callChannelOf(c.userId);
    if (ch && ch.group_id === c.groupId && music.get(ch.id)) return music.get(ch.id);
    for (const v of guild.channelsOf(c.groupId)) if (music.get(v.id)?.current) return music.get(v.id);
    return null;
  };
  const musicCtl = (c, action, arg) => {
    const st = musicState(c);
    if (!st) throw new Error('Não tem música tocando agora.');
    const text = music.control(c.userId, st.channelId, action, arg);
    if (text) postBot(c.groupId, c.channelId, { bot: 'music', text }, c.userId);
  };

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.on('command', async (p = {}, ack) => {
      const groupId = Number(p.groupId);
      const text = String(p.text || '').trim();
      const m = text.match(/^\/(\S+)\s*([\s\S]*)$/);
      if (!m || !isMember(groupId, userId)) return ack?.({ error: 'Comando inválido.' });
      const cmd = byName.get(m[1].toLowerCase());
      if (!cmd || cmd.client) return ack?.({ error: `Não conheço /${m[1]}. Digite /ajuda para ver a lista.` });
      const ch = hub.textChannel(userId, groupId, Number(p.channelId) || null);
      if (!ch) return ack?.({ error: 'Esse canal é só leitura para a sua classe.' });
      if (cmd.perm && !guild.can(groupId, userId, cmd.perm)) return ack?.({ error: `Sua classe não pode usar /${cmd.name}.` });
      if (Date.now() - (socket.data.lastCmd || 0) < 300) return ack?.({ error: 'Calma! Um comando de cada vez 😅' });
      socket.data.lastCmd = Date.now();
      try {
        const r = await handlers[cmd.name]({ userId, groupId, channelId: ch.id, args: m[2].trim(), socket });
        stats.track(userId, 'command');
        ack?.({ ok: true, ...(r || {}) });
      } catch (err) {
        ack?.({ error: err.message || 'Deu ruim no comando.' });
      }
    });
  });

  return { COMMANDS, music };
}

module.exports = { attachCommands, COMMANDS };
