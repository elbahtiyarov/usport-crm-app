const express = require('express');
const router = express.Router();
const pool = require('../db');

function mapCategory(r) {
  return {
    id: String(r.id),
    name: r.name,
    createdAt: new Date(r.created_at).getTime(),
    createdByEmail: r.created_by_email || null
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.email AS created_by_email FROM categories c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.name ASC`
    );
    res.json(rows.map(mapCategory));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Укажите название категории' });
    const { rows: existing } = await pool.query('SELECT id FROM categories WHERE lower(name)=lower($1)', [name]);
    if (existing[0]) return res.status(409).json({ error: 'Такая категория уже есть' });

    const { rows } = await pool.query(
      `INSERT INTO categories (name, created_by) VALUES ($1,$2) RETURNING *`,
      [name, req.userId]
    );
    res.json(mapCategory({ ...rows[0], created_by_email: req.userEmail }));
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Укажите название категории' });
    const { rows: existing } = await pool.query('SELECT id FROM categories WHERE lower(name)=lower($1) AND id<>$2', [name, req.params.id]);
    if (existing[0]) return res.status(409).json({ error: 'Такая категория уже есть' });

    const { rows } = await pool.query(`UPDATE categories SET name=$1 WHERE id=$2 RETURNING *`, [name, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Категория не найдена' });
    const { rows: full } = await pool.query(
      `SELECT c.*, u.email AS created_by_email FROM categories c LEFT JOIN users u ON u.id = c.created_by WHERE c.id=$1`,
      [req.params.id]
    );
    res.json(mapCategory(full[0]));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM categories WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
