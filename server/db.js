require('dotenv').config();
const { Pool } = require('pg');

// Некоторым облачным Postgres (в т.ч. иногда при подключении к Railway
// снаружи их внутренней сети) нужен SSL. Внутри одного Railway-проекта
// обычно не требуется — включайте через DATABASE_SSL=true при ошибках
// вида "self signed certificate" / "SSL required".
const useSsl = process.env.DATABASE_SSL === 'true' || /sslmode=require/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Неожиданная ошибка пула PostgreSQL', err);
});

module.exports = pool;
