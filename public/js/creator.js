// Estúdio de criação: figurinhas (fotos, texto, emojis, desenho, contorno)
// e GIFs (gravados da webcam, da tela, de um vídeo ou de várias imagens).
import { el, icon, modal, toast } from './ui.js';
import { api } from './api.js';
import { emojiPicker } from './emoji.js';
import { popover, closeMenu } from './ui.js';

const FONTS = [
  ['Anton', 'Impacto (meme)'],
  ['Bangers', 'Gibi'],
  ['Pacifico', 'Fofinha'],
  ['Outfit', 'Moderna'],
];
const COLORS = ['#ffffff', '#000000', '#ff5fa2', '#ff3b3b', '#ffb84c', '#ffe14c', '#5ce1a0', '#4cc9f0', '#7c8cff', '#a66bff'];

export function openStudio(kind = 'sticker', onDone) {
  const body = el('div', { class: 'studio' });
  const tabs = el('div', { class: 'studio-tabs' });
  let cleanup = () => {};
  const show = (k) => {
    cleanup();
    tabs.replaceChildren(
      el('button', { class: k === 'sticker' ? 'active' : '', onclick: () => show('sticker') }, '🌟 Figurinha'),
      el('button', { class: k === 'gif' ? 'active' : '', onclick: () => show('gif') }, '🎞️ GIF')
    );
    const editor = k === 'gif' ? gifMaker(done) : stickerEditor(done);
    cleanup = editor.cleanup;
    body.replaceChildren(editor.node);
  };
  const m = modal({ title: '✨ Estúdio', content: el('div', {}, tabs, body), wide: true, className: 'studio-modal', onClose: () => cleanup() });
  function done(sticker) {
    m.close();
    onDone?.(sticker);
  }
  show(kind);
}

// Pede a webcam e devolve uma foto (canvas)
function webcamSnapshot() {
  return new Promise(async (resolve) => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (err) {
      toast('Não consegui abrir a câmera: ' + err.message, 'error');
      return resolve(null);
    }
    const video = el('video', { autoplay: true, playsinline: true, muted: true, class: 'snap-video' });
    video.srcObject = stream;
    const count = el('div', { class: 'snap-count' });
    let resolved = false;
    const finish = (c) => {
      resolved = true;
      stream.getTracks().forEach((t) => t.stop());
      resolve(c);
    };
    const grab = () => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      const ctx = c.getContext('2d');
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0);
      return c;
    };
    const m = modal({
      title: '📷 Tirar foto',
      content: el('div', { class: 'snap' }, video, count),
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        { label: 'Em 3 segundos', onClick: (c) => { let n = 3; count.textContent = n; const t = setInterval(() => { n--; count.textContent = n || ''; if (!n) { clearInterval(t); const shot = grab(); finish(shot); c(); } }, 1000); } },
        { label: 'Capturar agora', primary: true, onClick: (c) => { const shot = grab(); finish(shot); c(); } },
      ],
      onClose: () => !resolved && finish(null),
    });
    return m;
  });
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const i = el('input', { type: 'file', accept, multiple });
    i.addEventListener('change', () => resolve([...i.files]));
    i.click();
  });
}

function colorRow(value, onPick) {
  const row = el('div', { class: 'color-row' });
  const custom = el('input', { type: 'color', value, oninput: (e) => { onPick(e.target.value); mark(e.target.value); } });
  const mark = (v) => row.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s.dataset.c === v));
  COLORS.forEach((c) => row.append(el('button', { class: 'swatch', style: { background: c }, dataset: { c }, onclick: () => { onPick(c); mark(c); custom.value = c; } })));
  row.append(custom);
  mark(value);
  return row;
}

function drawTextBlock(ctx, text, x, y, { font, size, color, stroke, strokeWidth, align = 'center', baseline = 'middle', maxWidth }) {
  ctx.save();
  ctx.font = `${size}px "${font}", Impact, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (!maxWidth) { lines.push(para); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
    }
    lines.push(line);
  }
  const lh = size * 1.12;
  const startY = baseline === 'top' ? y : baseline === 'bottom' ? y - lh * (lines.length - 1) : y - (lh * (lines.length - 1)) / 2;
  lines.forEach((l, i) => {
    if (strokeWidth > 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(l, x, startY + i * lh);
    }
    ctx.fillStyle = color;
    ctx.fillText(l, x, startY + i * lh);
  });
  ctx.restore();
  return { width: Math.max(...lines.map((l) => ctx.measureText(l).width), 10), height: lh * lines.length };
}

// =====================================================================
// FIGURINHA
// =====================================================================
function stickerEditor(done) {
  const S = 512;
  const canvas = el('canvas', { class: 'sticker-canvas', width: S, height: S });
  const ctx = canvas.getContext('2d');
  const drawLayer = document.createElement('canvas');
  drawLayer.width = drawLayer.height = S;
  const dctx = drawLayer.getContext('2d');
  const layers = [];
  let selected = null;
  let tool = 'move';
  let brush = { color: '#ff5fa2', size: 14 };
  const opts = { frame: 'none', outline: true, outlineSize: 10, shadow: true };

  const props = el('div', { class: 'studio-props' });

  function addLayer(layer) {
    layers.push(layer);
    selected = layer;
    tool = 'move';
    renderTools();
    renderProps();
    draw();
  }

  async function addImage(source) {
    if (!source) return;
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const scale = Math.min((S * 0.9) / w, (S * 0.9) / h);
    addLayer({ type: 'image', src: source, w, h, x: S / 2, y: S / 2, scale, rot: 0 });
  }

  function addText(text = 'Sua frase', isEmoji = false) {
    addLayer({ type: isEmoji ? 'emoji' : 'text', text, font: 'Anton', size: isEmoji ? 140 : 72, color: '#ffffff', stroke: '#000000', strokeWidth: isEmoji ? 0 : 10, x: S / 2, y: isEmoji ? S / 2 : S * 0.82, rot: 0, scale: 1 });
  }

  function layerBounds(l) {
    if (l.type === 'image') return { w: l.w * l.scale, h: l.h * l.scale };
    ctx.save();
    ctx.font = `${l.size * l.scale}px "${l.font}"`;
    const lines = l.text.split('\n');
    const w = Math.max(...lines.map((s) => ctx.measureText(s).width), 20);
    ctx.restore();
    return { w: w + 20, h: l.size * l.scale * 1.15 * lines.length + 10 };
  }

  function drawLayerTo(c, l) {
    c.save();
    c.translate(l.x, l.y);
    c.rotate((l.rot * Math.PI) / 180);
    if (l.type === 'image') {
      const w = l.w * l.scale, h = l.h * l.scale;
      c.drawImage(l.src, -w / 2, -h / 2, w, h);
    } else {
      drawTextBlock(c, l.text, 0, 0, { font: l.type === 'emoji' ? 'Outfit' : l.font, size: l.size * l.scale, color: l.color, stroke: l.stroke, strokeWidth: l.strokeWidth * l.scale });
    }
    c.restore();
  }

  function composeContent() {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    for (const l of layers) drawLayerTo(x, l);
    x.drawImage(drawLayer, 0, 0);
    if (opts.frame !== 'none') {
      x.globalCompositeOperation = 'destination-in';
      x.beginPath();
      if (opts.frame === 'circle') x.arc(S / 2, S / 2, S / 2 - 16, 0, Math.PI * 2);
      else if (opts.frame === 'heart') {
        const s = S / 2 - 10;
        x.moveTo(S / 2, S * 0.88);
        x.bezierCurveTo(-s * 0.2, S * 0.55, S * 0.12, -S * 0.05, S / 2, S * 0.27);
        x.bezierCurveTo(S * 0.88, -S * 0.05, S + s * 0.2, S * 0.55, S / 2, S * 0.88);
      } else x.roundRect(16, 16, S - 32, S - 32, 64);
      x.fill();
      x.globalCompositeOperation = 'source-over';
    }
    return c;
  }

  // Contorno branco estilo figurinha do WhatsApp
  function composeFinal() {
    const content = composeContent();
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const o = out.getContext('2d');
    if (opts.outline && opts.outlineSize > 0) {
      const sil = document.createElement('canvas');
      sil.width = sil.height = S;
      const s = sil.getContext('2d');
      s.drawImage(content, 0, 0);
      s.globalCompositeOperation = 'source-in';
      s.fillStyle = '#fff';
      s.fillRect(0, 0, S, S);
      if (opts.shadow) {
        o.save();
        o.shadowColor = 'rgba(0,0,0,.3)';
        o.shadowBlur = 10;
        o.shadowOffsetY = 4;
      }
      // expande a silhueta em círculo e só depois aplica a sombra (uma vez)
      const ring = document.createElement('canvas');
      ring.width = ring.height = S;
      const rg = ring.getContext('2d');
      const r = opts.outlineSize;
      for (let a = 0; a < 360; a += 15) {
        const rad = (a * Math.PI) / 180;
        rg.drawImage(sil, Math.cos(rad) * r, Math.sin(rad) * r);
      }
      o.drawImage(ring, 0, 0);
      if (opts.shadow) o.restore();
    }
    o.drawImage(content, 0, 0);
    return out;
  }

  function draw() {
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(composeFinal(), 0, 0);
    if (selected && tool === 'move' && layers.includes(selected)) {
      const b = layerBounds(selected);
      ctx.save();
      ctx.translate(selected.x, selected.y);
      ctx.rotate((selected.rot * Math.PI) / 180);
      ctx.strokeStyle = '#3d8bff';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
  }

  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * S, y: ((e.clientY - r.top) / r.height) * S };
  };

  function hitTest(p) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const b = layerBounds(l);
      const ang = (-l.rot * Math.PI) / 180;
      const dx = p.x - l.x, dy = p.y - l.y;
      const lx = dx * Math.cos(ang) - dy * Math.sin(ang);
      const ly = dx * Math.sin(ang) + dy * Math.cos(ang);
      if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return l;
    }
    return null;
  }

  let drag = null;
  const pinch = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    pinch.set(e.pointerId, p);
    if (tool === 'brush' || tool === 'eraser') {
      drag = { type: 'paint', last: p };
      dctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      dctx.fillStyle = brush.color;
      dctx.beginPath();
      dctx.arc(p.x, p.y, brush.size / 2, 0, Math.PI * 2);
      dctx.fill();
      draw();
      return;
    }
    const hit = hitTest(p);
    selected = hit;
    renderProps();
    if (hit) drag = { type: 'move', start: p, ox: hit.x, oy: hit.y };
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toCanvas(e);
    if (pinch.size === 2 && selected && drag.type === 'move') {
      const prev = [...pinch.values()];
      pinch.set(e.pointerId, p);
      const now = [...pinch.values()];
      const d0 = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y);
      const d1 = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
      if (d0 > 0) selected.scale = Math.max(0.05, selected.scale * (d1 / d0));
      draw();
      return;
    }
    pinch.set(e.pointerId, p);
    if (drag.type === 'paint') {
      dctx.strokeStyle = brush.color;
      dctx.lineWidth = brush.size;
      dctx.lineCap = 'round';
      dctx.beginPath();
      dctx.moveTo(drag.last.x, drag.last.y);
      dctx.lineTo(p.x, p.y);
      dctx.stroke();
      drag.last = p;
    } else if (selected) {
      selected.x = drag.ox + (p.x - drag.start.x);
      selected.y = drag.oy + (p.y - drag.start.y);
    }
    draw();
  });
  const endDrag = (e) => {
    pinch.delete(e.pointerId);
    if (!pinch.size) drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (!selected) return;
    e.preventDefault();
    if (e.shiftKey) selected.rot += e.deltaY > 0 ? 5 : -5;
    else selected.scale = Math.max(0.05, selected.scale * (e.deltaY > 0 ? 0.93 : 1.07));
    renderProps();
    draw();
  }, { passive: false });

  const tools = el('div', { class: 'studio-tools' });
  function renderTools() {
    const tb = (id, ic, label, fn) => el('button', { class: `tool-btn ${tool === id ? 'active' : ''}`, onclick: fn }, icon(ic, 18), el('span', {}, label));
    tools.replaceChildren(
      tb('cam', 'camera', 'Foto', async () => addImage(await webcamSnapshot())),
      tb('img', 'image', 'Imagem', async () => { const [f] = await pickFiles('image/*'); if (f) addImage(await loadImageFile(f)); }),
      tb('text', 'type', 'Texto', () => addText()),
      el('button', { class: 'tool-btn', onclick: (e) => popover(e.currentTarget, emojiPicker((emo) => { closeMenu(); addText(emo, true); }), { className: 'emoji-pop' }) }, el('span', { class: 'tool-emoji' }, '😀'), el('span', {}, 'Emoji')),
      tb('brush', 'brush', 'Pincel', () => { tool = tool === 'brush' ? 'move' : 'brush'; renderTools(); renderProps(); draw(); }),
      tb('eraser', 'x', 'Borracha', () => { tool = tool === 'eraser' ? 'move' : 'eraser'; renderTools(); renderProps(); draw(); })
    );
  }

  function slider(label, min, max, step, value, onInput) {
    const out = el('span', {}, value);
    const r = el('input', { type: 'range', min, max, step, value });
    r.addEventListener('input', () => { out.textContent = r.value; onInput(Number(r.value)); draw(); });
    return el('label', { class: 'prop' }, el('div', { class: 'prop-head' }, el('span', {}, label), out), r);
  }

  function renderProps() {
    props.replaceChildren();
    if (tool === 'brush' || tool === 'eraser') {
      props.append(el('h4', {}, tool === 'brush' ? '🖌️ Pincel' : '🧽 Borracha'));
      if (tool === 'brush') props.append(colorRow(brush.color, (c) => (brush.color = c)));
      props.append(slider('Espessura', 2, 80, 1, brush.size, (v) => (brush.size = v)));
      props.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { dctx.clearRect(0, 0, S, S); draw(); } }, 'Limpar desenho'));
    } else if (selected) {
      const l = selected;
      props.append(el('h4', {}, l.type === 'image' ? '🖼️ Imagem' : l.type === 'emoji' ? '😀 Emoji' : '🔤 Texto'));
      if (l.type === 'text') {
        const ta = el('textarea', { class: 'input', rows: 2 }, l.text);
        ta.addEventListener('input', () => { l.text = ta.value || ' '; draw(); });
        props.append(ta);
        props.append(el('select', { class: 'input', onchange: (e) => { l.font = e.target.value; draw(); } }, FONTS.map(([f, n]) => el('option', { value: f, selected: l.font === f, style: { fontFamily: f } }, n))));
        props.append(el('small', { class: 'muted' }, 'Cor do texto'), colorRow(l.color, (c) => { l.color = c; draw(); }));
        props.append(el('small', { class: 'muted' }, 'Cor do contorno'), colorRow(l.stroke, (c) => { l.stroke = c; draw(); }));
        props.append(slider('Contorno', 0, 30, 1, l.strokeWidth, (v) => (l.strokeWidth = v)));
      }
      props.append(slider('Tamanho', 5, 400, 1, Math.round(l.scale * 100), (v) => (l.scale = v / 100)));
      props.append(slider('Rotação', -180, 180, 1, l.rot, (v) => (l.rot = v)));
      props.append(
        el('div', { class: 'prop-actions' },
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const i = layers.indexOf(l); layers.splice(i, 1); layers.push(l); draw(); } }, 'Trazer p/ frente'),
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const i = layers.indexOf(l); layers.splice(i, 1); layers.unshift(l); draw(); } }, 'Mandar p/ trás'),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => { layers.splice(layers.indexOf(l), 1); selected = null; renderProps(); draw(); } }, 'Remover')
        )
      );
      props.append(el('p', { class: 'muted small' }, 'Arraste para mover • roda do mouse = tamanho • Shift + roda = girar • no celular, pinça para zoom.'));
    } else {
      props.append(el('h4', {}, '✨ Comece aqui'), el('p', { class: 'muted small' }, 'Tire uma foto, escolha uma imagem, escreva um texto ou desenhe. Clique em um item para editar.'));
    }
    props.append(el('div', { class: 'ctx-sep' }), el('h4', {}, '🎨 Estilo da figurinha'));
    props.append(
      el('div', { class: 'seg' },
        ...[['none', 'Livre'], ['circle', 'Círculo'], ['rounded', 'Arredondado'], ['heart', 'Coração']].map(([id, n]) =>
          el('button', { class: opts.frame === id ? 'active' : '', onclick: () => { opts.frame = id; renderProps(); draw(); } }, n)
        )
      )
    );
    const outline = el('input', { type: 'checkbox', checked: opts.outline, onchange: (e) => { opts.outline = e.target.checked; draw(); } });
    props.append(el('label', { class: 'switch-row compact' }, outline, el('span', { class: 'switch' }), el('span', {}, 'Contorno branco')));
    props.append(slider('Espessura do contorno', 2, 24, 1, opts.outlineSize, (v) => (opts.outlineSize = v)));
  }

  const name = el('input', { class: 'input', placeholder: 'Nome (opcional)', maxlength: 40 });
  const save = el('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      if (!layers.length && !hasDrawing()) return toast('Adicione algo à figurinha primeiro 🙂', 'error');
      save.disabled = true;
      save.textContent = 'Salvando…';
      const blob = await new Promise((r) => composeFinal().toBlob(r, 'image/png'));
      try {
        const up = await api.upload(new File([blob], 'figurinha.png', { type: 'image/png' }), 'sticker', name.value);
        toast('Figurinha criada! 🌟', 'success');
        done(up.sticker);
      } catch (err) {
        toast(err.message, 'error');
        save.disabled = false;
        save.textContent = 'Salvar e enviar';
      }
    },
  }, 'Salvar e enviar');

  function hasDrawing() {
    const d = dctx.getImageData(0, 0, S, S).data;
    for (let i = 3; i < d.length; i += 16) if (d[i]) return true;
    return false;
  }

  renderTools();
  renderProps();
  // fontes carregam sob demanda; pede todas e redesenha quando chegarem
  Promise.all(FONTS.map(([f]) => document.fonts?.load(`64px "${f}"`))).then(draw, draw);
  draw();

  const node = el('div', { class: 'studio-sticker' },
    el('div', { class: 'studio-left' }, tools, el('div', { class: 'canvas-wrap checker' }, canvas)),
    el('div', { class: 'studio-right' }, props, el('div', { class: 'studio-save' }, name, save))
  );
  return { node, cleanup: () => {} };
}

// =====================================================================
// GIF
// =====================================================================
function gifMaker(done) {
  const st = {
    source: null, // 'webcam' | 'screen' | 'video' | 'images'
    stream: null,
    fps: 12,
    duration: 3,
    width: 360,
    frames: [], // canvases
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    effect: 'normal', // normal | boomerang | reverse
    filter: 'none',
    top: '',
    bottom: '',
    font: 'Anton',
    color: '#ffffff',
    size: 34,
    recording: false,
  };
  const live = el('video', { class: 'gif-live', autoplay: true, playsinline: true, muted: true });
  const preview = el('canvas', { class: 'gif-preview' });
  const pctx = preview.getContext('2d');
  const stage = el('div', { class: 'gif-stage' });
  const sourceBar = el('div', { class: 'studio-tools' });
  const controls = el('div', { class: 'studio-props' });
  const progress = el('div', { class: 'gif-progress hidden' }, el('span'));
  let playTimer = null;
  let videoFile = null;

  const stopStream = () => {
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = null;
  };

  function renderSources() {
    const sb = (id, ic, label, fn) => el('button', { class: `tool-btn ${st.source === id ? 'active' : ''}`, onclick: fn }, typeof ic === 'string' ? icon(ic, 18) : ic, el('span', {}, label));
    sourceBar.replaceChildren(
      sb('webcam', 'camera', 'Webcam', () => useLive('webcam')),
      sb('screen', 'monitor', 'Tela', () => useLive('screen')),
      sb('video', 'film', 'Vídeo do PC', useVideo),
      sb('images', 'image', 'Imagens', useImages)
    );
  }

  async function useLive(kind) {
    stopStream();
    try {
      st.stream = kind === 'webcam'
        ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })
        : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
    } catch (err) {
      if (err.name !== 'NotAllowedError') toast(err.message, 'error');
      return;
    }
    st.source = kind;
    videoFile = null;
    live.srcObject = st.stream;
    live.src = '';
    live.classList.toggle('mirror', kind === 'webcam');
    st.stream.getVideoTracks()[0].addEventListener('ended', () => st.source === kind && renderStage());
    st.frames = [];
    renderSources();
    renderStage();
    renderControls();
  }

  async function useVideo() {
    const [f] = await pickFiles('video/*');
    if (!f) return;
    stopStream();
    st.source = 'video';
    videoFile = f;
    live.srcObject = null;
    live.classList.remove('mirror');
    live.src = URL.createObjectURL(f);
    live.muted = true;
    live.controls = true;
    st.frames = [];
    renderSources();
    renderStage();
    renderControls();
  }

  async function useImages() {
    const files = await pickFiles('image/*', true);
    if (!files.length) return;
    stopStream();
    st.source = 'images';
    const imgs = await Promise.all(files.map(loadImageFile));
    const w = st.width;
    const h = Math.round((w * (imgs[0].naturalHeight / imgs[0].naturalWidth)) / 2) * 2;
    st.frames = imgs.map((img) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#000';
      x.fillRect(0, 0, w, h);
      const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      x.drawImage(img, (w - img.naturalWidth * s) / 2, (h - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
      return c;
    });
    st.fps = 2;
    st.trimStart = 0;
    st.trimEnd = st.frames.length - 1;
    renderSources();
    renderStage();
    renderControls();
  }

  function frameSize(vw, vh) {
    const w = st.width;
    return { w, h: Math.max(2, Math.round((w * vh) / vw / 2) * 2) };
  }

  async function record() {
    if (st.recording) return;
    st.recording = true;
    renderControls();
    const frames = [];
    const total = Math.round(st.duration * st.fps);
    const bar = progress.firstChild;
    progress.classList.remove('hidden');
    try {
      if (st.source === 'video') {
        const start = live.currentTime;
        live.pause();
        const { w, h } = frameSize(live.videoWidth, live.videoHeight);
        for (let i = 0; i < total; i++) {
          const t = start + i / st.fps;
          if (t > live.duration) break;
          live.currentTime = t;
          await new Promise((r) => live.addEventListener('seeked', r, { once: true }));
          frames.push(grabFrame(w, h, false));
          bar.style.width = ((i + 1) / total) * 100 + '%';
        }
      } else {
        // contagem regressiva
        for (let n = 3; n > 0; n--) {
          stage.dataset.count = n;
          await new Promise((r) => setTimeout(r, 700));
        }
        delete stage.dataset.count;
        const { w, h } = frameSize(live.videoWidth, live.videoHeight);
        const mirror = st.source === 'webcam';
        await new Promise((resolve) => {
          let i = 0;
          const timer = setInterval(() => {
            frames.push(grabFrame(w, h, mirror));
            i++;
            bar.style.width = (i / total) * 100 + '%';
            if (i >= total) {
              clearInterval(timer);
              resolve();
            }
          }, 1000 / st.fps);
        });
      }
    } finally {
      st.recording = false;
      progress.classList.add('hidden');
    }
    st.frames = frames;
    st.trimStart = 0;
    st.trimEnd = frames.length - 1;
    renderStage();
    renderControls();
  }

  function grabFrame(w, h, mirror) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    if (mirror) {
      x.translate(w, 0);
      x.scale(-1, 1);
    }
    x.drawImage(live, 0, 0, w, h);
    return c;
  }

  function sequence() {
    const base = st.frames.slice(st.trimStart, st.trimEnd + 1);
    if (st.effect === 'reverse') return [...base].reverse();
    if (st.effect === 'boomerang') return [...base, ...base.slice(1, -1).reverse()];
    return base;
  }

  const FILTERS = {
    none: 'none',
    bw: 'grayscale(1) contrast(1.1)',
    sepia: 'sepia(.85)',
    vivid: 'saturate(1.7) contrast(1.1)',
    vintage: 'sepia(.35) saturate(1.3) contrast(.95) brightness(1.05) hue-rotate(-10deg)',
    dream: 'saturate(1.3) brightness(1.1) hue-rotate(-20deg) blur(.4px)',
  };

  function renderFrame(x, frame) {
    const w = frame.width, h = frame.height;
    x.filter = FILTERS[st.filter] || 'none';
    x.drawImage(frame, 0, 0);
    x.filter = 'none';
    const size = (st.size * w) / 320;
    const style = { font: st.font, size, color: st.color, stroke: '#000', strokeWidth: size / 7, maxWidth: w * 0.92 };
    if (st.top) drawTextBlock(x, st.font === 'Anton' ? st.top.toUpperCase() : st.top, w / 2, h * 0.04, { ...style, baseline: 'top' });
    if (st.bottom) drawTextBlock(x, st.font === 'Anton' ? st.bottom.toUpperCase() : st.bottom, w / 2, h * 0.96, { ...style, baseline: 'bottom' });
  }

  function play() {
    clearTimeout(playTimer);
    const seq = sequence();
    if (!seq.length) return;
    preview.width = seq[0].width;
    preview.height = seq[0].height;
    let i = 0;
    const tick = () => {
      renderFrame(pctx, seq[i % seq.length]);
      i++;
      playTimer = setTimeout(tick, 1000 / (st.fps * st.speed));
    };
    tick();
  }

  function renderStage() {
    clearTimeout(playTimer);
    stage.replaceChildren();
    if (st.frames.length) {
      stage.append(preview);
      play();
    } else if (st.source && st.source !== 'images') {
      stage.append(live);
      live.play().catch(() => {});
    } else {
      stage.append(el('div', { class: 'gif-empty' }, el('div', { class: 'gif-empty-ic' }, '🎞️'), el('b', {}, 'Escolha de onde vem o GIF'), el('p', { class: 'muted small' }, 'Grave a webcam (a reação dela!), um pedaço da tela, um trecho de vídeo do PC ou junte várias fotos.')));
    }
    stage.append(progress);
  }

  function field(label, input) {
    return el('label', { class: 'prop' }, el('div', { class: 'prop-head' }, el('span', {}, label)), input);
  }
  function slider(label, min, max, step, value, fmt, onInput) {
    const out = el('span', {}, fmt(value));
    const r = el('input', { type: 'range', min, max, step, value });
    r.addEventListener('input', () => { out.textContent = fmt(Number(r.value)); onInput(Number(r.value)); });
    return el('label', { class: 'prop' }, el('div', { class: 'prop-head' }, el('span', {}, label), out), r);
  }

  function renderControls() {
    controls.replaceChildren();
    if (!st.frames.length) {
      if (!st.source) return;
      controls.append(el('h4', {}, '⏺️ Gravação'));
      controls.append(slider('Duração', 1, 10, 0.5, st.duration, (v) => `${v}s`, (v) => (st.duration = v)));
      controls.append(slider('Quadros por segundo', 5, 24, 1, st.fps, (v) => `${v} fps`, (v) => (st.fps = v)));
      controls.append(el('div', { class: 'seg' }, ...[240, 320, 400, 480].map((w) => el('button', { class: st.width === w ? 'active' : '', onclick: () => { st.width = w; renderControls(); } }, `${w}px`))));
      if (st.source === 'video') controls.append(el('p', { class: 'muted small' }, 'Use a barra do vídeo para achar o momento de início e clique em Gravar.'));
      controls.append(el('button', { class: 'btn btn-primary btn-lg', disabled: st.recording, onclick: record }, st.recording ? 'Gravando…' : st.source === 'video' ? '✂️ Recortar trecho' : '⏺️ Gravar (3, 2, 1…)'));
      return;
    }
    const n = st.frames.length;
    controls.append(el('h4', {}, '✂️ Corte e velocidade'));
    if (n > 2) {
      controls.append(slider('Início', 0, n - 1, 1, st.trimStart, (v) => `quadro ${v + 1}`, (v) => { st.trimStart = Math.min(v, st.trimEnd - 1); play(); }));
      controls.append(slider('Fim', 0, n - 1, 1, st.trimEnd, (v) => `quadro ${v + 1}`, (v) => { st.trimEnd = Math.max(v, st.trimStart + 1); play(); }));
    }
    controls.append(slider('Velocidade', 0.25, 3, 0.25, st.speed, (v) => `${v}×`, (v) => { st.speed = v; play(); }));
    controls.append(el('div', { class: 'seg' }, ...[['normal', '▶️ Normal'], ['boomerang', '🔁 Bumerangue'], ['reverse', '◀️ Reverso']].map(([id, label]) => el('button', { class: st.effect === id ? 'active' : '', onclick: () => { st.effect = id; renderControls(); play(); } }, label))));
    controls.append(el('h4', {}, '🎨 Filtro'));
    controls.append(el('div', { class: 'seg wrap' }, ...[['none', 'Nenhum'], ['vivid', 'Vívido'], ['bw', 'P&B'], ['sepia', 'Sépia'], ['vintage', 'Vintage'], ['dream', 'Sonho']].map(([id, label]) => el('button', { class: st.filter === id ? 'active' : '', onclick: () => { st.filter = id; renderControls(); } }, label))));
    controls.append(el('h4', {}, '🔤 Legenda'));
    const top = el('input', { class: 'input', placeholder: 'Texto em cima', value: st.top, oninput: (e) => (st.top = e.target.value) });
    const bottom = el('input', { class: 'input', placeholder: 'Texto embaixo', value: st.bottom, oninput: (e) => (st.bottom = e.target.value) });
    controls.append(top, bottom);
    controls.append(field('Fonte', el('select', { class: 'input', onchange: (e) => (st.font = e.target.value) }, FONTS.map(([f, n2]) => el('option', { value: f, selected: st.font === f }, n2)))));
    controls.append(colorRow(st.color, (c) => (st.color = c)));
    controls.append(slider('Tamanho do texto', 16, 64, 1, st.size, (v) => v, (v) => (st.size = v)));
    controls.append(
      el('div', { class: 'prop-actions' },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { st.frames = []; renderStage(); renderControls(); } }, '↺ Gravar de novo')
      )
    );
  }

  const name = el('input', { class: 'input', placeholder: 'Nome (opcional)', maxlength: 40 });
  const save = el('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      const seq = sequence();
      if (!seq.length) return toast('Grave ou escolha algo primeiro 🙂', 'error');
      save.disabled = true;
      progress.classList.remove('hidden');
      const bar = progress.firstChild;
      try {
        const { GIFEncoder, quantize, applyPalette } = await import('/vendor/gifenc.js');
        const w = seq[0].width, h = seq[0].height;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true });
        const gif = GIFEncoder();
        const delay = Math.max(20, Math.round(1000 / (st.fps * st.speed)));
        for (let i = 0; i < seq.length; i++) {
          renderFrame(x, seq[i]);
          const { data } = x.getImageData(0, 0, w, h);
          const palette = quantize(data, 256);
          const index = applyPalette(data, palette);
          gif.writeFrame(index, w, h, { palette, delay, repeat: 0 });
          bar.style.width = ((i + 1) / seq.length) * 100 + '%';
          save.textContent = `Gerando GIF… ${Math.round(((i + 1) / seq.length) * 100)}%`;
          if (i % 2) await new Promise((r) => setTimeout(r));
        }
        gif.finish();
        const blob = new Blob([gif.bytes()], { type: 'image/gif' });
        save.textContent = 'Enviando…';
        const up = await api.upload(new File([blob], 'kenfeh.gif', { type: 'image/gif' }), 'gif', name.value);
        toast(`GIF criado! (${(blob.size / 1024 / 1024).toFixed(1)} MB) 🎉`, 'success');
        done(up.sticker);
      } catch (err) {
        console.error(err);
        toast('Erro ao gerar o GIF: ' + err.message, 'error');
        save.disabled = false;
        save.textContent = 'Salvar e enviar';
      } finally {
        progress.classList.add('hidden');
      }
    },
  }, 'Salvar e enviar');

  renderSources();
  renderStage();
  renderControls();
  FONTS.forEach(([f]) => document.fonts?.load(`64px "${f}"`));

  const node = el('div', { class: 'studio-gif' },
    el('div', { class: 'studio-left' }, sourceBar, stage),
    el('div', { class: 'studio-right' }, controls, el('div', { class: 'studio-save' }, name, save))
  );
  return {
    node,
    cleanup: () => {
      clearTimeout(playTimer);
      stopStream();
      if (videoFile) URL.revokeObjectURL(live.src);
    },
  };
}
