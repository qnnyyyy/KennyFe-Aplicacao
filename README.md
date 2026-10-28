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
- **🧱 Tetris Royale** (estilo TETR.IO), de 1v1 até 16 pessoas:
  - **Jogo:** rotação SRS com wall kicks, hold, 5 próximas peças, peça fantasma, hard drop, T-spins, combos, back-to-back e perfect clear mandando **lixo** para os outros.
  - **Tela:** mostra quantos tabuleiros couberem, e quem é eliminado sai da tela.
  - **Progresso:** **15 estilos de torre** liberados por XP (linhas limpas + colocação).
  - **Controles:** DAS/ARR ajustáveis, **modo casual** (velocidade fixa, mais tempo pra encaixar e toque no tabuleiro para derrubar a peça) e botões na tela no celular.
- Catálogo de **jogos grátis** pra jogar com a galera (navegador, Steam, Epic, Riot).

### 🕹️ Modo Jogo Coop (jogar no PC de quem transmite)
Quem transmite liga o Modo Coop numa tela compartilhada. O amigo clica em **"🎮 Pedir para jogar"**, o host aceita, e o **teclado, o mouse e o controle do amigo passam a funcionar no PC do host**, como se estivessem plugados lá. É ótimo para jogos com coop local (It Takes Two, Cuphead, Overcooked, emuladores…).

- **Host (Windows):**
  1. No diálogo do Modo Coop, baixe o `Kenfeh-Coop.bat`, abra e digite no site o código de 6 números que aparece.
  2. Para o controle do amigo virar um **controle de Xbox virtual** (até 4), instale o driver [ViGEmBus](https://github.com/nefarius/ViGEmBus/releases). Teclado e mouse funcionam sem ele.
  3. Se o navegador perguntar sobre "dispositivos na rede local", permita: é o site conversando com o agente no seu próprio PC.
- **Convidado:**
  - Clique no vídeo para capturar o teclado e o mouse. **Esc** solta o mouse e **Ctrl+Shift+Q** sai.
  - O controle funciona só de estar conectado.
  - Dá pra escolher mouse **absoluto** (menus, estratégia) ou **relativo** (FPS, câmera).
- **Segurança:**
  - O agente só aceita conexões do próprio PC, vindas do site, com o código de pareamento.
  - Ninguém joga sem o host aprovar.
  - A tecla Windows é sempre bloqueada.
  - **Ctrl+Shift+X** corta o controle de todo mundo na hora.
- **Limites:**
  - Jogos com anti-cheat (Valorant, CS2, Fortnite…) podem bloquear ou punir input simulado. Use em jogos coop/single-player.
  - Se o jogo roda como Administrador, rode o agente como Administrador também.
  - O atraso é o da transmissão (normalmente 50–150 ms).

### Extras de call para gamers
- **Push-to-talk** (tecla ou botão lateral do mouse), **soundboard** com sons prontos e os seus (todo mundo na call ouve), **ping** de cada pessoa na lista da call, e **gravar clipe** de qualquer bloco (botão direito → Gravar).

### Chat
- Mensagens em tempo real, respostas, reações, editar/apagar, "digitando…", **negrito**, *itálico*, `código`, ||spoiler||, links.
- Emojis, imagens, vídeos, áudios e arquivos (arrastar e soltar ou colar com Ctrl+V).
- **Figurinhas e GIFs**, com coleção pessoal de cada conta (dá pra salvar as que a outra pessoa mandou).
- **Estúdio ✨:**
  - *Figurinha:* foto da webcam, imagem do PC, textos com fontes de meme, emojis, pincel/borracha, moldura (círculo, arredondado, coração) e contorno branco estilo WhatsApp.
  - *GIF:* grave a webcam (com contagem 3-2-1), um pedaço da tela, recorte um trecho de vídeo do PC ou junte várias fotos. Corte início/fim, velocidade, bumerangue/reverso, filtros e legenda em cima/embaixo.

### Contas e grupos
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
public/
  js/main.js          login, grupos e navegação
  js/chat.js          chat, emojis, figurinhas
  js/creator.js       estúdio de figurinhas e GIFs
  js/settings-ui.js   configurações e edição de perfil
  js/profile.js       cartão de perfil
  js/games.js         aba Jogos (minijogos + catálogo)
  js/tetris.js        Tetris Royale: motor, estilos e interface
  js/call/            chamada: rtc (conexões), media (mic/câmera/telas), audio (volumes),
                      stage (blocos redimensionáveis), call (controles e menus),
                      coop (Modo Jogo Coop), sounds (soundboard)
agent/kenfeh-agent.ps1  agente Windows do Modo Coop (SendInput + controle virtual ViGEm)
data/                 banco e uploads (criado na hora, fora do git)
```
