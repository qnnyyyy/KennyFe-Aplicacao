// Cartão de perfil (aparece ao clicar em alguém) e prévia na edição do perfil.
import { applyBanner, THEME_BY_ID } from './cosmetics.js';
import { el, icon, avatar, contextMenu, closeMenu, timeAgo, toast } from './ui.js';
import { gameEmoji } from './gamesdata.js';

export function activityLine(user, online = true) {
  if (!user?.activity || !online) return null;
  return `${gameEmoji(user.activity.name)} Jogando ${user.activity.name}`;
}

// fontes dos temas (só baixa quando alguém com tema aparece)
let themeFonts = false;
function loadThemeFonts() {
  if (themeFonts) return;
  themeFonts = true;
  document.head.append(el('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Alegreya+Sans:wght@400;500;700&family=Press+Start+2P&family=Shippori+Mincho:wght@700;800&family=Orbitron:wght@700;900&family=Creepster&family=Audiowide&family=Uncial+Antiqua&family=Pirata+One&family=Fredoka:wght@500;700&family=UnifrakturMaguntia&family=Cinzel+Decorative:wght@700;900&family=Russo+One&family=Kaushan+Script&display=swap' }));
}

export function profileCard(app, user, { preview = false } = {}) {
  const online = preview || user.id === app.me?.id || app.online?.has(user.id);
  const banner = el('div', { class: 'pc-banner' });
  applyBanner(banner, user);
  const act = user.activity && online;
  const theme = user.theme && user.theme !== 'none' ? THEME_BY_ID[user.theme] : null;
  if (theme) loadThemeFonts();
  const name = theme
    ? el('div', { class: 'pt-nameplate' }, el('i', { class: 'pt-gem' }), el('span', { 'data-pf': 'name' }, user.displayName))
    : el('div', { class: 'pc-name', style: { color: user.color }, 'data-pf': 'name' }, user.displayName);
  return el('div', { class: `profile-card ${theme ? 'pt pt-' + theme.id : ''}` },
    banner,
    user.effect && user.effect !== 'none' ? el('img', { class: 'pc-fx', src: `/img/fx/${user.effect}.svg`, alt: '' }) : null,
    el('div', { class: 'pc-head' },
      el('div', { class: 'pc-av' }, avatar(user, 88), el('span', { class: `pc-presence ${online ? 'on' : ''}` })),
      theme?.badges ? el('div', { class: 'pt-badges' }, theme.badges.map(([b, label]) => el('img', { src: `/img/badge/${theme.id}-${b}.svg`, alt: label, title: label }))) : null,
    ),
    el('div', { class: 'pc-body' },
      name,
      theme?.owner ? el('div', { class: 'pt-owner' }, '👑 Dono do Kenfeh · Exclusivo') : null,
      el('div', { class: 'pc-user' }, '@' + (user.username || 'voce')),
      user.statusText ? el('div', { class: 'pc-status', 'data-pf': 'status' }, user.statusText) : null,
      act
        ? el('div', { class: 'pc-activity' },
            el('div', { class: 'pc-act-ic' }, gameEmoji(user.activity.name)),
            el('div', {}, el('small', {}, 'JOGANDO AGORA'), el('b', {}, user.activity.name), el('small', { class: 'muted' }, timeAgo(user.activity.since))))
        : null,
      user.bio ? el('div', { class: 'pc-section' }, el('h5', {}, 'Sobre mim'), el('p', { 'data-pf': 'bio' }, user.bio)) : null,
      theme?.id === 'tricolor'
        ? el('div', { class: 'pc-section' }, el('h5', {}, 'Títulos'), el('ol', { class: 'pt-timeline' },
            [['1930', 'Fundação'], ['92 · 93 · 05', 'Tri Mundial'], ['06 · 07 · 08', 'Tri Brasileiro seguido'], ['2023', 'Copa do Brasil']].map(([y, t]) => el('li', {}, el('b', {}, y), el('span', {}, t)))))
        : null,
      user.favoriteGames?.length
        ? el('div', { class: 'pc-section' }, el('h5', {}, 'Jogos favoritos'), el('div', { class: 'chips' }, user.favoriteGames.map((g) => el('span', { class: 'chip game-chip' }, `${gameEmoji(g)} ${g}`))))
        : null
    )
  );
}

export function openProfile(app, user, x, y) {
  const fresh = app.user(user.id) || user;
  const card = profileCard(app, fresh);
  const actions = el('div', { class: 'pc-actions' });
  if (fresh.id === app.me.id) {
    actions.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => { closeMenu(); app.openSettings('account'); } }, icon('edit', 14), 'Editar perfil'));
  } else {
    actions.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { navigator.clipboard.writeText(fresh.username); toast('@ copiado!'); } }, icon('copy', 14), 'Copiar @'));
  }
  card.querySelector('.pc-body').append(actions);
  const items = [{ type: 'custom', node: card }];
  if (app.call?.active && fresh.id !== app.me.id) {
    const peer = [...app.call.remotes.entries()].find(([, r]) => r.userId === fresh.id);
    if (peer) items.push({ type: 'sep' }, ...app.call.userMenuItems(fresh.id, peer[0]));
  }
  contextMenu(x, y, items, 'profile-pop');
}
