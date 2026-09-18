// Проверяет, может ли текущий пользователь редактировать/удалять запись:
// - если у записи нет владельца (created_by = NULL, старые записи до
//   включения этой функции) — можно всем;
// - если владелец есть — только он сам или пользователь с ролью admin.
async function assertOwnership(pool, table, id, req){
  const { rows } = await pool.query(`SELECT created_by FROM ${table} WHERE id=$1`, [id]);
  if (!rows[0]) return { status: 404, error: 'Запись не найдена' };
  const ownerId = rows[0].created_by;
  if (ownerId != null && req.userRole !== 'admin' && String(ownerId) !== String(req.userId)) {
    return { status: 403, error: 'Можно редактировать и удалять только свои записи' };
  }
  return null;
}

module.exports = { assertOwnership };
