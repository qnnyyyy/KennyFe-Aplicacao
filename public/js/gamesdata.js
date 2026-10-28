// Catálogo de jogos: sugestões para o perfil e jogos grátis para jogar em grupo.

// Jogos grátis (ou com versão grátis) bons pra jogar com a galera
export const FREE_GAMES = [
  { name: 'Gartic Phone', tag: 'Navegador', mode: 'Party', icon: '✏️', url: 'https://garticphone.com/pt' },
  { name: 'skribbl.io', tag: 'Navegador', mode: 'Party', icon: '🖍️', url: 'https://skribbl.io' },
  { name: 'Codenames', tag: 'Navegador', mode: 'Party', icon: '🕵️', url: 'https://codenames.game' },
  { name: 'Krunker', tag: 'Navegador', mode: 'FPS', icon: '🔫', url: 'https://krunker.io' },
  { name: 'Lichess (xadrez)', tag: 'Navegador', mode: 'PvP', icon: '♟️', url: 'https://lichess.org' },
  { name: 'Counter-Strike 2', tag: 'Steam', mode: 'FPS', icon: '💣', url: 'https://store.steampowered.com/app/730/' },
  { name: 'Valorant', tag: 'Riot', mode: 'FPS', icon: '🎯', url: 'https://playvalorant.com' },
  { name: 'League of Legends', tag: 'Riot', mode: 'MOBA', icon: '⚔️', url: 'https://www.leagueoflegends.com' },
  { name: 'Dota 2', tag: 'Steam', mode: 'MOBA', icon: '🛡️', url: 'https://store.steampowered.com/app/570/' },
  { name: 'Fortnite', tag: 'Epic', mode: 'Battle royale', icon: '🪂', url: 'https://www.fortnite.com' },
  { name: 'Apex Legends', tag: 'Steam', mode: 'Battle royale', icon: '🦾', url: 'https://store.steampowered.com/app/1172470/' },
  { name: 'Rocket League', tag: 'Epic', mode: 'Esporte', icon: '🚗', url: 'https://www.rocketleague.com' },
  { name: 'Fall Guys', tag: 'Epic', mode: 'Party', icon: '🫘', url: 'https://www.fallguys.com' },
  { name: 'Marvel Rivals', tag: 'Steam', mode: 'Hero shooter', icon: '🦸', url: 'https://store.steampowered.com/app/2767030/' },
  { name: 'Warframe', tag: 'Steam', mode: 'Coop', icon: '🥷', url: 'https://store.steampowered.com/app/230410/' },
  { name: 'Destiny 2', tag: 'Steam', mode: 'Coop', icon: '🌌', url: 'https://store.steampowered.com/app/1085660/' },
  { name: 'Path of Exile', tag: 'Steam', mode: 'Coop', icon: '🗡️', url: 'https://store.steampowered.com/app/238960/' },
  { name: 'Brawlhalla', tag: 'Steam', mode: 'Luta', icon: '🥊', url: 'https://store.steampowered.com/app/291550/' },
  { name: 'Team Fortress 2', tag: 'Steam', mode: 'FPS', icon: '🎩', url: 'https://store.steampowered.com/app/440/' },
  { name: 'Unturned', tag: 'Steam', mode: 'Coop', icon: '🧟', url: 'https://store.steampowered.com/app/304930/' },
  { name: 'Halo Infinite', tag: 'Steam', mode: 'FPS', icon: '🪖', url: 'https://store.steampowered.com/app/1240440/' },
  { name: 'War Thunder', tag: 'Steam', mode: 'PvP', icon: '✈️', url: 'https://store.steampowered.com/app/236390/' },
  { name: 'Stumble Guys', tag: 'Steam', mode: 'Party', icon: '🏃', url: 'https://store.steampowered.com/app/1677740/' },
];

// Sugestões para "jogos favoritos"
export const POPULAR_GAMES = [
  ...FREE_GAMES.map((g) => g.name),
  'Minecraft', 'Roblox', 'GTA V', 'Red Dead Redemption 2', 'Elden Ring', 'Overwatch 2', 'Among Us', 'Terraria',
  'Stardew Valley', 'Lethal Company', 'Phasmophobia', 'Palworld', 'It Takes Two', 'Overcooked 2', 'Cuphead',
  'Rainbow Six Siege', 'Call of Duty: Warzone', 'EA Sports FC', 'Hollow Knight', 'The Sims 4', 'Dead by Daylight',
  'Baldur\'s Gate 3', 'Cyberpunk 2077', 'Sea of Thieves', 'Deep Rock Galactic', 'Left 4 Dead 2', 'Rust', 'Genshin Impact',
  'Free Fire', 'Clash Royale', 'Brawl Stars', 'Pokémon', 'Hades', 'Portal 2', 'Helldivers 2', 'PUBG',
].filter((g, i, a) => a.indexOf(g) === i);

export function gameEmoji(name) {
  const f = FREE_GAMES.find((g) => g.name.toLowerCase() === String(name).toLowerCase());
  if (f) return f.icon;
  const n = String(name).toLowerCase();
  if (/mine|craft|terraria|stardew/.test(n)) return '⛏️';
  if (/gta|car|race|forza|need for/.test(n)) return '🏎️';
  if (/fifa|fc |football|soccer|pes/.test(n)) return '⚽';
  if (/cod|call of duty|siege|pubg|battlefield|halo|cs/.test(n)) return '🔫';
  if (/among|phasmo|lethal|dead by/.test(n)) return '👻';
  if (/pok[eé]mon/.test(n)) return '⚡';
  return '🎮';
}
