// Tela de configurações: conta, voz e vídeo, transmissão.
import { el, icon, modal, toast, avatar } from './ui.js';
import { api } from './api.js';
import { settings, updateSettings, CAMERA_PRESETS, SCREEN_RESOLUTIONS } from './call/settings.js';
import { listDevices, cleanLabel } from './call/media.js';

const PROFILE_COLORS = ['#ff5fa2', '#f72585', '#ff6b6b', '#ffb84c', '#5ce1a0', '#4cc9f0', '#7c8cff', '#a66bff'];

export function openSettings(app, tab = 'account') {
  const nav = el('nav', { class: 'settings-nav' });
  const pane = el('div', { class: 'settings-pane' });
  let cleanup = () => {};
  const tabs = [
    ['account', 'users', 'Minha conta'],
    ['voice', 'mic', 'Voz e vídeo'],
    ['stream', 'monitor', 'Transmissão'],
    ['keys', 'type', 'Atalhos'],
  ];
  const show = (id) => {
    cleanup();
    cleanup = () => {};
    nav.replaceChildren(
      ...tabs.map(([t, ic, label]) => el('button', { class: t === id ? 'active' : '', onclick: () => show(t) }, icon(ic, 16), label)),
      el('div', { class: 'settings-nav-sep' }),
      el('button', { class: 'danger', onclick: () => app.logout() }, icon('log-out', 16), 'Sair da conta')
    );
    const r = { account: accountPane, voice: voicePane, stream: streamPane, keys: keysPane }[id](app);
    pane.replaceChildren(r.node);
    if (r.cleanup) cleanup = r.cleanup;
  };
  show(tab);
  modal({ title: 'Configurações', content: el('div', { class: 'settings' }, nav, pane), wide: true, className: 'settings-modal', onClose: () => cleanup() });
}

function sw(label, desc, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
  return el('label', { class: 'switch-row' }, input, el('span', { class: 'switch' }), el('div', {}, el('b', {}, label), desc ? el('small', {}, desc) : null));
}

function select(label, options, value, onChange) {
  return el('label', { class: 'field' }, el('span', {}, label), el('select', { class: 'input', onchange: (e) => onChange(e.target.value) }, options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(value) }, l))));
}

function accountPane(app) {
  const me = app.me;
  let color = me.color;
  let avatarUrl = me.avatarUrl;
  const preview = el('div', { class: 'profile-preview' });
  const name = el('input', { class: 'input', value: me.displayName, maxlength: 32 });
  const status = el('input', { class: 'input', value: me.statusText || '', maxlength: 80, placeholder: 'Ex.: jogando Valorant 🎮' });
  const renderPreview = () => preview.replaceChildren(avatar({ ...me, color, avatarUrl, displayName: name.value }, 84), el('div', {}, el('b', {}, name.value || me.username), el('small', {}, '@' + me.username), el('small', { class: 'muted' }, status.value)));
  name.addEventListener('input', renderPreview);
  status.addEventListener('input', renderPreview);
  renderPreview();
  const colors = el('div', { class: 'color-row' }, PROFILE_COLORS.map((c) => el('button', { class: `swatch ${c === color ? 'active' : ''}`, style: { background: c }, onclick: (e) => { color = c; colors.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active')); e.currentTarget.classList.add('active'); renderPreview(); } })));
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const up = await api.upload(f, 'avatar');
      avatarUrl = up.url;
      renderPreview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const curPass = el('input', { class: 'input', type: 'password', placeholder: 'Senha atual', autocomplete: 'current-password' });
  const newPass = el('input', { class: 'input', type: 'password', placeholder: 'Nova senha (mín. 6)', autocomplete: 'new-password' });

  const saveBtn = el('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      try {
        const body = { displayName: name.value, color, statusText: status.value, avatarUrl: avatarUrl || null };
        if (newPass.value) Object.assign(body, { currentPassword: curPass.value, newPassword: newPass.value });
        const { user } = await api.patch('/me', body);
        app.setMe(user);
        curPass.value = newPass.value = '';
        toast('Perfil salvo!', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  }, 'Salvar alterações');

  return {
    node: el('div', {},
      el('h3', {}, 'Minha conta'),
      preview,
      el('div', { class: 'row-actions' },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => fileInput.click() }, 'Trocar foto'),
        avatarUrl ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { avatarUrl = null; renderPreview(); } }, 'Remover foto') : null,
        fileInput
      ),
      el('label', { class: 'field' }, el('span', {}, 'Nome de exibição'), name),
      el('label', { class: 'field' }, el('span', {}, 'Recado'), status),
      el('div', { class: 'field' }, el('span', {}, 'Cor do perfil'), colors),
      el('h4', {}, 'Trocar senha'),
      el('div', { class: 'grid-2' }, curPass, newPass),
      el('div', { class: 'row-actions end' }, saveBtn)
    ),
  };
}

function voicePane(app) {
  const st = settings();
  const node = el('div', {}, el('h3', {}, 'Voz e vídeo'), el('p', { class: 'muted' }, 'Carregando dispositivos…'));
  let testStream = null;
  let camStream = null;
  let raf = null;
  let actx = null;

  (async () => {
    // pede permissão para os nomes dos dispositivos aparecerem
    try {
      testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {}
    const devs = await listDevices();
    const meter = el('div', { class: 'meter big' }, el('span'), el('i', { class: 'gate-mark' }));
    const gateLabel = el('span');

    const update = (patch) => updateSettings(patch);
    const micSel = select('Microfone', devs.audioinput.map((d) => [d.deviceId, cleanLabel(d.label, 'Microfone')]), st.micDeviceId, async (v) => {
      update({ micDeviceId: v });
      startMeter(v);
    });
    const outSel = select('Saída de áudio (onde você ouve a call)', devs.audiooutput.map((d) => [d.deviceId, cleanLabel(d.label, 'Saída')]), st.outputDeviceId, (v) => update({ outputDeviceId: v }));
    const vol = el('input', { type: 'range', min: 0, max: 200, value: Math.round(st.micVolume * 100) });
    const volOut = el('span', {}, Math.round(st.micVolume * 100) + '%');
    vol.addEventListener('input', () => { volOut.textContent = vol.value + '%'; update({ micVolume: vol.value / 100 }); });

    const gate = el('input', { type: 'range', min: -80, max: -10, value: settings().gateDb });
    gate.addEventListener('input', () => { update({ gateDb: Number(gate.value) }); gateLabel.textContent = gate.value + ' dB'; placeGate(); });
    gateLabel.textContent = settings().gateDb + ' dB';
    const placeGate = () => (meter.querySelector('.gate-mark').style.left = ((settings().gateDb + 80) / 70) * 100 + '%');
    placeGate();

    const camPreview = el('video', { class: 'cam-preview', autoplay: true, playsinline: true, muted: true });
    const camSel = select('Câmera', [['', 'Padrão do sistema'], ...devs.videoinput.map((d, i) => [d.deviceId, cleanLabel(d.label, `Câmera ${i + 1}`)])], st.camDeviceId, (v) => { update({ camDeviceId: v }); });
    const camQ = select('Qualidade da câmera', Object.entries(CAMERA_PRESETS).map(([k, p]) => [k, p.label]), st.camQuality, (v) => update({ camQuality: v }));
    const camBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
      if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; camPreview.srcObject = null; camBtn.textContent = 'Testar câmera'; return; }
      try {
        const { cameraConstraints } = await import('./call/settings.js');
        camStream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(settings().camDeviceId) });
        camPreview.srcObject = camStream;
        const s = camStream.getVideoTracks()[0].getSettings();
        camBtn.textContent = `Parar teste (${s.width}×${s.height} @ ${Math.round(s.frameRate)} fps)`;
      } catch (err) { toast(err.message, 'error'); }
    } }, 'Testar câmera');

    const startMeter = async (deviceId) => {
      cancelAnimationFrame(raf);
      testStream?.getTracks().forEach((t) => t.stop());
      try {
        const { micConstraints } = await import('./call/settings.js');
        testStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
      } catch { return; }
      actx?.close();
      actx = new AudioContext();
      const src = actx.createMediaStreamSource(testStream);
      const an = actx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(1024);
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9) + 20 * Math.log10(settings().micVolume || 1e-3);
        const p = Math.max(0, Math.min(1, (db + 80) / 70));
        meter.firstChild.style.width = p * 100 + '%';
        meter.classList.toggle('open', !settings().gateEnabled || db > settings().gateDb);
        raf = requestAnimationFrame(loop);
      };
      loop();
    };
    startMeter(settings().micDeviceId);

    node.replaceChildren(
      el('h3', {}, 'Voz e vídeo'),
      el('div', { class: 'grid-2' }, micSel, outSel),
      el('div', { class: 'field' }, el('span', {}, 'Teste do microfone (fale algo)'), meter),
      el('label', { class: 'prop' }, el('div', { class: 'prop-head' }, el('span', {}, 'Volume do microfone'), volOut), vol),
      el('h4', {}, 'Processamento de voz'),
      sw('Cancelamento de eco', 'Evita que o som da call volte pelo seu microfone.', st.echoCancellation, (v) => update({ echoCancellation: v })),
      sw('Supressão de ruído', 'Tira ventilador, teclado e barulhos de fundo.', st.noiseSuppression, (v) => update({ noiseSuppression: v })),
      sw('Ganho automático', 'Ajusta o volume da sua voz sozinho.', st.autoGainControl, (v) => update({ autoGainControl: v })),
      sw('Modo alta fidelidade (estúdio)', 'Desliga todo o processamento e envia áudio estéreo puro a 510 kbps. Ideal para música/instrumento. Use fone!', st.hifi, (v) => update({ hifi: v })),
      sw('Sensibilidade manual (noise gate)', 'Só transmite quando sua voz passar do limite (linha rosa no medidor).', st.gateEnabled, (v) => update({ gateEnabled: v })),
      el('label', { class: 'prop' }, el('div', { class: 'prop-head' }, el('span', {}, 'Limite'), gateLabel), gate),
      el('h4', {}, 'Câmera'),
      el('div', { class: 'grid-2' }, camSel, camQ),
      sw('Espelhar minha prévia', null, st.mirrorCam, (v) => update({ mirrorCam: v })),
      camPreview,
      camBtn,
      el('h4', {}, 'Sons'),
      sw('Sons de entrar/sair da call', null, st.joinSounds, (v) => update({ joinSounds: v }))
    );
  })();

  return {
    node,
    cleanup: () => {
      cancelAnimationFrame(raf);
      testStream?.getTracks().forEach((t) => t.stop());
      camStream?.getTracks().forEach((t) => t.stop());
      actx?.close();
    },
  };
}

function streamPane() {
  const st = settings();
  const u = (p) => updateSettings(p);
  return {
    node: el('div', {},
      el('h3', {}, 'Transmissão de tela'),
      el('p', { class: 'muted' }, 'Padrões usados ao compartilhar. Dá pra mudar em cada transmissão também.'),
      el('div', { class: 'grid-2' },
        select('Resolução padrão', Object.entries(SCREEN_RESOLUTIONS).map(([k, r]) => [k, r.label]), st.screenRes, (v) => u({ screenRes: v })),
        select('FPS padrão', [[15, '15 fps'], [30, '30 fps'], [60, '60 fps'], [120, '120 fps']], st.screenFps, (v) => u({ screenFps: Number(v) }))
      ),
      el('div', { class: 'grid-2' },
        select('Bitrate máximo', [[8000, '8 Mbps (internet fraca)'], [15000, '15 Mbps'], [25000, '25 Mbps (ótimo p/ 4K)'], [50000, '50 Mbps (máximo, rede local)']], st.maxBitrateKbps, (v) => u({ maxBitrateKbps: Number(v) })),
        select('Codec de vídeo preferido', [['VP9', 'VP9 (recomendado: nítido e leve na rede)'], ['AV1', 'AV1 (melhor compressão, exige PC forte)'], ['H264', 'H.264 (usa a placa de vídeo, menos CPU)'], ['VP8', 'VP8 (compatibilidade)']], st.codec, (v) => u({ codec: v }))
      ),
      sw('Compartilhar áudio por padrão', null, st.screenAudio, (v) => u({ screenAudio: v })),
      sw('Anti-eco por padrão', 'Não captura o som desta página (a voz da call) quando você compartilha o áudio do sistema/aba.', st.restrictOwnAudio, (v) => u({ restrictOwnAudio: v })),
      sw('Mostrar minha própria prévia', 'Ver o que você está transmitindo e sua câmera no palco.', st.showSelfPreview, (v) => u({ showSelfPreview: v })),
      sw('Mostrar quem está sem vídeo', 'Mostra a foto de quem não está com câmera ligada.', st.showNonVideo, (v) => u({ showNonVideo: v })),
      el('div', { class: 'callout' },
        el('b', {}, '🌐 Pra conectar de fora de casa'),
        el('p', {}, 'Na mesma rede funciona direto. Pela internet, a maioria das conexões funciona com STUN; se não conectar, configure um servidor TURN no servidor (variáveis TURN_URL, TURN_USERNAME, TURN_PASSWORD — veja o README).')
      )
    ),
  };
}

function keysPane() {
  const row = (k, d) => el('div', { class: 'key-row' }, el('kbd', {}, k), el('span', {}, d));
  return {
    node: el('div', {},
      el('h3', {}, 'Atalhos'),
      row('Ctrl + Shift + M', 'Mutar / desmutar'),
      row('Ctrl + Shift + D', 'Ensurdecer'),
      row('F', 'Tela cheia da call (fora da caixa de texto)'),
      row('Esc', 'Sair da tela cheia / fechar janelas'),
      row('Duplo clique num bloco', 'Tela cheia só daquele bloco'),
      row('Botão direito num bloco', 'Volume, flutuar, focar, 50/50, janela separada…'),
      row('Segurar o dedo (celular)', 'Mesmo menu do botão direito'),
      row('Arrastar divisória', 'Redimensionar blocos (duplo clique = 50/50)'),
      row('Arrastar o nome do bloco', 'Trocar blocos de lugar'),
      row('Enter / Shift + Enter', 'Enviar / quebrar linha'),
      row('↑ (caixa vazia)', 'Editar sua última mensagem')
    ),
  };
}
