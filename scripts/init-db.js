// Cria (ou migra) o banco de dados e mostra um resumo.
// Uso: npm run db:init
const { db, DB_PATH } = require('../server/db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log(`\n  💾 Banco pronto em ${DB_PATH}\n`);
for (const { name } of tables) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get();
  console.log(`  • ${name.padEnd(14)} ${n} registro(s)`);
}
console.log('');
