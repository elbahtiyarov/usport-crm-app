const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const pool = require('../db');
const { assertOwnership } = require('../ownership');

function mapProduct(r) {
  return {
    id: String(r.id),
    sku: r.sku || '',
    name: r.name,
    category: r.category || '',
    price: Number(r.price),
    dealerPrice: r.dealer_price != null ? Number(r.dealer_price) : null,
    wholesalePrice: r.wholesale_price != null ? Number(r.wholesale_price) : null,
    priceWithVat: r.price_with_vat != null ? Number(r.price_with_vat) : null,
    weight: r.weight != null ? Number(r.weight) : null,
    volume: r.volume != null ? Number(r.volume) : null,
    specs: r.specs || '',
    photoUrl: r.photo_url || '',
    createdAt: new Date(r.created_at).getTime(),
    createdBy: r.created_by != null ? String(r.created_by) : null,
    createdByEmail: r.created_by_email || null
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.email AS created_by_email FROM products p LEFT JOIN users u ON u.id = p.created_by ORDER BY p.created_at DESC`
    );
    res.json(rows.map(mapProduct));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { sku, name, category, price, dealerPrice, wholesalePrice, priceWithVat, weight, volume, specs, photoUrl } = req.body;
    if (!name) return res.status(400).json({ error: 'Укажите наименование товара' });
    const { rows } = await pool.query(
      `INSERT INTO products (sku, name, category, price, dealer_price, wholesale_price, price_with_vat, weight, volume, specs, photo_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [sku || null, name, category || null, price || 0,
       dealerPrice || null, wholesalePrice || null, priceWithVat || null,
       weight || null, volume || null, specs || null, photoUrl || null, req.userId]
    );
    res.json(mapProduct({ ...rows[0], created_by_email: req.userEmail }));
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const denial = await assertOwnership(pool, 'products', req.params.id, req);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    const { sku, name, category, price, dealerPrice, wholesalePrice, priceWithVat, weight, volume, specs, photoUrl } = req.body;
    const { rows } = await pool.query(
      `UPDATE products SET sku=$1, name=$2, category=$3, price=$4, dealer_price=$5, wholesale_price=$6,
         price_with_vat=$7, weight=$8, volume=$9, specs=$10, photo_url=$11 WHERE id=$12 RETURNING *`,
      [sku || null, name, category || null, price || 0,
       dealerPrice || null, wholesalePrice || null, priceWithVat || null,
       weight || null, volume || null, specs || null, photoUrl || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Товар не найден' });
    const { rows: full } = await pool.query(
      `SELECT p.*, u.email AS created_by_email FROM products p LEFT JOIN users u ON u.id = p.created_by WHERE p.id=$1`,
      [req.params.id]
    );
    res.json(mapProduct(full[0]));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const denial = await assertOwnership(pool, 'products', req.params.id, req);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Загрузка фото товара: сначала загружаем файл, получаем ссылку, затем
// сохраняем её в поле photoUrl при создании/редактировании товара.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 4 * 1024 * 1024 } });

router.post('/upload-photo', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
    res.json({ url: '/uploads/' + req.file.filename });
  } catch (e) { next(e); }
});

module.exports = router;
