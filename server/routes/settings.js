const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const pool = require('../db');

function mapSettings(r) {
  if (!r) return { name: 'USPORT' };
  return {
    name: r.name || 'USPORT',
    legalAddress: r.legal_address || '',
    phone: r.phone || '',
    email: r.email || '',
    directorName: r.director_name || '',
    requisites: r.requisites || '',
    logoUrl: r.logo_url || ''
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM settings WHERE id=1');
    res.json(mapSettings(rows[0]));
  } catch (e) { next(e); }
});

router.put('/', async (req, res, next) => {
  try {
    const { name, legalAddress, phone, email, directorName, requisites } = req.body;
    const { rows } = await pool.query(
      `UPDATE settings SET name=$1, legal_address=$2, phone=$3, email=$4, director_name=$5, requisites=$6
       WHERE id=1 RETURNING *`,
      [name || 'USPORT', legalAddress || null, phone || null, email || null, directorName || null, requisites || null]
    );
    res.json(mapSettings(rows[0]));
  } catch (e) { next(e); }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } });

router.post('/logo', upload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
    const url = '/uploads/' + req.file.filename;
    await pool.query('UPDATE settings SET logo_url=$1 WHERE id=1', [url]);
    res.json({ url });
  } catch (e) { next(e); }
});

router.delete('/logo', async (req, res, next) => {
  try {
    await pool.query('UPDATE settings SET logo_url=NULL WHERE id=1');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
