const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { sendLoginCode } = require('../mailer');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 45;
const MAX_ATTEMPTS = 5;

function hashCode(code){
  return crypto.createHash('sha256').update(code).digest('hex');
}

function isEmailAllowed(email){
  const raw = process.env.ALLOWED_EMAILS;
  if (!raw || !raw.trim()) return true; // список не задан — доступ открыт всем (см. .env.example)
  const allowed = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

function isAdminEmail(email){
  const raw = process.env.ADMIN_EMAILS;
  if (!raw || !raw.trim()) return false;
  const admins = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

function issueSessionCookie(res, user){
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

// POST /api/auth/request-code { email }
router.post('/request-code', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Некорректный email' });
  }
  if (!isEmailAllowed(email)) {
    return res.status(403).json({ error: 'У этого email нет доступа к системе. Обратитесь к администратору.' });
  }

  try {
    const recent = await pool.query(
      `SELECT created_at FROM auth_codes WHERE email=$1 ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    if (recent.rows[0]) {
      const secondsSince = (Date.now() - new Date(recent.rows[0].created_at).getTime()) / 1000;
      if (secondsSince < RESEND_COOLDOWN_SECONDS) {
        return res.status(429).json({ error: `Подождите ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSince)} секунд перед повторной отправкой` });
      }
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    await pool.query(
      `INSERT INTO auth_codes (email, code_hash, expires_at) VALUES ($1,$2,$3)`,
      [email, codeHash, expiresAt]
    );

    const result = await sendLoginCode(email, code);
    // devCode отдаём только если реальная отправка не настроена (локальная разработка без SMTP)
    res.json({ ok: true, devCode: result.sent ? undefined : result.devCode });
  } catch (err) {
    console.error('request-code error', err);
    res.status(500).json({ error: 'Не удалось отправить код' });
  }
});

// POST /api/auth/verify-code { email, code }
router.post('/verify-code', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!email || !code) return res.status(400).json({ error: 'Укажите email и код' });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM auth_codes WHERE email=$1 AND used=false ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    const record = rows[0];
    if (!record) return res.status(400).json({ error: 'Код не найден. Запросите новый.' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
    if (record.attempts >= MAX_ATTEMPTS) return res.status(400).json({ error: 'Слишком много попыток. Запросите новый код.' });

    if (hashCode(code) !== record.code_hash) {
      await pool.query(`UPDATE auth_codes SET attempts = attempts + 1 WHERE id=$1`, [record.id]);
      return res.status(400).json({ error: 'Неверный код' });
    }

    await pool.query(`UPDATE auth_codes SET used=true WHERE id=$1`, [record.id]);

    let { rows: userRows } = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
    let user = userRows[0];
    const shouldBeAdmin = isAdminEmail(email);
    if (!user) {
      const inserted = await pool.query(
        `INSERT INTO users (email, role, last_login_at) VALUES ($1, $2, now()) RETURNING *`,
        [email, shouldBeAdmin ? 'admin' : 'manager']
      );
      user = inserted.rows[0];
    } else {
      // Повышаем до admin, если email добавили в ADMIN_EMAILS — понижение
      // делается вручную в базе, чтобы случайно никого не разжаловать.
      const newRole = shouldBeAdmin && user.role !== 'admin' ? 'admin' : user.role;
      const updated = await pool.query(
        `UPDATE users SET last_login_at = now(), role = $2 WHERE id = $1 RETURNING *`,
        [user.id, newRole]
      );
      user = updated.rows[0];
    }

    issueSessionCookie(res, user);
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('verify-code error', err);
    res.status(500).json({ error: 'Не удалось проверить код' });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const token = req.cookies && req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(`SELECT id, email, name, role FROM users WHERE id=$1`, [payload.sub]);
    if (!rows[0]) return res.status(401).json({ error: 'Не авторизован' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(401).json({ error: 'Не авторизован' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

module.exports = router;
module.exports.JWT_SECRET = JWT_SECRET;
