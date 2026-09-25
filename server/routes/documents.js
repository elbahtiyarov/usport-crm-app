const express = require('express');
const router = express.Router();
const pool = require('../db');
const { assertOwnership } = require('../ownership');
const { generateDocumentPdf } = require('../pdf');

const VAT_RATE = 16; // стандартная ставка НДС в Казахстане с 1 января 2026

function toDateStr(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }

function computeAmount(items, vatIncluded) {
  const base = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  return vatIncluded ? Math.round(base * (1 + VAT_RATE / 100) * 100) / 100 : base;
}

function mapDocument(r) {
  const amount = Number(r.amount);
  const vatIncluded = !!r.vat_included;
  const baseAmount = vatIncluded ? Math.round((amount / (1 + VAT_RATE / 100)) * 100) / 100 : amount;
  return {
    id: String(r.id),
    docNumber: r.doc_number != null ? Number(r.doc_number) : null,
    docType: r.doc_type,
    clientId: r.client_id != null ? String(r.client_id) : null,
    clientName: r.client_name || '',
    orderId: r.order_id != null ? String(r.order_id) : null,
    amount,
    vatIncluded,
    vatRate: VAT_RATE,
    baseAmount,
    vatAmount: vatIncluded ? Math.round((amount - baseAmount) * 100) / 100 : 0,
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

// doc_number — порядковый номер ВНУТРИ своего типа документа (КП №1, №2...
// Счёт №1, №2... отдельно), а не сквозной ID. Считается через CTE по ВСЕЙ
// таблице до любой фильтрации — иначе при выборке одного документа
// (WHERE d.id=$1) номер всегда получался бы "1".
const LIST_QUERY = `
  WITH doc_numbers AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY doc_type ORDER BY created_at) AS doc_number
    FROM documents
  )
  SELECT d.*, u.email AS created_by_email, dn.doc_number, COALESCE(
    json_agg(
      json_build_object('id', di.id, 'sku', di.sku, 'name', di.name, 'qty', di.qty, 'price', di.price, 'photoUrl', di.photo_url, 'weight', di.weight, 'volume', di.volume, 'dealerPrice', di.dealer_price, 'wholesalePrice', di.wholesale_price, 'priceWithVat', di.price_with_vat)
      ORDER BY di.id
    ) FILTER (WHERE di.id IS NOT NULL), '[]'
  ) AS items
  FROM documents d
  LEFT JOIN document_items di ON di.document_id = d.id
  LEFT JOIN users u ON u.id = d.created_by
  LEFT JOIN doc_numbers dn ON dn.id = d.id
`;
const GROUP_BY = 'GROUP BY d.id, u.email, dn.doc_number';

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
      `INSERT INTO document_items (document_id, sku, name, qty, price, photo_url, weight, volume, dealer_price, wholesale_price, price_with_vat) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [documentId, it.sku || null, it.name, Number(it.qty) || 0, Number(it.price) || 0, it.photoUrl || null, it.weight || null, it.volume || null, it.dealerPrice || null, it.wholesalePrice || null, it.priceWithVat || null]
    );
  }
}

router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { docType, clientId, clientName, orderId, items = [], notes, status, validUntil, dueDate, shipDate, signDate, vatIncluded } = req.body;
    const amount = computeAmount(items, !!vatIncluded);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO documents (doc_type, client_id, client_name, order_id, amount, vat_included, status, notes, valid_until, due_date, ship_date, sign_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [docType, clientId || null, clientName || null, orderId || null, amount, !!vatIncluded, status || 'draft', notes || null,
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
    const { docType, clientId, clientName, orderId, items = [], notes, status, validUntil, dueDate, shipDate, signDate, vatIncluded } = req.body;
    const amount = computeAmount(items, !!vatIncluded);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE documents SET doc_type=$1, client_id=$2, client_name=$3, order_id=$4, amount=$5, vat_included=$13, status=$6, notes=$7,
        valid_until=$8, due_date=$9, ship_date=$10, sign_date=$11 WHERE id=$12 RETURNING *`,
      [docType, clientId || null, clientName || null, orderId || null, amount, status || 'draft', notes || null,
       validUntil || null, dueDate || null, shipDate || null, signDate || null, req.params.id, !!vatIncluded]
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

// GET /api/documents/:id/pdf — скачать документ в PDF (без диалога печати).
// Доступно всем, кто вошёл — как и печать, это не редактирование документа.
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${LIST_QUERY} WHERE d.id=$1 ${GROUP_BY}`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Документ не найден' });
    const doc = mapDocument(rows[0]);

    let client = null;
    if (doc.clientId) {
      const { rows: clientRows } = await pool.query('SELECT requisites FROM clients WHERE id=$1', [doc.clientId]);
      client = clientRows[0] || null;
    }

    const { rows: settingsRows } = await pool.query('SELECT * FROM settings WHERE id=1');
    const s = settingsRows[0] || {};
    const settings = {
      name: s.name || 'USPORT',
      legalAddress: s.legal_address || '',
      phone: s.phone || '',
      email: s.email || '',
      directorName: s.director_name || '',
      licenseNumber: s.license_number || '',
      requisites: s.requisites || '',
      logoUrl: s.logo_url || ''
    };

    const buffer = await generateDocumentPdf({ doc, client, settings });
    const filename = `${doc.docType}-${doc.docNumber || doc.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
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
