# 🌐 Colocando o Kenfeh no ar em kenfeh.shop (rodando no seu notebook)

Usamos um **Cloudflare Tunnel** (grátis):
- não precisa abrir porta no roteador;
- funciona mesmo se a sua internet não tiver IP público (CGNAT);
- o HTTPS vem pronto, e sem HTTPS câmera, microfone e tela não funcionam;
- o seu IP fica escondido.

O vídeo e o áudio das calls vão **direto entre as pessoas**, sem passar pelo notebook. O notebook só carrega o site, o chat e os arquivos.

```
navegador ──https──> Cloudflare ──túnel──> seu notebook (localhost:3000)
navegador <══════ vídeo/áudio direto (WebRTC) ══════> navegador
```

---

## 1. Preparar o notebook

Na pasta do projeto (PowerShell):

```powershell
git pull
npm install
copy .env.example .env
npm start
```

Abra `http://localhost:3000` e veja se o site carrega. Depois feche com `Ctrl + C`.

## 2. Passar o domínio para a Cloudflare

1. Crie uma conta grátis em **https://dash.cloudflare.com**.
2. Clique em **Adicionar um domínio** (Add a domain), digite `kenfeh.shop` e escolha o plano **Free**.
3. A Cloudflare importa os registros DNS da GoDaddy. **Apague o registro `A` do `@` que aponta pro "Parked"** (estacionamento da GoDaddy), se ele aparecer.
4. A Cloudflare mostra **2 servidores de nomes**, parecidos com `ana.ns.cloudflare.com` e `bob.ns.cloudflare.com`. Copie os dois.
5. Na GoDaddy (a tela do seu print): **Domínio → DNS → aba "Servidores de nomes" → Alterar servidores de nomes → "Usarei meus próprios servidores de nomes"**, cole os dois da Cloudflare e salve.
6. Espere a Cloudflare avisar que o domínio está **Ativo** (de alguns minutos até algumas horas; chega um e-mail).

## 3. Criar o túnel

1. Instale o `cloudflared` no notebook (PowerShell):
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
2. No painel da Cloudflare: **Zero Trust → Redes (Networks) → Tunnels → Criar túnel**.
   - Tipo: **Cloudflared**. Nome: `kenfeh`.
   - Ambiente: **Windows**. Ele mostra um comando `cloudflared.exe service install eyJ...`.
   - Abra o **PowerShell como Administrador** e cole esse comando. Isso instala o túnel como serviço do Windows, que liga sozinho junto com o PC.
3. Na etapa **Nomes de host públicos (Public Hostnames)**:
   - Subdomínio: *(vazio)*. Domínio: `kenfeh.shop`.
   - Tipo: **HTTP**. URL: `localhost:3000`.
   - Salve. Se quiser, adicione outro com subdomínio `www`, apontando pro mesmo lugar.

## 4. Ligar o servidor

Dê dois cliques em **`iniciar-kenfeh.bat`**. Ele instala as dependências se faltar e reinicia sozinho se o servidor cair.

Pronto: abra **https://kenfeh.shop** 🎉

## 5. (Recomendado) TURN grátis da Cloudflare

Algumas redes, como 4G, Wi-Fi de faculdade ou certas operadoras, bloqueiam a conexão direta das calls. O TURN resolve isso.

1. Painel da Cloudflare → **Realtime** (ou "Calls") → **TURN Server → Create**.
2. Copie o **Turn Token ID** e o **API Token** para o seu `.env`:
   ```
   CF_TURN_KEY_ID=coloque_aqui
   CF_TURN_API_TOKEN=coloque_aqui
   ```
3. Feche e abra o `iniciar-kenfeh.bat` de novo.

A cota grátis é de 1 TB por mês, e o TURN só é usado quando a conexão direta falha.

## 6. Deixar sempre ligado

- **Ligar junto com o Windows:**
  1. Aperte `Win + R`, digite `shell:startup` e dê Enter.
  2. Crie ali um **atalho** para o `iniciar-kenfeh.bat`.
  3. O túnel já liga sozinho, porque é um serviço.
- **Não dormir:**
  - *Configurações → Sistema → Energia → Quando conectado, suspender após: **Nunca***.
  - Se for usar com a tampa fechada: *Painel de Controle → Opções de energia → Escolher a função ao fechar a tampa → Na tomada: **Não fazer nada***.
- Deixe o notebook na tomada e, de preferência, no cabo de rede.

## 7. Controlar quem cria conta (opcional)

O site fica aberto na internet. Para só quem você convidar conseguir se cadastrar, coloque um código no `.env`:

```
REGISTER_CODE=qualquer-codigo-secreto
```

A tela de cadastro passa a pedir esse código. Quem já tem conta continua entrando normal. O login também tem limite de tentativas contra quem tenta adivinhar senha.

## Atualizar o site

```powershell
git pull
npm install
```

Depois feche e abra o `iniciar-kenfeh.bat`.

## Backup

Tudo (contas, mensagens, figurinhas, uploads) fica na pasta **`data/`**. Copie essa pasta de vez em quando para um lugar seguro.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `kenfeh.shop` não abre | O domínio já está "Ativo" na Cloudflare? O `iniciar-kenfeh.bat` está aberto? O túnel aparece como **Healthy** no painel? |
| Erro 502 / "Bad gateway" | O túnel funciona, mas o servidor está desligado: abra o `iniciar-kenfeh.bat`. |
| Call fica conectando e não conecta | Configure o TURN (passo 5). |
| Netflix preta na transmissão | Desative "Usar aceleração de hardware" no Chrome/Edge de quem transmite. |
