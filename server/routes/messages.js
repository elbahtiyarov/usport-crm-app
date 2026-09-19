const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const pool = require('../db');

function mapMessage(r) {
  return {
    id: String(r.id),
    senderId: String(r.sender_id),
    recipientId: String(r.recipient_id),
    body: r.body || '',
    attachmentUrl: r.attachment_url || null,
    attachmentName: r.attachment_name || null,
    attachmentType: r.attachment_type || null,
    replyToId: r.reply_to_id != null ? String(r.reply_to_id) : null,
    createdAt: new Date(r.created_at).getTime(),
    readAt: r.read_at ? new Date(r.read_at).getTime() : null
  };
}

// GET /api/messages/contacts — список всех, кому можно написать
// (доступно любому вошедшему, не только admin — иначе не с кем общаться).
router.get('/contacts', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email FROM users WHERE id<>$1 ORDER BY email ASC',
      [req.userId]
    );
    res.json(rows.map(r => ({ id: String(r.id), login: r.email })));
  } catch (e) { next(e); }
});

// GET /api/messages/conversations — по каждому собеседнику: последнее
// сообщение и сколько от него непрочитано. Отсортировано по свежести.
router.get('/conversations', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email AS login, lm.body AS last_body, lm.attachment_name AS last_attachment_name,
        lm.created_at AS last_at, lm.sender_id AS last_sender_id,
        (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND recipient_id = $1 AND read_at IS NULL) AS unread
      FROM users u
      LEFT JOIN LATERAL (
        SELECT body, attachment_name, created_at, sender_id FROM messages
        WHERE (sender_id = u.id AND recipient_id = $1) OR (sender_id = $1 AND recipient_id = u.id)
        ORDER BY created_at DESC LIMIT 1
      ) lm ON true
      WHERE u.id <> $1
      ORDER BY lm.created_at DESC NULLS LAST, u.email ASC
    `, [req.userId]);

    res.json(rows.map(r => ({
      id: String(r.id),
      login: r.login,
      lastBody: r.last_body || (r.last_attachment_name ? '📎 ' + r.last_attachment_name : null),
      lastAt: r.last_at ? new Date(r.last_at).getTime() : null,
      lastFromMe: r.last_sender_id != null ? String(r.last_sender_id) === String(req.userId) : null,
      unread: Number(r.unread)
    })));
  } catch (e) { next(e); }
});

// GET /api/messages/unread-count — суммарно непрочитанных, для бейджа в меню
router.get('/unread-count', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM messages WHERE recipient_id=$1 AND read_at IS NULL', [req.userId]);
    res.json({ count: Number(rows[0].count) });
  } catch (e) { next(e); }
});

// GET /api/messages/gifs?q=... — поиск гифок через Giphy (сервер прячет ключ).
// Без своего GIPHY_API_KEY в .env используется публичный демо-ключ Giphy —
// он общий для всех и может тормозить при большой нагрузке; для реальной
// работы получите свой бесплатный ключ на developers.giphy.com.
const GIPHY_FALLBACK_KEY = 'dc6zaTOxFJmzC';
router.get('/gifs', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const key = process.env.GIPHY_API_KEY || GIPHY_FALLBACK_KEY;
    const endpoint = q
      ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=24&rating=pg-13`;
    console.log('[messages/gifs] запрос к Giphy:', endpoint.replace(key, '***'));
    const giphyRes = await fetch(endpoint);
    console.log('[messages/gifs] ответ Giphy: HTTP', giphyRes.status);
    if (!giphyRes.ok) {
      const errText = await giphyRes.text().catch(() => '');
      console.log('[messages/gifs] тело ответа Giphy:', errText.slice(0, 500));
      return res.status(502).json({ error: 'Giphy сейчас недоступен, попробуйте позже' });
    }
    const data = await giphyRes.json();
    const gifs = (data.data || []).map(g => ({
      id: g.id,
      previewUrl: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url,
      url: g.images?.fixed_width?.url || g.images?.original?.url
    }));
    console.log('[messages/gifs] найдено гифок:', gifs.length);
    res.json(gifs);
  } catch (e) {
    console.error('[messages/gifs] ошибка запроса к Giphy:', e.message);
    next(e);
  }
});

// GET /api/messages/:userId — переписка с конкретным человеком;
// заодно помечает его сообщения мне прочитанными.
router.get('/:userId', async (req, res, next) => {
  try {
    const otherId = req.params.userId;
    await pool.query(
      'UPDATE messages SET read_at = now() WHERE sender_id=$1 AND recipient_id=$2 AND read_at IS NULL',
      [otherId, req.userId]
    );
    const { rows } = await pool.query(
      `SELECT * FROM messages WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1) ORDER BY created_at ASC`,
      [req.userId, otherId]
    );
    res.json(rows.map(mapMessage));
  } catch (e) { next(e); }
});

// Вложения (фото/документы) сохраняются в ту же папку, что и остальные
// загруженные файлы — server/uploads/.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10 МБ

// POST /api/messages — form-data: recipientId, body, replyToId (всё необязательно, кроме recipientId),
// attachment (файл) ИЛИ externalAttachmentUrl/-Type/-Name (например, гифка по прямой ссылке — без загрузки на сервер).
router.post('/', upload.single('attachment'), async (req, res, next) => {
  try {
    const recipientId = req.body.recipientId;
    const body = String(req.body.body || '').trim();
    const replyToId = req.body.replyToId || null;
    const file = req.file;
    const externalUrl = req.body.externalAttachmentUrl || null;

    if (!recipientId) return res.status(400).json({ error: 'Укажите получателя' });
    if (!body && !file && !externalUrl) return res.status(400).json({ error: 'Пустое сообщение' });
    if (String(recipientId) === String(req.userId)) return res.status(400).json({ error: 'Нельзя написать самому себе' });

    const { rows: recipientRows } = await pool.query('SELECT id FROM users WHERE id=$1', [recipientId]);
    if (!recipientRows[0]) return res.status(404).json({ error: 'Получатель не найден' });

    let attachmentUrl = null, attachmentName = null, attachmentType = null;
    if (file) {
      attachmentUrl = '/uploads/' + file.filename;
      attachmentName = file.originalname;
      attachmentType = file.mimetype;
    } else if (externalUrl) {
      attachmentUrl = externalUrl;
      attachmentName = req.body.externalAttachmentName || 'gif';
      attachmentType = req.body.externalAttachmentType || 'image/gif';
    }

    const { rows } = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, body, attachment_url, attachment_name, attachment_type, reply_to_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.userId, recipientId, body || null, attachmentUrl, attachmentName, attachmentType, replyToId || null]
    );
    res.json(mapMessage(rows[0]));
  } catch (e) { next(e); }
});

module.exports = router;
