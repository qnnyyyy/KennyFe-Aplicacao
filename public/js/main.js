// Kenfeh — inicialização, login, grupos e navegação.
import { el, $, $$, icon, setIcon, avatar, toast, modal, prompt, contextMenu, onContext, store, save, sfx } from './ui.js';
import { api } from './api.js';
import { Chat } from './chat.js';
import { CallController } from './call/call.js';
import { openSettings } from './settings-ui.js';
import { emojiPicker } from './emoji.js';
import { popover, closeMenu } from './ui.js';

const GROUP_ICONS = ['🎮', '🍿', '🎬', '🎧', '🔥', '⚡', '🌙', '👾', '🏆', '🐱', '✨', '🍕'];

const app = {
  me: null,
  socket: null,
  groups: new Map(),
  currentGroupId: store('current-group', null),
  online: new Set(),
  calls: new Map(), // groupId -> participants
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
      const body = { username: form.username.value, password: form.password.value, displayName: form.displayName.value, accessCode: form.accessCode.value };
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
  $('#welcome-name').textContent = user.displayName;

  const socket = (app.socket = io({ transports: ['websocket', 'polling'] }));
  app.chat = new Chat(app);
  app.call = new CallController(app);

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') location.reload();
  });
  socket.on('groups:update', ({ groups }) => {
    app.groups = new Map(groups.map((g) => [g.id, g]));
    const me = groups.flatMap((g) => g.members).find((m) => m.id === app.me.id);
    if (me) Object.assign(app.me, me);
    if (!app.groups.has(app.currentGroupId)) app.currentGroupId = groups[0]?.id ?? null;
    renderAll();
    if (app.currentGroupId && app.chat.groupId !== app.currentGroupId) selectGroup(app.currentGroupId);
    if (app.call.active) app.call.refreshTiles();
  });
  socket.on('presence', ({ online }) => {
    app.online = new Set(online);
    renderMembers();
  });
  socket.on('calls:update', ({ groupId, participants }) => {
    app.calls.set(groupId, participants);
    renderRail();
    renderVoiceUsers();
    renderRoomHeader();
  });
  socket.on('call:ring', ({ groupId, userId }) => {
    if (app.call.active && app.call.groupId === groupId) return;
    const g = app.group(groupId);
    sfx('ring');
    toast(el('div', { class: 'ring-toast' }, el('span', {}, `📞 ${app.userName(userId)} começou uma call em ${g?.name || 'um grupo'}`), el('button', { class: 'btn btn-primary btn-sm', onclick: () => { selectGroup(groupId); app.call.join(groupId); } }, 'Entrar')), 'info', 10000);
    app.notify({ groupId, author: app.user(userId), type: 'text', content: '📞 começou uma call — vem!' });
  });

  setupStatic();
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
  const lastId = Math.max(g.lastMessageId || 0, ...[...app.chat.messages.keys()]);
  app.lastRead[groupId] = lastId;
  save('last-read', app.lastRead);
  renderRail();
};

app.onUnread = (m) => {
  const g = app.group(m.groupId);
  if (g) g.lastMessageId = Math.max(g.lastMessageId || 0, m.id);
  if (m.groupId === app.currentGroupId && !document.hidden) app.markRead(m.groupId);
  renderRail();
};

app.notify = (m) => {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const g = app.group(m.groupId);
  const body = m.type === 'text' ? m.content : { sticker: '🌟 figurinha', gif: '🎞️ GIF', image: '🖼️ imagem', video: '🎥 vídeo', audio: '🎵 áudio', file: '📎 arquivo' }[m.type];
  try {
    const n = new Notification(`${m.author?.displayName || ''} • ${g?.name || 'Kenfeh'}`, { body, icon: m.author?.avatarUrl || undefined, tag: 'kf-' + m.groupId });
    n.onclick = () => { window.focus(); selectGroup(m.groupId); n.close(); };
  } catch {}
};

app.onCallChanged = () => {
  renderAll();
};

app.renderMeBar = () => renderMeBar();
app.renderVoiceUsers = () => renderVoiceUsers();

document.addEventListener('visibilitychange', () => !document.hidden && app.currentGroupId && app.markRead(app.currentGroupId));

function selectGroup(id) {
  app.currentGroupId = id;
  save('current-group', id);
  $('#app').classList.remove('nav-open');
  renderAll();
  if (id) app.chat.open(id);
}

// =====================================================================
// RENDER
// =====================================================================
function renderAll() {
  renderRail();
  renderSidebar();
  renderMembers();
  renderVoiceUsers();
  renderMeBar();
  renderRoomHeader();
  renderRoomLayout();
}

function renderRail() {
  const rail = $('#group-rail');
  rail.replaceChildren(
    ...[...app.groups.values()].map((g) => {
      const unread = (g.lastMessageId || 0) > (app.lastRead[g.id] || 0) && g.id !== app.currentGroupId;
      const inCall = (app.calls.get(g.id) || []).length > 0;
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
  $('#sidebar-title').textContent = g ? `${g.icon} ${g.name}` : 'Kenfeh';
  $('#btn-group-menu').classList.toggle('hidden', !g);
  $('.sidebar-body').classList.toggle('hidden', !g);
}

function renderMembers() {
  const g = app.group(app.currentGroupId);
  const box = $('#members');
  if (!g) return box.replaceChildren();
  const sorted = [...g.members].sort((a, b) => Number(app.online.has(b.id)) - Number(app.online.has(a.id)));
  box.replaceChildren(
    ...sorted.map((m) => {
      const on = app.online.has(m.id);
      const row = el('div', { class: `member ${on ? 'online' : 'offline'}` },
        el('div', { class: 'member-av' }, avatar(m, 32), el('span', { class: 'presence' })),
        el('div', { class: 'member-info' }, el('b', { style: { color: m.color } }, m.displayName, m.role === 'owner' ? ' 👑' : ''), el('small', {}, m.statusText || (on ? 'online' : 'offline')))
      );
      onContext(row, (x, y) => userMenu(m, x, y));
      return row;
    })
  );
}

function userMenu(m, x, y) {
  const items = [{ type: 'title', label: `${m.displayName} (@${m.username})` }];
  if (app.call.active) {
    const peer = [...app.call.remotes.entries()].find(([, r]) => r.userId === m.id);
    if (peer) items.push(...app.call.userMenuItems(m.id, peer[0]));
  }
  items.push({ label: 'Copiar @usuário', icon: 'copy', onClick: () => navigator.clipboard.writeText(m.username) });
  if (m.id === app.me.id) items.push({ label: 'Editar perfil', icon: 'edit', onClick: () => app.openSettings('account') });
  contextMenu(x, y, items);
}

function renderVoiceUsers() {
  const g = app.group(app.currentGroupId);
  const box = $('#voice-users');
  if (!g) return box.replaceChildren();
  const parts = app.calls.get(g.id) || [];
  $('#call-count').textContent = parts.length ? parts.length : '';
  box.replaceChildren(
    ...parts.map((p) => {
      const u = app.user(p.userId) || { displayName: 'Alguém', id: p.userId };
      const streams = Object.values(p.state?.streams || {});
      const live = streams.filter((s) => s.type === 'screen').length;
      const cam = streams.some((s) => s.type === 'camera');
      const row = el('div', { class: 'voice-user', dataset: { voiceUser: u.id } },
        avatar(u, 24),
        el('span', { class: 'vu-name' }, u.displayName),
        el('span', { class: 'vu-icons' },
          live ? el('span', { class: 'live-pill' }, live > 1 ? `AO VIVO ×${live}` : 'AO VIVO') : null,
          cam ? icon('video', 14) : null,
          p.state?.deafened ? icon('headphones-off', 14) : p.state?.muted ? icon('mic-off', 14) : null
        )
      );
      onContext(row, (x, y) => userMenu(u, x, y));
      return row;
    })
  );
  // painel "na call" embaixo
  const inCall = app.call.active;
  $('#voice-panel').classList.toggle('hidden', !inCall);
  if (inCall) {
    const cg = app.group(app.call.groupId);
    $('#vp-group').textContent = cg ? `${cg.icon} ${cg.name}` : '';
  }
  $('#channel-voice').classList.toggle('active', inCall && app.call.groupId === app.currentGroupId);
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

function renderRoomHeader() {
  const g = app.group(app.currentGroupId);
  if (!g) return;
  $('#chat-icon').textContent = g.icon;
  $('#chat-name').textContent = g.name;
  const btn = $('#btn-join-call');
  const here = app.call.active && app.call.groupId === g.id;
  const count = (app.calls.get(g.id) || []).length;
  btn.replaceChildren(icon(here ? 'phone-off' : 'phone', 16), el('span', {}, here ? 'Sair da call' : count ? `Entrar na call (${count})` : 'Iniciar call'));
  btn.classList.toggle('danger', here);
  btn.classList.toggle('pulse', !here && count > 0);
}

function renderRoomLayout() {
  const g = app.group(app.currentGroupId);
  $('#welcome').classList.toggle('hidden', Boolean(g));
  $('#room').classList.toggle('hidden', !g);
  const showStage = app.call.active && app.call.groupId === app.currentGroupId;
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
  contextMenu(x, y, [
    { type: 'title', label: `${g.icon} ${g.name}` },
    { label: `Convite: ${g.inviteCode} (copiar)`, icon: 'link', onClick: () => { navigator.clipboard.writeText(g.inviteCode); toast('Código copiado! Manda pra quem você quer chamar.', 'success'); } },
    { label: 'Adicionar pessoa pelo @usuário', icon: 'plus', onClick: () => addMember(g) },
    { label: 'Renomear / trocar ícone', icon: 'edit', onClick: () => editGroup(g) },
    { label: 'Gerar novo convite', icon: 'link', onClick: () => api.post(`/groups/${g.id}/invite/reset`).then(() => toast('Novo código gerado.')) },
    { type: 'sep' },
    { label: 'Sair do grupo', icon: 'log-out', danger: true, onClick: () => leaveGroup(g) },
  ]);
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
  $('#welcome-create').onclick = () => newGroupDialog('create');
  $('#welcome-join').onclick = () => newGroupDialog('join');
  setIcon($('#btn-group-menu'), 'chevron-down', 18);
  $('#btn-group-menu').onclick = (e) => {
    const g = app.group(app.currentGroupId);
    const r = e.currentTarget.getBoundingClientRect();
    if (g) groupMenu(g, r.left, r.bottom + 4);
  };
  $('[data-icon="volume"]').replaceChildren(icon('volume', 16));
  $('#channel-chat').onclick = () => {
    $('#app').classList.remove('nav-open');
    if (app.chatHidden) app.toggleChat();
    $('#msg-input').focus();
  };
  $('#channel-voice').onclick = () => joinCurrent();
  $('#btn-join-call').onclick = () => {
    const g = app.group(app.currentGroupId);
    if (app.call.active && app.call.groupId === g?.id) app.call.leave();
    else joinCurrent();
  };
  $('#btn-toggle-chat').onclick = () => app.toggleChat();
  setIcon($('#vp-leave'), 'phone-off', 18);
  $('#vp-leave').onclick = () => app.call.leave();
  $('#voice-panel').onclick = (e) => {
    if (e.target.closest('#vp-leave')) return;
    if (app.call.active) selectGroup(app.call.groupId);
  };
  $('#me-mic').onclick = () => app.call.toggleMute();
  $('#me-deaf').onclick = () => app.call.toggleDeafen();
  setIcon($('#me-settings'), 'settings', 18);
  $('#me-settings').onclick = () => app.openSettings('account');
  $('#me-card').onclick = () => app.openSettings('account');

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

async function joinCurrent() {
  const id = app.currentGroupId;
  if (!id) return;
  try {
    await app.call.join(id);
  } catch (err) {
    console.error(err);
    toast('Não foi possível entrar na call: ' + err.message, 'error');
    app.call.active && app.call.leave();
  }
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
