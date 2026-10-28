// Kenfeh — servidor principal (HTTP/HTTPS + API + Socket.IO)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const express = require('express');
const { Server } = require('socket.io');
const { DB_PATH, DATA_DIR, UPLOAD_DIR } = require('./db');
const auth = require('./auth');
const { buildRouter } = require('./routes');
const { createHub } = require('./hub');
const { attachGames } = require('./games');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// "versão" do site = hash de todos os arquivos públicos (muda a cada atualização)
function buildHash() {
  const h = require('node:crypto').createHash('sha1');
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else h.update(f.name).update(fs.readFileSync(p));
    }
  };
  walk(PUBLIC_DIR);
  h.update(fs.readFileSync(path.join(__dirname, 'tetris-skins.js')));
  return h.digest('hex').slice(0, 10);
}
const BUILD = buildHash();
const USE_HTTPS = process.argv.includes('--https') || process.env.HTTPS === '1';

async function loadCertificate() {
  if (process.env.SSL_KEY && process.env.SSL_CERT) {
    return { key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT) };
  }
  // Certificado autoassinado para uso na rede local (o navegador vai pedir para aceitar uma vez)
  const dir = path.join(DATA_DIR, 'cert');
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  if (!fs.existsSync(keyPath)) {
    const selfsigned = require('selfsigned');
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'kennyfe.local' }], {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + 5 * 365 * 86400e3),
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
  }
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

async function main() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), picture-in-picture=(self)');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  const server = USE_HTTPS ? https.createServer(await loadCertificate(), app) : http.createServer(app);
  // pingTimeout maior: celular com o app em segundo plano congela a página por alguns segundos
  const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 25000, pingTimeout: 60000 });
  const hub = createHub(io);
  const games = attachGames(io, hub);
  const { COMMANDS } = require('./commands').attachCommands(io, hub, { createGame: games.createGame });

  app.get('/api/commands', auth.requireAuth, (_req, res) => res.json({ commands: COMMANDS }));
  app.use('/api', buildRouter(io, hub));

  // Arquivos enviados só para quem está logado
  app.use('/uploads', auth.requireAuth, express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
  // App do Modo Coop (Windows): um .exe só, com o controle virtual embutido
  app.get('/download/KenfehCoop.exe', (req, res) => {
    const u = auth.userFromToken(auth.tokenFromReq(req));
    if (u) require('./stats').track(u.id, 'coop_download');
    res.setHeader('Content-Disposition', 'attachment; filename="KenfehCoop.exe"');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '..', 'agent', 'dist', 'KenfehCoop.exe'));
  });
  const skinsJs = (_req, res) => res.type('application/javascript').send(`export const TETRIS_SKINS = ${JSON.stringify(require('./tetris-skins').TETRIS_SKINS)};`);
  app.get('/js/tetris-skins.js', skinsJs);
  app.get('/vendor/gifenc.js', (_req, res) => res.sendFile(require.resolve('gifenc/dist/gifenc.esm.js')));
  // Arquivos do site versionados: a cada atualização o endereço muda (/v/<hash>/...),
  // então nem o navegador nem a Cloudflare conseguem servir JavaScript velho.
  const versioned = express.Router();
  versioned.get('/js/tetris-skins.js', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    skinsJs(req, res);
  });
  versioned.use(express.static(PUBLIC_DIR, { maxAge: '365d', immutable: true, index: false }));
  app.use('/v/:build', versioned);
  const html = fs
    .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replace('href="/css/app.css"', `href="/v/${BUILD}/css/app.css"`)
    .replace('src="/js/main.js"', `src="/v/${BUILD}/js/main.js"`)
    .replaceAll('"/img/', `"/v/${BUILD}/img/`); // imagens também mudam de endereço a cada versão (a Cloudflare guardava o logo antigo)
  const sendIndex = (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  };
  app.get(['/', '/index.html'], sendIndex);
  // página pública de download do Kenfeh Coop
  const coopHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'coop.html'), 'utf8').replaceAll('"/img/', `"/v/${BUILD}/img/`);
  app.get(['/coop', '/coop/'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(coopHtml);
  });
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: 0 }));
  app.get('*', sendIndex);

  server.listen(PORT, '0.0.0.0', () => {
    const proto = USE_HTTPS ? 'https' : 'http';
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => `${proto}://${i.address}:${PORT}`);
    console.log(`\n  ⚡ Kenfeh rodando!`);
    console.log(`  ➜ Local:   ${proto}://localhost:${PORT}`);
    lan.forEach((u) => console.log(`  ➜ Rede:    ${u}${USE_HTTPS ? '' : '  (câmera/tela exigem HTTPS fora do localhost — use npm run https)'}`));
    console.log(`  ➜ Banco:   ${DB_PATH}\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
