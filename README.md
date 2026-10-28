# ⚡ Kenfeh

Calls, telas e figurinhas com a galera: chamadas de voz e vídeo em alta qualidade, compartilhamento de várias telas ao mesmo tempo (com áudio), chat com emojis, figurinhas e GIFs feitos no próprio site.

## Como rodar

Precisa do **Node.js 22.13 ou mais novo** (o banco usa o SQLite que já vem no Node, então não tem nada pra compilar).

```bash
npm install
npm run db:init   # cria o banco (data/kennyfe.db). O servidor também cria sozinho se não existir.
npm start         # http://localhost:3000
```

Abra `http://localhost:3000`, crie sua conta, crie um grupo e passe o **código de convite** (botão direito no ícone do grupo → Convite) pra quem você quiser chamar.

> Use **Chrome ou Edge** atualizados no PC: são os navegadores com o melhor suporte a captura de tela com áudio.

### Colocar no ar com o domínio

Passo a passo completo (Cloudflare Tunnel + kenfeh.shop + TURN grátis) em **[HOSPEDAR.md](HOSPEDAR.md)**. As configurações ficam no arquivo `.env` (copie de `.env.example`).

### Acessando de outro PC / celular (sem domínio)

O navegador só libera câmera, microfone e tela em `localhost` ou em **HTTPS**. Opções:

| Situação | Como fazer |
|---|---|
| Mesma rede (Wi-Fi de casa) | `npm run https` e abra `https://IP-DO-PC:3000` (aceite o aviso do certificado uma vez). |
| Pela internet (mais fácil) | Rode `npm start` e use um túnel: [Tailscale](https://tailscale.com) (os dois instalam e acessam `http://nome-do-pc:3000` via MagicDNS + HTTPS) ou `cloudflared tunnel --url http://localhost:3000` (gera um link `https://…trycloudflare.com`). |
| Certificado próprio | `SSL_KEY=/caminho/key.pem SSL_CERT=/caminho/cert.pem npm run https` |

### Servidor TURN (só se a call não conectar)

A conexão de vídeo é direta entre os PCs (WebRTC). Na maioria das redes funciona só com STUN. Se ficar "conectando" pra sempre (algumas operadoras/4G bloqueiam), configure um TURN (ex.: [coturn](https://github.com/coturn/coturn) ou um serviço pago):

```bash
TURN_URL=turn:seu-servidor:3478 TURN_USERNAME=usuario TURN_PASSWORD=senha npm start
```

Ou use o TURN grátis da Cloudflare com `CF_TURN_KEY_ID` e `CF_TURN_API_TOKEN` (veja o HOSPEDAR.md).

Outras variáveis: `PORT` (padrão 3000), `DATA_DIR` (onde ficam banco e uploads, padrão `./data`), `REGISTER_CODE` (exige um código para criar conta).

## O que tem

### Chamadas
- **Qualidade máxima:** voz Opus estéreo até 510 kbps com correção de perda, câmera até 4K/1080p60, tela na resolução nativa do monitor (até 8K) a até 60/120 fps com até 50 Mbps. Bitrate inicial alto (sem aquele começo borrado) e codec escolhível (VP9, AV1, H.264, VP8).
- **Sem limite de compartilhamento:** compartilhe tela inteira, janela ou aba — quantas quiser ao mesmo tempo. **Duas telas = dois blocos separados**, cada um pode ir pra uma janela própria (ótimo com 2 monitores).
- **Tela + webcam juntas.**
- **Mixer de transmissão (🎚️):** escolha exatamente quais áudios vão pra call, cada um com o nome que o PC usa — `Microfone (Realtek)`, `Headset HyperX`, `Tela 1 — áudio da janela`, `CABLE Output (VB-Audio)`… Liga/desliga e volume separado por faixa, vários microfones ao mesmo tempo.
- **Anti-eco:** ao compartilhar o áudio do sistema, o som da própria call não é capturado (navegadores recentes), então a voz da pessoa não volta em eco.
- **Botão direito (ou segurar o dedo no celular)** em qualquer pessoa ou bloco: volume do usuário 0–200%, volume da transmissão, silenciar pra mim, focar, 50/50, 70/30, flutuar, tela cheia, janela separada, Picture-in-Picture, estatísticas (resolução/fps/bitrate/ping).
- **Layout ajustável:** arraste as divisórias entre os blocos pra deixar o filme grande e a webcam pequena (ou 50/50). Lado a lado, empilhado, foco ou grade. **Flutuar** deixa a webcam por cima do filme, arrastável e redimensionável. Arraste o nome de um bloco em cima de outro pra trocar de lugar. Tudo fica salvo.
- **Tela cheia de verdade:** sem barras nem bordas — só os vídeos. Os controles somem sozinhos quando o mouse para. Duplo clique num bloco = tela cheia só dele. Também tem o **modo cinema** (esconde as barras sem sair da janela).
- Supressão de ruído, cancelamento de eco, ganho automático, **modo alta fidelidade** (áudio cru estéreo), noise gate com medidor, escolha de microfone/câmera/alto-falante, atalhos (Ctrl+Shift+M muta, Ctrl+Shift+D ensurdece, F tela cheia).

### Perfil
- Foto, banner (cor ou imagem), "sobre mim", recado, cor do nome e **10 molduras animadas** (Neon, Fogo, Gelo, Ouro, Arco-íris, Tóxico, Galáxia, Pixel, Glitch…).
- **Jogos favoritos** (até 12) com sugestões, e **"Jogando agora"**: escrito à mão ou detectado sozinho pelo agente Kenfeh Coop. Dá pra esconder isso nas configurações.
- Clique em qualquer pessoa (lista de membros, chat, call) para abrir o cartão de perfil, com o volume dela se estiver na call.

### Jogos
- Aba **🎮 Jogos** ao lado do chat, com minijogos multiplayer que rodam no próprio site: **Desenha & Adivinha** (estilo Gartic), **Reflexo**, **Lig 4** e **Jogo da velha**. O grupo inteiro recebe o convite e dá pra jogar durante a call.
- **🧱 Tetris Royale** (parecido com Tetris), de 1v1 até 16 pessoas:
  - **Jogo:** rotação SRS com wall kicks, hold, 5 próximas peças, peça fantasma, hard drop, T-spins, combos, back-to-back e perfect clear mandando **lixo** para os outros.
  - **Tela:** mostra quantos tabuleiros couberem, e quem é eliminado sai da tela.
  - **Progresso:** **15 estilos de torre** liberados por XP (linhas limpas + colocação).
  - **Controles:** DAS/ARR ajustáveis, **modo casual** (velocidade fixa, mais tempo pra encaixar e toque no tabuleiro para derrubar a peça) e botões na tela no celular.
- Catálogo de **jogos grátis** pra jogar com a galera (navegador, Steam, Epic, Riot).

### 🕹️ Modo Jogo Coop (todos jogando no PC de quem transmite)
Funciona como um coop local pela internet. **Quem transmite continua jogando normalmente (Jogador 1)**, e **cada amigo vira um jogador separado (Jogador 2, 3, 4)** com um controle virtual próprio. O jogo enxerga pessoas diferentes, não um teclado só. É ótimo para It Takes Two, Cuphead, Overcooked, emuladores e qualquer jogo com coop local.

- **Só quem transmite instala algo, e é um app só, o `KenfehCoop.exe`** (baixe no diálogo do Modo Coop).
  - Ele já traz o componente de controle virtual dentro e o ativa sozinho na primeira vez. O Windows pede permissão de administrador uma única vez.
  - Mostra o código de pareamento, quem está jogando como cada jogador, o jogo detectado e um botão **Parar tudo**.
- **Os amigos não instalam nada.** Jogam pelo navegador:
  - com **controle** (é só conectar);
  - ou com **teclado e mouse**, que viram controle: WASD = analógico, mouse = câmera, Espaço = A, cliques = gatilhos…
- **Modo "Dividir meu teclado e mouse"** (opcional): o teclado/mouse do amigo apertam no seu, junto com você. Serve para jogos de teclado dividido (P1 WASD / P2 setas), turnos e menus.
- **Segurança:**
  - O app só aceita conexões do próprio PC, vindas do site, com o código.
  - Ninguém joga sem o host aprovar.
  - A tecla Windows é sempre bloqueada.
  - **Ctrl+Shift+X** no site, ou **Parar tudo** no app, corta todo mundo.
- **Por que controle e não "2 teclados"?** O Windows junta todos os teclados e mouses numa entrada só, então quase nenhum jogo separa dois teclados em dois jogadores. Controles cada jogo reconhece como jogadores diferentes, e é assim que o Steam Remote Play Together e o Parsec fazem.
- **Limites:**
  - Jogos com anti-cheat (Valorant, CS2, Fortnite…) podem bloquear ou punir input simulado.
  - Se o jogo roda como Administrador, abra o Kenfeh Coop como Administrador também.
  - O app é sem assinatura digital, então o Windows pode mostrar "o Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**.
- **Recompilar o app:** `scripts/build-agent.sh` (precisa do `mcs`, o compilador C# do Mono). O código está em `agent/src/KenfehCoop.cs`, e os componentes de terceiros, com as licenças, em `agent/vendor/`.

### Extras de call para gamers
- **Push-to-talk** (tecla ou botão lateral do mouse), **soundboard** com sons prontos e os seus (todo mundo na call ouve), **ping** de cada pessoa na lista da call, e **gravar clipe** de qualquer bloco (botão direito → Gravar).

### Chat
- Mensagens em tempo real, respostas, reações, editar/apagar, "digitando…", **negrito**, *itálico*, `código`, ||spoiler||, links.
- Emojis, imagens, vídeos, áudios e arquivos (arrastar e soltar ou colar com Ctrl+V).
- **Figurinhas e GIFs**, com coleção pessoal de cada conta (dá pra salvar as que a outra pessoa mandou).
- **Estúdio ✨:**
  - *Figurinha:* foto da webcam, imagem do PC, textos com fontes de meme, emojis, pincel/borracha, moldura (círculo, arredondado, coração) e contorno branco estilo WhatsApp.
  - *GIF:* grave a webcam (com contagem 3-2-1), um pedaço da tela, recorte um trecho de vídeo do PC ou junte várias fotos. Corte início/fim, velocidade, bumerangue/reverso, filtros e legenda em cima/embaixo.

### Início (amigos e conversas diretas)
- Ao entrar no site você cai no **Início**, como no Discord: lista de amigos (online / todos / pendentes), **adicionar amigo pelo @**, conversas diretas (DM) com chat e call, quem está **jogando agora** e as **calls rolando** com botão de entrar.

### Canais, classes e comandos (estilo Discord, só que melhor)
- **Canais de texto e de voz** em cada grupo, com emoji, descrição e ordem. Clicar num canal de voz já entra na call; cada canal de voz tem **o próprio chat** do lado do palco.
- Canal de voz **trancado**, **invisível** e com **limite de pessoas**. Quem não pode entrar consegue **🚪 bater na porta** e alguém de dentro deixa entrar.
- **Classes** (cargos) com cor, emoji e permissões: administrador, editar o grupo, gerenciar canais/classes, expulsar, apagar mensagens, entrar em call trancada, ver canais invisíveis, mover/desconectar e mutar na call, usar o bot de música, abrir jogos e convidar. Nome colorido pela classe e lista de membros separada por classe. Hierarquia: ninguém mexe em quem está no mesmo nível ou acima.
- Moderação de call: botão direito em alguém → mutar, mover para outro canal, desconectar. Quem pode mover também **arrasta a pessoa** para outro canal de voz.
- **Comandos com /** (digite / no chat): `/botmusic`, `/pular`, `/pausar`, `/fila`, `/repetir`, `/enquete`, `/dado`, `/moeda`, `/escolher`, `/sortear`, `/bola8`, `/jogar`, `/me`, `/lembrar`, `/limpar`, `/convite`, `/ajuda` e outros.
- **KenBeat 🎧, o bot de música**: `/botmusic <link do YouTube ou nome>` e ele toca na call em que você está, **sincronizado para todo mundo** (cada um ouve pelo próprio navegador, com volume próprio). Aceita vídeo, playlist, link com tempo (`&t=1m30s`) e busca por nome. Aparece como um bloco na call com capa, barra de progresso (clique para avançar), fila e controles; sai sozinho quando a call fica vazia.

### Painel do site (só o dono)
- No Início aparece **📊 Painel do site** apenas para a conta do dono (`ADMIN_USERNAMES`, padrão `kenny_maciel`). Para qualquer outra conta a página e a API (`/api/admin/stats`) nem existem.
- Mostra: contas, quem está online, ativos por dia (30 dias), cadastros por dia, horas de uso e em call, **lista de quem se inscreveu com e-mail**, data de cadastro, último acesso, tempo de uso de cada um e as **funções mais usadas** (no geral e por pessoa).
- O tempo de uso conta enquanto o site está aberto; as funções começam a ser contadas a partir desta versão (mensagens antigas já entram na contagem por pessoa).

### Contas e grupos
- Cadastro pede **e-mail** (contas antigas podem adicionar em Configurações → Perfil; o e-mail só a própria pessoa e o dono veem).
- Login/cadastro com senha protegida (scrypt) e sessão em cookie httpOnly. Cada conta tem seus próprios dados (perfil, coleção de figurinhas, grupos).
- Grupos com ícone, convite por código ou por @usuário, membros online, quem está na call, notificações.

## Limitações honestas (do navegador, não do site)

- **Áudio de um app específico (ex.: só o Valorant):** o Chrome/Edge mais novos capturam só o áudio da *janela* escolhida. Se o seu não oferecer, use um cabo virtual ([VB-CABLE](https://vb-audio.com/Cable/)): no Windows, *Configurações → Sistema → Som → Mixer de volume*, mande o Valorant para "CABLE Input" e adicione "CABLE Output" como fonte no Mixer do Kenfeh. Assim você escolhe faixa por faixa o que vai.
- **Netflix/Prime/Disney ficando pretos:** é a proteção DRM. No Chrome/Edge, desative *Configurações → Sistema → Usar aceleração de hardware* e reinicie o navegador.
- **Muita gente com vídeo:** as conexões são diretas entre cada par de pessoas (sem servidor de mídia no meio = menor latência e qualidade máxima). Para 2–5 pessoas é perfeito; com bem mais gente transmitindo 4K, o upload de quem transmite vira o limite.

## Estrutura

```
server/
  index.js    servidor HTTP/HTTPS, arquivos estáticos e Socket.IO
  db.js       banco SQLite (tabelas criadas/migradas automaticamente)
  auth.js     senhas (scrypt) e sessões
  routes.js   API REST: contas, perfil, grupos, mensagens, uploads, figurinhas
  games.js    minijogos multiplayer (o servidor é o juiz)
  tetris-skins.js  estilos de torre do Tetris e o XP de cada um
  hub.js      tempo real: presença, chat e sinalização WebRTC
  stats.js    estatísticas do Painel do site (tempo de uso, funções usadas)
public/
  js/main.js          login, grupos e navegação
  js/chat.js          chat, emojis, figurinhas
  js/creator.js       estúdio de figurinhas e GIFs
  js/settings-ui.js   configurações e edição de perfil
  js/profile.js       cartão de perfil
  js/home.js          Início (amigos, conversas diretas)
  js/admin.js         Painel do site (só o dono)
  js/games.js         aba Jogos (minijogos + catálogo)
  js/tetris.js        Tetris Royale: motor, estilos e interface
  js/call/            chamada: rtc (conexões), media (mic/câmera/telas), audio (volumes),
                      stage (blocos redimensionáveis), call (controles e menus),
                      coop (Modo Jogo Coop), sounds (soundboard)
agent/src/KenfehCoop.cs  app Windows do Modo Coop (interface + controles virtuais + SendInput)
agent/dist/KenfehCoop.exe  app compilado, baixado pelo site em /download/KenfehCoop.exe
data/                 banco e uploads (criado na hora, fora do git)
```
