const express = require('express');
const router = express.Router();
const pool = require('../db');
const { assertOwnership } = require('../ownership');

function mapClient(r) {
  return {
    id: String(r.id),
    name: r.name,
    phone: r.phone || '',
    source: r.source || '',
    requisites: r.requisites || '',
    notes: r.notes || '',
    createdAt: new Date(r.created_at).getTime(),
    createdBy: r.created_by != null ? String(r.created_by) : null,
    createdByEmail: r.created_by_email || null
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.email AS created_by_email FROM clients c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.created_at DESC`
    );
    res.json(rows.map(mapClient));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, phone, source, requisites, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Укажите имя клиента' });
    const { rows } = await pool.query(
      `INSERT INTO clients (name, phone, source, requisites, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, phone || null, source || null, requisites || null, notes || null, req.userId]
    );
    res.json(mapClient({ ...rows[0], created_by_email: req.userEmail }));
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const denial = await assertOwnership(pool, 'clients', req.params.id, req);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    const { name, phone, source, requisites, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE clients SET name=$1, phone=$2, source=$3, requisites=$4, notes=$5 WHERE id=$6 RETURNING *`,
      [name, phone || null, source || null, requisites || null, notes || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Клиент не найден' });
    const { rows: full } = await pool.query(
      `SELECT c.*, u.email AS created_by_email FROM clients c LEFT JOIN users u ON u.id = c.created_by WHERE c.id=$1`,
      [req.params.id]
    );
    res.json(mapClient(full[0]));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const denial = await assertOwnership(pool, 'clients', req.params.id, req);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
