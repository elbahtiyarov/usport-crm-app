// Генерирует PDF документа (КП/счёт/накладная/договор) на сервере —
// без диалога печати браузера. Шрифт DejaVu Sans зашит в проект
// (server/fonts/), поддерживает кириллицу и знак ₸.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FONT_REGULAR = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const NAVY = '#14294D';
const RED = '#D62828';
const LINE = '#D8DCE3';
const INK = '#10141A';
const SOFT = '#5B6270';
const ZEBRA = '#F7F8FA';

const DOC_META = {
  kp: { title: 'Коммерческое предложение', prefix: 'КП' },
  invoice: { title: 'Счёт на оплату', prefix: 'СЧ' },
  waybill: { title: 'Товарная накладная', prefix: 'НН' },
  contract: { title: 'Договор поставки', prefix: 'ДГ' }
};

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') + ' ₸'; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('ru-RU') : ''; }

function localFilePath(url) {
  if (!url) return null;
  if (url.startsWith('/uploads/')) return path.join(UPLOADS_DIR, url.slice('/uploads/'.length));
  if (url === '/logo.png') return path.join(PUBLIC_DIR, 'logo.png');
  return null;
}

function contractTemplate(companyName, clientName, amount) {
  return `ТОО/ИП «${companyName}» (далее — Поставщик) и ${clientName || 'Покупатель'} (далее — Покупатель) заключили настоящий договор о нижеследующем:

1. Предмет договора
Поставщик обязуется поставить, а Покупатель принять и оплатить товар согласно Спецификации на общую сумму ${fmt(amount)}.

2. Условия оплаты
Оплата производится в порядке предоплаты либо по факту поставки, по согласованию сторон.

3. Срок поставки
Срок поставки — по согласованию сторон, не позднее 30 календарных дней с момента оплаты.

4. Ответственность сторон
За неисполнение обязательств стороны несут ответственность в соответствии с законодательством Республики Казахстан.

5. Прочие условия
Все изменения и дополнения к договору действительны при письменном оформлении и подписании обеими сторонами.`;
}

// doc: {id, docType, clientName, clientId, amount, status, notes, validUntil,
//       dueDate, shipDate, signDate, items:[{sku,name,qty,price,photoUrl}], createdAt}
// client: {requisites} | null
// settings: {name, legalAddress, phone, email, requisites, logoUrl}
function generateDocumentPdf({ doc, client, settings }) {
  return new Promise((resolve, reject) => {
    try {
      const meta = DOC_META[doc.docType] || DOC_META.kp;
      const number = String(doc.docNumber || doc.id);
      const hasPhotos = (doc.items || []).some(it => it.photoUrl);

      const pdf = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      const chunks = [];
      pdf.on('data', c => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      pdf.registerFont('regular', FONT_REGULAR);
      pdf.registerFont('bold', FONT_BOLD);
      pdf.font('regular');

      const left = pdf.page.margins.left;
      const right = pdf.page.width - pdf.page.margins.right;
      const contentWidth = right - left;
      const bottomLimit = pdf.page.height - pdf.page.margins.bottom;

      // ---------- Шапка ----------
      const headTop = pdf.y;
      let logoW = 0;
      const logoPath = localFilePath(settings.logoUrl) || path.join(PUBLIC_DIR, 'logo.png');
      try {
        if (fs.existsSync(logoPath)) {
          pdf.image(logoPath, left, headTop, { height: 38 });
          logoW = 48;
        }
      } catch (e) { /* без логотипа, не критично */ }

      pdf.font('bold').fontSize(15).fillColor(NAVY)
        .text(settings.name || 'USPORT', left + logoW, headTop, { width: contentWidth - logoW - 170 });
      const companyLine = [settings.legalAddress, settings.phone, settings.email].filter(Boolean).join(' · ');
      if (companyLine) {
        pdf.font('regular').fontSize(8.5).fillColor(SOFT)
          .text(companyLine, left + logoW, pdf.y + 2, { width: contentWidth - logoW - 170 });
      }

      const metaW = 160;
      pdf.font('bold').fontSize(11).fillColor(NAVY)
        .text(`№ ${number}`, right - metaW, headTop, { width: metaW, align: 'right' });
      pdf.font('regular').fontSize(9).fillColor(SOFT)
        .text(`от ${fmtDate(doc.createdAt)}`, right - metaW, pdf.y + 1, { width: metaW, align: 'right' });
      if (doc.createdByEmail) {
        pdf.font('regular').fontSize(8.5).fillColor(SOFT)
          .text(doc.createdByEmail, right - metaW, pdf.y + 1, { width: metaW, align: 'right' });
      }

      const headBottom = Math.max(pdf.y, headTop + 42) + 10;
      pdf.moveTo(left, headBottom).lineTo(right, headBottom).lineWidth(1.5).strokeColor(NAVY).stroke();
      pdf.x = left;
      pdf.y = headBottom + 14;

      // ---------- Заголовок документа ----------
      pdf.font('bold').fontSize(14).fillColor(NAVY).text(meta.title.toUpperCase(), left, pdf.y, { width: contentWidth });
      pdf.x = left;
      pdf.moveDown(0.7);

      // ---------- Блок клиента ----------
      const clientBoxTop = pdf.y;
      const clientLabel = doc.docType === 'contract' ? 'ПОКУПАТЕЛЬ' : 'КЛИЕНТ';
      pdf.font('regular').fontSize(8).fillColor(SOFT).text(clientLabel, left + 10, clientBoxTop + 8);
      pdf.font('bold').fontSize(11).fillColor(INK).text(doc.clientName || '—', left + 10, pdf.y + 1);
      let clientBoxBottom = pdf.y + 8;
      if (client && client.requisites) {
        pdf.font('regular').fontSize(8.5).fillColor(SOFT)
          .text(client.requisites, left + 10, pdf.y + 2, { width: contentWidth - 20 });
        clientBoxBottom = pdf.y + 8;
      }
      pdf.roundedRect(left, clientBoxTop, contentWidth, clientBoxBottom - clientBoxTop, 3).strokeColor(LINE).lineWidth(1).stroke();
      pdf.y = clientBoxBottom + 14;

      // ---------- Таблица позиций ----------
      const items = doc.items || [];
      const hasDealer = items.some(it => it.dealerPrice);
      const hasWholesale = items.some(it => it.wholesalePrice);
      const hasVat = items.some(it => it.priceWithVat);
      const priceColsCount = 1 + (hasDealer?1:0) + (hasWholesale?1:0) + (hasVat?1:0);
      const priceW = priceColsCount > 1 ? 50 : 72;
      const sumW = priceColsCount > 1 ? 68 : 82;
      const skuW = priceColsCount > 2 ? 58 : 62;
      const colQty = 46;
      const colPhoto = hasPhotos ? 30 : 0;
      const colName = contentWidth - colPhoto - skuW - colQty - priceW * priceColsCount - sumW;

      const cols = [
        { key: 'photo', w: colPhoto },
        { key: 'sku', w: skuW, label: 'Артикул' },
        { key: 'name', w: colName, label: 'Наименование' },
        { key: 'qty', w: colQty, label: 'Кол-во', align: 'center' },
        { key: 'price', w: priceW, label: 'Цена', align: 'right' },
        ...(hasDealer ? [{ key: 'dealerPrice', w: priceW, label: 'Дилер', align: 'right' }] : []),
        ...(hasWholesale ? [{ key: 'wholesalePrice', w: priceW, label: 'Опт', align: 'right' }] : []),
        ...(hasVat ? [{ key: 'priceWithVat', w: priceW, label: 'С НДС', align: 'right' }] : []),
        { key: 'sum', w: sumW, label: 'Сумма', align: 'right' }
      ].filter(c => c.w > 0);

      function colX(idx) {
        let x = left;
        for (let i = 0; i < idx; i++) x += cols[i].w;
        return x;
      }

      function drawTableHeader() {
        const y = pdf.y;
        const h = 20;
        pdf.rect(left, y, contentWidth, h).fill(NAVY);
        pdf.font('bold').fontSize(priceColsCount > 1 ? 7.5 : 8.5).fillColor('#FFFFFF');
        cols.forEach((c, i) => {
          if (c.key === 'photo') return;
          pdf.text(c.label, colX(i) + 4, y + 7, { width: c.w - 8, align: c.align || 'left', lineBreak: false });
        });
        pdf.y = y + h;
      }

      function ensureSpace(h) {
        if (pdf.y + h > bottomLimit) {
          pdf.addPage();
          pdf.y = pdf.page.margins.top;
          drawTableHeader();
        }
      }

      if (items.length) {
        drawTableHeader();
        items.forEach((it, i) => {
          pdf.font('regular').fontSize(9);
          const nameH = pdf.heightOfString(it.name || '', { width: cols.find(c => c.key === 'name').w - 12 });
          const rowH = Math.max(24, nameH + 10, colPhoto ? 34 : 0);
          ensureSpace(rowH);

          const rowY = pdf.y;
          if (i % 2 === 1) { pdf.rect(left, rowY, contentWidth, rowH).fill(ZEBRA); }

          cols.forEach((c, ci) => {
            const x = colX(ci) + 6;
            const w = c.w - 10;
            if (c.key === 'photo') {
              const p = localFilePath(it.photoUrl);
              if (p) { try { if (fs.existsSync(p)) pdf.image(p, colX(ci) + 3, rowY + 3, { fit: [colPhoto - 6, rowH - 6] }); } catch (e) {} }
              return;
            }
            const val = c.key === 'sku' ? (it.sku || '—')
              : c.key === 'name' ? (it.name || '')
              : c.key === 'qty' ? String(it.qty)
              : c.key === 'price' ? fmt(it.price)
              : c.key === 'dealerPrice' ? (it.dealerPrice ? fmt(it.dealerPrice) : '—')
              : c.key === 'wholesalePrice' ? (it.wholesalePrice ? fmt(it.wholesalePrice) : '—')
              : c.key === 'priceWithVat' ? (it.priceWithVat ? fmt(it.priceWithVat) : '—')
              : fmt((Number(it.qty) || 0) * (Number(it.price) || 0));
            const isPriceCol = ['price','dealerPrice','wholesalePrice','priceWithVat','sum'].includes(c.key);
            pdf.font(c.key === 'sku' ? 'bold' : 'regular').fontSize(isPriceCol && priceColsCount > 1 ? 8 : 9).fillColor(c.key === 'sku' ? SOFT : INK)
              .text(val, x, rowY + 6, { width: w, align: c.align || 'left', lineBreak: isPriceCol ? false : true });
          });

          pdf.moveTo(left, rowY + rowH).lineTo(right, rowY + rowH).lineWidth(0.5).strokeColor(LINE).stroke();
          pdf.y = rowY + rowH;
        });

        // Итого
        ensureSpace(26);
        const totalY = pdf.y + 4;
        pdf.moveTo(left, totalY).lineTo(right, totalY).lineWidth(1.5).strokeColor(NAVY).stroke();
        pdf.font('bold').fontSize(11).fillColor(NAVY)
          .text(doc.vatIncluded ? 'Итого (с НДС)' : 'Итого', colX(cols.length - 2) - 100, totalY + 6, { width: 100, align: 'right' });
        pdf.font('bold').fontSize(priceColsCount > 1 ? 9.5 : 11).fillColor(NAVY)
          .text(fmt(doc.amount), colX(cols.length - 1) + 6, totalY + 6, { width: cols[cols.length - 1].w - 10, align: 'right', lineBreak: false });
        pdf.x = left;
        pdf.y = totalY + 26;

        if (doc.vatIncluded) {
          pdf.font('regular').fontSize(9).fillColor(SOFT)
            .text(`Без НДС: ${fmt(doc.baseAmount)} · НДС ${doc.vatRate||16}%: ${fmt(doc.vatAmount)}`, left, pdf.y, { width: contentWidth });
          pdf.x = left;
          pdf.moveDown(0.5);
        }

        const totalWeight = items.reduce((s, it) => s + (Number(it.qty)||0) * (Number(it.weight)||0), 0);
        const totalVolume = items.reduce((s, it) => s + (Number(it.qty)||0) * (Number(it.volume)||0), 0);
        if (totalWeight || totalVolume) {
          pdf.font('regular').fontSize(9).fillColor(SOFT)
            .text(`Габариты: вес ${totalWeight.toFixed(2)} кг · объём ${totalVolume.toFixed(3)} м³`, left, pdf.y, { width: contentWidth });
          pdf.x = left;
          pdf.moveDown(0.5);
        }
      }

      // ---------- Доп. поля по типу документа ----------
      pdf.x = left;
      pdf.font('regular').fontSize(9.5).fillColor(INK);
      if (doc.docType === 'kp' && doc.validUntil) {
        pdf.text(`Действительно до: ${fmtDate(doc.validUntil)}`, left, pdf.y, { width: contentWidth }); pdf.x = left; pdf.moveDown(0.4);
      }
      if (doc.docType === 'invoice' && doc.dueDate) {
        pdf.text(`Оплатить до: ${fmtDate(doc.dueDate)}`, left, pdf.y, { width: contentWidth }); pdf.x = left; pdf.moveDown(0.4);
      }
      if (doc.docType === 'waybill' && doc.shipDate) {
        pdf.text(`Дата отгрузки: ${fmtDate(doc.shipDate)}`, left, pdf.y, { width: contentWidth }); pdf.x = left; pdf.moveDown(0.4);
      }

      if (doc.docType === 'invoice' && settings.requisites) {
        ensureSpace(50);
        pdf.x = left;
        pdf.font('bold').fontSize(9).fillColor(NAVY).text('РЕКВИЗИТЫ ДЛЯ ОПЛАТЫ', left, pdf.y, { width: contentWidth });
        pdf.x = left;
        pdf.font('regular').fontSize(9).fillColor(INK).text(settings.requisites, left, pdf.y, { width: contentWidth });
        pdf.x = left;
        pdf.moveDown(0.6);
      }

      if (doc.docType === 'contract') {
        ensureSpace(40);
        pdf.x = left;
        pdf.font('regular').fontSize(9.5).fillColor(INK)
          .text(doc.notes || contractTemplate(settings.name || 'USPORT', doc.clientName, doc.amount), left, pdf.y, { width: contentWidth });
        pdf.x = left;
        pdf.moveDown(0.6);
      } else if (doc.notes) {
        ensureSpace(40);
        pdf.x = left;
        pdf.font('bold').fontSize(9).fillColor(NAVY).text('УСЛОВИЯ', left, pdf.y, { width: contentWidth });
        pdf.x = left;
        pdf.font('regular').fontSize(9).fillColor(INK).text(doc.notes, left, pdf.y, { width: contentWidth });
        pdf.x = left;
        pdf.moveDown(0.6);
      }

      // ---------- Подписи ----------
      pdf.x = left;
      ensureSpace(70);
      const signY = Math.max(pdf.y + 40, bottomLimit - 60);
      const signW = contentWidth / 2 - 20;
      const signLabels = doc.docType === 'waybill' ? ['Отпустил', 'Получил'] : ['Поставщик', 'Покупатель'];
      pdf.moveTo(left, signY).lineTo(left + signW, signY).lineWidth(1).strokeColor(INK).stroke();
      pdf.moveTo(right - signW, signY).lineTo(right, signY).lineWidth(1).strokeColor(INK).stroke();
      pdf.font('regular').fontSize(8.5).fillColor(SOFT)
        .text(signLabels[0], left, signY + 4, { width: signW })
        .text(signLabels[1], right - signW, signY + 4, { width: signW, align: 'left' });

      // ---------- Подвал ----------
      pdf.font('regular').fontSize(7.5).fillColor(SOFT)
        .text(`Документ сформирован в USPORT CRM · ${fmtDate(Date.now())}`, left, bottomLimit - 12, { width: contentWidth, align: 'center', lineBreak: false });

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateDocumentPdf };
