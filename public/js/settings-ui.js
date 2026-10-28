// Tela de configurações: conta, voz e vídeo, transmissão.
import { el, icon, modal, toast, avatar, FRAMES, IS_MOBILE } from './ui.js';
import { POPULAR_GAMES, gameEmoji } from './gamesdata.js';
import { profileCard } from './profile.js';
import { api } from './api.js';
import { settings, updateSettings, CAMERA_PRESETS, SCREEN_RESOLUTIONS } from './call/settings.js';
import { listDevices, cleanLabel } from './call/media.js';
import { keyLabel } from './call/sounds.js';
import { AVATARS, BANNERS, COS_CATS } from './cosmetics.js';

const PROFILE_COLORS = ['#ff4fa3', '#f72585', '#ff6b6b', '#ffb84c', '#5ce1a0', '#38d6ff', '#3d8bff', '#7b5cff'];
const BANNER_COLORS = ['#2f7bff', '#7b5cff', '#ff4fa3', '#0f172a', '#14b8a6', '#f97316', '#e11d48', '#22c55e'];

export function openSettings(app, tab = 'account') {
  const nav = el('nav', { class: 'settings-nav' });
  const pane = el('div', { class: 'settings-pane' });
  let cleanup = () => {};
  const tabs = [
    ['account', 'users', 'Meu perfil'],
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
  const draft = {
    color: me.color,
    avatarUrl: me.avatarUrl,
    bannerColor: me.bannerColor || '#2f7bff',
    bannerUrl: me.bannerUrl,
    frame: me.frame || 'none',
    favoriteGames: [...(me.favoriteGames || [])],
    showActivity: me.showActivity !== false,
  };
  const preview = el('div', { class: 'profile-preview-wrap' });
  const name = el('input', { class: 'input', value: me.displayName, maxlength: 32 });
  const status = el('input', { class: 'input', value: me.statusText || '', maxlength: 80, placeholder: 'Ex.: bora de ranked? 🎮' });
  const email = el('input', { class: 'input', type: 'email', value: me.email || '', maxlength: 120, placeholder: 'voce@email.com', autocomplete: 'email' });
  const bio = el('textarea', { class: 'input', rows: 3, maxlength: 300, placeholder: 'Conta um pouco sobre você, seu main, seu horário de jogo…' }, me.bio || '');
  const current = () => ({ ...me, ...draft, displayName: name.value || me.username, statusText: status.value, bio: bio.value });
  const renderPreview = () => preview.replaceChildren(profileCard(app, current(), { preview: true }));
  [name, status, bio].forEach((i) => i.addEventListener('input', renderPreview));

  const upload = (purpose, onDone) => {
    const input = el('input', { type: 'file', accept: 'image/*' });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        onDone((await api.upload(f, purpose)).url);
        renderPreview();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    input.click();
  };

  const swatches = (list, key) => {
    const row = el('div', { class: 'color-row' });
    const paint = () => row.replaceChildren(
      ...list.map((c) => el('button', { class: `swatch ${c === draft[key] ? 'active' : ''}`, style: { background: c }, onclick: () => { draft[key] = c; paint(); renderPreview(); } })),
      el('input', { type: 'color', value: draft[key], oninput: (e) => { draft[key] = e.target.value; renderPreview(); } })
    );
    paint();
    return row;
  };

  // Galerias com filtro por tema (anime, jogos, geek…)
  const gallery = (items, render, cats = COS_CATS.filter((c) => c[0] !== 'basico' || items.some((x) => x.cat === 'basico'))) => {
    let cat = 'all';
    const tabs = el('div', { class: 'cos-tabs' });
    const grid = el('div', { class: 'cos-grid' });
    const paint = () => {
      tabs.replaceChildren(...cats.filter(([id]) => id === 'all' || items.some((x) => x.cat === id)).map(([id, label]) => el('button', { class: cat === id ? 'active' : '', onclick: () => { cat = id; paint(); } }, label)));
      grid.replaceChildren(...items.filter((x) => cat === 'all' || x.cat === cat).map(render));
    };
    paint();
    return { node: el('div', {}, tabs, grid), grid, paint };
  };
  // Molduras
  const frameItems = FRAMES.map(([id, name, cat]) => ({ id, name, cat: cat || 'basico' }));
  const framesG = gallery(frameItems, (f) => el('button', { class: `cos-opt ${draft.frame === f.id ? 'active' : ''}`, title: f.name, onclick: () => { draft.frame = f.id; framesG.paint(); renderPreview(); } },
    avatar({ ...current(), frame: f.id }, 50), el('small', {}, f.name)));
  const frames = framesG.node;
  const paintFrames = () => framesG.paint();
  // Avatares prontos
  const avatarsG = gallery(AVATARS, (a) => el('button', { class: `cos-opt ${draft.avatarUrl === a.url ? 'active' : ''}`, title: a.name, onclick: () => { draft.avatarUrl = a.url; avatarsG.paint(); paintFrames(); renderPreview(); } },
    el('img', { src: a.url, alt: '', loading: 'lazy' }), el('small', {}, a.name)));
  // Fundos animados
  const bannersG = gallery(BANNERS, (b) => el('button', { class: `cos-opt ${draft.bannerUrl === 'theme:' + b.id ? 'active' : ''}`, title: b.name, onclick: () => { draft.bannerUrl = 'theme:' + b.id; bannersG.paint(); renderPreview(); } },
    el('div', { class: `bnr-prev bnr bnr-${b.id}` }), el('small', {}, b.name)));
  bannersG.grid.classList.add('wide');

  // Jogos favoritos
  const chips = el('div', { class: 'chips' });
  const gameInput = el('input', { class: 'input', placeholder: 'Digite um jogo e aperte Enter', list: 'kf-games-list', maxlength: 40 });
  const datalist = el('datalist', { id: 'kf-games-list' }, POPULAR_GAMES.map((g) => el('option', { value: g })));
  const paintChips = () => chips.replaceChildren(
    ...draft.favoriteGames.map((g) => el('span', { class: 'chip game-chip' }, `${gameEmoji(g)} ${g}`, el('button', { title: 'Remover', onclick: () => { draft.favoriteGames = draft.favoriteGames.filter((x) => x !== g); paintChips(); renderPreview(); } }, '×'))),
    ...(draft.favoriteGames.length ? [] : [el('span', { class: 'muted small' }, 'Nenhum ainda.')])
  );
  const addGame = () => {
    const g = gameInput.value.trim();
    if (!g || draft.favoriteGames.includes(g) || draft.favoriteGames.length >= 12) return;
    draft.favoriteGames.push(g);
    gameInput.value = '';
    paintChips();
    renderPreview();
  };
  gameInput.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), addGame()));
  gameInput.addEventListener('change', () => POPULAR_GAMES.includes(gameInput.value) && addGame());
  paintChips();

  // Jogando agora (manual)
  const playing = el('input', { class: 'input', placeholder: 'Ex.: Valorant', list: 'kf-games-list', value: me.activity?.source === 'manual' ? me.activity.name : '' });
  const setPlaying = async (nameVal) => {
    try {
      await api.post('/me/activity', { name: nameVal, source: 'manual' });
      toast(nameVal ? `Status: jogando ${nameVal} 🎮` : 'Status de jogo removido.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const curPass = el('input', { class: 'input', type: 'password', placeholder: 'Senha atual', autocomplete: 'current-password' });
  const newPass = el('input', { class: 'input', type: 'password', placeholder: 'Nova senha (mín. 6)', autocomplete: 'new-password' });

  const saveBtn = el('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      try {
        const body = { displayName: name.value, statusText: status.value, bio: bio.value, ...(email.value.trim() || me.email ? { email: email.value } : {}), ...draft, avatarUrl: draft.avatarUrl || null, bannerUrl: draft.bannerUrl || null };
        if (newPass.value) Object.assign(body, { currentPassword: curPass.value, newPassword: newPass.value });
        const { user } = await api.patch('/me', body);
        app.setMe(user);
        curPass.value = newPass.value = '';
        toast('Perfil salvo!', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  }, 'Salvar perfil');

  renderPreview();
  return {
    node: el('div', { class: 'account-pane' },
      el('h3', {}, 'Meu perfil'),
      el('div', { class: 'account-grid' },
        el('div', { class: 'account-form' },
          el('div', { class: 'row-actions' },
            el('button', { class: 'btn btn-ghost btn-sm', onclick: () => upload('avatar', (u) => (draft.avatarUrl = u)) }, '📷 Trocar foto'),
            el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { draft.avatarUrl = null; avatarsG.paint(); paintFrames(); renderPreview(); } }, 'Remover foto'),
            el('button', { class: 'btn btn-ghost btn-sm', onclick: () => upload('avatar', (u) => (draft.bannerUrl = u)) }, '🖼️ Imagem do banner'),
            el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { draft.bannerUrl = null; bannersG.paint(); renderPreview(); } }, 'Tirar banner')
          ),
          el('label', { class: 'field' }, el('span', {}, 'Nome de exibição'), name),
          el('label', { class: 'field' }, el('span', {}, 'Recado'), status),
          el('label', { class: 'field' }, el('span', {}, 'E-mail (só você vê)'), email),
          el('label', { class: 'field' }, el('span', {}, 'Sobre mim'), bio),
          el('div', { class: 'grid-2' },
            el('div', { class: 'field' }, el('span', {}, 'Cor do nome/avatar'), swatches(PROFILE_COLORS, 'color')),
            el('div', { class: 'field' }, el('span', {}, 'Cor do banner'), swatches(BANNER_COLORS, 'bannerColor'))
          ),
          el('div', { class: 'field' }, el('span', {}, '🧑‍🎤 Avatares prontos (ou envie sua foto em "Trocar foto")'), avatarsG.node),
          el('div', { class: 'field' }, el('span', {}, '🌌 Fundo do perfil animado (ou envie uma imagem em "Imagem do banner")'), bannersG.node),
          el('div', { class: 'field' }, el('span', {}, '💫 Moldura em volta da foto'), frames),
          el('div', { class: 'field' }, el('span', {}, 'Jogos favoritos (até 12)'), gameInput, datalist, chips),
          el('h4', {}, '🎮 Jogando agora'),
          sw('Mostrar o que estou jogando', 'Aparece no seu perfil e na lista de membros. O agente do PC detecta sozinho (veja "Jogo Coop"), ou você escreve abaixo.', draft.showActivity, (v) => { draft.showActivity = v; renderPreview(); }),
          el('div', { class: 'inline-form' }, playing,
            el('button', { class: 'btn btn-ghost btn-sm', onclick: () => setPlaying(playing.value.trim()) }, 'Definir'),
            el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { playing.value = ''; setPlaying(''); } }, 'Limpar')),
          el('h4', {}, 'Trocar senha'),
          el('div', { class: 'grid-2' }, curPass, newPass)
        ),
        el('div', { class: 'account-side' }, el('span', { class: 'muted small' }, 'Prévia'), preview)
      ),
      el('div', { class: 'row-actions end sticky-save' }, saveBtn)
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
      sw('Modo anti-eco na saída', 'Toca as vozes pelo caminho normal do navegador, para o cancelamento de eco funcionar mesmo sem fone (já vem ligado no celular). Com ele, o volume por pessoa vai até 100%. Vale na próxima call.', st.antiEcho ?? IS_MOBILE, (v) => update({ antiEcho: v })),
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
      el('h4', {}, 'Push-to-talk (apertar para falar)'),
      sw('Ativar push-to-talk', 'O microfone só transmite enquanto você segura a tecla. Funciona com a janela do site em foco (limite do navegador).', st.pttEnabled, (v) => update({ pttEnabled: v })),
      pttPicker(),
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

function pttPicker() {
  const btn = el('button', { class: 'btn btn-ghost btn-sm' });
  const paint = () => (btn.textContent = `Tecla: ${keyLabel(settings().pttKey)} — clique para trocar`);
  paint();
  btn.addEventListener('click', () => {
    btn.textContent = 'Aperte uma tecla ou botão lateral do mouse…';
    const done = (code) => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPtr, true);
      if (code) updateSettings({ pttKey: code });
      paint();
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      done(e.code === 'Escape' ? null : e.code);
    };
    const onPtr = (e) => {
      if (e.button > 2) {
        e.preventDefault();
        done(`Mouse${e.button}`);
      }
    };
    setTimeout(() => {
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('pointerdown', onPtr, true);
    }, 50);
  });
  return el('div', { class: 'row-actions' }, btn);
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
      row('Tecla do push-to-talk', 'Falar enquanto segura (configure em Voz e vídeo)'),
      row('Ctrl + Shift + X', 'Modo Coop: cortar o controle de todos os convidados'),
      row('Ctrl + Shift + Q', 'Modo Coop: parar de jogar no PC do amigo'),
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
