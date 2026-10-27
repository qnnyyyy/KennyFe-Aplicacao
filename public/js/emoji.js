// Seletor de emojis (dados embutidos, sem depender de CDN)
import { el, store, save } from './ui.js';

const CATEGORIES = [
  ['😀', 'Carinhas', '😀 😃 😄 😁 😆 🥹 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😮‍💨 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🫣 🤗 🫡 🤔 🫢 🤭 🤫 🤥 😶 😶‍🌫️ 😐 😑 😬 🫨 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 😵‍💫 🫥 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾'],
  ['❤️', 'Amor', '❤️ 🩷 🧡 💛 💚 💙 🩵 💜 🖤 🩶 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💌 💋 💏 💑 👩‍❤️‍👨 👨‍❤️‍👨 👩‍❤️‍👩 🫶 🥰 😍 😘 🌹 🌷 💐 🍫 🧸 💍 💒 🏩 🔥 ✨ 💫 ⭐ 🌟'],
  ['👋', 'Gestos', '👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 💃 🕺 👯 🧖 🛀 🛌'],
  ['🐶', 'Bichos', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🪲 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🦭 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🦒 🦘 🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐈‍⬛ 🪶 🐓 🦃 🦤 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍃 🍂 🍁 🍄 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌙 🌎 🪐 💫 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌪️ 🌈 ☀️ ⛅ ☁️ 🌧️ ⛈️ 🌩️ ❄️ ☃️ ⛄ 🌊 💧 💦 ☔'],
  ['🍕', 'Comidas', '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🫖 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊'],
  ['🎮', 'Atividades', '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🏋️ 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚵 🚴 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🎰 🧩 🍿 📺 🎥 📽️ 🎞️ 📸 🎉 🎊 🎈 🎁 🪅 🪩'],
  ['🚗', 'Viagem', '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🏍️ 🛵 🚲 🛴 🚨 🚔 🚍 🚘 🚖 ✈️ 🛫 🛬 🛩️ 💺 🚀 🛸 🚁 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙️ 🌃 🌌 🌉 🌁'],
  ['💡', 'Objetos', '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🕹️ 💽 💾 💿 📀 📼 📷 📹 🎥 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏰ ⌛ ⏳ 📡 🔋 🔌 💡 🔦 🕯️ 🧯 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🧰 🔧 🔨 🛠️ ⛏️ 🔩 ⚙️ 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🩹 🩺 💊 💉 🧬 🦠 🧪 🌡️ 🧹 🧺 🧻 🚽 🛁 🧼 🪥 🪒 🧽 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🧸 🪆 🖼️ 🪞 🛍️ 🛒 🎁 🎈 🎀 🪄 🎊 🎉 🎎 🏮 🎐 🧧 ✉️ 📩 📨 📧 💌 📦 🏷️ 📜 📃 📄 📑 📊 📈 📉 🗒️ 🗓️ 📆 📅 📇 🗃️ 🗳️ 🗄️ 📋 📁 📂 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓'],
  ['✅', 'Símbolos', '✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ 🟰 ♾️ ‼️ ⁉️ ❓ ❔ ❕ ❗ 〰️ 💯 🔞 📵 🚫 ⛔ 🆗 🆒 🆕 🆓 🆙 🆘 🔝 🔜 🔛 🔚 🔙 ♻️ ⚜️ 🔱 📛 🔰 ⭕ 🌀 💤 💢 💬 💭 🗯️ ♠️ ♥️ ♦️ ♣️ 🃏 🀄 🎴 🔇 🔈 🔉 🔊 🔔 🔕 🎵 🎶 ⚠️ 🚸 ⬆️ ↗️ ➡️ ↘️ ⬇️ ↙️ ⬅️ ↖️ ↕️ ↔️ 🔄 ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ 🔀 🔁 🔂 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫 🏳️ 🏴 🏁 🚩 🏳️‍🌈 🇧🇷 🇵🇹 🇺🇸 🇯🇵 🇰🇷'],
];

export const ALL_EMOJIS = CATEGORIES.flatMap(([, , list]) => list.split(' '));

export function pushRecent(e) {
  const rec = store('emoji-recent', []).filter((x) => x !== e);
  rec.unshift(e);
  save('emoji-recent', rec.slice(0, 32));
}

export function emojiPicker(onPick) {
  const body = el('div', { class: 'emoji-scroll' });
  const tabs = el('div', { class: 'emoji-tabs' });
  const sections = [];
  const recent = store('emoji-recent', []);
  const cats = recent.length ? [['🕘', 'Recentes', recent.join(' ')], ...CATEGORIES] : CATEGORIES;
  for (const [ic, name, list] of cats) {
    const grid = el('div', { class: 'emoji-grid' });
    for (const e of list.split(' ').filter(Boolean)) {
      grid.append(el('button', { class: 'emoji-btn', title: e, onclick: () => { pushRecent(e); onPick(e); } }, e));
    }
    const sec = el('section', {}, el('h4', {}, name), grid);
    sections.push(sec);
    body.append(sec);
    tabs.append(el('button', { title: name, onclick: () => body.scrollTo({ top: sec.offsetTop - body.offsetTop, behavior: 'smooth' }) }, ic));
  }
  return el('div', { class: 'emoji-picker' }, tabs, body);
}

// Detecta mensagem só com emojis (para mostrar grandão)
export function onlyEmoji(text) {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t);
}
