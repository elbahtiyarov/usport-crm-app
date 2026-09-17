require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const productsRouter = require('./routes/products');
const clientsRouter = require('./routes/clients');
const ordersRouter = require('./routes/orders');
const documentsRouter = require('./routes/documents');
const settingsRouter = require('./routes/settings');

const app = express();

app.use(cors());
app.use(express.json());

// Загруженные файлы (логотип и т.п.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API
app.use('/api/products', productsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/settings', settingsRouter);

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
