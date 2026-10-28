// Início (estilo Discord): amigos, pedidos, conversas diretas, calls ativas e quem está jogando.
import { el, $, icon, avatar, toast, contextMenu, onContext, sfx, timeAgo } from './ui.js';
import { api } from './api.js';
import { openProfile, activityLine } from './profile.js';
import { gameEmoji } from './gamesdata.js';
import { AdminPanel } from './admin.js';

export class Home {
  constructor(app, { selectGroup, newGroupDialog }) {
    this.app = app;
    this.selectGroup = selectGroup;
    this.newGroupDialog = newGroupDialog;
    this.tab = 'online';
    this.page = 'friends'; // friends | admin (painel do dono do site)
    this.friends = [];
    this.root = $('#home');
    this.side = $('#home-side');
    app.socket.on('friends:update', async (ev) => {
      await this.load();
      const u = this.friends.find((f) => f.user.id === ev.by)?.user;
      if (ev.type === 'request' && ev.by !== app.me.id) {
        sfx('message');
        toast(`👋 ${u ? u.displayName : 'Alguém'} quer ser seu amigo! Veja em Início → Pendentes.`, 'info', 6000);
      }
      if (ev.type === 'accepted' && ev.by !== app.me.id) toast(`🎉 ${u ? u.displayName : 'A pessoa'} aceitou seu pedido de amizade!`, 'success');
    });
    this.load();
  }

  async load() {
    try {
      this.friends = (await api.get('/friends')).friends;
    } catch {}
    this.app.renderAll();
  }

  onUserUpdate(user) {
    const f = this.friends.find((x) => x.user.id === user.id);
    if (f) f.user = { ...f.user, ...user };
  }

  get pending() {
    return this.friends.filter((f) => f.status === 'incoming');
  }

  user(id) {
    return this.friends.find((f) => f.user.id === id)?.user || null;
  }

  dms() {
    return [...this.app.groups.values()].filter((g) => g.isDm).sort((a, b) => (b.lastMessageId || 0) - (a.lastMessageId || 0));
  }

  dmOther(g) {
    return g.members.find((m) => m.id !== this.app.me.id) || g.members[0];
  }

  async openDm(userId, { call = false } = {}) {
    try {
      const { group } = await api.post(`/dm/${userId}`);
      this.app.groups.set(group.id, group);
      this.selectGroup(group.id);
      if (call) this.app.call.join(group.id).catch((e) => toast(e.message, 'error'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  badgeCount() {
    const unreadDms = this.dms().filter((g) => (g.lastMessageId || 0) > (this.app.lastRead[g.id] || 0) && g.id !== this.app.currentGroupId).length;
    return this.pending.length + unreadDms;
  }

  // ---------------- barra lateral (Amigos + conversas diretas) ----------------
  renderSide() {
    const app = this.app;
    const onHome = !app.currentGroupId;
    const dms = this.dms();
    this.side.replaceChildren(
      el('button', { class: `side-nav ${onHome && this.page === 'friends' ? 'active' : ''}`, onclick: () => this.go('friends') }, icon('users', 18), el('span', {}, 'Amigos'), this.pending.length ? el('span', { class: 'count-badge' }, this.pending.length) : null),
      ...(app.me.isAdmin ? [el('button', { class: `side-nav ${onHome && this.page === 'admin' ? 'active' : ''}`, onclick: () => this.go('admin') }, el('span', { class: 'ic' }, '📊'), el('span', {}, 'Painel do site'))] : []),
      el('button', { class: 'side-nav', onclick: () => this.newGroupDialog('create') }, icon('plus', 18), el('span', {}, 'Criar grupo')),
      el('div', { class: 'sidebar-section with-action' }, el('span', {}, 'Conversas diretas'),
        el('button', { class: 'icon-btn sm', title: 'Nova conversa', onclick: (e) => this.dmPicker(e.clientX, e.clientY) }, icon('plus', 14))),
      ...(dms.length
        ? dms.map((g) => {
            const u = this.dmOther(g);
            const on = app.online.has(u.id);
            const unread = (g.lastMessageId || 0) > (app.lastRead[g.id] || 0) && g.id !== app.currentGroupId;
            const inCall = (app.calls.get(g.id) || []).length > 0;
            const row = el('button', { class: `dm-row ${g.id === app.currentGroupId ? 'active' : ''} ${unread ? 'unread' : ''} ${on ? 'online' : 'offline'}`, onclick: () => this.selectGroup(g.id) },
              el('div', { class: 'member-av' }, avatar(u, 32), el('span', { class: 'presence' })),
              el('div', { class: 'member-info' }, el('b', {}, u.displayName), el('small', { class: activityLine(u, on) ? 'member-act' : '' }, activityLine(u, on) || u.statusText || (on ? 'online' : 'offline'))),
              inCall ? el('span', { class: 'dm-call', title: 'Call rolando' }, icon('volume', 12)) : null,
              unread ? el('span', { class: 'dm-dot' }) : null
            );
            onContext(row, (x, y) => contextMenu(x, y, [
              { type: 'title', label: u.displayName },
              { label: 'Ver perfil', icon: 'users', onClick: () => openProfile(app, u, x, y) },
              { label: 'Ligar', icon: 'phone', onClick: () => this.openDm(u.id, { call: true }) },
            ]));
            return row;
          })
        : [el('p', { class: 'muted small side-empty' }, 'Suas conversas diretas aparecem aqui. Clique em 💬 num amigo para começar.')])
    );
  }

  dmPicker(x, y) {
    const accepted = this.friends.filter((f) => f.status === 'accepted');
    contextMenu(x, y, [
      { type: 'title', label: 'Conversar com…' },
      ...(accepted.length ? accepted.map((f) => ({ label: f.user.displayName, icon: 'message', onClick: () => this.openDm(f.user.id) })) : [{ label: 'Adicione amigos primeiro', disabled: true }]),
    ]);
  }

  go(page) {
    this.page = page;
    if (page !== 'admin') this.admin?.hide();
    this.selectGroup(null);
  }

  // ---------------- área principal ----------------
  render() {
    const app = this.app;
    if (this.page === 'admin' && app.me.isAdmin) return this.renderAdmin();
    this.admin?.hide();
    const accepted = this.friends.filter((f) => f.status === 'accepted');
    const online = accepted.filter((f) => app.online.has(f.user.id));
    const pending = this.friends.filter((f) => f.status !== 'accepted');
    const tabs = [
      ['online', `Online (${online.length})`],
      ['all', `Todos (${accepted.length})`],
      ['pending', 'Pendentes', this.pending.length],
      ['add', 'Adicionar amigo'],
    ];
    const head = el('header', { class: 'home-head' },
      el('button', { class: 'icon-btn mobile-only', onclick: () => $('#app').classList.toggle('nav-open') }, icon('more', 18)),
      el('div', { class: 'home-title' }, icon('users', 20), el('b', {}, 'Amigos')),
      el('div', { class: 'home-tabs' },
        tabs.map(([id, label, badge]) => el('button', { class: `${this.tab === id ? 'active' : ''} ${id === 'add' ? 'add' : ''}`, onclick: () => { this.tab = id; this.render(); } }, label, badge ? el('span', { class: 'count-badge' }, badge) : null))
      )
    );

    let main;
    if (this.tab === 'add') main = this.addPane();
    else {
      const list = this.tab === 'online' ? online : this.tab === 'all' ? accepted : pending;
      main = el('div', { class: 'friend-list' },
        el('div', { class: 'list-label' }, { online: 'ONLINE', all: 'TODOS OS AMIGOS', pending: 'PEDIDOS' }[this.tab] + ` — ${list.length}`),
        ...(list.length ? list.map((f) => this.friendRow(f)) : [this.emptyState()])
      );
    }
    this.root.replaceChildren(head, el('div', { class: 'home-body' }, el('section', { class: 'home-main' }, this.hero(), main), this.nowPanel()));
  }

  renderAdmin() {
    this.admin ||= new AdminPanel(this.app);
    // o painel tem estado próprio (busca, ordenação): reaproveita o mesmo elemento
    if (this.root.querySelector('.admin') === this.admin.root) return;
    this.admin.show();
    const head = el('header', { class: 'home-head' },
      el('button', { class: 'icon-btn mobile-only', onclick: () => $('#app').classList.toggle('nav-open') }, icon('more', 18)),
      el('div', { class: 'home-title keep' }, el('span', {}, '📊'), el('b', {}, 'Painel do site')));
    this.root.replaceChildren(head, el('div', { class: 'home-body' }, el('section', { class: 'home-main admin-main' }, this.admin.root)));
  }

  hero() {
    const me = this.app.me;
    return el('div', { class: 'home-hero' },
      el('div', { class: 'hero-text' },
        el('h2', {}, `E aí, ${me.displayName}! 👋`),
        el('p', { class: 'muted' }, 'Chama a galera, abre uma call, compartilha a tela ou bota um Tetris Royale.')),
      el('div', { class: 'hero-actions' },
        el('button', { class: 'btn btn-primary', onclick: () => { this.tab = 'add'; this.render(); } }, icon('plus', 16), 'Adicionar amigo'),
        el('button', { class: 'btn btn-ghost', onclick: () => this.newGroupDialog('create') }, '✨ Criar grupo'),
        el('button', { class: 'btn btn-ghost', onclick: () => this.newGroupDialog('join') }, '🔗 Entrar com convite')),
      me.email ? null : el('div', { class: 'email-nudge' }, '📧 Sua conta ainda não tem e-mail.',
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.app.openSettings('account') }, 'Adicionar e-mail'))
    );
  }

  emptyState() {
    const txt = {
      online: ['😴', 'Ninguém online agora.', 'Quando seus amigos entrarem, eles aparecem aqui.'],
      all: ['🫂', 'Você ainda não adicionou ninguém.', 'Clique em "Adicionar amigo" e digite o @ da pessoa.'],
      pending: ['📭', 'Nenhum pedido pendente.', 'Pedidos que você enviar ou receber aparecem aqui.'],
    }[this.tab];
    return el('div', { class: 'home-empty' }, el('div', { class: 'home-empty-ic' }, txt[0]), el('b', {}, txt[1]), el('p', { class: 'muted small' }, txt[2]),
      this.tab !== 'pending' ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => { this.tab = 'add'; this.render(); } }, 'Adicionar amigo') : null);
  }

  friendRow(f) {
    const app = this.app;
    const u = f.user;
    const on = app.online.has(u.id);
    const act = activityLine(u, on);
    const btn = (ic, title, fn, cls = '') => el('button', { class: `round-btn ${cls}`, title, onclick: (e) => { e.stopPropagation(); fn(e); } }, icon(ic, 18));
    let actions;
    if (f.status === 'incoming')
      actions = [btn('check', 'Aceitar', () => this.accept(u.id), 'ok'), btn('x', 'Recusar', () => this.remove(u.id, 'Pedido recusado.'), 'bad')];
    else if (f.status === 'outgoing') actions = [el('small', { class: 'muted' }, 'Pedido enviado'), btn('x', 'Cancelar pedido', () => this.remove(u.id, 'Pedido cancelado.'), 'bad')];
    else
      actions = [
        btn('message', 'Mensagem', () => this.openDm(u.id)),
        btn('phone', 'Ligar', () => this.openDm(u.id, { call: true })),
        btn('more', 'Mais', (e) => contextMenu(e.clientX, e.clientY, [
          { label: 'Ver perfil', icon: 'users', onClick: () => openProfile(app, u, e.clientX, e.clientY) },
          { label: 'Copiar @', icon: 'copy', onClick: () => navigator.clipboard.writeText(u.username) },
          { type: 'sep' },
          { label: 'Desfazer amizade', icon: 'trash', danger: true, onClick: () => this.remove(u.id, 'Amizade desfeita.') },
        ])),
      ];
    const row = el('div', { class: `friend-row ${on ? 'online' : 'offline'}` },
      el('div', { class: 'member-av' }, avatar(u, 40), el('span', { class: 'presence' })),
      el('div', { class: 'friend-info' },
        el('b', {}, u.displayName, el('span', { class: 'muted' }, ` @${u.username}`)),
        el('small', { class: act ? 'member-act' : 'muted' }, f.status === 'incoming' ? 'Quer ser seu amigo' : act || u.statusText || (on ? 'Online' : 'Offline'))),
      el('div', { class: 'friend-actions' }, ...actions)
    );
    row.addEventListener('click', (e) => openProfile(app, u, e.clientX, e.clientY));
    return row;
  }

  addPane() {
    const input = el('input', { class: 'input', placeholder: 'Digite o @usuário da pessoa', maxlength: 24, autocapitalize: 'none' });
    const msg = el('p', { class: `add-msg ${this.addMsg?.ok ? 'ok' : 'bad'}` }, this.addMsg?.text || '');
    const send = async () => {
      const username = input.value.trim();
      if (!username) return;
      try {
        const r = await api.post('/friends', { username });
        this.addMsg = { ok: true, text: r.accepted ? 'Vocês agora são amigos! 🎉' : `Pedido enviado para @${username.replace(/^@/, '')}! ✅` };
      } catch (err) {
        this.addMsg = { ok: false, text: err.message };
      }
      await this.load();
      if (this.tab === 'add') this.render();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && send());
    setTimeout(() => input.focus(), 30);
    return el('div', { class: 'add-pane' },
      el('h3', {}, 'Adicionar amigo'),
      el('p', { class: 'muted' }, 'Mande um pedido usando o nome de usuário (o @) da pessoa.'),
      el('div', { class: 'add-box' }, el('span', { class: 'at' }, '@'), input, el('button', { class: 'btn btn-primary', onclick: send }, 'Enviar pedido')),
      msg,
      el('div', { class: 'my-tag' },
        el('span', {}, 'Seu usuário pra passar pra galera: '),
        el('b', {}, '@' + this.app.me.username),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { navigator.clipboard.writeText(this.app.me.username); toast('Copiado!'); } }, icon('copy', 14), 'Copiar'))
    );
  }

  // painel da direita: calls ativas, quem está jogando, seus grupos
  nowPanel() {
    const app = this.app;
    const calls = [...app.calls.entries()].filter(([gid, parts]) => parts.length && app.groups.has(gid));
    const playing = this.friends.filter((f) => f.status === 'accepted' && f.user.activity && app.online.has(f.user.id));
    const groups = [...app.groups.values()].filter((g) => !g.isDm);
    return el('aside', { class: 'home-now' },
      el('h4', {}, '🔴 Rolando agora'),
      calls.length
        ? calls.map(([gid, parts]) => {
            const g = app.groups.get(gid);
            const names = parts.map((p) => app.userName(p.userId));
            return el('div', { class: 'now-card call' },
              el('div', { class: 'now-top' }, el('b', {}, app.groupTitle(g)), el('span', { class: 'live-pill' }, `${parts.length} na call`)),
              el('small', { class: 'muted' }, names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '')),
              el('button', { class: 'btn btn-call btn-sm', onclick: () => { this.selectGroup(gid); app.call.join(gid); } }, icon('phone', 14), 'Entrar'));
          })
        : el('p', { class: 'muted small' }, 'Nenhuma call agora.'),
      el('h4', {}, '🎮 Jogando agora'),
      playing.length
        ? playing.map((f) => el('div', { class: 'now-card', onclick: (e) => openProfile(app, f.user, e.clientX, e.clientY) },
            el('div', { class: 'now-top' }, avatar(f.user, 28), el('b', {}, f.user.displayName)),
            el('div', { class: 'now-game' }, el('span', {}, gameEmoji(f.user.activity.name)), el('div', {}, el('b', {}, f.user.activity.name), el('small', { class: 'muted' }, timeAgo(f.user.activity.since))))))
        : el('p', { class: 'muted small' }, 'Quando um amigo estiver jogando, aparece aqui.'),
      el('h4', {}, '🏠 Seus grupos'),
      groups.length
        ? el('div', { class: 'now-groups' }, groups.map((g) => el('button', { class: 'now-group', onclick: () => this.selectGroup(g.id), title: g.name }, el('span', {}, g.icon), el('small', {}, g.name))))
        : el('p', { class: 'muted small' }, 'Crie um grupo para a sua galera.')
    );
  }

  async accept(id) {
    try {
      await api.post(`/friends/${id}/accept`);
      toast('Amizade aceita! 🎉', 'success');
      this.load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async remove(id, msg) {
    try {
      await api.del(`/friends/${id}`);
      toast(msg);
      this.load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}
