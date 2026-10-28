// Aba "Jogos": minijogos multiplayer do grupo + catálogo de jogos grátis + Jogo Coop.
import { el, $, $$, icon, toast, sfx } from './ui.js';
import { FREE_GAMES } from './gamesdata.js';
import { TetrisGame } from './tetris.js';

const BUILTIN = [
  { type: 'tetris', icon: '🧱', name: 'Tetris Royale', desc: 'Parecido com Tetris: mande lixo, sobreviva, seja o último. Libera estilos de torre!', players: '1–16' },
  { type: 'draw', icon: '🎨', name: 'Desenha & Adivinha', desc: 'Um desenha, a galera adivinha. Estilo Gartic.', players: '2–12' },
  { type: 'reaction', icon: '⚡', name: 'Reflexo', desc: 'Ficou verde? Clica! Quem é o mais rápido?', players: '1–16' },
  { type: 'connect4', icon: '🔴', name: 'Lig 4', desc: 'Alinhe 4 peças antes do outro.', players: '2' },
  { type: 'tictactoe', icon: '❌', name: 'Jogo da velha', desc: 'O clássico, rapidinho entre uma partida e outra.', players: '2' },
];
const P_COLORS = ['#3d8bff', '#ff4fa3'];
const DRAW_COLORS = ['#111111', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#a16207', '#9ca3af'];

export class GamesHub {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    this.sessions = new Map();
    this.tab = 'chat';
    this.view = $('#games-view');
    this.mounted = null; // { key, game } componente do jogo montado

    $$('#panel-tabs button').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.tab)));

    this.socket.on('game:state', (s) => {
      const isNew = !this.sessions.has(s.groupId);
      this.sessions.set(s.groupId, s);
      if (isNew && s.hostId !== app.me.id) {
        if (s.groupId !== app.currentGroupId || this.tab !== 'games') $('#games-dot').classList.remove('hidden');
        sfx('message');
      }
      if (s.groupId === app.currentGroupId) this.render();
    });
    this.socket.on('game:ended', ({ groupId }) => {
      this.sessions.delete(groupId);
      if (groupId === app.currentGroupId) this.render();
    });
    const toGame = (ev, fn) => this.socket.on(ev, (d) => d.groupId === app.currentGroupId && this.mounted?.game[fn]?.(d));
    toGame('tetris:board', 'onBoardEvt');
    toGame('tetris:garbage', 'onGarbageEvt');
    toGame('tetris:attackfx', 'onAttackFx');
    this.socket.on('game:stroke', ({ groupId, stroke }) => {
      if (groupId === app.currentGroupId && this.mounted?.game.onStroke) this.mounted.game.onStroke(stroke);
    });
  }

  setTab(tab) {
    this.tab = tab;
    $$('#panel-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const games = tab === 'games';
    this.view.classList.toggle('hidden', !games);
    ['#messages', '#typing', '.composer-wrap'].forEach((sel) => $(sel).classList.toggle('hidden', games));
    if (games) {
      $('#games-dot').classList.add('hidden');
      this.render();
    }
  }

  onGroupChanged() {
    this.mounted?.game.destroy?.();
    this.mounted = null;
    if (this.tab === 'games') this.render();
  }

  emit(action) {
    this.socket.emit('game:action', { groupId: this.app.currentGroupId, action });
  }

  render() {
    if (this.tab !== 'games') return;
    const gid = this.app.currentGroupId;
    const s = this.sessions.get(gid);
    if (!s) {
      this.mounted?.game.destroy?.();
      this.mounted = null;
      return this.renderHub();
    }
    const key = `${gid}:${s.type}`;
    if (this.mounted?.key !== key) {
      this.mounted?.game.destroy?.();
      const Cls = { tictactoe: TicTacToe, connect4: Connect4, draw: DrawGame, reaction: Reaction, tetris: TetrisGame }[s.type];
      const game = new Cls(this);
      this.view.replaceChildren(this.header(s), game.root);
      this.mounted = { key, game };
    } else {
      this.view.firstChild.replaceWith(this.header(s));
    }
    this.mounted.game.update(s);
  }

  header(s) {
    const meIn = s.me >= 0;
    const full = s.players.length >= s.max;
    return el('div', { class: 'game-head' },
      el('div', { class: 'game-title' }, el('b', {}, s.name), el('small', {}, `${s.players.length}/${s.max} jogador(es)`)),
      el('div', { class: 'game-players' },
        s.players.map((uid, i) => el('span', { class: `gp ${i === s.me ? 'gp-me' : ''}` }, s.names[i], el('em', {}, s.scores[i] ?? 0)))
      ),
      el('div', { class: 'game-head-actions' },
        !meIn && !full ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => this.socket.emit('game:join', { groupId: s.groupId }, (r) => r?.error && toast(r.error, 'error')) }, 'Entrar na partida') : null,
        meIn ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.socket.emit('game:leave', { groupId: s.groupId }) }, 'Sair') : null,
        s.hostId === this.app.me.id ? el('button', { class: 'btn btn-danger btn-sm', onclick: () => this.socket.emit('game:end', { groupId: s.groupId }) }, 'Encerrar') : null
      )
    );
  }

  renderHub() {
    const gid = this.app.currentGroupId;
    const create = (type) => this.socket.emit('game:create', { groupId: gid, type }, (r) => r?.error && toast(r.error, 'error'));
    this.view.replaceChildren(
      el('div', { class: 'hub' },
        el('section', {},
          el('h3', {}, '🎮 Jogar aqui agora'),
          el('p', { class: 'muted small' }, 'Abra uma partida e todo mundo do grupo recebe o convite. Dá pra jogar durante a call.'),
          el('div', { class: 'hub-grid' },
            BUILTIN.map((g) => el('button', { class: 'hub-card', onclick: () => create(g.type) },
              el('span', { class: 'hub-ic' }, g.icon),
              el('b', {}, g.name),
              el('small', {}, g.desc),
              el('span', { class: 'hub-meta' }, `👥 ${g.players}`)))
          )
        ),
        el('section', { class: 'hub-coop' },
          el('div', { class: 'hub-coop-ic' }, '🕹️'),
          el('div', {},
            el('h3', {}, 'Jogo Coop pela tela'),
            el('p', { class: 'muted small' }, 'Compartilhe a tela do seu jogo em "Modo Coop": você continua jogando e cada amigo vira um jogador separado no SEU PC (Jogador 2, 3, 4) — como um coop local. Os amigos não instalam nada. Ideal para It Takes Two, Cuphead, Overcooked, emuladores…'),
            el('button', { class: 'btn btn-primary btn-sm', onclick: () => this.app.call.coop.openHostDialog() }, '🎮 Abrir Modo Coop')
          )
        ),
        el('section', {},
          el('h3', {}, '🆓 Jogos grátis pra jogar com a galera'),
          el('div', { class: 'free-grid' },
            FREE_GAMES.map((g) => el('a', { class: 'free-card', href: g.url, target: '_blank', rel: 'noopener noreferrer' },
              el('span', { class: 'free-ic' }, g.icon),
              el('div', {}, el('b', {}, g.name), el('small', {}, `${g.mode} • ${g.tag}`))))
          )
        )
      )
    );
  }
}

// ---------------------------------------------------------------------------
function statusBar(text, cls = '') {
  return el('div', { class: `game-status ${cls}` }, text);
}

class TicTacToe {
  constructor(hub) {
    this.hub = hub;
    this.root = el('div', { class: 'game-body ttt-wrap' });
  }
  update(s) {
    const st = s.state;
    const waiting = s.players.length < 2;
    const mine = s.me >= 0 && st.turn === s.me && st.winner === null && !st.draw && !waiting;
    let msg;
    if (waiting) msg = 'Esperando um oponente entrar…';
    else if (st.winner !== null) msg = st.winner === s.me ? '🏆 Você venceu!' : `${s.names[st.winner]} venceu!`;
    else if (st.draw) msg = '🤝 Deu velha!';
    else msg = mine ? 'Sua vez!' : `Vez de ${s.names[st.turn]}`;
    const grid = el('div', { class: 'ttt' },
      st.board.map((v, i) => el('button', {
        class: `ttt-cell ${st.line?.includes(i) ? 'win' : ''}`,
        disabled: !mine || v !== null,
        style: { color: v !== null ? P_COLORS[v] : '' },
        onclick: () => this.hub.emit({ type: 'cell', cell: i }),
      }, v === 0 ? '✕' : v === 1 ? '◯' : ''))
    );
    this.root.replaceChildren(
      ...[statusBar(msg, mine ? 'turn' : ''), grid, st.winner !== null || st.draw ? el('button', { class: 'btn btn-primary', onclick: () => this.hub.emit({ type: 'rematch' }) }, 'Jogar de novo') : null].filter(Boolean)
    );
  }
}

class Connect4 {
  constructor(hub) {
    this.hub = hub;
    this.root = el('div', { class: 'game-body c4-wrap' });
  }
  update(s) {
    const st = s.state;
    const waiting = s.players.length < 2;
    const mine = s.me >= 0 && st.turn === s.me && st.winner === null && !st.draw && !waiting;
    let msg;
    if (waiting) msg = 'Esperando um oponente entrar…';
    else if (st.winner !== null) msg = st.winner === s.me ? '🏆 Você venceu!' : `${s.names[st.winner]} venceu!`;
    else if (st.draw) msg = '🤝 Empate!';
    else msg = mine ? 'Sua vez! Escolha uma coluna' : `Vez de ${s.names[st.turn]}`;
    const isWin = (r, c) => st.line?.some(([a, b]) => a === r && b === c);
    const board = el('div', { class: `c4 ${mine ? 'active' : ''}` });
    for (let c = 0; c < 7; c++) {
      const col = el('button', { class: 'c4-col', disabled: !mine || st.grid[0][c] !== null, onclick: () => this.hub.emit({ type: 'drop', col: c }) });
      for (let r = 0; r < 6; r++) {
        const v = st.grid[r][c];
        const last = st.last && st.last[0] === r && st.last[1] === c;
        col.append(el('span', { class: `c4-cell ${v !== null ? 'filled' : ''} ${last ? 'last' : ''} ${isWin(r, c) ? 'win' : ''}` }));
      }
      board.append(col);
    }
    this.root.replaceChildren(
      ...[
        statusBar(msg, mine ? 'turn' : ''),
        el('div', { class: 'c4-legend' }, s.names.map((n, i) => el('span', {}, el('i', { style: { background: P_COLORS[i] } }), n))),
        board,
        st.winner !== null || st.draw ? el('button', { class: 'btn btn-primary', onclick: () => this.hub.emit({ type: 'rematch' }) }, 'Jogar de novo') : null,
      ].filter(Boolean)
    );
    // CSS custom properties precisam de setProperty
    board.querySelectorAll('.c4-col').forEach((colEl, c) =>
      colEl.querySelectorAll('.c4-cell').forEach((cell, r) => {
        const v = st.grid[r][c];
        cell.style.setProperty('--disc', v !== null ? P_COLORS[v] : 'transparent');
        cell.style.setProperty('--row', r);
      })
    );
  }
}

class Reaction {
  constructor(hub) {
    this.hub = hub;
    this.root = el('div', { class: 'game-body react-wrap' });
    this.goLocal = 0;
    this.lastPhaseKey = '';
  }
  update(s) {
    const st = s.state;
    const phaseKey = `${st.round}:${st.phase}`;
    if (st.phase === 'go' && this.lastPhaseKey !== phaseKey) this.goLocal = performance.now();
    this.lastPhaseKey = phaseKey;
    const myRes = st.results?.[s.me];
    let pad;
    if (st.phase === 'lobby' || st.phase === 'over') {
      const rank = s.players.map((_, i) => i).sort((a, b) => s.scores[b] - s.scores[a]);
      pad = el('div', { class: 'react-pad idle' },
        st.phase === 'over' ? el('div', { class: 'rank' }, el('h3', {}, '🏁 Resultado'), rank.map((i, k) => el('div', { class: 'rank-row' }, `${['🥇', '🥈', '🥉'][k] || `${k + 1}º`} ${s.names[i]}`, el('b', {}, `${s.scores[i]} pts`)))) : el('div', {}, el('h3', {}, '⚡ Reflexo'), el('p', { class: 'muted' }, `${st.rounds} rodadas. Espere a tela ficar VERDE e clique o mais rápido que puder. Clicar antes = -1 ponto.`)),
        s.me >= 0 ? el('button', { class: 'btn btn-primary btn-lg', onclick: () => this.hub.emit({ type: st.phase === 'over' ? 'restart' : 'start' }) }, st.phase === 'over' ? 'Jogar de novo' : 'Começar') : el('p', { class: 'muted' }, 'Entre na partida pra jogar.')
      );
    } else if (st.phase === 'wait' || st.phase === 'go') {
      const go = st.phase === 'go';
      const done = myRes !== undefined;
      pad = el('button', {
        class: `react-pad ${go ? 'go' : 'wait'} ${done ? 'done' : ''}`,
        disabled: done || s.me < 0,
        onpointerdown: () => {
          if (done || s.me < 0) return;
          this.hub.emit({ type: 'hit', ms: go ? Math.round(performance.now() - this.goLocal) : 0 });
          if (!go) sfx('mute');
        },
      }, el('span', { class: 'react-big' }, done ? (myRes < 0 ? '😬 Queimou!' : `${myRes} ms`) : go ? 'CLIQUE!' : 'Espere o verde…'), el('small', {}, `Rodada ${st.round}/${st.rounds}`));
    } else {
      const entries = s.players.map((_, i) => [i, st.results[i]]).sort((a, b) => (a[1] ?? 9e9) - (b[1] ?? 9e9));
      pad = el('div', { class: 'react-pad idle' },
        el('h3', {}, `Rodada ${st.round}`),
        entries.map(([i, ms], k) => el('div', { class: 'rank-row' }, `${k === 0 && ms > 0 ? '⚡' : ''} ${s.names[i]}`, el('b', {}, ms === undefined ? 'não clicou' : ms < 0 ? 'queimou' : `${ms} ms`))));
    }
    this.root.replaceChildren(pad);
  }
}

class DrawGame {
  constructor(hub) {
    this.hub = hub;
    this.socket = hub.socket;
    this.drawn = [];
    this.color = '#111111';
    this.width = 6;
    this.eraser = false;
    this.canvas = el('canvas', { class: 'draw-canvas', width: 1000, height: 700 });
    this.ctx = this.canvas.getContext('2d');
    this.top = el('div', { class: 'draw-top' });
    this.tools = el('div', { class: 'draw-tools' });
    this.overlay = el('div', { class: 'draw-overlay hidden' });
    this.log = el('div', { class: 'draw-log' });
    this.guess = el('input', { class: 'input', placeholder: 'Seu palpite…', maxlength: 60 });
    this.guess.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.guess.value.trim()) {
        hub.emit({ type: 'guess', text: this.guess.value });
        this.guess.value = '';
      }
    });
    this.root = el('div', { class: 'game-body draw-wrap' },
      this.top,
      el('div', { class: 'draw-main' }, el('div', { class: 'draw-board' }, this.canvas, this.overlay), el('div', { class: 'draw-side' }, this.log, this.guess)),
      this.tools
    );
    this.clearCanvas();
    this.setupPointer();
    this.timer = setInterval(() => this.tick(), 250);
  }
  destroy() {
    clearInterval(this.timer);
  }
  clearCanvas() {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, 1000, 700);
  }
  paint(st) {
    const x = this.ctx;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = st.e ? '#ffffff' : st.c;
    x.lineWidth = st.w;
    const p = st.p;
    x.beginPath();
    x.moveTo(p[0], p[1]);
    if (p.length === 2) x.lineTo(p[0] + 0.1, p[1]);
    for (let i = 2; i < p.length; i += 2) x.lineTo(p[i], p[i + 1]);
    x.stroke();
  }
  onStroke(stroke) {
    this.drawn.push(stroke);
    this.paint(stroke);
  }
  setupPointer() {
    let pts = null;
    let flushTimer = null;
    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return [Math.round(((e.clientX - r.left) / r.width) * 1000), Math.round(((e.clientY - r.top) / r.height) * 700)];
    };
    const flush = () => {
      if (!pts || pts.length < 2) return;
      const stroke = { c: this.color, w: this.width, p: pts, e: this.eraser };
      this.drawn.push(stroke);
      this.paint(stroke);
      this.socket.emit('game:stroke', { groupId: this.hub.app.currentGroupId, stroke });
      pts = pts.slice(-2); // continua do último ponto
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.isDrawer) return;
      this.canvas.setPointerCapture(e.pointerId);
      pts = pos(e);
      flushTimer = setInterval(flush, 40);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!pts) return;
      pts.push(...pos(e));
      if (pts.length > 300) flush();
    });
    const end = () => {
      if (!pts) return;
      flush();
      pts = null;
      clearInterval(flushTimer);
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }
  tick() {
    const st = this.s?.state;
    const t = this.top.querySelector('.draw-timer');
    if (!st || !t) return;
    const left = Math.max(0, Math.ceil((st.endsAt - Date.now()) / 1000));
    t.textContent = st.phase === 'drawing' || st.phase === 'choose' ? `⏱ ${left}s` : '';
    t.classList.toggle('urgent', left <= 10 && st.phase === 'drawing');
  }
  update(s) {
    this.s = s;
    const st = s.state;
    this.isDrawer = st.drawer === s.me && st.phase === 'drawing';
    // sincroniza os traços (quem entrou no meio, ou "limpar")
    if (st.strokes.length !== this.drawn.length) {
      this.drawn = [...st.strokes];
      this.clearCanvas();
      this.drawn.forEach((x) => this.paint(x));
    }
    this.canvas.classList.toggle('can-draw', this.isDrawer);
    const drawerName = st.drawer >= 0 ? s.names[st.drawer] : '';
    this.top.replaceChildren(
      el('span', { class: 'draw-round' }, st.phase === 'lobby' ? 'Sala de espera' : `Rodada ${Math.min(st.round, st.rounds)}/${st.rounds}`),
      el('span', { class: 'draw-word' }, st.word ? [...st.word].map((ch) => el('i', { class: ch === '_' ? 'blank' : '' }, ch === '_' ? '' : ch)) : ''),
      el('span', { class: 'draw-timer' })
    );
    this.tick();

    // ferramentas só para quem desenha
    this.tools.replaceChildren();
    if (this.isDrawer) {
      this.tools.append(
        ...DRAW_COLORS.map((c) => el('button', { class: `swatch ${this.color === c && !this.eraser ? 'active' : ''}`, style: { background: c }, onclick: () => { this.color = c; this.eraser = false; this.update(this.s); } })),
        el('span', { class: 'tool-sep' }),
        ...[3, 6, 12, 24].map((w) => el('button', { class: `size-btn ${this.width === w ? 'active' : ''}`, onclick: () => { this.width = w; this.update(this.s); } }, el('i', { style: { width: w / 1.5 + 4 + 'px', height: w / 1.5 + 4 + 'px' } }))),
        el('button', { class: `btn btn-ghost btn-sm ${this.eraser ? 'active' : ''}`, onclick: () => { this.eraser = !this.eraser; this.update(this.s); } }, '🧽 Borracha'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.hub.emit({ type: 'clear' }) }, '🗑️ Limpar')
      );
    }

    // sobreposições por fase
    let over = null;
    if (st.phase === 'lobby') {
      over = el('div', {}, el('h3', {}, '🎨 Desenha & Adivinha'), el('p', {}, `${s.players.length} jogador(es). Cada um desenha ${st.rounds}x. Acertar rápido vale mais pontos!`),
        s.players.length >= 2 && s.me >= 0 ? el('button', { class: 'btn btn-primary btn-lg', onclick: () => this.hub.emit({ type: 'start' }) }, 'Começar') : el('p', { class: 'muted' }, 'Precisa de pelo menos 2 jogadores.'));
    } else if (st.phase === 'choose') {
      over = st.choices
        ? el('div', {}, el('h3', {}, 'Escolha o que desenhar'), el('div', { class: 'word-choices' }, st.choices.map((w) => el('button', { class: 'btn btn-primary', onclick: () => this.hub.emit({ type: 'choose', word: w }) }, w))))
        : el('div', {}, el('h3', {}, `${drawerName} está escolhendo a palavra…`));
    } else if (st.phase === 'reveal') {
      over = el('div', {}, el('h3', {}, `A palavra era: ${st.word}`));
    } else if (st.phase === 'over') {
      const rank = s.players.map((_, i) => i).sort((a, b) => s.scores[b] - s.scores[a]);
      over = el('div', {}, el('h3', {}, '🏁 Fim de jogo!'), rank.map((i, k) => el('div', { class: 'rank-row' }, `${['🥇', '🥈', '🥉'][k] || `${k + 1}º`} ${s.names[i]}`, el('b', {}, `${s.scores[i]} pts`))),
        s.me >= 0 ? el('button', { class: 'btn btn-primary', onclick: () => this.hub.emit({ type: 'restart' }) }, 'Jogar de novo') : null);
    } else if (st.phase === 'drawing' && st.drawer === s.me) {
      // sem overlay; dica no topo
    }
    this.overlay.classList.toggle('hidden', !over);
    this.overlay.replaceChildren(over || '');

    // palpites
    const canGuess = st.phase === 'drawing' && st.drawer !== s.me && s.me >= 0 && !st.guessed.includes(s.me);
    this.guess.disabled = !canGuess;
    this.guess.placeholder = st.drawer === s.me && st.phase === 'drawing' ? 'Você está desenhando ✏️' : st.guessed.includes(s.me) ? 'Você acertou! 🎉' : 'Seu palpite…';
    const stick = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    this.log.replaceChildren(
      el('div', { class: 'log-line sys' }, st.phase === 'drawing' ? `✏️ ${drawerName} está desenhando` : ''),
      ...st.log.map((l) => el('div', { class: `log-line ${l.system ? 'sys' : ''}` }, l.system ? l.text : el('span', {}, el('b', {}, s.names[l.player] || '?'), ': ', l.text)))
    );
    if (stick) this.log.scrollTop = this.log.scrollHeight;
  }
}
