// Recorte de imagem antes de enviar: círculo para a foto de perfil, faixa comprida para o fundo.
// Arraste para posicionar, zoom pela barra, rodinha do mouse ou pinça (dois dedos no celular).
import { el, modal, toast } from './ui.js';

const SHAPES = {
  avatar: { w: 300, h: 300, out: [512, 512], round: true, title: '📷 Ajustar foto de perfil' },
  banner: { w: 520, h: 150, out: [1200, 346], round: false, title: '🖼️ Ajustar fundo do perfil' },
};

export function cropImage(file, kind = 'avatar') {
  const S = SHAPES[kind];
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('Não consegui abrir essa imagem.', 'error');
      resolve(null);
    };
    img.onload = () => {
      const view = Math.min(S.w, window.innerWidth - 80);
      const scaleView = view / S.w;
      const vw = Math.round(S.w * scaleView), vh = Math.round(S.h * scaleView);
      const pad = 26; // borda escurecida em volta da área
      const cw = vw + pad * 2, ch = vh + pad * 2;
      const canvas = el('canvas', { class: 'crop-canvas', width: cw * devicePixelRatio, height: ch * devicePixelRatio, style: { width: cw + 'px', height: ch + 'px' } });
      const ctx = canvas.getContext('2d');
      // "cover": a imagem sempre cobre a área inteira (maior ou menor, ela se ajusta)
      const minZoom = Math.max(vw / img.width, vh / img.height);
      let zoom = minZoom;
      let cx = img.width / 2, cy = img.height / 2; // ponto da imagem no centro da área
      const clamp = () => {
        const hw = vw / 2 / zoom, hh = vh / 2 / zoom;
        cx = Math.min(Math.max(cx, hw), img.width - hw);
        cy = Math.min(Math.max(cy, hh), img.height - hh);
      };
      const draw = () => {
        clamp();
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#05060c';
        ctx.fillRect(0, 0, cw, ch);
        ctx.imageSmoothingQuality = 'high';
        const dx = pad + vw / 2 - cx * zoom, dy = pad + vh / 2 - cy * zoom;
        ctx.drawImage(img, dx, dy, img.width * zoom, img.height * zoom);
        // escurece o que fica de fora
        ctx.save();
        ctx.fillStyle = 'rgba(5,6,12,.68)';
        ctx.beginPath();
        ctx.rect(0, 0, cw, ch);
        if (S.round) ctx.arc(pad + vw / 2, pad + vh / 2, vw / 2, 0, Math.PI * 2, true);
        else ctx.roundRect ? ctx.roundRect(pad + vw, pad, -vw, vh, 10) : ctx.rect(pad + vw, pad, -vw, vh);
        ctx.fill('evenodd');
        ctx.restore();
        ctx.strokeStyle = '#ff3d9a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (S.round) ctx.arc(pad + vw / 2, pad + vh / 2, vw / 2, 0, Math.PI * 2);
        else if (ctx.roundRect) ctx.roundRect(pad, pad, vw, vh, 10);
        else ctx.rect(pad, pad, vw, vh);
        ctx.stroke();
      };
      const range = el('input', { type: 'range', min: 0, max: 100, step: 0.1, value: 0, class: 'crop-zoom' });
      const zoomTo = (z, fx = pad + vw / 2, fy = pad + vh / 2) => {
        const nz = Math.min(Math.max(z, minZoom), minZoom * 6);
        // mantém fixo o ponto debaixo do dedo/mouse
        const ix = cx + (fx - pad - vw / 2) / zoom, iy = cy + (fy - pad - vh / 2) / zoom;
        zoom = nz;
        cx = ix - (fx - pad - vw / 2) / zoom;
        cy = iy - (fy - pad - vh / 2) / zoom;
        range.value = ((Math.log(zoom / minZoom) / Math.log(6)) * 100).toFixed(1);
        draw();
      };
      range.addEventListener('input', () => zoomTo(minZoom * Math.pow(6, range.value / 100)));
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      // arrastar e pinça
      const pts = new Map();
      let pinch = null;
      canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: zoom };
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        const prev = pts.get(e.pointerId);
        if (!prev) return;
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2 && pinch) {
          const [a, b] = [...pts.values()];
          const r = canvas.getBoundingClientRect();
          zoomTo(pinch.z * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d), (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
        } else if (pts.size === 1) {
          cx -= (e.clientX - prev[0]) / zoom;
          cy -= (e.clientY - prev[1]) / zoom;
          draw();
        }
      });
      const up = (e) => {
        pts.delete(e.pointerId);
        if (pts.size < 2) pinch = null;
      };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      draw();

      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        resolve(v);
      };
      const exportCrop = () =>
        new Promise((res) => {
          const [ow, oh] = S.out;
          const out = el('canvas', { width: ow, height: oh });
          const o = out.getContext('2d');
          o.imageSmoothingQuality = 'high';
          const sw = vw / zoom, sh = vh / zoom;
          o.drawImage(img, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, ow, oh);
          out.toBlob((b) => res(b && new File([b], `${kind}.webp`, { type: 'image/webp' })), 'image/webp', 0.92);
        });
      const isGif = file.type === 'image/gif';
      modal({
        title: S.title,
        className: 'crop-modal',
        content: el('div', { class: 'crop' },
          el('p', { class: 'muted small' }, S.round ? 'Arraste para escolher o que aparece no círculo. Use a barra (ou a rodinha / dois dedos) para dar zoom.' : 'Arraste para escolher a parte que aparece no fundo do perfil. Use a barra (ou a rodinha / dois dedos) para dar zoom.'),
          el('div', { class: 'crop-stage' }, canvas),
          el('div', { class: 'crop-zoom-row' }, el('span', {}, '−'), range, el('span', {}, '+')),
          isGif ? el('p', { class: 'muted small' }, '🎞️ É um GIF: recortar deixa a imagem parada. Para manter animado, use "Enviar sem recortar".') : null),
        actions: [
          { label: 'Cancelar', onClick: (c) => { finish(null); c(); } },
          ...(isGif ? [{ label: 'Enviar sem recortar', onClick: (c) => { finish(file); c(); } }] : []),
          { label: 'Usar imagem', primary: true, onClick: async (c) => { const f = await exportCrop(); finish(f); c(); } },
        ],
        onClose: () => finish(null),
      });
    };
    img.src = url;
  });
}
