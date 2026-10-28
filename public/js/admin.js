// Painel do site — só aparece para a conta do dono (o servidor também confere).
import { el, avatar, toast, timeAgo } from './ui.js';
import { api } from './api.js';

const fmtDur = (s) => {
  s = Math.round(s || 0);
  if (s < 60) return s ? '< 1 min' : '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`;
};
const fmtNum = (n) => Number(n || 0).toLocaleString('pt-BR');
const fmtDate = (sec) => (sec ? new Date(sec * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const fmtDay = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const METRICS = {
  active: { label: 'Pessoas ativas', fmt: (v) => `${v} pessoa(s)`, val: (d) => d.active },
  signups: { label: 'Cadastros', fmt: (v) => `${v} cadastro(s)`, val: (d) => d.signups },
  hours: { label: 'Horas de uso', fmt: (v) => fmtDur(v * 3600), val: (d) => d.onlineSeconds / 3600 },
  call: { label: 'Horas em call', fmt: (v) => fmtDur(v * 3600), val: (d) => d.callSeconds / 3600 },
};

const COLS = [
  ['user', 'Usuário', (u) => u.displayName.toLowerCase()],
  ['email', 'E-mail', (u) => u.email || '~'],
  ['createdAt', 'Cadastro', (u) => u.createdAt],
  ['lastSeen', 'Último acesso', (u) => u.lastSeen || 0],
  ['onlineSeconds', 'Tempo de uso', (u) => u.onlineSeconds],
  ['onlineSeconds7d', 'Últimos 7 dias', (u) => u.onlineSeconds7d],
  ['callSeconds', 'Em call', (u) => u.callSeconds],
  ['messages', 'Mensagens', (u) => u.messages],
  ['top', 'Mais usa', (u) => u.features[0]?.count || 0],
];

export class AdminPanel {
  constructor(app) {
    this.app = app;
    this.root = el('div', { class: 'admin' });
    this.data = null;
    this.metric = 'active';
    this.sort = { key: 'lastSeen', dir: -1 };
    this.q = '';
    this.open = new Set();
    this.allFeatures = false;
  }

  show() {
    if (!this.data) this.root.replaceChildren(el('p', { class: 'muted admin-loading' }, 'Carregando estatísticas…'));
    this.load();
    clearInterval(this.timer);
    this.timer = setInterval(() => document.visibilityState === 'visible' && this.root.isConnected && this.load(), 30e3);
  }

  hide() {
    clearInterval(this.timer);
  }

  async load() {
    try {
      this.data = await api.get('/admin/stats');
      this.render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  render() {
    const d = this.data;
    if (!d) return;
    const t = d.totals;
    const tile = (label, value, sub) => el('div', { class: 'kpi' }, el('small', {}, label), el('b', {}, value), sub ? el('span', {}, sub) : null);
    const scroll = this.root.parentElement?.scrollTop;
    this.root.replaceChildren(
      el('div', { class: 'admin-top' },
        el('div', {}, el('h2', {}, '📊 Painel do Kenfeh'), el('p', { class: 'muted small' }, `Só você vê esta página. Atualizado ${new Date(d.generatedAt * 1000).toLocaleTimeString('pt-BR')} — atualiza sozinho a cada 30 s.`)),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.load() }, '↻ Atualizar')),
      el('div', { class: 'kpis' },
        tile('Contas', fmtNum(t.users), `+${t.new7d} nos últimos 7 dias`),
        tile('Online agora', fmtNum(t.onlineNow), `${t.activeToday} usaram hoje`),
        tile('Ativos (7 dias)', fmtNum(t.active7d), `${t.active30d} nos últimos 30`),
        tile('Tempo total de uso', fmtDur(t.onlineSeconds), `${fmtDur(t.callSeconds)} em call`),
        tile('Mensagens', fmtNum(t.messages), `${t.groups} grupos • ${t.dms} conversas privadas`),
        tile('Amizades', fmtNum(t.friendships), `${t.stickers} figurinhas/GIFs/sons criados`)
      ),
      el('div', { class: 'admin-grid' }, this.dailyChart(), this.featureChart()),
      this.usersTable()
    );
    if (scroll && this.root.parentElement) this.root.parentElement.scrollTop = scroll;
  }

  // ---------- colunas por dia (30 dias) ----------
  dailyChart() {
    const m = METRICS[this.metric];
    const days = this.data.daily;
    const vals = days.map(m.val);
    const max = Math.max(...vals, 0);
    const step = niceStep(max);
    const top = Math.max(step, Math.ceil(max / step) * step);
    const ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    const tip = el('div', { class: 'viz-tip hidden' });
    const plot = el('div', { class: 'col-plot' },
      ...ticks.map((v) => el('div', { class: 'grid-line', style: `bottom:${(v / top) * 100}%` }, el('span', {}, this.metric === 'hours' || this.metric === 'call' ? `${+v.toFixed(1)}h` : v))),
      el('div', { class: 'cols' },
        ...days.map((d, i) => {
          const v = vals[i];
          const slot = el('div', { class: 'col-slot' }, el('i', { class: v ? '' : 'zero', style: `height:${v ? Math.max(2, (v / top) * 100) : 0}%` }));
          const showTip = () => {
            const wd = WEEK[new Date(d.day + 'T12:00:00').getDay()];
            tip.replaceChildren(el('small', {}, `${wd}, ${fmtDay(d.day)}`), el('b', {}, m.fmt(+v.toFixed(2))));
            tip.classList.remove('hidden');
            const r = slot.getBoundingClientRect(), pr = plot.getBoundingClientRect();
            tip.style.left = `${Math.min(Math.max(r.left - pr.left + r.width / 2, 50), pr.width - 50)}px`;
            slot.classList.add('hover');
          };
          const hideTip = () => {
            tip.classList.add('hidden');
            slot.classList.remove('hover');
          };
          slot.addEventListener('pointerenter', showTip);
          slot.addEventListener('pointerleave', hideTip);
          slot.addEventListener('pointerdown', showTip);
          return slot;
        })),
      tip
    );
    const labels = el('div', { class: 'col-labels' }, ...days.map((d, i) => el('span', {}, i % 5 === 4 || i === days.length - 1 ? fmtDay(d.day) : '')));
    return el('section', { class: 'viz-card' },
      el('div', { class: 'viz-head' },
        el('h3', {}, `${m.label} por dia`),
        el('div', { class: 'seg' }, Object.entries(METRICS).map(([k, x]) => el('button', { class: k === this.metric ? 'active' : '', onclick: () => { this.metric = k; this.render(); } }, x.label)))),
      el('p', { class: 'muted small' }, 'Últimos 30 dias (horário de Brasília). Passe o mouse ou toque numa coluna.'),
      plot, labels);
  }

  // ---------- funções mais usadas ----------
  featureChart() {
    const all = this.data.features;
    const list = this.allFeatures ? all : all.slice(0, 10);
    const max = Math.max(1, ...all.map((f) => f.count));
    return el('section', { class: 'viz-card' },
      el('div', { class: 'viz-head' }, el('h3', {}, 'Funções mais usadas')),
      el('p', { class: 'muted small' }, 'Quantas vezes cada função foi usada desde que o painel foi ligado.'),
      list.length
        ? el('div', { class: 'hbars' }, ...list.map((f) => el('div', { class: 'hbar', title: `${f.label}: ${fmtNum(f.count)} vez(es), ${f.users} pessoa(s)` },
            el('span', { class: 'hbar-label' }, f.label),
            el('div', { class: 'hbar-track' }, el('i', { style: `width:${Math.max(1.5, (f.count / max) * 100)}%` })),
            el('span', { class: 'hbar-val' }, el('b', {}, fmtNum(f.count)), el('small', {}, `${f.users} pess.`)))))
        : el('p', { class: 'muted' }, 'Ainda sem dados — conforme a galera usa o site, aparece aqui.'),
      all.length > 10 ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { this.allFeatures = !this.allFeatures; this.render(); } }, this.allFeatures ? 'Mostrar menos' : `Ver todas (${all.length})`) : null);
  }

  // ---------- quem se inscreveu ----------
  usersTable() {
    const col = COLS.find((c) => c[0] === this.sort.key) || COLS[3];
    const users = [...this.data.users].sort((a, b) => {
        const x = col[2](a), y = col[2](b);
        return (x > y ? 1 : x < y ? -1 : 0) * this.sort.dir;
      });
    const search = el('input', { class: 'input', type: 'search', placeholder: 'Buscar por nome, @usuário ou e-mail…', value: this.q });
    search.addEventListener('input', () => {
      this.q = search.value;
      this.renderTableBody(tbody);
    });
    const head = el('tr', {}, ...COLS.map(([key, label]) => el('th', {
      class: this.sort.key === key ? 'sorted' : '',
      onclick: () => {
        this.sort = this.sort.key === key ? { key, dir: -this.sort.dir } : { key, dir: key === 'user' || key === 'email' ? 1 : -1 };
        this.render();
      },
    }, label, this.sort.key === key ? (this.sort.dir > 0 ? ' ▲' : ' ▼') : '')));
    const tbody = el('tbody');
    this.tableUsers = users;
    this.renderTableBody(tbody);
    const noEmail = this.data.users.length - this.data.totals.withEmail;
    return el('section', { class: 'viz-card' },
      el('div', { class: 'viz-head' }, el('h3', {}, `Quem se inscreveu (${this.data.users.length})`), search),
      el('p', { class: 'muted small' },
        'Tempo de uso = tempo com o site aberto. Toque numa linha para ver tudo o que a pessoa usou.',
        noEmail ? ` ${noEmail} conta(s) antiga(s) ainda sem e-mail — o campo pede na próxima vez que editarem o perfil.` : ''),
      el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table' }, el('thead', {}, head), tbody)));
  }

  renderTableBody(tbody) {
    const q = this.q.trim().toLowerCase();
    const users = this.tableUsers.filter((u) => !q || [u.displayName, u.username, u.email || ''].some((s) => s.toLowerCase().includes(q)));
    const rows = [];
    for (const u of users) {
      const open = this.open.has(u.id);
      rows.push(el('tr', { class: `${open ? 'open' : ''}`, onclick: () => { open ? this.open.delete(u.id) : this.open.add(u.id); this.renderTableBody(tbody); } },
        el('td', {}, el('div', { class: 'au' }, avatar(u, 30), el('div', {}, el('b', {}, u.displayName), el('small', {}, '@' + u.username)))),
        el('td', { class: u.email ? '' : 'muted' }, u.email || 'sem e-mail'),
        el('td', {}, fmtDate(u.createdAt)),
        el('td', {}, u.online ? el('span', { class: 'on-pill' }, '● online') : u.lastSeen ? timeAgo(u.lastSeen) : 'nunca'),
        el('td', { class: 'num' }, fmtDur(u.onlineSeconds)),
        el('td', { class: 'num' }, fmtDur(u.onlineSeconds7d)),
        el('td', { class: 'num' }, fmtDur(u.callSeconds)),
        el('td', { class: 'num' }, fmtNum(u.messages)),
        el('td', {}, u.features.length ? u.features.slice(0, 2).map((f) => el('span', { class: 'feat-chip' }, f.label, el('em', {}, f.count))) : el('span', { class: 'muted' }, '—'))
      ));
      if (open) rows.push(el('tr', { class: 'detail' }, el('td', { colspan: COLS.length },
        el('div', { class: 'detail-box' },
          el('div', { class: 'detail-facts' },
            [['Dias com uso', u.daysActive], ['Grupos', u.groups], ['Amigos', u.friends], ['XP no Tetris', u.tetrisXp], ['Cadastro', new Date(u.createdAt * 1000).toLocaleString('pt-BR')]]
              .map(([k, v]) => el('span', {}, el('small', {}, k), el('b', {}, String(v))))),
          u.features.length
            ? el('div', { class: 'detail-feats' }, u.features.map((f) => el('span', { class: 'feat-chip' }, f.label, el('em', {}, fmtNum(f.count)))))
            : el('p', { class: 'muted small' }, 'Ainda não usou nenhuma função registrada.')))));
    }
    tbody.replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colspan: COLS.length, class: 'muted' }, 'Ninguém encontrado.'))]));
  }
}

// passo "redondo" do eixo (1, 2, 5, 10…) com ~3–4 linhas
function niceStep(max) {
  if (max <= 0) return 1;
  const raw = max / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  return step < 1 && max >= 1 ? 1 : step;
}
