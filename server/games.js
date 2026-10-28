// Minijogos multiplayer do grupo (um por grupo por vez). O servidor é o juiz:
// guarda o estado, valida as jogadas e manda para cada um só o que ele pode ver.
const { db } = require('./db');
const { isMember } = require('./routes');

const WORDS = `abacaxi abelha avião baleia banana bicicleta boné borboleta bota cachorro cadeira café caminhão
camisa caneta carro castelo cavalo celular chapéu chave chocolate chuva cobra coelho computador coração
coroa dado dinossauro dragão escada espada estrela faca fantasma flor fogo foguete fone formiga futebol
galinha gato girafa guarda-chuva guitarra hambúrguer helicóptero igreja ilha jacaré janela joystick lâmpada
lápis leão livro lua maçã macaco mala mão mapa martelo melancia mesa microfone moto montanha mouse navio
nuvem óculos olho onda ovo palhaço panela pão papagaio pato peixe pipa pipoca pirata pizza planeta polvo
ponte porco porta praia presente queijo raio relógio robô rosa sapato sereia sofá sol sorvete tartaruga
teclado telefone televisão tênis tesoura tigre trem tubarão unicórnio urso vaca vela violão vulcão zebra
zumbi controle headset pizza-de-calabresa churrasco brigadeiro coxinha capivara saci futebol-de-areia`
  .split(/\s+/)
  .filter(Boolean);

const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const now = () => Date.now();

// ---------------------------------------------------------------------------
const GAMES = {
  tictactoe: {
    name: 'Jogo da velha',
    min: 2,
    max: 2,
    init: () => ({ board: Array(9).fill(null), turn: 0, winner: null, line: null, draw: false }),
    action(s, playerIdx, a) {
      const st = s.state;
      if (a.type === 'rematch') return (s.state = { ...GAMES.tictactoe.init(), turn: Math.random() < 0.5 ? 0 : 1 });
      if (st.winner !== null || st.draw || st.turn !== playerIdx) return;
      const i = Number(a.cell);
      if (!(i >= 0 && i < 9) || st.board[i] !== null) return;
      st.board[i] = playerIdx;
      const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
      const win = lines.find((l) => l.every((k) => st.board[k] === playerIdx));
      if (win) {
        st.winner = playerIdx;
        st.line = win;
        s.scores[playerIdx]++;
      } else if (st.board.every((c) => c !== null)) st.draw = true;
      else st.turn = 1 - playerIdx;
    },
  },

  connect4: {
    name: 'Lig 4',
    min: 2,
    max: 2,
    init: () => ({ grid: Array.from({ length: 6 }, () => Array(7).fill(null)), turn: 0, winner: null, line: null, draw: false, last: null }),
    action(s, playerIdx, a) {
      const st = s.state;
      if (a.type === 'rematch') return (s.state = { ...GAMES.connect4.init(), turn: Math.random() < 0.5 ? 0 : 1 });
      if (st.winner !== null || st.draw || st.turn !== playerIdx) return;
      const c = Number(a.col);
      if (!(c >= 0 && c < 7)) return;
      let r = 5;
      while (r >= 0 && st.grid[r][c] !== null) r--;
      if (r < 0) return;
      st.grid[r][c] = playerIdx;
      st.last = [r, c];
      const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (const [dr, dc] of dirs) {
        const cells = [[r, c]];
        for (const sgn of [1, -1]) {
          let rr = r + dr * sgn, cc = c + dc * sgn;
          while (rr >= 0 && rr < 6 && cc >= 0 && cc < 7 && st.grid[rr][cc] === playerIdx) {
            cells.push([rr, cc]);
            rr += dr * sgn;
            cc += dc * sgn;
          }
        }
        if (cells.length >= 4) {
          st.winner = playerIdx;
          st.line = cells;
          s.scores[playerIdx]++;
          return;
        }
      }
      if (st.grid[0].every((x) => x !== null)) st.draw = true;
      else st.turn = 1 - playerIdx;
    },
  },

  // Desenha e adivinha (estilo Gartic)
  draw: {
    name: 'Desenha & Adivinha',
    min: 2,
    max: 12,
    roundTime: 80,
    init: () => ({ phase: 'lobby', round: 0, rounds: 2, order: [], drawerIdx: -1, word: null, choices: null, endsAt: 0, guessed: [], hints: [], strokes: [], log: [] }),
    start(s, hub) {
      const st = s.state;
      st.order = pick(s.players.map((_, i) => i), s.players.length);
      st.round = 1;
      st.drawerIdx = -1;
      s.scores = s.players.map(() => 0);
      GAMES.draw.nextTurn(s, hub);
    },
    nextTurn(s, hub) {
      const st = s.state;
      clearTimeout(s.timer);
      st.drawerIdx++;
      if (st.drawerIdx >= st.order.length) {
        st.drawerIdx = 0;
        st.round++;
      }
      if (st.round > st.rounds || s.players.length < 2) {
        st.phase = 'over';
        return hub.emitGame(s);
      }
      st.phase = 'choose';
      st.word = null;
      st.choices = pick(WORDS, 3);
      st.guessed = [];
      st.strokes = [];
      st.hints = [];
      st.endsAt = now() + 15000;
      s.timer = setTimeout(() => GAMES.draw.choose(s, hub, st.choices[0]), 15000);
      hub.emitGame(s);
    },
    choose(s, hub, word) {
      const st = s.state;
      if (st.phase !== 'choose') return;
      st.word = word;
      st.phase = 'drawing';
      st.endsAt = now() + GAMES.draw.roundTime * 1000;
      clearTimeout(s.timer);
      // dicas: revela letras aos poucos
      const letters = [...word].map((ch, i) => (/[a-zà-ú]/i.test(ch) ? i : -1)).filter((i) => i >= 0);
      const reveal = pick(letters, Math.max(0, Math.floor(letters.length / 3)));
      reveal.forEach((idx, k) => {
        const at = ((k + 1) / (reveal.length + 1)) * GAMES.draw.roundTime * 1000;
        setTimeout(() => {
          if (st.word === word && st.phase === 'drawing') {
            st.hints.push(idx);
            hub.emitGame(s);
          }
        }, at);
      });
      s.timer = setTimeout(() => GAMES.draw.endTurn(s, hub), GAMES.draw.roundTime * 1000);
      hub.emitGame(s);
    },
    endTurn(s, hub) {
      const st = s.state;
      clearTimeout(s.timer);
      st.phase = 'reveal';
      st.log.push({ system: true, text: `A palavra era "${st.word}"` });
      hub.emitGame(s);
      s.timer = setTimeout(() => GAMES.draw.nextTurn(s, hub), 4000);
    },
    drawerPlayer(s) {
      return s.state.order[s.state.drawerIdx];
    },
    action(s, playerIdx, a, hub) {
      const st = s.state;
      const isDrawer = playerIdx === GAMES.draw.drawerPlayer(s);
      if (a.type === 'start' && st.phase === 'lobby' && s.players.length >= 2) return GAMES.draw.start(s, hub);
      if (a.type === 'restart' && st.phase === 'over') {
        s.state = GAMES.draw.init();
        return GAMES.draw.start(s, hub);
      }
      if (a.type === 'choose' && isDrawer && st.choices?.includes(a.word)) return GAMES.draw.choose(s, hub, a.word);
      if (a.type === 'clear' && isDrawer) {
        st.strokes = [];
        return;
      }
      if (a.type === 'guess' && st.phase === 'drawing' && !isDrawer && !st.guessed.includes(playerIdx)) {
        const text = String(a.text || '').trim().slice(0, 60);
        if (!text) return;
        const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (norm(text) === norm(st.word)) {
          const remaining = Math.max(0, st.endsAt - now()) / (GAMES.draw.roundTime * 1000);
          s.scores[playerIdx] += Math.round(50 + 100 * remaining);
          s.scores[GAMES.draw.drawerPlayer(s)] += 25;
          st.guessed.push(playerIdx);
          st.log.push({ system: true, text: `${s.names[playerIdx]} acertou! 🎉` });
          const guessers = s.players.length - 1;
          if (st.guessed.length >= guessers) GAMES.draw.endTurn(s, hub);
        } else {
          const close = st.word.length > 3 && norm(text).length === norm(st.word).length && [...norm(text)].filter((ch, i) => ch === norm(st.word)[i]).length >= norm(st.word).length - 1;
          st.log.push({ player: playerIdx, text });
          if (close) st.log.push({ system: true, private: playerIdx, text: 'Quase! 🔥' });
        }
        st.log = st.log.slice(-60);
      }
    },
    // cada um vê uma coisa diferente (a palavra só o desenhista)
    view(s, playerIdx) {
      const st = s.state;
      const isDrawer = playerIdx === GAMES.draw.drawerPlayer(s);
      const reveal = st.phase === 'reveal' || st.phase === 'over' || st.guessed.includes(playerIdx);
      const mask = st.word ? [...st.word].map((ch, i) => (isDrawer || reveal || st.hints.includes(i) || !/[a-zà-ú]/i.test(ch) ? ch : '_')).join('') : null;
      return {
        ...st,
        word: mask,
        choices: isDrawer ? st.choices : null,
        drawer: GAMES.draw.drawerPlayer(s),
        log: st.log.filter((l) => l.private === undefined || l.private === playerIdx),
      };
    },
  },

  // Teste de reflexo: espera ficar verde e clica o mais rápido possível.
  // O tempo é medido no aparelho de cada um, então a internet não atrapalha.
  reaction: {
    name: 'Reflexo',
    min: 1,
    max: 16,
    init: () => ({ phase: 'lobby', round: 0, rounds: 5, results: {}, goAt: 0, history: [] }),
    action(s, playerIdx, a, hub) {
      const st = s.state;
      if ((a.type === 'start' && st.phase === 'lobby') || (a.type === 'restart' && st.phase === 'over')) {
        s.state = { ...GAMES.reaction.init(), phase: 'wait', round: 1 };
        s.scores = s.players.map(() => 0);
        return GAMES.reaction.arm(s, hub);
      }
      if (a.type === 'hit' && (st.phase === 'go' || st.phase === 'wait') && st.results[playerIdx] === undefined) {
        // clicou antes da hora = queimou
        st.results[playerIdx] = st.phase === 'wait' ? -1 : Math.max(80, Math.min(5000, Number(a.ms) || 5000));
        if (Object.keys(st.results).length >= s.players.length) GAMES.reaction.finishRound(s, hub);
      }
    },
    arm(s, hub) {
      const st = s.state;
      st.phase = 'wait';
      st.results = {};
      hub.emitGame(s);
      s.timer = setTimeout(() => {
        st.phase = 'go';
        st.goAt = now();
        hub.emitGame(s);
        s.timer = setTimeout(() => GAMES.reaction.finishRound(s, hub), 4000);
      }, 1500 + Math.random() * 3500);
    },
    finishRound(s, hub) {
      const st = s.state;
      clearTimeout(s.timer);
      const valid = Object.entries(st.results).filter(([, ms]) => ms > 0).sort((a, b) => a[1] - b[1]);
      if (valid[0]) s.scores[Number(valid[0][0])] += 3;
      if (valid[1]) s.scores[Number(valid[1][0])] += 1;
      Object.entries(st.results).filter(([, ms]) => ms < 0).forEach(([i]) => (s.scores[Number(i)] -= 1));
      st.history.push({ round: st.round, results: { ...st.results } });
      st.phase = 'result';
      hub.emitGame(s);
      s.timer = setTimeout(() => {
        if (st.round >= st.rounds) {
          st.phase = 'over';
          return hub.emitGame(s);
        }
        st.round++;
        GAMES.reaction.arm(s, hub);
      }, 2500);
    },
  },
};

function attachGames(io, hub) {
  const sessions = new Map(); // groupId -> sessão

  const publicSession = (s, userId) => {
    const idx = s.players.indexOf(userId);
    const def = GAMES[s.type];
    return {
      groupId: s.groupId,
      type: s.type,
      name: def.name,
      hostId: s.hostId,
      players: s.players,
      names: s.names,
      scores: s.scores,
      min: def.min,
      max: def.max,
      me: idx,
      state: def.view ? def.view(s, idx) : s.state,
    };
  };

  hub.emitGame = (s) => {
    if (sessions.get(s.groupId) !== s) return;
    const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(s.groupId).map((r) => r.user_id);
    for (const uid of members) for (const sock of hub.online.get(uid) || []) sock.emit('game:state', publicSession(s, uid));
  };

  const endSession = (groupId) => {
    const s = sessions.get(groupId);
    if (!s) return;
    clearTimeout(s.timer);
    sessions.delete(groupId);
    io.to(`group:${groupId}`).emit('game:ended', { groupId });
  };

  const userName = (id) => db.prepare('SELECT display_name FROM users WHERE id = ?').get(id)?.display_name || '?';

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    // estado atual dos jogos dos grupos
    for (const s of sessions.values()) if (isMember(s.groupId, userId)) socket.emit('game:state', publicSession(s, userId));

    socket.on('game:create', ({ groupId, type } = {}, ack) => {
      groupId = Number(groupId);
      if (!isMember(groupId, userId) || !GAMES[type]) return ack?.({ error: 'Jogo inválido.' });
      endSession(groupId);
      const s = { groupId, type, hostId: userId, players: [userId], names: [userName(userId)], scores: [0], state: GAMES[type].init(), timer: null };
      sessions.set(groupId, s);
      hub.broadcastMessage(require('./routes').createMessage({ groupId, userId, type: 'system', content: `abriu uma partida de ${GAMES[type].name} 🎮 — vem jogar!` }));
      hub.emitGame(s);
      ack?.({ ok: true });
    });

    socket.on('game:join', ({ groupId } = {}, ack) => {
      const s = sessions.get(Number(groupId));
      if (!s || !isMember(s.groupId, userId)) return ack?.({ error: 'Partida não encontrada.' });
      if (s.players.includes(userId)) return ack?.({ ok: true });
      const def = GAMES[s.type];
      if (s.players.length >= def.max) return ack?.({ error: 'A partida está cheia.' });
      const inProgress = s.type === 'draw' ? s.state.phase !== 'lobby' && s.state.phase !== 'over' : false;
      s.players.push(userId);
      s.names.push(userName(userId));
      s.scores.push(0);
      if (inProgress) s.state.order.push(s.players.length - 1);
      hub.emitGame(s);
      ack?.({ ok: true });
    });

    socket.on('game:leave', ({ groupId } = {}) => {
      const s = sessions.get(Number(groupId));
      if (!s) return;
      const idx = s.players.indexOf(userId);
      if (idx < 0) return;
      // jogos de 2 ou partida vazia: encerra
      if (GAMES[s.type].max === 2 || s.players.length <= 1 || s.hostId === userId) return endSession(s.groupId);
      s.players.splice(idx, 1);
      s.names.splice(idx, 1);
      s.scores.splice(idx, 1);
      if (s.type === 'draw') {
        const st = s.state;
        const wasDrawer = GAMES.draw.drawerPlayer(s) === idx;
        st.order = st.order.filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i));
        st.guessed = st.guessed.filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i));
        if (wasDrawer && (st.phase === 'drawing' || st.phase === 'choose')) {
          st.drawerIdx--;
          GAMES.draw.endTurn(s, hub);
        }
      }
      hub.emitGame(s);
    });

    socket.on('game:end', ({ groupId } = {}) => {
      const s = sessions.get(Number(groupId));
      if (s && (s.hostId === userId || !s.players.includes(s.hostId))) endSession(s.groupId);
    });

    socket.on('game:action', ({ groupId, action } = {}) => {
      const s = sessions.get(Number(groupId));
      if (!s || !action) return;
      const idx = s.players.indexOf(userId);
      if (idx < 0) return;
      const def = GAMES[s.type];
      if (action.type === 'start' || action.type === 'rematch' || action.type === 'restart') {
        if (s.players.length < def.min) return;
      }
      def.action(s, idx, action, hub);
      hub.emitGame(s);
    });

    // traços do desenho vão direto para os outros (rápido) e ficam guardados para quem entrar depois
    socket.on('game:stroke', ({ groupId, stroke } = {}) => {
      const s = sessions.get(Number(groupId));
      if (!s || s.type !== 'draw' || s.state.phase !== 'drawing') return;
      if (GAMES.draw.drawerPlayer(s) !== s.players.indexOf(userId)) return;
      if (!stroke || !Array.isArray(stroke.p) || stroke.p.length > 400) return;
      const clean = { c: String(stroke.c || '#000').slice(0, 9), w: Math.max(1, Math.min(60, Number(stroke.w) || 4)), p: stroke.p.map(Number).filter(Number.isFinite), e: Boolean(stroke.e) };
      if (s.state.strokes.length < 4000) s.state.strokes.push(clean);
      socket.to(`group:${s.groupId}`).emit('game:stroke', { groupId: s.groupId, stroke: clean });
    });
  });
}

module.exports = { attachGames, GAMES };
