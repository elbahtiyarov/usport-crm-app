const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const pool = require('../db');

function mapProduct(r) {
  return {
    id: String(r.id),
    sku: r.sku || '',
    name: r.name,
    category: r.category || '',
    price: Number(r.price),
    specs: r.specs || '',
    photoUrl: r.photo_url || '',
    createdAt: new Date(r.created_at).getTime()
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(rows.map(mapProduct));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { sku, name, category, price, specs, photoUrl } = req.body;
    if (!name) return res.status(400).json({ error: 'Укажите наименование товара' });
    const { rows } = await pool.query(
      `INSERT INTO products (sku, name, category, price, specs, photo_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [sku || null, name, category || null, price || 0, specs || null, photoUrl || null]
    );
    res.json(mapProduct(rows[0]));
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { sku, name, category, price, specs, photoUrl } = req.body;
    const { rows } = await pool.query(
      `UPDATE products SET sku=$1, name=$2, category=$3, price=$4, specs=$5, photo_url=$6 WHERE id=$7 RETURNING *`,
      [sku || null, name, category || null, price || 0, specs || null, photoUrl || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Товар не найден' });
    res.json(mapProduct(rows[0]));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
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
