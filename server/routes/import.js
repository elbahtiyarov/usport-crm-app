const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const router = express.Router();
const pool = require('../db');
const { parseProducts, parseDocuments } = require('../importExcel');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function saveExtractedImage(buffer, extension){
  const ext = (extension || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return '/uploads/' + filename;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15 МБ
});

async function readWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

// POST /api/import/products — загрузить прайс-лист (.xlsx), обновит
// существующие товары по артикулу и добавит новые.
router.post('/products', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  try {
    const wb = await readWorkbook(req.file.buffer);
    const rows = parseProducts(wb);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Не нашёл в файле таблицу с колонками «Артикул» и «Наименование». Проверьте, что в файле есть прайс-лист.' });
    }

    const { rows: existing } = await pool.query('SELECT id, sku, name FROM products');
    const bySku = new Map(existing.filter(p => p.sku).map(p => [norm(p.sku), p]));
    const byName = new Map(existing.map(p => [norm(p.name), p]));

    let inserted = 0, updated = 0;
    for (const r of rows) {
      const match = (r.sku && bySku.get(norm(r.sku))) || (!r.sku && byName.get(norm(r.name)));
      if (match) {
        await pool.query(
          `UPDATE products SET sku=$1, name=$2, category=COALESCE(NULLIF($3,''), category), price=$4, specs=$5 WHERE id=$6`,
          [r.sku || match.sku || '', r.name, r.category, r.price, r.specs, match.id]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO products (sku, name, category, price, specs) VALUES ($1,$2,$3,$4,$5)`,
          [r.sku || null, r.name, r.category || null, r.price, r.specs || null]
        );
        inserted++;
      }
    }

    res.json({ ok: true, total: rows.length, inserted, updated });
  } catch (e) { next(e); }
});

function norm(s) { return String(s || '').trim().toLowerCase(); }

// POST /api/import/documents — загрузить файл с готовым КП (.xlsx),
// создаст черновик документа (тип КП) на каждое найденное предложение.
router.post('/documents', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  try {
    const wb = await readWorkbook(req.file.buffer);
    const docs = parseDocuments(wb);
    if (docs.length === 0) {
      return res.status(400).json({ error: 'Не нашёл в файле лист с «КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ» и таблицей позиций.' });
    }

    let created = 0;
    for (const d of docs) {
      const client = await pool.connect();
      try {
        const amount = d.items.reduce((s, it) => s + it.qty * it.price, 0);
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO documents (doc_type, client_id, client_name, amount, status, notes, valid_until, created_by)
           VALUES ('kp', NULL, $1, $2, 'draft', $3, $4, $5) RETURNING id`,
          [d.clientName, amount, d.notes, d.validUntil || null, req.userId]
        );
        for (const it of d.items) {
          let photoUrl = null;
          if (it.imageBuffer) {
            try { photoUrl = saveExtractedImage(it.imageBuffer, it.imageExtension); }
            catch (e) { console.error('Не удалось сохранить картинку позиции из Excel:', e.message); }
          }
          await client.query(
            `INSERT INTO document_items (document_id, sku, name, qty, price, photo_url) VALUES ($1,$2,$3,$4,$5,$6)`,
            [rows[0].id, it.sku || null, it.name, it.qty, it.price, photoUrl]
          );
        }
        await client.query('COMMIT');
        created++;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    res.json({ ok: true, created });
  } catch (e) { next(e); }
});

module.exports = router;
