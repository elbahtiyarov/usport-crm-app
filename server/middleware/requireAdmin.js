module.exports = function requireAdmin(req, res, next){
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Доступно только администратору' });
  }
  next();
};
