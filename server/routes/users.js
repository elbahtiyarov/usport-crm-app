const express = require('express');
const router = express.Router();
const pool = require('../db');
const { hashPassword } = require('../passwords');

const ROLES = ['manager', 'admin'];

function mapUser(r) {
  return {
    id: String(r.id),
    login: r.email,
    role: r.role,
    createdAt: new Date(r.created_at).getTime(),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).getTime() : null
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, email, role, created_at, last_login_at FROM users ORDER BY created_at DESC');
    res.json(rows.map(mapUser));
  } catch (e) { next(e); }
});

// POST / { login, password, role } — админ сам заводит логин и пароль
// для нового человека; тому не нужно ничего "регистрировать" самому.
router.post('/', async (req, res, next) => {
  try {
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = ROLES.includes(req.body.role) ? req.body.role : 'manager';

    if (login.length < 2 || login.length > 190) return res.status(400).json({ error: 'Логин должен быть от 2 до 190 символов' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email=$1', [login]);
    if (existing[0]) return res.status(409).json({ error: 'Пользователь с таким логином уже есть' });

    const { rows } = await pool.query(
      `INSERT INTO users (email, role, password_hash) VALUES ($1,$2,$3) RETURNING id, email, role, created_at, last_login_at`,
      [login, role, hashPassword(password)]
    );
    res.json(mapUser(rows[0]));
  } catch (e) { next(e); }
});

// PUT /:id { role?, password? } — сменить роль и/или сбросить пароль
router.put('/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Пользователь не найден' });

    const role = ROLES.includes(req.body.role) ? req.body.role : existing[0].role;
    if (String(req.params.id) === String(req.userId) && role !== 'admin') {
      return res.status(400).json({ error: 'Нельзя понизить самого себя — попросите другого администратора' });
    }

    let passwordHash = existing[0].password_hash;
    if (req.body.password) {
      const password = String(req.body.password);
      if (password.length < 4) return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });
      passwordHash = hashPassword(password);
    }

    const { rows } = await pool.query(
      `UPDATE users SET role=$1, password_hash=$2 WHERE id=$3 RETURNING id, email, role, created_at, last_login_at`,
      [role, passwordHash, req.params.id]
    );
    res.json(mapUser(rows[0]));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (String(req.params.id) === String(req.userId)) {
      return res.status(400).json({ error: 'Нельзя удалить самого себя' });
    }
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
