// Kenfeh — inicialização, login, grupos e navegação.
import { el, $, $$, icon, setIcon, avatar, toast, modal, prompt, contextMenu, onContext, store, save, sfx } from './ui.js';
import { api } from './api.js';
import { Chat } from './chat.js';
import { CallController } from './call/call.js';
import { openSettings } from './settings-ui.js';
import { emojiPicker } from './emoji.js';
import { popover, closeMenu } from './ui.js';
import { openProfile, activityLine } from './profile.js';
import { GamesHub } from './games.js';
import { Home } from './home.js';
import { renderChannels, renderMembers as renderMemberList, memberModItems, groupSettings, channelDialog, can } from './guild.js';
import { Commands } from './commands.js';
import { MusicClient } from './music.js';

const GROUP_ICONS = ['🎮', '🍿', '🎬', '🎧', '🔥', '⚡', '🌙', '👾', '🏆', '🐱', '✨', '🍕'];

const app = {
  me: null,
  socket: null,
  groups: new Map(),
  currentGroupId: null, // null = Início
  currentChannelId: null, // canal aberto no grupo atual
  channelPrefs: store('current-channel', {}), // último canal aberto em cada grupo
  online: new Set(),
  calls: new Map(), // id do canal de voz -> participantes
  callGroups: new Map(), // id do canal de voz -> grupo
  groupsListeners: new Set(),
  lastRead: store('last-read', {}),
  chatHidden: store('chat-hidden', false),

  user(id) {
    if (id === this.me?.id) return this.me;
    for (const g of this.groups.values()) {
      const u = g.members.find((m) => m.id === id);
      if (u) return u;
    }
    return null;
  },
  userName(id) {
    return this.user(id)?.displayName || 'Alguém';
  },
  group(id) {
    return this.groups.get(id);
  },
  channel(id) {
    for (const g of this.groups.values()) {
      const c = g.channels?.find((x) => x.id === id);
      if (c) return c;
    }
    return null;
  },
  callGroupOf(channelId) {
    return this.callGroups.get(channelId) ?? this.channel(channelId)?.groupId ?? null;
  },
  // todo mundo em call num grupo (somando os canais de voz)
  groupCallParts(groupId) {
    const out = [];
    for (const [cid, parts] of this.calls) if (this.callGroupOf(cid) === groupId) out.push(...parts);
    return out;
  },
  defaultVoice(g) {
    return g?.channels?.find((c) => c.kind === 'voice') || null;
  },
  onGroupsUpdate(fn) {
    this.groupsListeners.add(fn);
  },
  offGroupsUpdate(fn) {
    this.groupsListeners.delete(fn);
  },
  // nome para mostrar: em conversa direta é o nome da outra pessoa
  groupTitle(g) {
    if (!g) return '';
    if (g.isDm) return (g.members.find((m) => m.id !== this.me.id) || g.members[0])?.displayName || 'Conversa';
    return `${g.icon} ${g.name}`;
  },
};

// =====================================================================
// LOGIN
// =====================================================================
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  let mode = 'login';
  const form = $('#auth-form');
  const setMode = (m) => {
    mode = m;
    $$('.auth-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === m));
    $('.auth-tabs').dataset.mode = m;
    form.classList.toggle('register', m === 'register');
    $('#auth-submit').textContent = m === 'login' ? 'Entrar' : 'Criar conta';
    form.password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    form.email.required = m === 'register';
    $('#auth-error').textContent = '';
  };
  $$('.auth-tabs button').forEach((b) => (b.onclick = () => setMode(b.dataset.tab)));
  api.get('/public-config').then((c) => $('#access-code-field').classList.toggle('hidden', !c.registerCodeRequired)).catch(() => {});
  setMode('login');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#auth-submit');
    btn.disabled = true;
    $('#auth-error').textContent = '';
    try {
      const body = { username: form.username.value, password: form.password.value, displayName: form.displayName.value, email: form.email.value, accessCode: form.accessCode.value };
      const { user } = await api.post(mode === 'login' ? '/auth/login' : '/auth/register', body);
      start(user);
    } catch (err) {
      $('#auth-error').textContent = err.message;
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    } finally {
      btn.disabled = false;
    }
  };
  setTimeout(() => form.username.focus(), 100);
}

app.logout = async () => {
  if (app.call?.active) app.call.leave();
  await api.post('/auth/logout').catch(() => {});
  location.reload();
};

// =====================================================================
// APP
// =====================================================================
function start(user) {
  app.me = user;
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');

  const socket = (app.socket = io({ transports: ['websocket', 'polling'] }));
  app.chat = new Chat(app);
  app.call = new CallController(app);
  app.games = new GamesHub(app);
  app.music = new MusicClient(app);
  app.commands = new Commands(app);
  app.renderAll = () => renderAll();
  app.joinVoice = (cid) => joinVoice(cid);
  app.selectGroup = (id, cid) => selectGroup(id, cid);

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') location.reload();
  });
  // voltou de uma queda (aba dormindo, celular em segundo plano, internet): busca o que perdeu
  let connectedOnce = false;
  socket.on('connect', () => {
    if (connectedOnce && app.chat.groupId && app.chat.channelId) app.chat.open(app.chat.groupId, app.chat.channelId);
    connectedOnce = true;
  });
  const wake = () => !socket.connected && socket.connect();
  document.addEventListener('visibilitychange', () => !document.hidden && wake());
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
  socket.on('groups:update', ({ groups }) => {
    app.groups = new Map(groups.map((g) => [g.id, g]));
    const me = groups.flatMap((g) => g.members).find((m) => m.id === app.me.id);
    if (me) Object.assign(app.me, me);
    if (app.currentGroupId && !app.groups.has(app.currentGroupId)) app.currentGroupId = null;
    // canal recém-criado por mim: já abre
    if (app.pendingChannel && app.channel(app.pendingChannel)) {
      const c = app.channel(app.pendingChannel);
      app.pendingChannel = null;
      return selectGroup(c.groupId, c.id);
    }
    const g = app.group(app.currentGroupId);
    if (g && !g.channels.some((c) => c.id === app.currentChannelId)) return selectGroup(g.id);
    renderAll();
    if (app.currentGroupId && (app.chat.groupId !== app.currentGroupId || app.chat.channelId !== app.currentChannelId)) selectGroup(app.currentGroupId, app.currentChannelId);
    if (app.call.active) app.call.refreshTiles();
    app.groupsListeners.forEach((fn) => fn());
  });
  socket.on('user:update', ({ user }) => {
    for (const g of app.groups.values()) {
      const i = g.members.findIndex((m) => m.id === user.id);
      if (i >= 0) g.members[i] = { ...g.members[i], ...user };
    }
    if (user.id === app.me.id) Object.assign(app.me, user);
    app.home?.onUserUpdate(user);
    renderHome();
    renderMembers();
    renderVoiceUsers();
    renderMeBar();
    if (app.call.active) app.call.refreshTiles();
  });
  socket.on('presence', ({ online }) => {
    app.online = new Set(online);
    renderMembers();
    renderHome();
  });
  socket.on('calls:update', ({ groupId, channelId, participants }) => {
    app.callGroups.set(channelId, groupId);
    if (participants.length) app.calls.set(channelId, participants);
    else app.calls.delete(channelId);
    renderHome();
    renderRail();
    renderVoiceUsers();
    renderRoomHeader();
  });
  socket.on('call:ring', ({ groupId, channelId, userId }) => {
    if (app.call.active && app.call.groupId === groupId) return;
    const g = app.group(groupId);
    const ch = app.channel(channelId);
    sfx('ring');
    const text = g?.isDm ? `📞 ${app.userName(userId)} está te ligando!` : `📞 ${app.userName(userId)} entrou em ${ch?.emoji || '🔊'} ${ch?.name || 'call'} • ${g?.name || 'um grupo'}`;
    toast(el('div', { class: 'ring-toast' }, el('span', {}, text), el('button', { class: 'btn btn-primary btn-sm', onclick: (e) => { e.currentTarget.closest('.toast')?.remove(); joinVoice(channelId); } }, g?.isDm ? 'Atender' : 'Entrar')), 'info', 15000);
    app.notify({ groupId, author: app.user(userId), type: 'text', content: '📞 começou uma call — vem!' });
  });

  setupStatic();
  app.home = new Home(app, { selectGroup, newGroupDialog });
  renderAll();
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission().catch(() => {}), { once: true });
  }
}

app.setMe = (u) => {
  Object.assign(app.me, u);
  renderAll();
  if (app.call.active) app.call.refreshTiles();
};

app.openSettings = (tab) => openSettings(app, tab);

app.toggleChat = () => {
  app.chatHidden = !app.chatHidden;
  save('chat-hidden', app.chatHidden);
  renderRoomLayout();
};

app.markRead = (groupId) => {
  const g = app.group(groupId);
  if (!g) return;
  const lastId = Math.max(0, ...[...app.chat.messages.keys()]);
  const ch = g.channels?.find((c) => c.id === app.chat.channelId);
  if (ch) app.lastRead['c' + ch.id] = Math.max(ch.lastMessageId || 0, lastId);
  // o grupo fica "lido" quando todos os canais que a pessoa vê estão lidos
  const pending = (g.channels || []).some((c) => (c.lastMessageId || 0) > (app.lastRead['c' + c.id] || 0));
  if (!pending || g.isDm) app.lastRead[groupId] = Math.max(g.lastMessageId || 0, lastId);
  save('last-read', app.lastRead);
  renderRail();
  renderChannelList();
};

app.onUnread = (m) => {
  const g = app.group(m.groupId);
  if (g) g.lastMessageId = Math.max(g.lastMessageId || 0, m.id);
  const ch = g?.channels?.find((c) => c.id === m.channelId);
  if (ch) ch.lastMessageId = Math.max(ch.lastMessageId || 0, m.id);
  if (m.groupId === app.currentGroupId && m.channelId === app.chat.channelId && !document.hidden) app.markRead(m.groupId);
  renderRail();
  renderChannelList();
};

app.notify = (m) => {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const g = app.group(m.groupId);
  const body = m.type === 'text' ? m.content : { sticker: '🌟 figurinha', gif: '🎞️ GIF', image: '🖼️ imagem', video: '🎥 vídeo', audio: '🎵 áudio', file: '📎 arquivo' }[m.type];
  try {
    const n = new Notification(g?.isDm ? `${m.author?.displayName || ''} (mensagem direta)` : `${m.author?.displayName || ''} • ${g?.name || 'Kenfeh'}`, { body, icon: m.author?.avatarUrl || undefined, tag: 'kf-' + m.groupId });
    n.onclick = () => { window.focus(); selectGroup(m.groupId); n.close(); };
  } catch {}
};

app.onCallChanged = () => {
  renderAll();
};

app.renderMeBar = () => renderMeBar();
app.renderVoiceUsers = () => renderVoiceUsers();

document.addEventListener('visibilitychange', () => !document.hidden && app.currentGroupId && app.markRead(app.currentGroupId));

function selectGroup(id, channelId) {
  const changedGroup = app.currentGroupId !== id;
  app.currentGroupId = id;
  save('current-group', id);
  $('#app').classList.remove('nav-open');
  const g = app.group(id);
  if (g) {
    const pick = (cid) => g.channels.find((c) => c.id === cid);
    const ch = pick(channelId) || pick(app.channelPrefs[id]) || g.channels.find((c) => c.kind === 'text') || g.channels[0];
    app.currentChannelId = ch?.id || null;
    app.channelPrefs[id] = app.currentChannelId;
    save('current-channel', app.channelPrefs);
  } else {
    app.currentChannelId = null;
    app.chat.groupId = null;
  }
  renderAll();
  if (g && app.currentChannelId && (app.chat.groupId !== id || app.chat.channelId !== app.currentChannelId)) app.chat.open(id, app.currentChannelId);
  if (changedGroup) app.games?.onGroupChanged();
}

// clicou num canal de voz: entra na call (como no Discord) e mostra o palco + o chat do próprio canal
async function joinVoice(channelId) {
  const ch = app.channel(channelId);
  if (!ch) return;
  if (!ch.canEnter) return lockedDialog(ch, 'locked');
  const g = app.group(ch.groupId);
  if (!g?.isDm) selectGroup(ch.groupId, ch.id);
  else selectGroup(ch.groupId);
  if (app.call.active && app.call.channelId === ch.id) return;
  try {
    const r = await app.call.join(ch.id);
    if (r?.locked || r?.full) lockedDialog(ch, r.full ? 'full' : 'locked');
  } catch (err) {
    console.error(err);
    toast('Não foi possível entrar na call: ' + err.message, 'error');
    app.call.active && app.call.leave();
  }
}

// call trancada ou lotada: dá para "bater na porta" e alguém de dentro libera
function lockedDialog(ch, why) {
  const parts = app.calls.get(ch.id) || [];
  modal({
    title: `${ch.emoji || '🔊'} ${ch.name} ${why === 'full' ? 'está lotada' : 'está trancada'}`,
    content: el('div', {},
      el('p', {}, why === 'full' ? `Essa call tem limite de ${ch.userLimit} pessoas.` : 'Só entra quem tem uma classe liberada para esse canal.'),
      parts.length
        ? el('div', {}, el('p', { class: 'muted small' }, `Na call agora: ${parts.map((p) => app.userName(p.userId)).join(', ')}`), el('p', { class: 'muted small' }, 'Você pode bater na porta: quem está lá dentro recebe um aviso e pode te deixar entrar.'))
        : el('p', { class: 'muted small' }, 'Não tem ninguém lá dentro agora para abrir a porta.')),
    actions: [
      { label: 'Fechar', onClick: (c) => c() },
      ...(parts.length ? [{ label: '🚪 Bater na porta', primary: true, onClick: (c) => app.socket.emit('call:knock', { channelId: ch.id }, (r) => { if (r?.error) toast(r.error, 'error'); else { toast('Toc toc! 🚪 Avisamos quem está na call.', 'success'); c(); } }) }] : []),
    ],
  });
}

// =====================================================================
// RENDER
// =====================================================================
function renderAll() {
  renderHome();
  renderRail();
  renderSidebar();
  renderChannelList();
  renderMembers();
  renderVoiceUsers();
  renderMeBar();
  renderRoomHeader();
  renderRoomLayout();
}

function renderHome() {
  if (!app.home) return;
  app.home.renderSide();
  if (!app.currentGroupId) app.home.render();
}

function renderRail() {
  const homeMode = !app.group(app.currentGroupId) || app.group(app.currentGroupId).isDm;
  $('#btn-home').classList.toggle('active', homeMode);
  const badge = app.home?.badgeCount() || 0;
  $('#home-badge').classList.toggle('hidden', !badge);
  $('#home-badge').textContent = badge > 9 ? '9+' : badge;
  const rail = $('#group-rail');
  rail.replaceChildren(
    ...[...app.groups.values()].filter((g) => !g.isDm).map((g) => {
      const unread = (g.lastMessageId || 0) > (app.lastRead[g.id] || 0) && g.id !== app.currentGroupId;
      const inCall = app.groupCallParts(g.id).length > 0;
      const b = el('button', { class: `rail-btn ${g.id === app.currentGroupId ? 'active' : ''} ${unread ? 'unread' : ''}`, title: g.name, onclick: () => selectGroup(g.id) },
        el('span', { class: 'rail-icon' }, g.icon),
        inCall ? el('span', { class: 'rail-call' }, icon('volume', 10)) : null
      );
      onContext(b, (x, y) => groupMenu(g, x, y));
      return b;
    })
  );
}

function renderSidebar() {
  const g = app.group(app.currentGroupId);
  const homeMode = !g || g.isDm;
  $('#sidebar-title').textContent = homeMode ? 'Início' : app.groupTitle(g);
  $('#btn-group-menu').classList.toggle('hidden', homeMode);
  $('#home-side').classList.toggle('hidden', !homeMode);
  $('#group-side').classList.toggle('hidden', homeMode);
}

function renderChannelList() {
  renderChannels(app, $('#channel-list'), {
    selectChannel: (cid) => {
      const ch = app.channel(cid);
      if (ch?.kind === 'voice') return joinVoice(cid);
      selectGroup(app.currentGroupId, cid);
    },
    joinVoice,
    userMenu,
  });
}

function renderMembers() {
  renderMemberList(app, $('#members'), { userMenu });
}

function userMenu(m, x, y) {
  const items = [{ type: 'title', label: `${m.displayName} (@${m.username})` }];
  if (app.call.active) {
    const peer = [...app.call.remotes.entries()].find(([, r]) => r.userId === m.id);
    if (peer) items.push(...app.call.userMenuItems(m.id, peer[0]));
  }
  items.push({ label: 'Copiar @usuário', icon: 'copy', onClick: () => navigator.clipboard.writeText(m.username) });
  if (m.id === app.me.id) items.push({ label: 'Editar perfil', icon: 'edit', onClick: () => app.openSettings('account') });
  items.push(...memberModItems(app, app.group(app.currentGroupId), m));
  contextMenu(x, y, items);
}

function renderVoiceUsers() {
  renderChannelList();
  // painel "na call" embaixo
  const inCall = app.call.active;
  $('#voice-panel').classList.toggle('hidden', !inCall);
  if (inCall) {
    const cg = app.group(app.call.groupId);
    const ch = app.channel(app.call.channelId);
    $('#vp-group').textContent = cg?.isDm ? app.groupTitle(cg) : `${ch?.emoji || '🔊'} ${ch?.name || ''} • ${cg?.name || ''}`;
  }
}

function renderMeBar() {
  const me = app.me;
  $('#me-card').replaceChildren(avatar(me, 34), el('div', { class: 'me-info' }, el('b', {}, me.displayName), el('small', {}, '@' + me.username)));
  const muted = app.call.muted || app.call.deafened;
  setIcon($('#me-mic'), muted ? 'mic-off' : 'mic', 18);
  setIcon($('#me-deaf'), app.call.deafened ? 'headphones-off' : 'headphones', 18);
  $('#me-mic').classList.toggle('off', muted);
  $('#me-deaf').classList.toggle('off', app.call.deafened);
}

// canal de voz ligado à tela atual: o próprio canal (se for de voz) ou a call da conversa direta
function roomVoice() {
  const g = app.group(app.currentGroupId);
  const ch = app.channel(app.currentChannelId);
  if (!g) return null;
  if (g.isDm) return app.defaultVoice(g);
  return ch?.kind === 'voice' ? ch : null;
}

function renderRoomHeader() {
  const g = app.group(app.currentGroupId);
  if (!g) return;
  const ch = app.channel(app.currentChannelId);
  if (g.isDm) {
    $('#chat-icon').textContent = '@';
    $('#chat-name').textContent = app.groupTitle(g);
    $('#chat-topic').textContent = '';
  } else {
    $('#chat-icon').replaceChildren(ch?.emoji || (ch?.kind === 'voice' ? icon('volume', 18) : icon('hash', 18)));
    $('#chat-name').textContent = ch?.name || g.name;
    $('#chat-topic').textContent = ch?.topic || (ch?.kind === 'voice' ? 'chat do canal de voz' : '');
  }
  const btn = $('#btn-join-call');
  const voice = roomVoice();
  btn.classList.toggle('hidden', !voice);
  if (!voice) return;
  const here = app.call.active && app.call.channelId === voice.id;
  const count = (app.calls.get(voice.id) || []).length;
  btn.replaceChildren(icon(here ? 'phone-off' : 'phone', 16), el('span', {}, here ? 'Sair da call' : count ? `Entrar na call (${count})` : g.isDm ? 'Ligar' : 'Entrar na call'));
  btn.classList.toggle('danger', here);
  btn.classList.toggle('pulse', !here && count > 0);
}

function renderRoomLayout() {
  const g = app.group(app.currentGroupId);
  $('#home').classList.toggle('hidden', Boolean(g));
  $('#room').classList.toggle('hidden', !g);
  const voice = roomVoice();
  const showStage = Boolean(app.call.active && voice && app.call.channelId === voice.id);
  $('#stage-wrap').classList.toggle('hidden', !showStage);
  $('#room').classList.toggle('with-stage', showStage);
  const chatHidden = showStage && app.chatHidden;
  $('#chat').classList.toggle('hidden', chatHidden);
  $('#room-resizer').classList.toggle('hidden', !showStage || chatHidden);
  $('#chat').style.width = showStage && !chatHidden ? (store('chat-width', 380) + 'px') : '';
  setIcon($('#btn-toggle-chat'), 'x', 18);
  $('#btn-toggle-chat').classList.toggle('hidden', !showStage);
  if (showStage) app.call.stage.scheduleRender();
}

function groupMenu(g, x, y) {
  const items = [{ type: 'title', label: `${g.icon} ${g.name}` }];
  if (g.inviteCode) items.push({ label: `Convite: ${g.inviteCode} (copiar)`, icon: 'link', onClick: () => { navigator.clipboard.writeText(g.inviteCode); toast('Código copiado! Manda pra quem você quer chamar.', 'success'); } });
  if (can(app, g, 'invite')) items.push({ label: 'Adicionar pessoa pelo @usuário', icon: 'plus', onClick: () => addMember(g) });
  if (can(app, g, 'manage_channels')) items.push({ label: 'Criar canal de texto', icon: 'hash', onClick: () => channelDialog(app, g, null, 'text') }, { label: 'Criar canal de voz', icon: 'volume', onClick: () => channelDialog(app, g, null, 'voice') });
  items.push({ label: 'Configurações do grupo', icon: 'settings', onClick: () => openGroupSettings(g) });
  if (can(app, g, 'manage_roles')) items.push({ label: 'Classes e permissões', icon: 'shield', onClick: () => openGroupSettings(g, 'roles') });
  items.push({ type: 'sep' }, { label: 'Sair do grupo', icon: 'log-out', danger: true, onClick: () => leaveGroup(g) });
  contextMenu(x, y, items);
}

function openGroupSettings(g, tab) {
  groupSettings(app, g.id, { tab, iconPicker });
}

async function addMember(g) {
  const username = await prompt({ title: 'Adicionar ao grupo', label: 'Usuário da pessoa (sem @)', placeholder: 'ex.: joao_silva', okLabel: 'Adicionar' });
  if (!username) return;
  try {
    await api.post(`/groups/${g.id}/members`, { username: username.replace(/^@/, '') });
    toast('Adicionado(a)!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function iconPicker(initial, onPick) {
  let current = initial;
  const row = el('div', { class: 'icon-pick' });
  const render = () => row.replaceChildren(
    ...GROUP_ICONS.map((i) => el('button', { class: i === current ? 'active' : '', onclick: () => { current = i; onPick(i); render(); } }, i)),
    el('button', { title: 'Outro emoji', onclick: (e) => popover(e.currentTarget, emojiPicker((emo) => { closeMenu(); current = emo; onPick(emo); render(); }), { className: 'emoji-pop' }) }, '＋')
  );
  render();
  return row;
}

function editGroup(g) {
  let ic = g.icon;
  const name = el('input', { class: 'input', value: g.name, maxlength: 40 });
  modal({
    title: 'Editar grupo',
    content: el('div', {}, el('label', { class: 'field' }, el('span', {}, 'Nome'), name), el('div', { class: 'field' }, el('span', {}, 'Ícone'), iconPicker(ic, (i) => (ic = i)))),
    actions: [
      { label: 'Cancelar', onClick: (c) => c() },
      { label: 'Salvar', primary: true, onClick: async (c) => { await api.patch(`/groups/${g.id}`, { name: name.value, icon: ic }); c(); } },
    ],
  });
}

function leaveGroup(g) {
  modal({
    title: 'Sair do grupo?',
    content: el('p', {}, `Você vai sair de "${g.name}". Se for a última pessoa, o grupo e as mensagens são apagados.`),
    actions: [
      { label: 'Cancelar', onClick: (c) => c() },
      { label: 'Sair', danger: true, onClick: async (c) => { await api.del(`/groups/${g.id}/members/me`); c(); } },
    ],
  });
}

function newGroupDialog(startTab = 'create') {
  let ic = '🎮';
  const name = el('input', { class: 'input', placeholder: 'Ex.: Resenha da noite', maxlength: 40 });
  const code = el('input', { class: 'input code-input', placeholder: 'ABCD1234', maxlength: 8 });
  const createPane = el('div', {}, el('label', { class: 'field' }, el('span', {}, 'Nome do grupo'), name), el('div', { class: 'field' }, el('span', {}, 'Ícone'), iconPicker(ic, (i) => (ic = i))));
  const joinPane = el('div', {}, el('label', { class: 'field' }, el('span', {}, 'Código de convite'), code), el('p', { class: 'muted small' }, 'Peça o código pra quem criou o grupo (botão direito no ícone do grupo → Convite).'));
  let tab = startTab;
  const tabs = el('div', { class: 'seg big' });
  const body = el('div');
  const render = () => {
    tabs.replaceChildren(
      el('button', { class: tab === 'create' ? 'active' : '', onclick: () => { tab = 'create'; render(); } }, '✨ Criar grupo'),
      el('button', { class: tab === 'join' ? 'active' : '', onclick: () => { tab = 'join'; render(); } }, '🔗 Tenho um convite')
    );
    body.replaceChildren(tab === 'create' ? createPane : joinPane);
    setTimeout(() => (tab === 'create' ? name : code).focus(), 30);
  };
  render();
  const submit = async (c) => {
    try {
      const { group } = tab === 'create' ? await api.post('/groups', { name: name.value, icon: ic }) : await api.post('/groups/join', { code: code.value });
      c();
      app.groups.set(group.id, group);
      selectGroup(group.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const m = modal({ title: 'Grupos', content: el('div', {}, tabs, body), actions: [{ label: 'Cancelar', onClick: (c) => c() }, { label: 'Continuar', primary: true, onClick: submit }] });
  [name, code].forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && submit(m.close)));
}

function setupStatic() {
  $('#btn-new-group').onclick = () => newGroupDialog('create');
  $('#btn-home').onclick = () => selectGroup(null);
  setIcon($('#btn-group-menu'), 'chevron-down', 18);
  $('#btn-group-menu').onclick = (e) => {
    const g = app.group(app.currentGroupId);
    const r = e.currentTarget.getBoundingClientRect();
    if (g) groupMenu(g, r.left, r.bottom + 4);
  };
  $('#btn-join-call').onclick = () => {
    const voice = roomVoice();
    if (!voice) return;
    if (app.call.active && app.call.channelId === voice.id) app.call.leave();
    else joinVoice(voice.id);
  };
  $('#btn-toggle-chat').onclick = () => app.toggleChat();
  setIcon($('#vp-leave'), 'phone-off', 18);
  $('#vp-leave').onclick = () => app.call.leave();
  $('#voice-panel').onclick = (e) => {
    if (e.target.closest('#vp-leave')) return;
    if (!app.call.active) return;
    const g = app.group(app.call.groupId);
    selectGroup(app.call.groupId, g?.isDm ? undefined : app.call.channelId);
  };
  $('#me-mic').onclick = () => app.call.toggleMute();
  $('#me-deaf').onclick = () => app.call.toggleDeafen();
  setIcon($('#me-settings'), 'settings', 18);
  $('#me-settings').onclick = () => app.openSettings('account');
  $('#me-card').onclick = (e) => openProfile(app, app.me, e.clientX, e.clientY);

  // botão de menu no celular
  const menuBtn = el('button', { class: 'icon-btn mobile-only', onclick: () => $('#app').classList.toggle('nav-open') }, icon('more', 18));
  $('.chat-title').prepend(menuBtn);
  $('#main').addEventListener('click', (e) => {
    if ($('#app').classList.contains('nav-open') && !e.target.closest('.mobile-only')) $('#app').classList.remove('nav-open');
  });

  // divisória entre o palco e o chat
  const rz = $('#room-resizer');
  rz.addEventListener('pointerdown', (e) => {
    rz.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-x');
    const chat = $('#chat');
    const start = e.clientX;
    const w0 = chat.getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.max(260, Math.min(window.innerWidth * 0.7, w0 - (ev.clientX - start)));
      chat.style.width = w + 'px';
      save('chat-width', Math.round(w));
      app.call.stage.scheduleRender();
    };
    const up = () => {
      document.body.classList.remove('resizing-x');
      rz.removeEventListener('pointermove', move);
      rz.removeEventListener('pointerup', up);
    };
    rz.addEventListener('pointermove', move);
    rz.addEventListener('pointerup', up);
  });
}


// =====================================================================
(async function boot() {
  try {
    const { user } = await api.get('/me');
    start(user);
  } catch {
    showAuth();
  }
})();
