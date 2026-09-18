const express = require('express');
const router = express.Router();
const pool = require('../db');
const { assertOwnership } = require('../ownership');

function toDateStr(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }

function mapDocument(r) {
  return {
    id: String(r.id),
    docType: r.doc_type,
    clientId: r.client_id != null ? String(r.client_id) : null,
    clientName: r.client_name || '',
    orderId: r.order_id != null ? String(r.order_id) : null,
    amount: Number(r.amount),
    status: r.status,
    notes: r.notes || '',
    validUntil: toDateStr(r.valid_until),
    dueDate: toDateStr(r.due_date),
    shipDate: toDateStr(r.ship_date),
    signDate: toDateStr(r.sign_date),
    items: Array.isArray(r.items) ? r.items : [],
    createdAt: new Date(r.created_at).getTime(),
    createdBy: r.created_by != null ? String(r.created_by) : null,
    createdByEmail: r.created_by_email || null
  };
}

const LIST_QUERY = `
  SELECT d.*, u.email AS created_by_email, COALESCE(
    json_agg(
      json_build_object('id', di.id, 'sku', di.sku, 'name', di.name, 'qty', di.qty, 'price', di.price, 'photoUrl', di.photo_url)
      ORDER BY di.id
    ) FILTER (WHERE di.id IS NOT NULL), '[]'
  ) AS items
  FROM documents d
  LEFT JOIN document_items di ON di.document_id = d.id
  LEFT JOIN users u ON u.id = d.created_by
`;
const GROUP_BY = 'GROUP BY d.id, u.email';

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${LIST_QUERY} ${GROUP_BY} ORDER BY d.created_at DESC`);
    res.json(rows.map(mapDocument));
  } catch (e) { next(e); }
});

async function insertItems(client, documentId, items) {
  for (const it of items) {
    if (!it.name || !String(it.name).trim()) continue;
    await client.query(
      `INSERT INTO document_items (document_id, sku, name, qty, price, photo_url) VALUES ($1,$2,$3,$4,$5,$6)`,
      [documentId, it.sku || null, it.name, Number(it.qty) || 0, Number(it.price) || 0, it.photoUrl || null]
    );
  }
}

router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { docType, clientId, clientName, orderId, items = [], notes, status, validUntil, dueDate, shipDate, signDate } = req.body;
    const amount = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO documents (doc_type, client_id, client_name, order_id, amount, status, notes, valid_until, due_date, ship_date, sign_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [docType, clientId || null, clientName || null, orderId || null, amount, status || 'draft', notes || null,
       validUntil || null, dueDate || null, shipDate || null, signDate || null, req.userId]
    );
    await insertItems(client, rows[0].id, items);
    await client.query('COMMIT');
    const { rows: full } = await pool.query(`${LIST_QUERY} WHERE d.id=$1 ${GROUP_BY}`, [rows[0].id]);
    res.json(mapDocument(full[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res, next) => {
  const denial = await assertOwnership(pool, 'documents', req.params.id, req);
  if (denial) return res.status(denial.status).json({ error: denial.error });

  const client = await pool.connect();
  try {
    const { docType, clientId, clientName, orderId, items = [], notes, status, validUntil, dueDate, shipDate, signDate } = req.body;
    const amount = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE documents SET doc_type=$1, client_id=$2, client_name=$3, order_id=$4, amount=$5, status=$6, notes=$7,
        valid_until=$8, due_date=$9, ship_date=$10, sign_date=$11 WHERE id=$12 RETURNING *`,
      [docType, clientId || null, clientName || null, orderId || null, amount, status || 'draft', notes || null,
       validUntil || null, dueDate || null, shipDate || null, signDate || null, req.params.id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Документ не найден' }); }
    await client.query('DELETE FROM document_items WHERE document_id=$1', [req.params.id]);
    await insertItems(client, req.params.id, items);
    await client.query('COMMIT');
    const { rows: full } = await pool.query(`${LIST_QUERY} WHERE d.id=$1 ${GROUP_BY}`, [req.params.id]);
    res.json(mapDocument(full[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

// Быстрое обновление только статуса (используется select'ом в таблице)
router.patch('/:id/status', async (req, res, next) => {
  try {
    const denial = await assertOwnership(pool, 'documents', req.params.id, req);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    const { status } = req.body;
    const { rows } = await pool.query(`UPDATE documents SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Документ не найден' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const denial = await assertOwnership(pool, 'documents', req.params.id, req);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    await pool.query('DELETE FROM documents WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
