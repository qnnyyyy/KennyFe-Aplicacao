// Cartão de perfil (aparece ao clicar em alguém) e prévia na edição do perfil.
import { applyBanner } from './cosmetics.js';
import { el, icon, avatar, contextMenu, closeMenu, timeAgo, toast } from './ui.js';
import { gameEmoji } from './gamesdata.js';

export function activityLine(user, online = true) {
  if (!user?.activity || !online) return null;
  return `${gameEmoji(user.activity.name)} Jogando ${user.activity.name}`;
}

export function profileCard(app, user, { preview = false } = {}) {
  const online = preview || user.id === app.me?.id || app.online?.has(user.id);
  const banner = el('div', { class: 'pc-banner' });
  applyBanner(banner, user);
  const act = user.activity && online;
  return el('div', { class: 'profile-card' },
    banner,
    el('div', { class: 'pc-head' },
      el('div', { class: 'pc-av' }, avatar(user, 88), el('span', { class: `pc-presence ${online ? 'on' : ''}` })),
    ),
    el('div', { class: 'pc-body' },
      el('div', { class: 'pc-name', style: { color: user.color } }, user.displayName),
      el('div', { class: 'pc-user' }, '@' + (user.username || 'voce')),
      user.statusText ? el('div', { class: 'pc-status' }, user.statusText) : null,
      act
        ? el('div', { class: 'pc-activity' },
            el('div', { class: 'pc-act-ic' }, gameEmoji(user.activity.name)),
            el('div', {}, el('small', {}, 'JOGANDO AGORA'), el('b', {}, user.activity.name), el('small', { class: 'muted' }, timeAgo(user.activity.since))))
        : null,
      user.bio ? el('div', { class: 'pc-section' }, el('h5', {}, 'Sobre mim'), el('p', {}, user.bio)) : null,
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
