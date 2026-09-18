const express = require('express');
const router = express.Router();
const pool = require('../db');
const { assertOwnership } = require('../ownership');

function mapOrder(r) {
  return {
    id: String(r.id),
    clientId: r.client_id != null ? String(r.client_id) : null,
    clientName: r.client_name || '',
    stage: r.stage,
    amount: Number(r.amount),
    items: Array.isArray(r.items) ? r.items : [],
    createdAt: new Date(r.created_at).getTime(),
    createdBy: r.created_by != null ? String(r.created_by) : null,
    createdByEmail: r.created_by_email || null
  };
}

const LIST_QUERY = `
  SELECT o.*, u.email AS created_by_email, COALESCE(
    json_agg(
      json_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.name, 'qty', oi.qty, 'price', oi.price, 'photoUrl', oi.photo_url)
      ORDER BY oi.id
    ) FILTER (WHERE oi.id IS NOT NULL), '[]'
  ) AS items
  FROM orders o
  LEFT JOIN order_items oi ON oi.order_id = o.id
  LEFT JOIN users u ON u.id = o.created_by
`;
const GROUP_BY = 'GROUP BY o.id, u.email';

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${LIST_QUERY} ${GROUP_BY} ORDER BY o.created_at DESC`);
    res.json(rows.map(mapOrder));
  } catch (e) { next(e); }
});

async function insertItems(client, orderId, items) {
  for (const it of items) {
    if (!it.name || !String(it.name).trim()) continue;
    await client.query(
      `INSERT INTO order_items (order_id, sku, name, qty, price, photo_url) VALUES ($1,$2,$3,$4,$5,$6)`,
      [orderId, it.sku || null, it.name, Number(it.qty) || 0, Number(it.price) || 0, it.photoUrl || null]
    );
  }
}

router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { clientId, clientName, items = [], stage } = req.body;
    const amount = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO orders (client_id, client_name, stage, amount, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [clientId || null, clientName || null, stage || 'request', amount, req.userId]
    );
    await insertItems(client, rows[0].id, items);
    await client.query('COMMIT');
    const { rows: full } = await pool.query(`${LIST_QUERY} WHERE o.id=$1 ${GROUP_BY}`, [rows[0].id]);
    res.json(mapOrder(full[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res, next) => {
  const denial = await assertOwnership(pool, 'orders', req.params.id, req);
  if (denial) return res.status(denial.status).json({ error: denial.error });

  const client = await pool.connect();
  try {
    const { clientId, clientName, items = [], stage } = req.body;
    const amount = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE orders SET client_id=$1, client_name=$2, stage=$3, amount=$4 WHERE id=$5 RETURNING *`,
      [clientId || null, clientName || null, stage || 'request', amount, req.params.id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Заказ не найден' }); }
    await client.query('DELETE FROM order_items WHERE order_id=$1', [req.params.id]);
    await insertItems(client, req.params.id, items);
    await client.query('COMMIT');
    const { rows: full } = await pool.query(`${LIST_QUERY} WHERE o.id=$1 ${GROUP_BY}`, [req.params.id]);
    res.json(mapOrder(full[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

// Быстрое обновление только этапа (используется кнопками ‹ › на карточке)
router.patch('/:id/stage', async (req, res, next) => {
  try {
    const denial = await assertOwnership(pool, 'orders', req.params.id, req);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    const { stage } = req.body;
    const { rows } = await pool.query(`UPDATE orders SET stage=$1 WHERE id=$2 RETURNING *`, [stage, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Заказ не найден' });
    const { rows: full } = await pool.query(`${LIST_QUERY} WHERE o.id=$1 ${GROUP_BY}`, [req.params.id]);
    res.json(mapOrder(full[0]));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const denial = await assertOwnership(pool, 'orders', req.params.id, req);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    await pool.query('DELETE FROM orders WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
