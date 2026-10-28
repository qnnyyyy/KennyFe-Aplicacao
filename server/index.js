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
  const io = new Server(server, { maxHttpBufferSize: 1e6 });
  const hub = createHub(io);
  attachGames(io, hub);

  app.use('/api', buildRouter(io, hub));

  // Arquivos enviados só para quem está logado
  app.use('/uploads', auth.requireAuth, express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
  // Agente do Modo Coop (Windows): o .bat baixa o script e já libera este site
  app.get('/agent/kenfeh-agent.ps1', (_req, res) => res.type('text/plain').sendFile(path.join(__dirname, '..', 'agent', 'kenfeh-agent.ps1')));
  app.get('/agent/Kenfeh-Coop.bat', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`.replace(/[^\w:/.\-]/g, '');
    const bat = [
      '@echo off',
      'title Kenfeh Coop',
      'if not exist "%LOCALAPPDATA%\\Kenfeh" mkdir "%LOCALAPPDATA%\\Kenfeh"',
      `echo Baixando o agente de ${origin} ...`,
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '${origin}/agent/kenfeh-agent.ps1' -OutFile (Join-Path $env:LOCALAPPDATA 'Kenfeh\\kenfeh-agent.ps1')"`,
      `powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\\Kenfeh\\kenfeh-agent.ps1" -Origins "${origin}"`,
      'pause',
      '',
    ].join('\r\n');
    res.setHeader('Content-Disposition', 'attachment; filename="Kenfeh-Coop.bat"');
    res.type('application/octet-stream').send(bat);
  });
  app.get('/vendor/gifenc.js', (_req, res) => res.sendFile(require.resolve('gifenc/dist/gifenc.esm.js')));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

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
