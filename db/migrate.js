// Применяет backend/sql/schema.sql к базе, указанной в DATABASE_URL.
// Запуск: npm run migrate (из папки backend)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
