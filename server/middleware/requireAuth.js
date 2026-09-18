const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

module.exports = function requireAuth(req, res, next){
  const token = req.cookies && req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    req.userRole = payload.role || 'manager';
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Сессия истекла, войдите заново' });
  }
};
