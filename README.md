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
  routes.js   API REST: contas, grupos, mensagens, uploads, figurinhas
  hub.js      tempo real: presença, chat e sinalização WebRTC
public/
  js/main.js          login, grupos e navegação
  js/chat.js          chat, emojis, figurinhas
  js/creator.js       estúdio de figurinhas e GIFs
  js/settings-ui.js   configurações
  js/call/            chamada: rtc (conexões), media (mic/câmera/telas), audio (volumes),
                      stage (blocos redimensionáveis), call (controles e menus)
data/                 banco e uploads (criado na hora, fora do git)
```
