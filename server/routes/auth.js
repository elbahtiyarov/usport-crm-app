const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { hashPassword, verifyPassword } = require('../passwords');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

function isLoginAllowed(login){
  const raw = process.env.ALLOWED_EMAILS;
  if (!raw || !raw.trim()) return true; // список не задан — самостоятельная регистрация открыта всем
  const allowed = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(login.toLowerCase());
}

function isAdminLogin(login){
  const raw = process.env.ADMIN_EMAILS;
  if (!raw || !raw.trim()) return false;
  const admins = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(login.toLowerCase());
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

// POST /api/auth/login { login, password }
// Просто логин (любая строка) + пароль, без проверки формата почты.
//
// Если аккаунт с этим логином уже существует (создан админом в разделе
// «Пользователи», либо зарегистрирован раньше сам) — всегда можно войти,
// ALLOWED_EMAILS тут ни при чём, он проверяется, только если пользователя
// с таким логином ещё нет в базе: пароль в таком случае просто
// запоминается как новый — это и есть самостоятельная регистрация.
router.post('/login', async (req, res) => {
  const login = String(req.body.login ?? req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (login.length < 2 || login.length > 190) {
    return res.status(400).json({ error: 'Логин должен быть от 2 до 190 символов' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [login]);
    let user = rows[0];
    const shouldBeAdmin = isAdminLogin(login);

    if (!user) {
      if (!isLoginAllowed(login)) {
        return res.status(403).json({ error: 'У этого логина нет доступа к системе. Обратитесь к администратору.' });
      }
      // Первый вход с этим логином — заводим аккаунт и запоминаем пароль.
      const inserted = await pool.query(
        `INSERT INTO users (email, role, password_hash, last_login_at) VALUES ($1,$2,$3, now()) RETURNING *`,
        [login, shouldBeAdmin ? 'admin' : 'manager', hashPassword(password)]
      );
      user = inserted.rows[0];
    } else if (!user.password_hash) {
      // Аккаунт существует (например, создан админом или с прошлой версии
      // входа по коду), но пароль ещё не задан — принимаем текущий как новый.
      const newRole = shouldBeAdmin && user.role !== 'admin' ? 'admin' : user.role;
      const updated = await pool.query(
        `UPDATE users SET password_hash=$2, role=$3, last_login_at=now() WHERE id=$1 RETURNING *`,
        [user.id, hashPassword(password), newRole]
      );
      user = updated.rows[0];
    } else {
      if (!verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }
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
    console.error('login error', err);
    res.status(500).json({ error: 'Не удалось выполнить вход' });
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
