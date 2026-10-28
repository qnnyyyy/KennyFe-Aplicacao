// Ids válidos dos visuais do perfil (espelho de public/js/cosmetics.js)
const fs = require('node:fs');
const path = require('node:path');
const AV_DIR = path.join(__dirname, '..', 'public', 'img', 'av');
const BANNERS = ['kenfeh', 'ninja', 'tomoe', 'sakura', 'ki', 'village', 'magic', 'mecha', 'kawaii', 'comic', 'ocean', 'galaxy', 'synthwave', 'arcade', 'matrix', 'blocks', 'fps', 'zone', 'space', 'racing', 'rpg', 'cyber', 'lava', 'craft'];
const FRAMES = ['none', 'neon', 'rgb', 'fire', 'ice', 'gold', 'legend', 'rainbow', 'toxic', 'galaxy', 'pixel', 'arcade', 'glitch', 'electric', 'matrix', 'hud', 'zone', 'lava', 'ocean', 'heart', 'tomoe', 'pinwheel', 'crows', 'chakra', 'leaves', 'shuriken', 'ki', 'orbs', 'sakura', 'butterflies', 'magic', 'void', 'shadow', 'bats', 'flames', 'stars8', 'kawaii'];
const validAvatar = (u) => typeof u === 'string' && (u.startsWith('/uploads/') || (/^\/img\/av\/[a-z0-9-]+\.svg$/.test(u) && fs.existsSync(path.join(AV_DIR, path.basename(u)))));
const validBanner = (u) => typeof u === 'string' && (u.startsWith('/uploads/') || (u.startsWith('theme:') && BANNERS.includes(u.slice(6))));
module.exports = { BANNERS, FRAMES, validAvatar, validBanner };
