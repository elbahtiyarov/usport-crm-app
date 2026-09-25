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

function contractTemplate(companyName, clientName, amount, directorName, licenseNumber) {
  const director = directorName ? `, в лице директора ${directorName}` : '';
  const basis = directorName
    ? (licenseNumber ? `, действующего на основании Талона № ${licenseNumber}` : ', действующего на основании Устава')
    : '';
  return `ИП «${companyName}»${director}${basis}, «Поставщик», с одной стороны, и ${clientName || 'Покупатель'}, «Покупатель», с другой стороны, заключили настоящий договор о нижеследующем:

1. ПРЕДМЕТ ДОГОВОРА
1.1. Покупатель поручает, а Поставщик принимает на себя обязательства в порядке и на условиях, оговоренных в Договоре, в соответствии с Приложением №1 к Договору, являющейся неотъемлемой частью Договора.
1.2. Поставка отпускается со склада поставщика.

2. СТОИМОСТЬ ДОГОВОРА И ПОРЯДОК РАСЧЕТОВ
2.1. Общая стоимость Договора формируется из общих сумм, предусмотренных в Приложениях к настоящему Договору, и составляет ${fmt(amount)}.
2.2. Оплата производится в национальной валюте Республики Казахстан – «тенге».
2.3. Общая стоимость Договора включает материалы и все расходы Исполнителя, необходимые для надлежащего исполнения своих обязательств по Договору и указаны в Приложении к настоящему Договору.
2.4. Оплата за поставляемый Товар производится в течение 3 календарных дней после подписания Договора в порядке _____________

3. ПОСТАВКА ТОВАРА
3.1. Срок готовности товара согласно приложению № 1 20 календарных дней.
3.2. Поставщик по окончанию Заказа обязан предоставить вместе с Товаром следующие документы в электронном виде:
-Накладные (оригинал);
-Акт сверки взаиморасчетов.
3.3. Право собственности на Товар переходит от Поставщика к Покупатель с момента полной оплаты стоимости Товара.

4. ПРАВА И ОБЯЗАТЕЛЬСТВА СТОРОН
4.1. Поставщик обязан
4.1.1. Осуществить поставку Товара на Объект Покупателя в полном объеме согласно счету на оплату
4.1.2. Уведомить Покупателя о готовности Товара к поставке.
4.1.3. Провести поставку Товара в соответствии с условиями Договора.
4.1.4. Поставщик обязан своевременно информировать Покупателя о всех обстоятельствах, возникающих в ходе поставки, которые могут существенно повлиять на объем, качество и сроки.
4.1.5. При обнаружении Покупателем, недопоставки и/или недостатков в Товара, заменить любой компонент Товара или материала на новый, либо безвозмездно устранить недостатки в течение 5 (пяти) рабочих дней с даты обнаружения.
4.1.6. Обеспечить соблюдение своими специалистами на территории Покупателя пропускной режим, требования техники безопасности, правил пожарной и санитарной безопасности, а также трудовую дисциплину.
4.1.7. Нести ответственность за своих работников за причинение ущерба Покупателя, а также третьим лицам, своими действиями и действиями своих работников в ходе выполнения поставки Товара.
4.1.8. Назначить уполномоченных лиц для осуществления контроля, подписания исполнительной документации и актов в соответствии с Договором.
4.1.9. Поставщик несет полную ответственность за несчастный случай, связанный с трудовой деятельностью, - воздействия на работника опасного производственного фактора при выполнении им трудовых (служебных) обязанностей или заданий Исполнителя, в результате которого произошли производственная травма, внезапное ухудшение здоровья или отравление работника, приведшие их к временной или стойкой утрате трудоспособности либо смерти на объекте Покупателя.

4.2. Поставщик вправе:
4.2.1. требовать оплату по настоящему Договору.
4.2.2. по согласованию с Покупателем досрочно произвести поставку Товара, в таком случае составление Акта приемки и оплата производятся в соответствии с условиями настоящего Договора.
4.2.3. не производить поставку, до полной оплаты стоимости Товара, в соответствии с условиями настоящего Договора.

4.3. Покупатель обязан:
4.3.1. Оплатить Исполнителю сумму, указанную в Приложении к настоящему Договору, в сроки, установленные пунктом 2.4 настоящего Договора.
4.3.2. Поставка каждой партии Товара на строительную площадку Покупателя осуществляется в порядке и в сроки, которые установлены Настоящим Договором, и оформляется документом о приемке, который подписывается ответственным лицом(лицами) Покупателя: Заведующем склада, в случае его отсутствия Начальником участка, либо Прорабом/Мастером. Обеспечить складские помещения, приемку Товара в течение 1 (одного) рабочего дня с даты получения уведомления от Исполнителя о готовности к отгрузке. В случае отсутствия ответственного лица/лиц Покупателя при поставке Товаров на строительную площадку не препятствует их полной выгрузке, при этом Подрядчик снимает с себя ответственность за дальнейшее хранение и сохранность доставленного на строительную площадку Товара.
4.3.3. Покупатель обязан предоставлять Исполнителю по его требованию любую информацию, планы участков и строений, чертежи, и иные документы, необходимые для осуществления Поставки, а также оказывать любое иное содействие Исполнителю в выполнении Поставки на Объекте.
4.3.4. Назначить должностное лицо, ответственное за осуществление контроля над ходом поставки и решения организационно-технических вопросов.

4.4. Покупатель вправе:
4.4.1. Покупатель в любое время имеет право проверять ход поставки Товара, не вмешиваясь в деятельность Исполнителя.
4.4.2. При обнаружении Покупателем недопоставки, недостатков в Товаре, требовать от Исполнителя либо заменить любой компонент Товара или материала на новый, либо безвозмездно устранить недостатки в течение 15 (десяти) рабочих дней с даты обнаружения.

5. КАЧЕСТВО И ГАРАНТИЙНЫЙ СРОК
5.1. Гарантийный срок на Товар составляет 12 (двенадцать) месяцев с момента передачи Покупателю по накладным на отпуск запасов на сторону. Все гарантийные обязательства по замене или возврату на некачественной фурнитуры лежат на Поставщике. Гарантия распространяется на комплектующие Товара: на замки и ручки при условии, если будут соблюдены правила эксплуатации и ухода Покупателем.
5.2. В перечень гарантийных случаев не входят если:
1) имеются повреждения, нанесенные во время привоза и монтажа металлических дверей посторонними лицами;
2) нанесены повреждения вследствие природных катаклизмов, несчастных случаев, неосторожных и/или умышленных действий самого Покупателя или иных лиц.
3) при наличии поломок из-за попадания в дверные механизмы инородных предметов (влага, песок, строительный мусор и т.д.)
4) Покупатель нарушил одну из инструкций руководства по пользованию дверью, либо несвоевременно информировал Поставщика о наличии поломок, вызвавших выход из строя двери.
5) при наличии сбоев в работе изделия возникших из-за самостоятельного переделывания дверных компонентов, установки нефирменных механизмов.

6. ОТВЕТСТВЕННОСТЬ СТОРОН
6.1. Стороны несут ответственность за неисполнение, несвоевременное исполнение либо за некачественное исполнение обязательств по настоящему Договору в соответствии с условиями, установленными настоящим Договором, а также установленную законодательством Республики Казахстан.
6.2. Каждая из Сторон должна исполнить свои обязательства надлежащим образом.
6.3. В случае задержки сроков поставки Товара Поставщик выплачивает пеню в размере 10% от общей стоимости Договора, за каждый день просрочки, но не более 25% от общей стоимости Договора.
6.4. В случае задержки сроков устранения недопоставки, недостатков Товара и/или дефектов Поставщик оплачивает Покупателю пеню в размере 0,1% от общей стоимости недопоставленного материала и/или дефектов, но не более 10 % от общей стоимости Договора.
6.5. Выплата пени и штрафов не освобождает Стороны от исполнения обязательств по Договору.

7. ФОРС-МАЖОР
7.1. Стороны освобождаются от ответственности за полное или частичное неисполнение обязательств по Договору, если оно явилось следствием обстоятельств непреодолимой силы, а именно – пожара, наводнения, землетрясения, постановлений Правительства РК и местных органов власти и, если эти обстоятельства непосредственно повлияли на исполнение Договора. Если эти обстоятельства будут продолжаться более трех месяцев, то каждая Сторона имеет право аннулировать Договор, и в этом случае ни одна из Сторон не будет иметь право на возмещение убытков.
7.2. При возникновении форс-мажорных обстоятельств Поставщик должен незамедлительно направить Покупателю письменное уведомление о таких обстоятельствах и их причинах. Если от Покупателя не поступает иных письменных инструкций, Поставщик продолжает выполнять свои обязательства по Договору, насколько это целесообразно, и ведет поиск альтернативных способов выполнения Договора, не зависящих от форс-мажорных обстоятельств.
7.3. Поставщик не лишается своего обеспечения исполнения Договора и не несет ответственность за выплату неустоек или расторжение Договора в силу невыполнения его условий, если задержка с выполнением Договора является результатом форс-мажорных обстоятельств.

8. ПОРЯДОК РАЗРЕШЕНИЯ СПОРОВ
8.1. Все споры и разногласия, возникающие между сторонами по настоящему Договору или в связи с ним, разрешаются путем переговоров между Сторонами.
8.2. В случае невозможности разрешения разногласий путем переговоров они подлежат рассмотрению в порядке, установленном действующим законодательством Республики Казахстан, путем передачи на рассмотрение в международный арбитражный суд «ZAN» в г. Алматы согласно регламенту арбитража.

9. ПОРЯДОК ИЗМЕНЕНИЯ И РАСТОРЖЕНИЯ ДОГОВОРА
9.1. Любые изменения и дополнения к Договору оформляются в виде письменных дополнительных соглашений, согласованных и подписанных полномочными представителями Сторон.
9.2. Договор может быть расторгнут:
по согласованию Сторон;
по форс-мажорным обстоятельствам.
9.3. Покупатель вправе в одностороннем порядке отказаться от исполнения настоящего Договора в случае нарушения Исполнителем срока поставки согласно п. 3.1. Договора.
9.4. В случае досрочного расторжения настоящего Договора, в одностороннем порядке Сторона обязана уведомить об этом другую Сторону в письменной форме не менее, чем за 15 (пятнадцать) календарных дней.

10. ПРОЧИЕ УСЛОВИЯ
10.1. Срок действия настоящего Договора с даты его подписания и до полного исполнения Сторонами своих обязательств.
10.2. Любая договоренность между Сторонами, влекущая за собой новые обстоятельства, не предусмотренные Договором, считается действительной, если она подтверждена Сторонами в письменной форме в виде дополнительного соглашения.
10.3. Стороны обязаны информировать друг друга об изменении адресов и реквизитов, о реорганизации, либо ликвидации в целях полного и своевременного исполнения взаимных обязательств.
10.4. Риск случайной гибели или порчи Товара переходит на Покупателя с момента приемки Товара Покупателем.
10.5. Все указанные в Договоре приложения являются его неотъемлемой частью.
10.6. Настоящий Договор составлен, на русском языке, в двух экземплярах, по одному экземпляру для каждой из Сторон.`;
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

      // ---------- Таблица позиций (обёрнуто в функцию — для договора
      // вызывается позже, после текста и первой подписи, как «Приложение №1») ----------
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

      function drawItemsTable() {
        if (!items.length) return;
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

      function drawSignatures() {
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
        pdf.x = left;
        pdf.y = signY + 26;
      }

      if (doc.docType === 'contract') {
        // Договор: сначала сам текст, потом подпись под договором,
        // затем новая страница — «Приложение №1» со спецификацией и
        // отдельной подписью под ней (так принято оформлять поставку).
        ensureSpace(40);
        pdf.x = left;
        pdf.font('regular').fontSize(9.5).fillColor(INK)
          .text(doc.notes || contractTemplate(settings.name || 'USPORT', doc.clientName, doc.amount, settings.directorName, settings.licenseNumber), left, pdf.y, { width: contentWidth });
        pdf.x = left;
        pdf.moveDown(0.8);

        drawSignatures();

        if (items.length) {
          pdf.addPage();
          pdf.y = pdf.page.margins.top;
          pdf.x = left;
          pdf.font('bold').fontSize(13).fillColor(NAVY).text('ПРИЛОЖЕНИЕ №1', left, pdf.y, { width: contentWidth, align: 'center' });
          pdf.x = left;
          pdf.font('regular').fontSize(9).fillColor(SOFT)
            .text(`к Договору поставки № ${number} от ${fmtDate(doc.createdAt)}`, left, pdf.y, { width: contentWidth, align: 'center' });
          pdf.x = left;
          pdf.moveDown(0.3);
          pdf.font('bold').fontSize(10).fillColor(INK).text('СПЕЦИФИКАЦИЯ', left, pdf.y, { width: contentWidth, align: 'center' });
          pdf.x = left;
          pdf.moveDown(0.8);

          drawItemsTable();
          drawSignatures();
        }
      } else {
        drawItemsTable();

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

        if (doc.notes) {
          ensureSpace(40);
          pdf.x = left;
          pdf.font('bold').fontSize(9).fillColor(NAVY).text('УСЛОВИЯ', left, pdf.y, { width: contentWidth });
          pdf.x = left;
          pdf.font('regular').fontSize(9).fillColor(INK).text(doc.notes, left, pdf.y, { width: contentWidth });
          pdf.x = left;
          pdf.moveDown(0.6);
        }

        drawSignatures();
      }

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
