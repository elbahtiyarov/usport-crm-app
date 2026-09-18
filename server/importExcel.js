// Разбор файлов вида "Прайс-лист" (каталог) и "КП (шаблон)" (готовое
// коммерческое предложение) в структуры, которые CRM может сохранить.
// Ищем нужные колонки по заголовкам, а не по фиксированным номерам ячеек,
// чтобы файл можно было немного менять (переставлять столбцы, добавлять
// свои) и импорт всё равно сработал.

function cellText(cell) {
  const v = cell ? cell.value : null;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if (v.text != null) return String(v.text); // гиперссылка { text, hyperlink }
    if (v.result != null) return String(v.result); // формула
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}

function cellNumber(cell) {
  const v = cell ? cell.value : null;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.result != null) return Number(v.result);
    return null;
  }
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function norm(s) { return String(s || '').trim().toLowerCase(); }

// Ищет строку заголовков товарного прайса: есть "артикул" и "наименование",
// но нет "кол-во"/"сумма" (иначе это таблица КП/накладной, а не каталог).
function findProductsHeader(ws) {
  const maxScan = Math.min(ws.rowCount, 30);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const map = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = norm(cellText(row.getCell(c)));
      if (t) map[t] = c;
    }
    const keys = Object.keys(map);
    const hasSku = keys.some(k => k.includes('артикул'));
    const hasName = keys.some(k => k.includes('наименован'));
    const hasQty = keys.some(k => k.includes('кол-во') || k.includes('кол.во'));
    const hasSum = keys.some(k => k.includes('сумма'));
    if (hasSku && hasName && !hasQty && !hasSum) return { rowIndex: r, map, keys };
  }
  return null;
}

function findColumn(map, keys, predicate) {
  const key = keys.find(predicate);
  return key ? map[key] : null;
}

// Возвращает [{ sku, name, category, price, specs }] из первого листа,
// похожего на прайс-лист.
function parseProducts(workbook) {
  for (const ws of workbook.worksheets) {
    const header = findProductsHeader(ws);
    if (!header) continue;

    const { rowIndex, map, keys } = header;
    const skuCol = findColumn(map, keys, k => k.includes('артикул'));
    const nameCol = findColumn(map, keys, k => k.includes('наименован'));
    const unitCol = findColumn(map, keys, k => k.includes('ед') && k.includes('изм'));
    const priceCol = findColumn(map, keys, k => k.includes('цена'));
    const weightCol = findColumn(map, keys, k => k.includes('вес'));
    const volumeCol = findColumn(map, keys, k => k.includes('объ'));
    const categoryCol = findColumn(map, keys, k => k.includes('категор') || k.includes('раздел') || k.includes('групп'));

    const rows = [];
    for (let r = rowIndex + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = cellText(row.getCell(nameCol)).trim();
      if (!name) continue;
      const sku = skuCol ? cellText(row.getCell(skuCol)).trim() : '';
      const price = priceCol ? (cellNumber(row.getCell(priceCol)) || 0) : 0;
      const unit = unitCol ? cellText(row.getCell(unitCol)).trim() : '';
      const weight = weightCol ? cellNumber(row.getCell(weightCol)) : null;
      const volume = volumeCol ? cellNumber(row.getCell(volumeCol)) : null;
      const category = categoryCol ? cellText(row.getCell(categoryCol)).trim() : '';

      const specParts = [];
      if (unit) specParts.push(`Ед. изм.: ${unit}`);
      if (weight) specParts.push(`Вес: ${weight} кг`);
      if (volume) specParts.push(`Объём: ${volume} м³`);

      rows.push({ sku, name, category, price, specs: specParts.join(' · ') });
    }
    if (rows.length) return rows; // нашли и разобрали лист — этого достаточно
  }
  return [];
}

function parseRuDate(str) {
  const m = String(str || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return '';
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Ищет в листе таблицу позиций КП: строка с "артикул"+"наименование"+"кол-во".
function findKpItemsHeader(ws, fromRow) {
  const maxScan = Math.min(ws.rowCount, fromRow + 15);
  for (let r = fromRow; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const map = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = norm(cellText(row.getCell(c)));
      if (t) map[t] = c;
    }
    const keys = Object.keys(map);
    const hasSku = keys.some(k => k.includes('артикул'));
    const hasName = keys.some(k => k.includes('наименован'));
    const hasQty = keys.some(k => k.includes('кол-во') || k.includes('кол.во'));
    if (hasSku && hasName && hasQty) return { rowIndex: r, map, keys };
  }
  return null;
}

// Возвращает массив документов [{ clientName, validUntil, notes, items }],
// по одному на каждое найденное на листах "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ №...".
function parseDocuments(workbook) {
  const results = [];

  for (const ws of workbook.worksheets) {
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      let titleText = '';
      for (let c = 1; c <= ws.columnCount; c++) {
        const t = cellText(row.getCell(c));
        if (/коммерческое предложение/i.test(t)) { titleText = t; break; }
      }
      if (!titleText) continue;

      // Собираем несколько строк после заголовка — там обычно "Кому:", "От:", "Дата:"
      let clientName = '';
      let managerLine = '';
      let validUntil = '';
      for (let rr = r; rr <= Math.min(ws.rowCount, r + 8); rr++) {
        const line = ws.getRow(rr).getCell(1);
        const text = cellText(line);
        if (/^кому:/i.test(text)) clientName = text.replace(/^кому:\s*/i, '').trim();
        if (/^от:/i.test(text)) managerLine = text.replace(/^от:\s*/i, '').trim();
        const validMatch = text.match(/действительно до:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i);
        if (validMatch) validUntil = parseRuDate(validMatch[1]);
      }

      const itemsHeader = findKpItemsHeader(ws, r + 1);
      const items = [];
      if (itemsHeader) {
        const { rowIndex, map, keys } = itemsHeader;
        const skuCol = findColumn(map, keys, k => k.includes('артикул'));
        const nameCol = findColumn(map, keys, k => k.includes('наименован'));
        const qtyCol = findColumn(map, keys, k => k.includes('кол-во') || k.includes('кол.во'));
        const discountedPriceCol = findColumn(map, keys, k => k.includes('цена') && k.includes('скидк'));
        const plainPriceCol = findColumn(map, keys, k => k.includes('цена') && !k.includes('скидк'));
        const priceCol = discountedPriceCol || plainPriceCol;

        for (let rr = rowIndex + 1; rr <= ws.rowCount; rr++) {
          const irow = ws.getRow(rr);
          const anyText = irow.values ? irow.values.join(' ') : '';
          if (/итого/i.test(anyText)) break;
          const name = nameCol ? cellText(irow.getCell(nameCol)).trim() : '';
          const qty = qtyCol ? cellNumber(irow.getCell(qtyCol)) : null;
          if (!name || !qty) continue;
          const price = priceCol ? (cellNumber(irow.getCell(priceCol)) || 0) : 0;
          const sku = skuCol ? cellText(irow.getCell(skuCol)).trim() : '';
          items.push({ sku, name, qty, price });
        }
      }

      if (items.length) {
        const notesParts = [`Импортировано из Excel: ${titleText.trim()}`];
        if (managerLine) notesParts.push(`Менеджер: ${managerLine}`);
        results.push({
          clientName: clientName || 'Клиент из Excel',
          validUntil,
          notes: notesParts.join('. '),
          items
        });
      }
    }
  }

  return results;
}

module.exports = { parseProducts, parseDocuments };
