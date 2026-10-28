// Canais (texto e voz), classes com cor e permissões, lista de membros e configurações do grupo.
import { el, $, icon, avatar, toast, modal, contextMenu, onContext, popover, closeMenu } from './ui.js';
import { api } from './api.js';
import { emojiPicker } from './emoji.js';
import { openProfile, activityLine } from './profile.js';

const ROLE_COLORS = ['#ff4fa3', '#7b5cff', '#3d8bff', '#38d6ff', '#3ddc97', '#ffcc4d', '#ff9f40', '#ff4d6d', '#c7a4ff', '#9aa4c3'];
let PERMS = null;
const loadPerms = async () => (PERMS ||= (await api.get('/perms')).perms);

// ---------------- permissões e classes ----------------
export function can(app, g, perm) {
  if (!g) return false;
  if (g.isDm || g.ownerId === app.me.id) return true;
  return Boolean(g.myPerms?.includes(perm) || g.myPerms?.includes('admin'));
}

export function rolesOf(g, userId) {
  const ids = new Set(g?.memberRoles?.[userId] || []);
  return (g?.roles || []).filter((r) => ids.has(r.id)); // já vem da mais alta para a mais baixa
}

// cor do nome = cor da classe mais alta (como no Discord); sem classe, a cor da pessoa
export function nameColor(app, g, user) {
  if (!user) return null;
  const r = rolesOf(g, user.id).find((x) => x.color && x.color !== '#9aa4c3');
  return r?.color || user.color;
}

export function roleBadge(r) {
  return el('span', { class: 'role-chip', style: { '--rc': r.color } }, el('i'), r.icon ? r.icon + ' ' : '', r.name);
}

// ---------------- lista de canais na barra lateral ----------------
export function renderChannels(app, box, { selectChannel, joinVoice, userMenu, openSettings }) {
  const g = app.group(app.currentGroupId);
  if (!g || g.isDm) return box.replaceChildren();
  const manage = can(app, g, 'manage_channels');
  const text = g.channels.filter((c) => c.kind === 'text');
  const voice = g.channels.filter((c) => c.kind === 'voice');
  const cur = app.currentChannelId;
  const head = (label, kind) =>
    el('div', { class: 'sidebar-section with-action ch-section' }, el('span', {}, label),
      manage ? el('button', { class: 'icon-btn sm', title: kind === 'voice' ? 'Criar canal de voz' : 'Criar canal de texto', onclick: () => channelDialog(app, g, null, kind) }, icon('plus', 14)) : null);

  const flags = (c) => [
    c.locked ? el('span', { class: 'ch-flag', title: c.kind === 'voice' ? 'Trancada: só classes liberadas entram' : 'Só leitura para quem não tem acesso' }, icon('lock', 12)) : null,
    c.hidden ? el('span', { class: 'ch-flag', title: 'Invisível para quem não tem acesso' }, icon('eye-off', 12)) : null,
  ];
  const chMenu = (c, x, y) => {
    const items = [{ type: 'title', label: `${c.kind === 'voice' ? '🔊' : '#'} ${c.name}` }];
    if (c.kind === 'voice') items.push({ label: app.call.channelId === c.id ? 'Sair da call' : 'Entrar na call', icon: 'phone', onClick: () => (app.call.channelId === c.id ? app.call.leave() : joinVoice(c.id)) });
    items.push({ label: 'Copiar nome', icon: 'copy', onClick: () => navigator.clipboard.writeText(c.name) });
    if (manage) {
      items.push({ type: 'sep' }, { label: 'Editar canal', icon: 'edit', onClick: () => channelDialog(app, g, c) },
        { label: 'Mover para cima', icon: 'chevron-down', onClick: () => api.post(`/channels/${c.id}/move`, { dir: -1 }) },
        { label: 'Mover para baixo', icon: 'chevron-down', onClick: () => api.post(`/channels/${c.id}/move`, { dir: 1 }) },
        { label: 'Apagar canal', icon: 'trash', danger: true, onClick: () => deleteChannel(c) });
    }
    contextMenu(x, y, items);
  };

  const textRow = (c) => {
    const unread = (c.lastMessageId || 0) > (app.lastRead['c' + c.id] || 0) && c.id !== cur;
    const row = el('div', { class: `channel ${c.id === cur ? 'active' : ''} ${unread ? 'unread' : ''}`, onclick: () => selectChannel(c.id) },
      el('span', { class: 'ch-ic' }, c.emoji || icon('hash', 16)),
      el('span', { class: 'ch-name' }, c.name),
      ...flags(c),
      manage ? el('button', { class: 'ch-gear', title: 'Editar canal', onclick: (e) => { e.stopPropagation(); channelDialog(app, g, c); } }, icon('settings', 14)) : null);
    onContext(row, (x, y) => chMenu(c, x, y));
    return row;
  };

  const voiceRow = (c) => {
    const parts = app.calls.get(c.id) || [];
    const music = app.music?.stateOf(c.id);
    const here = app.call.channelId === c.id;
    const live = parts.some((p) => Object.values(p.state?.streams || {}).some((s) => s.type === 'screen'));
    const row = el('div', { class: `channel voice ${here ? 'connected' : ''} ${c.id === cur ? 'active' : ''} ${!c.canEnter ? 'no-enter' : ''}`, onclick: () => joinVoice(c.id), dataset: { voiceChannel: c.id } },
      el('span', { class: 'ch-ic' }, c.emoji || icon('volume', 16)),
      el('span', { class: 'ch-name' }, c.name),
      live ? el('span', { class: 'live-pill sm' }, 'AO VIVO') : null,
      ...flags(c),
      parts.length || c.userLimit ? el('span', { class: `call-count ${c.userLimit && parts.length >= c.userLimit ? 'full' : ''}` }, c.userLimit ? `${parts.length}/${c.userLimit}` : parts.length) : null,
      manage ? el('button', { class: 'ch-gear', title: 'Editar canal', onclick: (e) => { e.stopPropagation(); channelDialog(app, g, c); } }, icon('settings', 14)) : null);
    onContext(row, (x, y) => chMenu(c, x, y));
    // arrastar alguém para este canal (quem pode mover)
    if (can(app, g, 'move_members')) {
      row.addEventListener('dragover', (e) => e.dataTransfer.types.includes('text/kf-user') && (e.preventDefault(), row.classList.add('drop')));
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => {
        row.classList.remove('drop');
        const uid = Number(e.dataTransfer.getData('text/kf-user'));
        if (uid) app.socket.emit('call:mod', { action: 'move', userId: uid, channelId: c.id }, (r) => r?.error && toast(r.error, 'error'));
      });
    }
    const users = parts.map((p) => {
      const u = app.user(p.userId) || { displayName: 'Alguém', id: p.userId };
      const streams = Object.values(p.state?.streams || {});
      const screens = streams.filter((s) => s.type === 'screen').length;
      const ur = el('div', { class: 'voice-user', dataset: { voiceUser: u.id }, draggable: can(app, g, 'move_members') ? 'true' : null },
        avatar(u, 22),
        el('span', { class: 'vu-name', style: { color: nameColor(app, g, u) } }, u.displayName),
        el('span', { class: 'vu-icons' },
          screens ? el('span', { class: 'live-pill' }, screens > 1 ? `AO VIVO ×${screens}` : 'AO VIVO') : null,
          streams.some((s) => s.type === 'camera') ? icon('video', 13) : null,
          pingBadge(app, p.peerId),
          p.state?.serverMuted ? el('span', { class: 'srv-mute', title: 'Mutado por um moderador' }, icon('mic-off', 13)) : p.state?.deafened ? icon('headphones-off', 13) : p.state?.muted ? icon('mic-off', 13) : null));
      ur.addEventListener('click', (e) => { e.stopPropagation(); openProfile(app, u, e.clientX, e.clientY); });
      ur.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/kf-user', String(u.id)));
      onContext(ur, (x, y) => userMenu(u, x, y));
      return ur;
    });
    if (music?.current) {
      users.push(el('div', { class: 'voice-user bot', title: music.current.title, onclick: (e) => e.stopPropagation() },
        el('span', { class: 'bot-av' }, '🎧'),
        el('span', { class: 'vu-name' }, el('b', {}, 'KenBeat '), el('small', {}, music.pausedAt ? '⏸ ' : '♪ ', music.current.title)),
        music.pausedAt ? null : el('span', { class: 'eq' }, el('i'), el('i'), el('i'))));
    }
    return el('div', { class: 'voice-block' }, row, users.length ? el('div', { class: 'voice-users' }, users) : null);
  };

  box.replaceChildren(
    head('Canais de texto', 'text'),
    ...text.map(textRow),
    head('Canais de voz', 'voice'),
    ...voice.map(voiceRow),
    ...(!text.length && !voice.length ? [el('p', { class: 'muted small side-empty' }, 'Nenhum canal visível para você.')] : [])
  );
}

function pingBadge(app, peerId) {
  const ms = app.call.active ? app.call.remotes.get(peerId)?.ping : null;
  if (ms == null) return null;
  return el('span', { class: `ping ${ms < 60 ? 'good' : ms < 140 ? 'ok' : 'bad'}`, title: 'Ping até você' }, `${ms} ms`);
}

function deleteChannel(c) {
  modal({
    title: `Apagar ${c.kind === 'voice' ? '🔊' : '#'} ${c.name}?`,
    content: el('p', {}, c.kind === 'voice' ? 'Quem estiver na call vai ser desconectado.' : 'Todas as mensagens desse canal serão apagadas para sempre.'),
    actions: [
      { label: 'Cancelar', onClick: (x) => x() },
      { label: 'Apagar', danger: true, onClick: async (x) => { try { await api.del(`/channels/${c.id}`); x(); } catch (err) { toast(err.message, 'error'); } } },
    ],
  });
}

// ---------------- criar / editar canal ----------------
export function channelDialog(app, g, ch, kind = ch?.kind || 'text') {
  const isNew = !ch;
  const st = { kind, emoji: ch?.emoji || '', locked: ch?.locked || false, hidden: ch?.hidden || false, userLimit: ch?.userLimit || 0, allowRoles: new Set(ch?.allowRoles || []) };
  const name = el('input', { class: 'input', value: ch?.name || '', maxlength: 32, placeholder: kind === 'voice' ? 'Ex.: Ranked 🎯' : 'ex.: memes' });
  const topic = el('input', { class: 'input', value: ch?.topic || '', maxlength: 160, placeholder: 'Sobre o que é esse canal (opcional)' });
  const limit = el('input', { class: 'input', type: 'number', min: 0, max: 99, value: st.userLimit });
  const body = el('div', { class: 'ch-dialog' });
  const emojiBtn = el('button', { class: 'emoji-btn', title: 'Emoji do canal', onclick: (e) => popover(e.currentTarget, emojiPicker((emo) => { closeMenu(); st.emoji = emo; render(); }), { className: 'emoji-pop' }) });
  const sw = (label, desc, key) => el('label', { class: 'switch-row' }, el('input', { type: 'checkbox', checked: st[key], onchange: (e) => { st[key] = e.target.checked; render(); } }), el('span', { class: 'switch' }), el('div', {}, el('b', {}, label), el('small', {}, desc)));
  const render = () => {
    emojiBtn.replaceChildren(st.emoji || (st.kind === 'voice' ? '🔊' : '#'));
    body.replaceChildren(
      isNew ? el('div', { class: 'kind-pick' },
        ['text', 'voice'].map((k) => el('button', { class: `kind-card ${st.kind === k ? 'active' : ''}`, onclick: () => { st.kind = k; render(); } },
          el('span', { class: 'kind-ic' }, k === 'voice' ? '🔊' : '#'),
          el('div', {}, el('b', {}, k === 'voice' ? 'Voz e vídeo' : 'Texto'), el('small', {}, k === 'voice' ? 'Call com tela, câmera, música e chat próprio' : 'Mensagens, figurinhas, GIFs e comandos'))))) : null,
      el('div', { class: 'field' }, el('span', {}, 'Nome do canal'), el('div', { class: 'name-row' }, emojiBtn, name)),
      el('label', { class: 'field' }, el('span', {}, 'Descrição'), topic),
      st.kind === 'voice' ? el('label', { class: 'field' }, el('span', {}, 'Limite de pessoas (0 = sem limite)'), limit) : null,
      el('div', { class: 'section-label' }, '🔐 Privacidade'),
      sw(st.kind === 'voice' ? 'Call trancada' : 'Só leitura', st.kind === 'voice' ? 'Só entra quem tem "Entrar em calls trancadas", as classes liberadas abaixo, ou quem alguém de dentro deixar entrar (bater na porta).' : 'Todo mundo lê, mas só as classes liberadas (e quem gerencia canais) escrevem. Bom para avisos.', 'locked'),
      sw('Canal invisível', 'Some da lista para quem não tem "Ver canais invisíveis" nem uma das classes liberadas.', 'hidden'),
      st.locked || st.hidden
        ? el('div', { class: 'field' }, el('span', {}, 'Classes liberadas'),
            g.roles.length
              ? el('div', { class: 'role-picks' }, g.roles.map((r) => el('button', { class: `role-pick ${st.allowRoles.has(r.id) ? 'on' : ''}`, style: { '--rc': r.color }, onclick: () => { st.allowRoles.has(r.id) ? st.allowRoles.delete(r.id) : st.allowRoles.add(r.id); render(); } }, el('i'), r.name)))
              : el('p', { class: 'muted small' }, 'Crie classes em Configurações do grupo → Classes para liberar só para algumas pessoas.'))
        : null
    );
  };
  render();
  const submit = async (close) => {
    const payload = { kind: st.kind, name: name.value, emoji: st.emoji, topic: topic.value, locked: st.locked, hidden: st.hidden, userLimit: Number(limit.value) || 0, allowRoles: [...st.allowRoles] };
    try {
      if (isNew) {
        const { channel } = await api.post(`/groups/${g.id}/channels`, payload);
        close();
        // a lista nova pode chegar antes ou depois da resposta
        if (app.channel(channel.id)) app.selectGroup(g.id, channel.id);
        else app.pendingChannel = channel.id;
      } else {
        await api.patch(`/channels/${ch.id}`, payload);
        close();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const m = modal({
    title: isNew ? 'Criar canal' : `Editar ${ch.kind === 'voice' ? '🔊' : '#'} ${ch.name}`,
    content: body,
    actions: [
      ...(isNew ? [] : [{ label: 'Apagar', danger: true, onClick: (x) => { x(); deleteChannel(ch); } }]),
      { label: 'Cancelar', onClick: (x) => x() },
      { label: isNew ? 'Criar canal' : 'Salvar', primary: true, onClick: submit },
    ],
  });
  name.addEventListener('keydown', (e) => e.key === 'Enter' && submit(m.close));
  setTimeout(() => name.focus(), 50);
}

// ---------------- lista de membros (separada por classe) ----------------
export function renderMembers(app, box, { userMenu }) {
  const g = app.group(app.currentGroupId);
  if (!g) return box.replaceChildren();
  const hoisted = (g.roles || []).filter((r) => r.hoist);
  const sections = new Map(hoisted.map((r) => [r.id, []]));
  const onlineRest = [];
  const offline = [];
  for (const m of g.members) {
    if (!app.online.has(m.id)) offline.push(m);
    else {
      const top = rolesOf(g, m.id).find((r) => r.hoist);
      (top ? sections.get(top.id) : onlineRest).push(m);
    }
  }
  const row = (m) => {
    const on = app.online.has(m.id);
    const r = el('div', { class: `member ${on ? 'online' : 'offline'}` },
      el('div', { class: 'member-av' }, avatar(m, 32), el('span', { class: 'presence' })),
      el('div', { class: 'member-info' },
        el('b', { style: { color: nameColor(app, g, m) } }, m.displayName, m.id === g.ownerId && !g.isDm ? el('span', { class: 'crown', title: 'Dono do grupo' }, ' 👑') : ''),
        activityLine(m, on) ? el('small', { class: 'member-act' }, activityLine(m, on)) : el('small', {}, m.statusText || (on ? 'online' : 'offline'))));
    r.addEventListener('click', (e) => openProfile(app, m, e.clientX, e.clientY));
    onContext(r, (x, y) => userMenu(m, x, y));
    return r;
  };
  const byName = (a, b) => a.displayName.localeCompare(b.displayName);
  const out = [];
  for (const role of hoisted) {
    const list = sections.get(role.id).sort(byName);
    if (list.length) out.push(el('div', { class: 'sidebar-section role-head', style: { '--rc': role.color } }, `${role.icon ? role.icon + ' ' : ''}${role.name} — ${list.length}`), ...list.map(row));
  }
  if (onlineRest.length) out.push(el('div', { class: 'sidebar-section' }, `Online — ${onlineRest.length}`), ...onlineRest.sort(byName).map(row));
  if (offline.length) out.push(el('div', { class: 'sidebar-section' }, `Offline — ${offline.length}`), ...offline.sort(byName).map(row));
  box.replaceChildren(...out);
}

// ---------------- menu de moderação no clique direito de alguém ----------------
export function memberModItems(app, g, m) {
  if (!g || g.isDm || m.id === app.me.id) return [];
  const items = [];
  const inCallCh = [...app.calls.entries()].find(([cid, parts]) => app.callGroupOf(cid) === g.id && parts.some((p) => p.userId === m.id));
  if (inCallCh) {
    const [cid, parts] = inCallCh;
    const p = parts.find((x) => x.userId === m.id);
    const mod = (action, extra = {}) => app.socket.emit('call:mod', { action, userId: m.id, ...extra }, (r) => (r?.error ? toast(r.error, 'error') : toast('Feito!', 'success')));
    if (can(app, g, 'mute_members')) items.push({ label: p?.state?.serverMuted ? 'Desmutar na call' : 'Mutar na call (moderação)', icon: 'mic-off', onClick: () => mod(p?.state?.serverMuted ? 'unmute' : 'mute') });
    if (can(app, g, 'move_members')) {
      const others = g.channels.filter((c) => c.kind === 'voice' && c.id !== cid);
      others.forEach((c) => items.push({ label: `Mover para ${c.emoji || '🔊'} ${c.name}`, icon: 'volume', onClick: () => mod('move', { channelId: c.id }) }));
      items.push({ label: 'Desconectar da call', icon: 'phone-off', danger: true, onClick: () => mod('disconnect') });
    }
  }
  if (can(app, g, 'manage_roles') && g.roles.length) items.push({ label: 'Classes…', icon: 'shield', onClick: () => memberRolesDialog(app, g, m) });
  if (can(app, g, 'kick') && m.id !== g.ownerId) items.push({ label: `Expulsar ${m.displayName}`, icon: 'log-out', danger: true, onClick: () => kickDialog(app, g, m) });
  return items.length ? [{ type: 'sep' }, ...items] : [];
}

function kickDialog(app, g, m) {
  modal({
    title: `Expulsar ${m.displayName}?`,
    content: el('p', {}, `${m.displayName} sai de "${g.name}". Pode voltar se tiver o código de convite.`),
    actions: [
      { label: 'Cancelar', onClick: (x) => x() },
      { label: 'Expulsar', danger: true, onClick: async (x) => { try { await api.del(`/groups/${g.id}/members/${m.id}`); x(); } catch (err) { toast(err.message, 'error'); } } },
    ],
  });
}

function memberRolesDialog(app, g, m) {
  const sel = new Set(g.memberRoles?.[m.id] || []);
  const list = el('div', { class: 'role-picks col' });
  const render = () => list.replaceChildren(...g.roles.map((r) => el('button', { class: `role-pick ${sel.has(r.id) ? 'on' : ''}`, style: { '--rc': r.color }, onclick: () => { sel.has(r.id) ? sel.delete(r.id) : sel.add(r.id); render(); } }, el('i'), r.icon ? r.icon + ' ' : '', r.name, sel.has(r.id) ? icon('check', 14) : null)));
  render();
  modal({
    title: `Classes de ${m.displayName}`,
    content: el('div', {}, list, el('p', { class: 'muted small' }, 'Você só consegue dar ou tirar classes que estão abaixo da sua.')),
    actions: [
      { label: 'Cancelar', onClick: (x) => x() },
      { label: 'Salvar', primary: true, onClick: async (x) => { try { await api.put(`/groups/${g.id}/members/${m.id}/roles`, { roleIds: [...sel] }); x(); toast('Classes atualizadas!', 'success'); } catch (err) { toast(err.message, 'error'); } } },
    ],
  });
}

// ---------------- configurações do grupo: geral, classes, membros ----------------
export async function groupSettings(app, gid, { tab = 'general', iconPicker } = {}) {
  const perms = await loadPerms().catch(() => []);
  let current = tab;
  let roleSel = null; // id da classe aberta ou 'everyone'
  const nav = el('nav', { class: 'settings-nav' });
  const pane = el('div', { class: 'settings-pane' });
  const g = () => app.group(gid);
  const tabs = () => [
    ['general', '⚙️ Geral', can(app, g(), 'manage_group')],
    ['roles', '🛡️ Classes', can(app, g(), 'manage_roles')],
    ['members', '👥 Membros', true],
    ['channels', '📚 Canais', can(app, g(), 'manage_channels')],
  ].filter((t) => t[2]);

  const render = () => {
    if (!g()) return m.close();
    if (!tabs().some((t) => t[0] === current)) current = tabs()[0][0];
    nav.replaceChildren(...tabs().map(([id, label]) => el('button', { class: current === id ? 'active' : '', onclick: () => { current = id; render(); } }, label)));
    pane.replaceChildren({ general: generalPane, roles: rolesPane, members: membersPane, channels: channelsPane }[current]());
  };

  const generalPane = () => {
    const gg = g();
    let ic = gg.icon;
    const name = el('input', { class: 'input', value: gg.name, maxlength: 40 });
    return el('div', {},
      el('h3', {}, 'Geral'),
      el('label', { class: 'field' }, el('span', {}, 'Nome do grupo'), name),
      el('div', { class: 'field' }, el('span', {}, 'Ícone'), iconPicker(ic, (i) => (ic = i))),
      el('button', { class: 'btn btn-primary', onclick: async () => { try { await api.patch(`/groups/${gid}`, { name: name.value, icon: ic }); toast('Salvo!', 'success'); } catch (err) { toast(err.message, 'error'); } } }, 'Salvar'),
      el('div', { class: 'section-label' }, '🔗 Convite'),
      el('div', { class: 'invite-row' }, el('code', { class: 'invite-code' }, gg.inviteCode || '—'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { navigator.clipboard.writeText(gg.inviteCode); toast('Copiado!', 'success'); } }, icon('copy', 14), 'Copiar'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => api.post(`/groups/${gid}/invite/reset`).then(() => toast('Novo código gerado.')) }, 'Gerar novo')));
  };

  const permList = (selected, onToggle, { allowAdmin = true } = {}) =>
    el('div', { class: 'perm-list' }, perms.filter((p) => allowAdmin || p.id !== 'admin').map((p) =>
      el('label', { class: `switch-row ${p.id === 'admin' ? 'danger' : ''}` },
        el('input', { type: 'checkbox', checked: selected.has(p.id), disabled: !can(app, g(), p.id), onchange: (e) => onToggle(p.id, e.target.checked) }),
        el('span', { class: 'switch' }), el('div', {}, el('b', {}, p.name), el('small', {}, p.desc)))));

  const rolesPane = () => {
    const gg = g();
    const list = el('div', { class: 'role-list' },
      el('button', { class: `role-item ${roleSel === 'everyone' ? 'active' : ''}`, onclick: () => { roleSel = 'everyone'; render(); } }, el('i', { style: { background: '#9aa4c3' } }), el('span', {}, '@todos'), el('small', {}, 'base de todo mundo')),
      ...gg.roles.map((r) => el('button', { class: `role-item ${roleSel === r.id ? 'active' : ''}`, onclick: () => { roleSel = r.id; render(); } },
        el('i', { style: { background: r.color } }), el('span', { style: { color: r.color } }, (r.icon ? r.icon + ' ' : '') + r.name),
        el('small', {}, `${Object.values(gg.memberRoles || {}).filter((ids) => ids.includes(r.id)).length} pess.`))),
      el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        try {
          const { role } = await api.post(`/groups/${gid}/roles`, { name: 'nova classe', color: ROLE_COLORS[gg.roles.length % ROLE_COLORS.length], perms: [] });
          roleSel = role.id;
          setTimeout(render, 250);
        } catch (err) { toast(err.message, 'error'); }
      } }, icon('plus', 14), 'Criar classe'));
    let editor;
    if (roleSel === 'everyone') {
      const sel = new Set(gg.everyonePerms || []);
      editor = el('div', { class: 'role-editor' },
        el('h4', {}, '@todos'),
        el('p', { class: 'muted small' }, 'O que qualquer pessoa do grupo pode fazer, mesmo sem classe. As classes somam permissões por cima disso.'),
        permList(sel, (id, on) => { on ? sel.add(id) : sel.delete(id); }, { allowAdmin: false }),
        el('button', { class: 'btn btn-primary', onclick: () => api.patch(`/groups/${gid}/everyone`, { perms: [...sel] }).then(() => toast('Salvo!', 'success')).catch((e) => toast(e.message, 'error')) }, 'Salvar'));
    } else {
      const r = gg.roles.find((x) => x.id === roleSel);
      if (!r) editor = el('div', { class: 'role-editor empty' }, el('p', { class: 'muted' }, '🛡️ Classes são como cargos: dão cor ao nome, separam a lista de membros e liberam permissões (entrar em call trancada, ver canais invisíveis, moderar…). Escolha uma classe à esquerda ou crie uma.'));
      else {
        const st = { name: r.name, color: r.color, icon: r.icon, hoist: r.hoist, perms: new Set(r.perms) };
        const name = el('input', { class: 'input', value: r.name, maxlength: 32 });
        const colorIn = el('input', { type: 'color', value: r.color, class: 'color-in', oninput: (e) => { st.color = e.target.value; preview(); } });
        const prev = el('div', { class: 'role-preview' });
        const preview = () => prev.replaceChildren(avatar(app.me, 28), el('b', { style: { color: st.color } }, app.me.displayName), roleBadge({ ...r, color: st.color, name: name.value || r.name, icon: st.icon }));
        name.addEventListener('input', preview);
        const iconBtn = el('button', { class: 'emoji-btn', title: 'Emoji da classe', onclick: (e) => popover(e.currentTarget, emojiPicker((emo) => { closeMenu(); st.icon = emo; iconBtn.textContent = emo; preview(); }), { className: 'emoji-pop' }) }, st.icon || '＋');
        preview();
        editor = el('div', { class: 'role-editor' },
          el('div', { class: 'role-editor-head' }, el('h4', {}, 'Editar classe'),
            el('div', { class: 'role-move' },
              el('button', { class: 'icon-btn sm', title: 'Subir (mais importante)', onclick: () => api.post(`/roles/${r.id}/move`, { dir: -1 }).catch((e) => toast(e.message, 'error')) }, '▲'),
              el('button', { class: 'icon-btn sm', title: 'Descer', onclick: () => api.post(`/roles/${r.id}/move`, { dir: 1 }).catch((e) => toast(e.message, 'error')) }, '▼'))),
          prev,
          el('div', { class: 'field' }, el('span', {}, 'Nome e emoji'), el('div', { class: 'name-row' }, iconBtn, name)),
          el('div', { class: 'field' }, el('span', {}, 'Cor'), el('div', { class: 'color-row' }, ...ROLE_COLORS.map((c) => el('button', { class: 'swatch', style: { background: c }, onclick: () => { st.color = c; colorIn.value = c; preview(); } })), colorIn)),
          el('label', { class: 'switch-row' }, el('input', { type: 'checkbox', checked: st.hoist, onchange: (e) => (st.hoist = e.target.checked) }), el('span', { class: 'switch' }), el('div', {}, el('b', {}, 'Mostrar separado na lista de membros'), el('small', {}, 'Quem tem essa classe aparece num bloco próprio.'))),
          el('div', { class: 'section-label' }, 'Permissões'),
          permList(st.perms, (id, on) => (on ? st.perms.add(id) : st.perms.delete(id))),
          el('div', { class: 'role-actions' },
            el('button', { class: 'btn btn-danger btn-sm', onclick: () => api.del(`/roles/${r.id}`).then(() => { roleSel = null; setTimeout(render, 250); }).catch((e) => toast(e.message, 'error')) }, icon('trash', 14), 'Apagar classe'),
            el('button', { class: 'btn btn-primary', onclick: () => api.patch(`/roles/${r.id}`, { name: name.value, color: st.color, icon: st.icon, hoist: st.hoist, perms: [...st.perms] }).then(() => toast('Classe salva!', 'success')).catch((e) => toast(e.message, 'error')) }, 'Salvar')));
      }
    }
    return el('div', {}, el('h3', {}, 'Classes'), el('div', { class: 'roles-layout' }, list, editor));
  };

  const membersPane = () => {
    const gg = g();
    const q = el('input', { class: 'input', type: 'search', placeholder: 'Buscar membro…' });
    const listBox = el('div', { class: 'member-admin' });
    const fill = () => listBox.replaceChildren(...gg.members
      .filter((mm) => !q.value || (mm.displayName + mm.username).toLowerCase().includes(q.value.toLowerCase()))
      .map((mm) => el('div', { class: 'ma-row' },
        avatar(mm, 32),
        el('div', { class: 'ma-info' }, el('b', { style: { color: nameColor(app, gg, mm) } }, mm.displayName, mm.id === gg.ownerId ? ' 👑' : ''), el('small', {}, '@' + mm.username)),
        el('div', { class: 'ma-roles' }, rolesOf(gg, mm.id).map(roleBadge)),
        can(app, gg, 'manage_roles') && gg.roles.length ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => memberRolesDialog(app, gg, mm) }, icon('shield', 14), 'Classes') : null,
        can(app, gg, 'kick') && mm.id !== gg.ownerId && mm.id !== app.me.id ? el('button', { class: 'icon-btn sm danger', title: 'Expulsar', onclick: () => kickDialog(app, gg, mm) }, icon('log-out', 14)) : null)));
    q.addEventListener('input', fill);
    fill();
    return el('div', {}, el('h3', {}, `Membros (${gg.members.length})`), q, listBox);
  };

  const channelsPane = () => {
    const gg = g();
    const row = (c) => el('div', { class: 'ca-row' },
      el('span', { class: 'ch-ic' }, c.emoji || (c.kind === 'voice' ? '🔊' : '#')),
      el('b', {}, c.name),
      c.locked ? el('span', { class: 'ch-flag' }, icon('lock', 12)) : null,
      c.hidden ? el('span', { class: 'ch-flag' }, icon('eye-off', 12)) : null,
      el('small', { class: 'muted' }, c.topic || ''),
      el('div', { class: 'ca-actions' },
        el('button', { class: 'icon-btn sm', title: 'Subir', onclick: () => api.post(`/channels/${c.id}/move`, { dir: -1 }) }, '▲'),
        el('button', { class: 'icon-btn sm', title: 'Descer', onclick: () => api.post(`/channels/${c.id}/move`, { dir: 1 }) }, '▼'),
        el('button', { class: 'icon-btn sm', title: 'Editar', onclick: () => channelDialog(app, gg, c) }, icon('edit', 14))));
    return el('div', {},
      el('h3', {}, 'Canais'),
      el('div', { class: 'ca-actions-top' },
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => channelDialog(app, gg, null, 'text') }, '# Novo canal de texto'),
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => channelDialog(app, gg, null, 'voice') }, '🔊 Novo canal de voz')),
      el('div', { class: 'section-label' }, 'Texto'), ...gg.channels.filter((c) => c.kind === 'text').map(row),
      el('div', { class: 'section-label' }, 'Voz'), ...gg.channels.filter((c) => c.kind === 'voice').map(row));
  };

  const m = modal({ title: `${g().icon} ${g().name} — configurações`, content: el('div', { class: 'settings' }, nav, pane), wide: true, className: 'settings-modal group-settings', onClose: () => app.offGroupsUpdate?.(onUpdate) });
  // quando o grupo muda (alguém salvou algo), redesenha sem perder a aba
  const onUpdate = () => current !== 'general' && render();
  app.onGroupsUpdate?.(onUpdate);
  render();
}
