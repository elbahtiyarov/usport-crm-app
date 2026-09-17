const express = require('express');
const router = express.Router();
const pool = require('../db');

function mapOrder(r) {
  return {
    id: String(r.id),
    clientId: r.client_id != null ? String(r.client_id) : null,
    clientName: r.client_name || '',
    stage: r.stage,
    amount: Number(r.amount),
    items: Array.isArray(r.items) ? r.items : [],
    createdAt: new Date(r.created_at).getTime()
  };
}

const LIST_QUERY = `
  SELECT o.*, COALESCE(
    json_agg(
      json_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.name, 'qty', oi.qty, 'price', oi.price)
      ORDER BY oi.id
    ) FILTER (WHERE oi.id IS NOT NULL), '[]'
  ) AS items
  FROM orders o
  LEFT JOIN order_items oi ON oi.order_id = o.id
`;

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${LIST_QUERY} GROUP BY o.id ORDER BY o.created_at DESC`);
    res.json(rows.map(mapOrder));
  } catch (e) { next(e); }
});

async function insertItems(client, orderId, items) {
  for (const it of items) {
    if (!it.name || !String(it.name).trim()) continue;
    await client.query(
      `INSERT INTO order_items (order_id, sku, name, qty, price) VALUES ($1,$2,$3,$4,$5)`,
      [orderId, it.sku || null, it.name, Number(it.qty) || 0, Number(it.price) || 0]
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
      `INSERT INTO orders (client_id, client_name, stage, amount) VALUES ($1,$2,$3,$4) RETURNING *`,
      [clientId || null, clientName || null, stage || 'request', amount]
    );
    await insertItems(client, rows[0].id, items);
    await client.query('COMMIT');
    const { rows: full } = await pool.query(`${LIST_QUERY} WHERE o.id=$1 GROUP BY o.id`, [rows[0].id]);
    res.json(mapOrder(full[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res, next) => {
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
    const { rows: full } = await pool.query(`${LIST_QUERY} WHERE o.id=$1 GROUP BY o.id`, [req.params.id]);
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
    const { stage } = req.body;
    const { rows } = await pool.query(`UPDATE orders SET stage=$1 WHERE id=$2 RETURNING *`, [stage, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Заказ не найден' });
    const { rows: full } = await pool.query(`${LIST_QUERY} WHERE o.id=$1 GROUP BY o.id`, [req.params.id]);
    res.json(mapOrder(full[0]));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM orders WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
