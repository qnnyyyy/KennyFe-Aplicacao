// Ids válidos dos visuais do perfil (espelho de public/js/cosmetics.js)
const fs = require('node:fs');
const path = require('node:path');
const AV_DIR = path.join(__dirname, '..', 'public', 'img', 'av');
const BANNERS = ['kenfeh', 'ninja', 'tomoe', 'sakura', 'ki', 'village', 'magic', 'mecha', 'kawaii', 'comic', 'ocean', 'galaxy', 'synthwave', 'arcade', 'matrix', 'blocks', 'fps', 'zone', 'space', 'racing', 'rubro', 't-raposa', 't-corvo', 't-sakura', 't-gamer', 't-fenix', 't-lobo', 't-arcano', 't-cyber', 't-galaxia', 't-caveira', 't-oni', 't-serpente', 't-kraken', 't-neko', 't-pirata', 't-tempestade', 't-vampiro', 't-cavaleiro', 't-slime', 't-floresta', 't-tricolor', 'rpg', 'cyber', 'lava', 'craft'];
const FRAMES = ['none', 'neon', 'rgb', 'fire', 'ice', 'gold', 'legend', 'rainbow', 'toxic', 'galaxy', 'pixel', 'arcade', 'glitch', 'electric', 'matrix', 'hud', 'zone', 'lava', 'ocean', 'heart', 'tomoe', 'pinwheel', 'crows', 'chakra', 'leaves', 'shuriken', 'ki', 'orbs', 'sakura', 'butterflies', 'magic', 'void', 'shadow', 'bats', 'flames', 'stars8', 'kawaii'];
const DECOS = ['none', 't-raposa', 't-corvo', 't-sakura', 't-gamer', 't-fenix', 't-lobo', 't-arcano', 't-cyber', 't-galaxia', 't-caveira', 't-oni', 't-serpente', 't-kraken', 't-neko', 't-pirata', 't-tempestade', 't-vampiro', 't-cavaleiro', 't-slime', 't-floresta', 't-tricolor', 'x-dragon', 'x-dragon-fly', 'x-dragon-east', 'x-aura-water', 'x-aura-fire', 'x-aura-chakra', 'x-aura-sharingan', 'x-aura-golden', 'x-aura-nature', 'x-crows', 'x-fox9', 'x-serpent', 'x-ninja', 'x-sakura', 'x-crown', 'x-angel', 'x-demon'];
const THEMES = ['none', 'rubro', 'raposa', 'corvo', 'sakura', 'gamer', 'fenix', 'lobo', 'arcano', 'cyber', 'galaxia', 'caveira', 'oni', 'serpente', 'kraken', 'neko', 'pirata', 'tempestade', 'vampiro', 'cavaleiro', 'slime', 'floresta', 'tricolor'];
// só a conta do dono pode equipar (os outros veem normalmente no perfil dele)
const OWNER_ONLY = ['tricolor', 't-tricolor', 'theme:t-tricolor'];
const EFFECTS = ['none', 'crows', 'sakura', 'leaves', 'snow', 'embers', 'hearts', 'bubbles', 'stars', 'pixels', 'bats', 'lightning'];
const validAvatar = (u) => typeof u === 'string' && (u.startsWith('/uploads/') || (/^\/img\/av\/[a-z0-9-]+\.svg$/.test(u) && fs.existsSync(path.join(AV_DIR, path.basename(u)))));
const validBanner = (u) => typeof u === 'string' && (u.startsWith('/uploads/') || (u.startsWith('theme:') && BANNERS.includes(u.slice(6))));
module.exports = { BANNERS, FRAMES, DECOS, EFFECTS, THEMES, OWNER_ONLY, validAvatar, validBanner };
