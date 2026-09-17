const express = require('express');
const router = express.Router();
const pool = require('../db');

function mapClient(r) {
  return {
    id: String(r.id),
    name: r.name,
    phone: r.phone || '',
    source: r.source || '',
    requisites: r.requisites || '',
    notes: r.notes || '',
    createdAt: new Date(r.created_at).getTime()
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    res.json(rows.map(mapClient));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, phone, source, requisites, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Укажите имя клиента' });
    const { rows } = await pool.query(
      `INSERT INTO clients (name, phone, source, requisites, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, phone || null, source || null, requisites || null, notes || null]
    );
    res.json(mapClient(rows[0]));
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, phone, source, requisites, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE clients SET name=$1, phone=$2, source=$3, requisites=$4, notes=$5 WHERE id=$6 RETURNING *`,
      [name, phone || null, source || null, requisites || null, notes || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Клиент не найден' });
    res.json(mapClient(rows[0]));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
