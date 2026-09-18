require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const productsRouter = require('./routes/products');
const clientsRouter = require('./routes/clients');
const ordersRouter = require('./routes/orders');
const documentsRouter = require('./routes/documents');
const settingsRouter = require('./routes/settings');
const importRouter = require('./routes/import');
const authRouter = require('./routes/auth');
const requireAuth = require('./middleware/requireAuth');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Загруженные файлы (логотип и т.п.) — доступны и без авторизации,
// иначе не отрисуется логотип на странице входа
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Авторизация (без защиты — сюда и приходят за входом)
app.use('/api/auth', authRouter);

// Остальной API закрыт авторизацией
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/clients', requireAuth, clientsRouter);
app.use('/api/orders', requireAuth, ordersRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/import', requireAuth, importRouter);

// Отдаём фронтенд как статику (index.html лежит в ../public)
const frontendDir = path.join(__dirname, '..', 'public');
app.use(express.static(frontendDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`USPORT CRM backend запущен: http://localhost:${PORT}`);
});
