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
  ['rpg', 'Floresta RPG', 'jogos'], ['cyber', 'Cidade cyberpunk', 'jogos'], ['lava', 'Lava', 'jogos'], ['craft', 'Mundo de blocos', 'jogos'],
].map(([id, name, cat]) => ({ id, name, cat }));

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
