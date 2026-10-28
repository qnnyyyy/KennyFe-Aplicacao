// Catálogo de visuais do perfil: avatares prontos, fundos animados e molduras.
// (designs originais do Kenfeh, inspirados em jogos e anime/geek)
export const AVATARS = [
  ['ninja', 'Ninja da bandana', 'anime'], ['tomoe', 'Olhos tomoe', 'anime'], ['crow', 'Ninja do corvo', 'anime'],
  ['pirate', 'Pirata do chapéu de palha', 'anime'], ['golden-warrior', 'Guerreiro dourado', 'anime'], ['demon-hunter', 'Caçador de demônios', 'anime'],
  ['kunoichi', 'Kunoichi', 'anime'], ['wizard-boy', 'Bruxo de óculos', 'geek'], ['monster-hunter', 'Caçador de monstros', 'jogos'],
  ['plumber', 'Encanador', 'jogos'], ['space-soldier', 'Soldado espacial', 'jogos'], ['gamer-girl', 'Gamer de headset', 'jogos'],
  ['fox', 'Raposa de nove caudas', 'anime'], ['kawaii-cat', 'Gatinho kawaii', 'geek'], ['panda', 'Panda', 'geek'],
  ['pad', 'Controle', 'jogos'], ['headset', 'Headset RGB', 'jogos'], ['ghost', 'Fantasminha arcade', 'jogos'],
  ['slime', 'Slime', 'jogos'], ['robot', 'Robô', 'geek'], ['skull', 'Caveira gamer', 'jogos'],
  ['block', 'Bloco de grama', 'jogos'], ['sword', 'Espada lendária', 'jogos'], ['astronaut', 'Astronauta', 'geek'],
].map(([id, name, cat]) => ({ id, name, cat, url: `/img/av/${id}.svg` }));

export const BANNERS = [
  ['kenfeh', 'Kenfeh neon', 'geek'], ['ninja', 'Espiral ninja', 'anime'], ['tomoe', 'Lua vermelha', 'anime'], ['sakura', 'Sakura', 'anime'],
  ['ki', 'Aura de poder', 'anime'], ['village', 'Vila à noite', 'anime'], ['magic', 'Círculo mágico', 'anime'], ['mecha', 'HUD mecha', 'anime'],
  ['kawaii', 'Kawaii', 'geek'], ['comic', 'HQ', 'geek'], ['ocean', 'Mar pirata', 'anime'], ['galaxy', 'Galáxia', 'geek'],
  ['synthwave', 'Synthwave', 'jogos'], ['arcade', 'Arcade 8-bit', 'jogos'], ['matrix', 'Código', 'jogos'], ['blocks', 'Blocos caindo', 'jogos'],
  ['fps', 'Mira e radar', 'jogos'], ['zone', 'Zona fechando', 'jogos'], ['space', 'Velocidade da luz', 'jogos'], ['racing', 'Corrida', 'jogos'],
  ['rubro', 'Dragão Rubro', 'jogos'], ['t-raposa', 'Raposa Espiritual', 'anime'], ['t-corvo', 'Corvo Sombrio', 'anime'], ['t-sakura', 'Lâmina Sakura', 'anime'], ['t-gamer', 'Gamer Arcade', 'jogos'], ['t-fenix', 'Fênix Solar', 'geek'], ['t-lobo', 'Lobo Lunar', 'geek'], ['t-arcano', 'Círculo Arcano', 'jogos'], ['t-cyber', 'Neon Cyber', 'jogos'], ['t-galaxia', 'Galáxia', 'geek'], ['t-caveira', 'Caveira Tóxica', 'jogos'], ['t-oni', 'Máscara Oni', 'anime'], ['t-serpente', 'Serpente Jade', 'anime'], ['t-kraken', 'Kraken Abissal', 'geek'], ['t-neko', 'Neko Kawaii', 'anime'], ['t-pirata', 'Pirata dos Mares', 'anime'], ['t-tempestade', 'Tempestade', 'geek'], ['t-vampiro', 'Vampiro Gótico', 'geek'], ['t-cavaleiro', 'Ordem do Cavaleiro', 'jogos'], ['t-slime', 'Slime Rei', 'jogos'], ['t-floresta', 'Floresta Mística', 'geek'], ['t-tricolor', 'Tricolor Soberano', 'jogos', 'owner'], ['rpg', 'Floresta RPG', 'jogos'], ['cyber', 'Cidade cyberpunk', 'jogos'], ['lava', 'Lava', 'jogos'], ['craft', 'Mundo de blocos', 'jogos'],
].map(([id, name, cat, owner]) => ({ id, name, cat, owner: owner === 'owner' }));

export const FRAMES = [
  ['none', 'Sem moldura', 'basico'],
  ['neon', 'Neon', 'basico'], ['rgb', 'RGB gamer', 'jogos'], ['fire', 'Fogo', 'basico'], ['ice', 'Gelo', 'basico'], ['gold', 'Ouro', 'basico'],
  ['legend', 'Lendário', 'jogos'], ['rainbow', 'Arco-íris', 'basico'], ['toxic', 'Tóxico', 'jogos'], ['galaxy', 'Galáxia', 'geek'],
  ['pixel', 'Pixel', 'jogos'], ['arcade', '8-bit', 'jogos'], ['glitch', 'Glitch', 'geek'], ['electric', 'Raio', 'anime'], ['matrix', 'Código', 'geek'],
  ['hud', 'HUD mecha', 'anime'], ['zone', 'Zona', 'jogos'], ['lava', 'Lava', 'jogos'], ['ocean', 'Oceano', 'geek'], ['heart', 'Coração', 'geek'],
  ['tomoe', 'Tomoe girando', 'anime'], ['pinwheel', 'Olhar giratório', 'anime'], ['crows', 'Corvos voando', 'anime'], ['chakra', 'Chakra', 'anime'],
  ['leaves', 'Folhas ninja', 'anime'], ['shuriken', 'Shurikens', 'anime'], ['ki', 'Aura dourada', 'anime'], ['orbs', 'Esferas', 'anime'],
  ['sakura', 'Pétalas', 'anime'], ['butterflies', 'Borboletas', 'anime'], ['magic', 'Círculo mágico', 'anime'], ['void', 'Vazio', 'anime'],
  ['shadow', 'Sombra', 'anime'], ['bats', 'Morcegos', 'geek'], ['flames', 'Chamas', 'jogos'], ['stars8', 'Estrelas 8-bit', 'jogos'], ['kawaii', 'Kawaii', 'geek'],
].map(([id, name, cat]) => [id, name, cat]);

// layers: 'f' = só na frente da foto, 'b' = só atrás, 'fb' = frente + atrás (<id>-back.svg)
export const DECOS = [
  ['none', 'Nenhuma', 'basico', 'f'],
  ['x-dragon', 'Dragões Rubros', 'jogos', 'fb'], ['x-dragon-fly', 'Dragão Rubro dando a volta', 'jogos', 'fb'], ['x-dragon-east', 'Dragão oriental', 'anime', 'f'],
  ['t-raposa', 'Raposa Espiritual', 'anime', 'f', 'kit'], ['t-corvo', 'Corvo Sombrio', 'anime', 'f', 'kit'], ['t-sakura', 'Lâmina Sakura', 'anime', 'f', 'kit'], ['t-gamer', 'Gamer Arcade', 'jogos', 'f', 'kit'], ['t-fenix', 'Fênix Solar', 'geek', 'f', 'kit'], ['t-lobo', 'Lobo Lunar', 'geek', 'f', 'kit'], ['t-arcano', 'Círculo Arcano', 'jogos', 'f', 'kit'], ['t-cyber', 'Neon Cyber', 'jogos', 'f', 'kit'], ['t-galaxia', 'Galáxia', 'geek', 'f', 'kit'], ['t-caveira', 'Caveira Tóxica', 'jogos', 'f', 'kit'],
  ['t-oni', 'Máscara Oni', 'anime', 'f', 'kit'], ['t-serpente', 'Serpente Jade', 'anime', 'f', 'kit'], ['t-kraken', 'Kraken Abissal', 'geek', 'f', 'kit'], ['t-neko', 'Neko Kawaii', 'anime', 'f', 'kit'], ['t-pirata', 'Pirata dos Mares', 'anime', 'f', 'kit'], ['t-tempestade', 'Tempestade', 'geek', 'f', 'kit'], ['t-vampiro', 'Vampiro Gótico', 'geek', 'f', 'kit'], ['t-cavaleiro', 'Ordem do Cavaleiro', 'jogos', 'f', 'kit'], ['t-slime', 'Slime Rei', 'jogos', 'f', 'kit'], ['t-floresta', 'Floresta Mística', 'geek', 'f', 'kit'], ['t-tricolor', 'Tricolor Soberano', 'jogos', 'f', 'kit', 'owner'],
  ['x-aura-water', 'Aura de água', 'anime', 'fb'], ['x-aura-fire', 'Aura de fogo', 'anime', 'fb'], ['x-aura-chakra', 'Aura de chakra', 'anime', 'fb'],
  ['x-aura-sharingan', 'Aura sharingan', 'anime', 'fb'], ['x-aura-golden', 'Aura dourada', 'anime', 'fb'], ['x-aura-nature', 'Aura da natureza', 'anime', 'fb'],
  ['x-crows', 'Bando de corvos', 'anime', 'fb'], ['x-fox9', 'Raposa de nove caudas', 'anime', 'fb'], ['x-serpent', 'Serpente sombria', 'anime', 'fb'],
  ['x-ninja', 'Kunais ninja', 'anime', 'f'], ['x-sakura', 'Galho de sakura', 'anime', 'f'],
  ['x-crown', 'Coroa', 'jogos', 'f'], ['x-angel', 'Asas de anjo', 'geek', 'b'], ['x-demon', 'Chifres e asas', 'geek', 'b'],
].map(([id, name, cat, layers, kind, owner]) => ({ id, name, cat, layers, kit: kind === 'kit', owner: owner === 'owner' }));
export const DECO_BY_ID = Object.fromEntries(DECOS.map((d) => [d.id, d]));

export const EFFECTS = [
  ['none', 'Nenhum', 'basico'], ['crows', 'Corvos atravessando', 'anime'], ['sakura', 'Chuva de sakura', 'anime'], ['leaves', 'Folhas ao vento', 'anime'],
  ['lightning', 'Tempestade', 'anime'], ['embers', 'Brasas', 'jogos'], ['pixels', 'Pixels', 'jogos'], ['stars', 'Estrelas', 'geek'],
  ['snow', 'Neve', 'geek'], ['hearts', 'Corações', 'geek'], ['bubbles', 'Bolhas', 'geek'], ['bats', 'Morcegos', 'geek'],
].map(([id, name, cat]) => ({ id, name, cat }));

export const COS_CATS = [['all', 'Todos'], ['anime', '🍥 Anime'], ['jogos', '🎮 Jogos'], ['geek', '🤓 Geek'], ['basico', '✨ Clássicos']];

// fundo do perfil: imagem enviada, tema animado ("theme:<id>") ou cor
export function applyBanner(node, user) {
  const b = user?.bannerUrl || '';
  node.className = node.className.replace(/\bbnr(-\S+)?\b/g, '').trim();
  node.style.background = '';
  if (b.startsWith('theme:')) node.classList.add('bnr', 'bnr-' + b.slice(6));
  else if (b) node.style.background = `center / cover no-repeat url("${b}")`;
  else node.style.background = `linear-gradient(135deg, ${user?.bannerColor || '#ff3d9a'}, color-mix(in srgb, ${user?.bannerColor || '#ff3d9a'} 45%, #3d7bff))`;
}

// Temas completos: aplicam fundo, decoração, nameplate, badges e o visual do cartão de uma vez
export const THEMES = [
  { id: 'none', name: 'Sem tema', cat: 'basico' },
  {
    id: 'rubro', name: 'Dragão Rubro', cat: 'jogos', deco: 'x-dragon', banner: 'theme:rubro',
    badges: [['olho', 'Olho do Dragão'], ['garra', 'Garra'], ['chama', 'Chama'], ['escama', 'Escama de Ferro'], ['coroa', 'Coroa']],
  },
  { id: 'raposa', name: 'Raposa Espiritual', cat: 'anime', deco: 't-raposa', banner: 'theme:t-raposa', badges: [['pata', 'Pata'], ['chama', 'Chama'], ['lua', 'Lua'], ['olho', 'Olho']] },
  { id: 'corvo', name: 'Corvo Sombrio', cat: 'anime', deco: 't-corvo', banner: 'theme:t-corvo', badges: [['pena', 'Pena'], ['olho', 'Olho'], ['garra', 'Garra'], ['lua', 'Lua']] },
  { id: 'sakura', name: 'Lâmina Sakura', cat: 'anime', deco: 't-sakura', banner: 'theme:t-sakura', badges: [['flor', 'Flor'], ['katana', 'Katana'], ['kunai', 'Kunai'], ['shuriken', 'Shuriken']] },
  { id: 'gamer', name: 'Gamer Arcade', cat: 'jogos', deco: 't-gamer', banner: 'theme:t-gamer', badges: [['trofeu', 'Troféu'], ['coracao', 'Vida extra'], ['estrela', 'Estrela'], ['moeda', 'Moeda']] },
  { id: 'fenix', name: 'Fênix Solar', cat: 'geek', deco: 't-fenix', banner: 'theme:t-fenix', badges: [['chama', 'Chama'], ['pena', 'Pena'], ['sol', 'Sol'], ['coroa', 'Coroa']] },
  { id: 'lobo', name: 'Lobo Lunar', cat: 'geek', deco: 't-lobo', banner: 'theme:t-lobo', badges: [['lua', 'Lua'], ['presa', 'Presa'], ['pata', 'Pata'], ['floco', 'Floco de neve']] },
  { id: 'arcano', name: 'Círculo Arcano', cat: 'jogos', deco: 't-arcano', banner: 'theme:t-arcano', badges: [['runa', 'Runa'], ['cristal', 'Cristal'], ['pocao', 'Poção'], ['olho', 'Olho']] },
  { id: 'cyber', name: 'Neon Cyber', cat: 'jogos', deco: 't-cyber', banner: 'theme:t-cyber', badges: [['visor', 'Visor'], ['chip', 'Chip'], ['raio', 'Raio'], ['alvo', 'Alvo']] },
  { id: 'galaxia', name: 'Galáxia', cat: 'geek', deco: 't-galaxia', banner: 'theme:t-galaxia', badges: [['planeta', 'Planeta'], ['estrela', 'Estrela'], ['foguete', 'Foguete'], ['cometa', 'Cometa']] },
  { id: 'caveira', name: 'Caveira Tóxica', cat: 'jogos', deco: 't-caveira', banner: 'theme:t-caveira', badges: [['caveira', 'Caveira'], ['radiacao', 'Radiação'], ['gota', 'Gota tóxica'], ['osso', 'Osso']] },
  { id: 'oni', name: 'Máscara Oni', cat: 'anime', deco: 't-oni', banner: 'theme:t-oni', badges: [['mascara', 'Máscara'], ['chifre', 'Chifre'], ['chama', 'Chama'], ['presa', 'Presa']] },
  { id: 'serpente', name: 'Serpente Jade', cat: 'anime', deco: 't-serpente', banner: 'theme:t-serpente', badges: [['cobra', 'Cobra'], ['olho', 'Olho'], ['escama', 'Escama'], ['moeda', 'Moeda']] },
  { id: 'kraken', name: 'Kraken Abissal', cat: 'geek', deco: 't-kraken', banner: 'theme:t-kraken', badges: [['tentaculo', 'Tentáculo'], ['olho', 'Olho'], ['ancora', 'Âncora'], ['bolha', 'Bolha']] },
  { id: 'neko', name: 'Neko Kawaii', cat: 'anime', deco: 't-neko', banner: 'theme:t-neko', badges: [['pata', 'Pata'], ['coracao', 'Coração'], ['peixe', 'Peixinho'], ['estrela', 'Estrela']] },
  { id: 'pirata', name: 'Pirata dos Mares', cat: 'anime', deco: 't-pirata', banner: 'theme:t-pirata', badges: [['mapa', 'Mapa do tesouro'], ['bussola', 'Bússola'], ['leme', 'Leme'], ['ancora', 'Âncora']] },
  { id: 'tempestade', name: 'Tempestade', cat: 'geek', deco: 't-tempestade', banner: 'theme:t-tempestade', badges: [['raio', 'Raio'], ['nuvem', 'Nuvem'], ['chuva', 'Chuva'], ['vento', 'Vento']] },
  { id: 'vampiro', name: 'Vampiro Gótico', cat: 'geek', deco: 't-vampiro', banner: 'theme:t-vampiro', badges: [['presas', 'Presas'], ['morcego', 'Morcego'], ['rosa', 'Rosa'], ['lua', 'Lua']] },
  { id: 'cavaleiro', name: 'Ordem do Cavaleiro', cat: 'jogos', deco: 't-cavaleiro', banner: 'theme:t-cavaleiro', badges: [['espada', 'Espada'], ['escudo', 'Escudo'], ['elmo', 'Elmo'], ['coroa', 'Coroa']] },
  { id: 'slime', name: 'Slime Rei', cat: 'jogos', deco: 't-slime', banner: 'theme:t-slime', badges: [['slime', 'Slime'], ['coroa', 'Coroa'], ['gema', 'Gema'], ['gota', 'Gota']] },
  { id: 'floresta', name: 'Floresta Mística', cat: 'geek', deco: 't-floresta', banner: 'theme:t-floresta', badges: [['folha', 'Folha'], ['cogumelo', 'Cogumelo'], ['vagalume', 'Vagalume'], ['flor', 'Flor']] },
  // exclusivo da conta do dono
  { id: 'tricolor', name: 'Tricolor Soberano', cat: 'jogos', owner: true, deco: 't-tricolor', banner: 'theme:t-tricolor', badges: [['mundial', 'Tri Mundial (92, 93 e 05)'], ['taca', 'Libertadores'], ['tri-brasileiro', 'Tri Brasileiro (06, 07, 08)'], ['1930', 'Desde 1930'], ['bola', 'Bola tricolor'], ['coracao', 'Coração tricolor']] },
];
export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
