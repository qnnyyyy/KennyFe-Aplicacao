// Utilitários de interface: elementos, ícones, toasts, modais, menus de contexto.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// celular/tablet (sem mouse): algumas funções, como o Modo Jogo Coop, são só para computador
export const IS_MOBILE =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);
if (IS_MOBILE) document.documentElement.classList.add('is-mobile');
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Ícones no estilo "lucide" (traço 2px)
const P = {
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  'mic-off': '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  'headphones-off': '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/><line x1="2" x2="22" y1="2" y2="22"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  'video-off': '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  'monitor-up': '<path d="m9 10 3-3 3 3"/><path d="M12 13V7"/><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M12 17v4"/><path d="M8 21h8"/>',
  'phone-off': '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" x2="2" y1="2" y2="22"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
  rows: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/>',
  focus: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="M15 9h6"/><path d="M15 15h6"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
  sticker: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/><path d="M8 13h.01"/><path d="M16 13h.01"/><path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  popout: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  pip: '<rect width="20" height="16" x="2" y="4" rx="2"/><rect width="8" height="6" x="12" y="12" rx="1"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  'volume-x': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
  'message': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  record: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  float: '<rect width="20" height="14" x="2" y="5" rx="2"/><rect width="7" height="5" x="13" y="12" rx="1" fill="currentColor"/>',
  cinema: '<path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2"/><path d="M2 12h10"/><path d="m9 9 3 3-3 3"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
};

export function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

export function setIcon(node, name, size) {
  node.replaceChildren(icon(name, size));
}

// Avatar com moldura opcional (as molduras são CSS animado em volta da foto)
export function avatar(user, size = 36, { frame = true } = {}) {
  const inner = el('div', { class: 'avatar', style: { background: user?.color || '#7b5cff', fontSize: Math.round(size * 0.42) + 'px' } });
  if (user?.avatarUrl) inner.append(el('img', { src: user.avatarUrl, alt: '' }));
  else inner.textContent = (user?.displayName || user?.username || '?').trim().charAt(0).toUpperCase();
  const f = frame && user?.frame && user.frame !== 'none' ? user.frame : null;
  const wrap = el('div', { class: `av ${f ? 'framed frame-' + f : ''}`, style: { width: size + 'px', height: size + 'px' } }, inner);
  wrap.style.setProperty('--fw', Math.max(2, Math.round(size * 0.075)) + 'px');
  return wrap;
}

export const FRAMES = [
  ['none', 'Sem moldura'],
  ['neon', 'Neon'],
  ['fire', 'Fogo'],
  ['ice', 'Gelo'],
  ['gold', 'Ouro'],
  ['rainbow', 'Arco-íris'],
  ['toxic', 'Tóxico'],
  ['galaxy', 'Galáxia'],
  ['pixel', 'Pixel'],
  ['glitch', 'Glitch'],
];

export function timeAgo(sec) {
  const d = Math.max(0, Math.floor(Date.now() / 1000 - sec));
  if (d < 60) return 'agora mesmo';
  if (d < 3600) return `há ${Math.floor(d / 60)} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h ${Math.floor((d % 3600) / 60)} min`;
  return `há ${Math.floor(d / 86400)} dia(s)`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- Toasts ----------
export function toast(message, type = 'info', ms = 3500) {
  const t = el('div', { class: `toast toast-${type}` }, message);
  document.getElementById('toasts').append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// ---------- Modais ----------
export function modal({ title, content, actions = [], wide = false, className = '', onClose } = {}) {
  const layer = document.getElementById('layer');
  const close = () => {
    backdrop.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => backdrop.remove(), 200);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && layer.lastElementChild === backdrop) close();
  };
  const footer = actions.length
    ? el(
        'div',
        { class: 'modal-actions' },
        actions.map((a) =>
          el('button', { class: `btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-ghost'}`, onclick: () => a.onClick?.(close) }, a.label)
        )
      )
    : null;
  const box = el(
    'div',
    { class: `modal glass ${wide ? 'modal-wide' : ''} ${className}` },
    el('header', { class: 'modal-head' }, el('h3', {}, title || ''), el('button', { class: 'icon-btn', onclick: close, title: 'Fechar' }, icon('x'))),
    el('div', { class: 'modal-body' }, content),
    footer
  );
  const backdrop = el('div', { class: 'backdrop', onmousedown: (e) => e.target === backdrop && close() }, box);
  layer.append(backdrop);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  return { close, box, body: box.querySelector('.modal-body') };
}

export function prompt({ title, label, value = '', placeholder = '', okLabel = 'OK' }) {
  return new Promise((resolve) => {
    let done = false;
    const input = el('input', { class: 'input', value, placeholder });
    const m = modal({
      title,
      content: el('label', { class: 'field' }, el('span', {}, label || ''), input),
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        { label: okLabel, primary: true, onClick: (c) => { done = true; resolve(input.value.trim()); c(); } },
      ],
      onClose: () => !done && resolve(null),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { done = true; resolve(input.value.trim()); m.close(); }
    });
    setTimeout(() => input.focus(), 50);
  });
}

// ---------- Menu de contexto (botão direito / toque longo) ----------
let openMenu = null;
export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

/**
 * items: [{ label, icon, onClick, danger, checked } | { type:'sep' } | { type:'title', label }
 *        | { type:'slider', label, min, max, value, step, format, onInput } | { type:'custom', node }]
 */
export function contextMenu(x, y, items, className = '') {
  closeMenu();
  const menu = el('div', { class: `ctx-menu glass ${className}`, oncontextmenu: (e) => e.preventDefault() });
  for (const it of items) {
    if (!it) continue;
    if (it.type === 'sep') menu.append(el('div', { class: 'ctx-sep' }));
    else if (it.type === 'title') menu.append(el('div', { class: 'ctx-title' }, it.label));
    else if (it.type === 'custom') menu.append(it.node);
    else if (it.type === 'slider') {
      const out = el('span', { class: 'ctx-slider-val' }, it.format ? it.format(it.value) : it.value);
      const range = el('input', { type: 'range', min: it.min, max: it.max, step: it.step || 1, value: it.value });
      range.addEventListener('input', () => {
        out.textContent = it.format ? it.format(Number(range.value)) : range.value;
        it.onInput?.(Number(range.value));
      });
      menu.append(el('div', { class: 'ctx-slider' }, el('div', { class: 'ctx-slider-head' }, el('span', {}, it.label), out), range));
    } else {
      menu.append(
        el(
          'button',
          {
            class: `ctx-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}`,
            disabled: it.disabled,
            onclick: () => {
              closeMenu();
              it.onClick?.();
            },
          },
          it.icon ? icon(it.icon, 16) : el('span', { class: 'ic-space' }),
          el('span', { class: 'ctx-label' }, it.label),
          it.checked !== undefined ? el('span', { class: 'ctx-check' }, it.checked ? '✓' : '') : null
        )
      );
    }
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + 'px';
  openMenu = menu;
  return menu;
}

document.addEventListener('mousedown', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
window.addEventListener('blur', closeMenu);

// Botão direito no PC + toque longo no celular
export function onContext(node, handler) {
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    handler(e.clientX, e.clientY, e);
  });
  let timer = null;
  let start = null;
  node.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY };
    timer = setTimeout(() => {
      timer = null;
      handler(start.x, start.y, e);
      navigator.vibrate?.(15);
    }, 500);
  }, { passive: true });
  const cancel = (e) => {
    if (!timer) return;
    if (e.type === 'touchmove') {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) < 10) return;
    }
    clearTimeout(timer);
    timer = null;
  };
  node.addEventListener('touchmove', cancel, { passive: true });
  node.addEventListener('touchend', cancel);
  node.addEventListener('touchcancel', cancel);
}

// Popover ancorado em um botão
export function popover(anchor, content, { placement = 'top', className = '' } = {}) {
  closeMenu();
  const pop = el('div', { class: `ctx-menu popover glass ${className}` }, content);
  document.body.append(pop);
  const a = anchor.getBoundingClientRect();
  const r = pop.getBoundingClientRect();
  let x = a.left + a.width / 2 - r.width / 2;
  let y = placement === 'top' ? a.top - r.height - 10 : a.bottom + 10;
  if (y < 8) y = a.bottom + 10;
  if (y + r.height > window.innerHeight - 8) y = Math.max(8, a.top - r.height - 10);
  pop.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  pop.style.top = y + 'px';
  openMenu = pop;
  return pop;
}

export function formatTime(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `hoje às ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `ontem às ${hm}`;
  return `${d.toLocaleDateString('pt-BR')} ${hm}`;
}

export function store(key, fallback) {
  try {
    const v = localStorage.getItem('kf:' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    localStorage.setItem('kf:' + key, JSON.stringify(value));
  } catch {}
}

// Sons curtinhos gerados na hora (sem arquivos)
let sfxCtx = null;
export function sfx(kind) {
  try {
    sfxCtx ||= new AudioContext();
    const ctx = sfxCtx;
    const notes = { join: [523, 784], leave: [784, 523], message: [880], ring: [659, 880, 659, 880], mute: [440], unmute: [660] }[kind] || [600];
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const s = t0 + i * 0.09;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.12, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(s);
      o.stop(s + 0.18);
    });
  } catch {}
}
