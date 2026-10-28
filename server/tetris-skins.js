// Estilos de torre do Tetris e o XP para liberar cada um (usado no servidor e no navegador)
const TETRIS_SKINS = [
  { id: 'classic', name: 'Clássico', xp: 0 },
  { id: 'flat', name: 'Flat', xp: 0 },
  { id: 'neon', name: 'Neon', xp: 0 },
  { id: 'glossy', name: 'Brilhante', xp: 60 },
  { id: 'pixel', name: 'Pixel', xp: 140 },
  { id: 'glass', name: 'Vidro', xp: 250 },
  { id: 'candy', name: 'Bala', xp: 400 },
  { id: 'gameboy', name: 'Gameboy', xp: 600 },
  { id: 'jelly', name: 'Gelatina', xp: 850 },
  { id: 'metal', name: 'Metal', xp: 1150 },
  { id: 'sakura', name: 'Sakura', xp: 1500 },
  { id: 'lava', name: 'Lava', xp: 1900 },
  { id: 'galaxy', name: 'Galáxia', xp: 2400 },
  { id: 'hologram', name: 'Holograma', xp: 3000 },
  { id: 'gold', name: 'Ouro', xp: 3800 },
];
if (typeof module !== 'undefined') module.exports = { TETRIS_SKINS };
