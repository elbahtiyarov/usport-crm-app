// Применяет db/schema.sql к базе, указанной в DATABASE_URL.
// Запуск: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../server/db');

async function main() {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    console.log('Применяю схему из', sqlPath, '...');
    await pool.query(sql);
    console.log('Готово: схема базы данных применена.');
  } catch (err) {
    console.error('Ошибка при применении схемы:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
