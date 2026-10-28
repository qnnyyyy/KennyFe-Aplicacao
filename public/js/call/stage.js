// "Palco" da call: blocos de vídeo redimensionáveis (arrasta as divisórias),
// blocos flutuantes (ex.: webcam por cima do filme), reordenação,
// tela cheia por bloco, janela separada e Picture-in-Picture.
import { el, icon, avatar, store, save, onContext, IS_MOBILE } from '../ui.js';

const MIN_PX = 90;

export class Stage {
  constructor(root, { onContext: onTileContext, onCoop } = {}) {
    this.root = root;
    this.onTileContext = onTileContext;
    this.onCoop = onCoop;
    this.tiles = new Map();
    const saved = store('stage', {});
    this.layout = saved.layout || 'row';
    this.weights = saved.weights || {};
    this.floating = saved.floating || {};
    this.fit = saved.fit || {};
    this.order = [];
    this.hidden = new Set();
    this.focusKey = null;
    this.showNonVideo = true;
    this.popouts = new Map();
    this.dock = el('div', { class: 'stage-dock' });
    this.floatLayer = el('div', { class: 'stage-float' });
    this.hiddenBar = el('div', { class: 'stage-hidden-bar hidden' });
    root.append(this.dock, this.floatLayer, this.hiddenBar);
    this.ro = new ResizeObserver(() => this.scheduleRender());
    this.ro.observe(root);
  }

  persist() {
    save('stage', { layout: this.layout, weights: this.weights, floating: this.floating, fit: this.fit });
  }

  setLayout(l) {
    this.layout = l;
    this.persist();
    this.render();
  }

  // ---------- Tiles ----------
  upsert(key, info) {
    let t = this.tiles.get(key);
    if (!t) {
      t = this.createTile(key, info);
      this.tiles.set(key, t);
      this.order.push(key);
      if (this.weights[key] === undefined) this.weights[key] = info.kind === 'screen' ? 2 : 1;
    }
    Object.assign(t.info, info);
    this.updateTile(t);
    this.scheduleRender();
    return t;
  }

  remove(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    if (document.fullscreenElement === t.el) document.exitFullscreen().catch(() => {});
    if (document.pictureInPictureElement === t.video) document.exitPictureInPicture().catch(() => {});
    this.popouts.get(key)?.close();
    this.popouts.delete(key);
    t.el.remove();
    this.tiles.delete(key);
    this.order = this.order.filter((k) => k !== key);
    this.hidden.delete(key);
    if (this.focusKey === key) this.focusKey = null;
    this.scheduleRender();
  }

  clear() {
    for (const k of [...this.tiles.keys()]) this.remove(k);
  }

  createTile(key, info) {
    const video = el('video', { autoplay: true, playsinline: true, muted: true });
    video.muted = true; // áudio sai pelo mixer, nunca pelo <video>
    const avatarWrap = el('div', { class: 'tile-avatar' });
    const nameEl = el('span', { class: 'tile-name' });
    const badge = el('span', { class: 'tile-badge' });
    const muteIc = el('span', { class: 'tile-mute hidden' }, icon('mic-off', 14));
    const label = el('div', { class: 'tile-label', draggable: 'true' }, muteIc, nameEl, badge);
    const stats = el('div', { class: 'tile-stats hidden' });
    const actions = el('div', { class: 'tile-actions' });
    const handle = el('div', { class: 'tile-resize', title: 'Redimensionar' });
    const coopBtn = el('button', { class: 'tile-coop hidden', onclick: (e) => { e.stopPropagation(); this.onCoop?.(t); } });
    const coopHint = el('div', { class: 'tile-coop-hint hidden' }, '🎮 Você está jogando — clique no vídeo para controlar • Esc solta o mouse • Ctrl+Shift+Q sai');
    const rec = el('div', { class: 'tile-rec' }, '● REC');
    const custom = el('div', { class: 'tile-custom' }); // conteúdo próprio (ex.: bloco do bot de música)
    const tileEl = el('div', { class: 'tile', dataset: { key } }, video, avatarWrap, custom, label, stats, actions, coopBtn, coopHint, rec, handle);
    const t = { key, el: tileEl, video, avatarWrap, custom, nameEl, badge, muteIc, label, stats, actions, handle, coopBtn, coopHint, info: { ...info } };

    const btn = (ic, title, fn) => el('button', { class: 'tile-btn', title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic, 16));
    actions.append(
      btn('float', 'Flutuar / encaixar', () => this.toggleFloat(key)),
      btn('popout', 'Abrir em outra janela', () => this.popout(key)),
      btn('maximize', 'Tela cheia deste bloco (duplo clique)', () => this.fullscreen(key)),
      btn('more', 'Mais opções', () => {
        const r = actions.getBoundingClientRect();
        this.onTileContext?.(t, r.right, r.bottom);
      })
    );

    tileEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('.tile-actions, .tile-coop') || tileEl.classList.contains('controlling')) return;
      this.fullscreen(key);
    });
    // jogando no Modo Coop o botão direito vai para o jogo, não para o menu
    onContext(tileEl, (x, y) => !tileEl.classList.contains('capturing') && this.onTileContext?.(t, x, y));

    // Reordenar: arrasta o nome de um bloco em cima de outro
    label.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/kf-tile', key);
      e.dataTransfer.effectAllowed = 'move';
      tileEl.classList.add('dragging');
    });
    label.addEventListener('dragend', () => tileEl.classList.remove('dragging'));
    tileEl.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/kf-tile')) {
        e.preventDefault();
        tileEl.classList.add('drop-target');
      }
    });
    tileEl.addEventListener('dragleave', () => tileEl.classList.remove('drop-target'));
    tileEl.addEventListener('drop', (e) => {
      tileEl.classList.remove('drop-target');
      const from = e.dataTransfer.getData('text/kf-tile');
      if (!from || from === key) return;
      e.preventDefault();
      this.swap(from, key);
    });

    this.setupFloatDrag(t);
    return t;
  }

  updateTile(t) {
    const { info } = t;
    const isCustom = info.kind === 'custom';
    const hasVideo = info.kind !== 'avatar' && !isCustom && info.stream;
    t.el.classList.toggle('is-custom', isCustom);
    t.el.classList.toggle('is-avatar', !hasVideo && !isCustom);
    if (isCustom) info.render?.(t.custom);
    t.el.classList.toggle('is-screen', info.kind === 'screen');
    t.el.classList.toggle('is-local', Boolean(info.isLocal));
    t.el.classList.toggle('mirror', Boolean(info.mirror));
    t.nameEl.textContent = info.name || '';
    t.badge.textContent = info.kind === 'screen' ? 'AO VIVO' : '';
    t.badge.classList.toggle('hidden', info.kind !== 'screen');
    t.muteIc.classList.toggle('hidden', !info.muted);
    // Modo Jogo Coop
    const coop = Boolean(info.coop) && !info.isLocal;
    t.coopBtn.classList.toggle('hidden', !coop);
    t.el.classList.toggle('coop', coop);
    t.el.classList.toggle('controlling', coop && info.coopState === 'playing');
    t.coopHint.classList.toggle('hidden', !(coop && info.coopState === 'playing'));
    if (coop) t.coopBtn.textContent = IS_MOBILE ? '💻 Coop só no computador' : { idle: '🎮 Pedir para jogar', pending: '⏳ Esperando o host…', playing: '✋ Parar de jogar' }[info.coopState] || '🎮 Pedir para jogar';
    t.coopBtn.classList.toggle('disabled', IS_MOBILE);
    t.badge.textContent = info.kind === 'screen' ? (info.coop ? 'COOP' : 'AO VIVO') : '';
    const fit = this.fit[t.key] || (info.kind === 'screen' ? 'contain' : 'cover');
    t.video.style.objectFit = fit;
    if (hasVideo) {
      if (t.video.srcObject !== info.stream) {
        t.video.srcObject = info.stream;
        t.video.play().catch(() => {});
      }
    } else {
      t.video.srcObject = null;
    }
    if (!hasVideo && info.user) {
      const key = `${info.user.id}:${info.user.avatarUrl}:${info.user.color}:${info.user.displayName}`;
      if (t.avatarWrap.dataset.k !== key) {
        t.avatarWrap.dataset.k = key;
        t.avatarWrap.replaceChildren(avatar(info.user, 96));
        t.el.style.setProperty('--tile-color', info.user.color);
      }
    }
    const pop = this.popouts.get(t.key);
    if (pop && !pop.closed) {
      const v = pop.document.querySelector('video');
      if (v && v.srcObject !== info.stream) v.srcObject = info.stream || null;
    }
  }

  setSpeaking(peerId, speaking) {
    for (const t of this.tiles.values()) if (t.info.peerId === peerId && t.info.kind !== 'screen') t.el.classList.toggle('speaking', speaking);
  }

  setStats(key, text) {
    const t = this.tiles.get(key);
    if (!t) return;
    t.stats.textContent = text || '';
  }

  toggleStats(key) {
    const t = this.tiles.get(key);
    t?.stats.classList.toggle('hidden');
    return t && !t.stats.classList.contains('hidden');
  }

  statsVisible() {
    return [...this.tiles.values()].filter((t) => !t.stats.classList.contains('hidden'));
  }

  // ---------- Ações ----------
  swap(a, b) {
    const ia = this.order.indexOf(a);
    const ib = this.order.indexOf(b);
    if (ia < 0 || ib < 0) return;
    [this.order[ia], this.order[ib]] = [this.order[ib], this.order[ia]];
    if (this.focusKey === a) this.focusKey = b;
    else if (this.focusKey === b) this.focusKey = a;
    this.render();
  }

  setFocus(key) {
    this.focusKey = key;
    if (this.layout !== 'focus') this.layout = 'focus';
    this.persist();
    this.render();
  }

  setFit(key, fit) {
    this.fit[key] = fit;
    this.persist();
    const t = this.tiles.get(key);
    if (t) this.updateTile(t);
  }

  hide(key) {
    this.hidden.add(key);
    this.render();
  }

  showAll() {
    this.hidden.clear();
    this.render();
  }

  // Divide o espaço entre dois blocos (ex.: 70/30)
  setRatio(key, ratio) {
    const docked = this.visibleDocked();
    const others = docked.filter((k) => k !== key);
    if (!others.length) return;
    if (this.layout === 'focus') {
      this.focusKey = key;
      this.weights.__main = ratio * 10;
      this.weights.__side = (1 - ratio) * 10;
    } else {
      this.weights[key] = ratio * 10;
      others.forEach((k) => (this.weights[k] = ((1 - ratio) * 10) / others.length));
    }
    this.persist();
    this.render();
  }

  equalize() {
    for (const k of this.tiles.keys()) this.weights[k] = 1;
    this.weights.__main = 3;
    this.weights.__side = 1;
    this.persist();
    this.render();
  }

  toggleFloat(key) {
    if (this.floating[key]) delete this.floating[key];
    else {
      const t = this.tiles.get(key);
      const isScreen = t?.info.kind === 'screen';
      const n = Object.keys(this.floating).length;
      this.floating[key] = isScreen ? { x: 50, y: 50, w: 45, h: 45 } : { x: 74 - n * 3, y: 66 - n * 3, w: 24, h: 30 };
    }
    this.persist();
    this.render();
  }

  isFloating(key) {
    return Boolean(this.floating[key]);
  }

  fullscreen(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    if (document.fullscreenElement === t.el) document.exitFullscreen().catch(() => {});
    else t.el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }

  async pip(key) {
    const t = this.tiles.get(key);
    if (!t || !t.info.stream) return;
    try {
      if (document.pictureInPictureElement === t.video) await document.exitPictureInPicture();
      else await t.video.requestPictureInPicture();
    } catch (err) {
      console.warn(err);
    }
  }

  // Janela separada (ótimo para quem tem 2 monitores: uma tela em cada)
  popout(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    const existing = this.popouts.get(key);
    if (existing && !existing.closed) return existing.focus();
    const w = window.open('', `kf_${key.replace(/\W/g, '')}`, 'popup=yes,width=1280,height=760');
    if (!w) return;
    w.document.title = `${t.info.name} — Kenfeh`;
    w.document.body.innerHTML = '';
    const style = w.document.createElement('style');
    style.textContent = `html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui}
      video{width:100%;height:100%;object-fit:contain;display:block}
      .hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);color:#fff;background:#0009;padding:6px 12px;border-radius:99px;font-size:13px;transition:opacity .4s}
      .avatar{display:grid;place-items:center;height:100%;color:#fff;font-size:28px}`;
    w.document.head.append(style);
    const v = w.document.createElement('video');
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.srcObject = t.info.stream || null;
    const hint = w.document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Duplo clique = tela cheia';
    w.document.body.append(v, hint);
    setTimeout(() => (hint.style.opacity = 0), 2500);
    v.addEventListener('dblclick', () => (w.document.fullscreenElement ? w.document.exitFullscreen() : w.document.documentElement.requestFullscreen()));
    v.play().catch(() => {});
    this.popouts.set(key, w);
  }

  // ---------- Layout ----------
  scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.render();
    });
  }

  visibleKeys() {
    const anyVideo = [...this.tiles.values()].some((t) => t.info.kind !== 'avatar' && t.info.stream);
    return this.order.filter((k) => {
      if (this.hidden.has(k)) return false;
      const t = this.tiles.get(k);
      if (!t) return false;
      if (!this.showNonVideo && anyVideo && t.info.kind === 'avatar') return false;
      return true;
    });
  }

  visibleDocked() {
    return this.visibleKeys().filter((k) => !this.floating[k]);
  }

  render() {
    const visible = this.visibleKeys();
    const docked = visible.filter((k) => !this.floating[k]);
    const floating = visible.filter((k) => this.floating[k]);
    const layout = this.layout;

    this.dock.className = `stage-dock layout-${layout}`;
    this.dock.replaceChildren();
    this.dock.style.gridTemplateColumns = '';

    // tiles escondidos ficam fora do DOM
    for (const t of this.tiles.values()) {
      t.el.classList.toggle('floating', Boolean(this.floating[t.key]));
      t.el.style.flex = '';
      t.el.style.left = t.el.style.top = t.el.style.width = t.el.style.height = '';
    }

    if (layout === 'grid') {
      const n = Math.max(1, docked.length);
      const r = this.root.getBoundingClientRect();
      // escolhe colunas que deixam os blocos mais próximos de 16:9
      let best = 1, bestScore = Infinity;
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const w = r.width / cols, h = r.height / rows;
        const score = Math.abs(Math.log(w / h / (16 / 9)));
        if (score < bestScore) { bestScore = score; best = cols; }
      }
      this.dock.style.gridTemplateColumns = `repeat(${best}, 1fr)`;
      docked.forEach((k) => this.dock.append(this.tiles.get(k).el));
    } else if (layout === 'focus' && docked.length > 1) {
      const main = docked.includes(this.focusKey) ? this.focusKey : docked.find((k) => this.tiles.get(k).info.kind === 'screen') || docked[0];
      const others = docked.filter((k) => k !== main);
      const portrait = this.root.clientHeight > this.root.clientWidth;
      this.dock.style.flexDirection = portrait ? 'column' : 'row';
      const mainEl = this.tiles.get(main).el;
      mainEl.style.flex = `${this.weights.__main ?? 3} 1 0`;
      mainEl.dataset.wkey = '__main';
      const side = el('div', { class: 'stage-side', dataset: { wkey: '__side' } });
      side.style.flex = `${this.weights.__side ?? 1} 1 0`;
      side.style.flexDirection = portrait ? 'row' : 'column';
      this.fillFlex(side, others, portrait ? 'row' : 'column');
      this.dock.append(mainEl, this.gutter(mainEl, side, portrait ? 'column' : 'row'), side);
    } else {
      // tela em pé (celular): "lado a lado" vira "um em cima do outro"
      const portrait = this.root.clientWidth < 640 && this.root.clientHeight > this.root.clientWidth;
      const dir = layout === 'column' || (layout === 'row' && portrait) ? 'column' : 'row';
      this.dock.style.flexDirection = dir;
      this.fillFlex(this.dock, docked, dir);
    }

    this.floatLayer.replaceChildren();
    for (const k of floating) {
      const t = this.tiles.get(k);
      const f = this.floating[k];
      Object.assign(t.el.style, { left: f.x + '%', top: f.y + '%', width: f.w + '%', height: f.h + '%' });
      this.floatLayer.append(t.el);
    }

    // reanexar <video> ao DOM pode pausar; garante que continuem tocando
    for (const t of this.tiles.values()) if (t.video.srcObject && t.video.paused) t.video.play().catch(() => {});

    const hiddenCount = this.hidden.size;
    this.hiddenBar.classList.toggle('hidden', !hiddenCount);
    this.hiddenBar.replaceChildren(
      el('button', { class: 'chip', onclick: () => this.showAll() }, `${hiddenCount} bloco(s) oculto(s) — mostrar`)
    );
  }

  fillFlex(container, keys, dir) {
    keys.forEach((k, i) => {
      const t = this.tiles.get(k);
      t.el.style.flex = `${this.weights[k] ?? 1} 1 0`;
      t.el.dataset.wkey = k;
      if (i > 0) container.append(this.gutter(this.tiles.get(keys[i - 1]).el, t.el, dir));
      container.append(t.el);
    });
  }

  // Divisória arrastável entre dois blocos
  gutter(a, b, dir) {
    const g = el('div', { class: `gutter gutter-${dir}`, title: 'Arraste para redimensionar • duplo clique = 50/50' });
    const horizontal = dir === 'row';
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      g.classList.add('active');
      document.body.classList.add(horizontal ? 'resizing-x' : 'resizing-y');
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const sa = horizontal ? ra.width : ra.height;
      const sb = horizontal ? rb.width : rb.height;
      const wa = parseFloat(a.style.flexGrow) || 1;
      const wb = parseFloat(b.style.flexGrow) || 1;
      const total = wa + wb;
      const start = horizontal ? e.clientX : e.clientY;
      const move = (ev) => {
        const d = (horizontal ? ev.clientX : ev.clientY) - start;
        const na = Math.max(MIN_PX, Math.min(sa + sb - MIN_PX, sa + d));
        const nwa = (total * na) / (sa + sb);
        const nwb = total - nwa;
        a.style.flexGrow = nwa;
        b.style.flexGrow = nwb;
        this.weights[a.dataset.wkey] = nwa;
        this.weights[b.dataset.wkey] = nwb;
      };
      const up = () => {
        g.classList.remove('active');
        document.body.classList.remove('resizing-x', 'resizing-y');
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.removeEventListener('pointercancel', up);
        this.persist();
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
      g.addEventListener('pointercancel', up);
    });
    g.addEventListener('dblclick', () => {
      const avg = ((parseFloat(a.style.flexGrow) || 1) + (parseFloat(b.style.flexGrow) || 1)) / 2;
      a.style.flexGrow = b.style.flexGrow = avg;
      this.weights[a.dataset.wkey] = this.weights[b.dataset.wkey] = avg;
      this.persist();
    });
    return g;
  }

  // Arrastar e redimensionar blocos flutuantes (posição em % → escala com tela cheia)
  setupFloatDrag(t) {
    const startDrag = (e, mode) => {
      const f = this.floating[t.key];
      if (!f) return;
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const node = mode === 'move' ? t.el : t.handle;
      node.setPointerCapture(e.pointerId);
      const r = this.root.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      const o = { ...f };
      t.el.classList.add('moving');
      const move = (ev) => {
        const dx = ((ev.clientX - sx) / r.width) * 100;
        const dy = ((ev.clientY - sy) / r.height) * 100;
        if (mode === 'move') {
          f.x = Math.max(0, Math.min(100 - f.w, o.x + dx));
          f.y = Math.max(0, Math.min(100 - f.h, o.y + dy));
        } else {
          f.w = Math.max(10, Math.min(100 - f.x, o.w + dx));
          f.h = Math.max(10, Math.min(100 - f.y, o.h + dy));
        }
        Object.assign(t.el.style, { left: f.x + '%', top: f.y + '%', width: f.w + '%', height: f.h + '%' });
      };
      const up = () => {
        t.el.classList.remove('moving');
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
        this.persist();
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
    };
    t.el.addEventListener('pointerdown', (e) => {
      if (!this.floating[t.key] || e.target.closest('.tile-actions, .tile-resize, .tile-label')) return;
      startDrag(e, 'move');
    });
    t.handle.addEventListener('pointerdown', (e) => startDrag(e, 'resize'));
  }
}
