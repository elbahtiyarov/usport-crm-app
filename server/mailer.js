require('dotenv').config();
const nodemailer = require('nodemailer');

// Известные провайдеры "из коробки" — достаточно указать логин/пароль
// в .env, host/port подставляются автоматически.
const KNOWN_PROVIDERS = [
  {
    name: 'gmail',
    host: 'smtp.gmail.com', port: 587, secure: false,
    userEnv: 'GMAIL_USER', passEnv: 'GMAIL_PASS'
  },
  {
    name: 'yandex',
    host: 'smtp.yandex.ru', port: 465, secure: true,
    userEnv: 'YANDEX_USER', passEnv: 'YANDEX_PASS'
  },
  {
    name: 'mailru',
    host: 'smtp.mail.ru', port: 465, secure: true,
    userEnv: 'MAILRU_USER', passEnv: 'MAILRU_PASS'
  }
];

// Порядок перебора — если задан SMTP_ORDER=yandex,gmail,mailru, используем его,
// иначе порядок как в KNOWN_PROVIDERS выше.
function providerOrder(){
  const raw = (process.env.SMTP_ORDER || '').trim();
  if (!raw) return KNOWN_PROVIDERS.map(p => p.name).concat(['custom']);
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function buildTransporters(){
  const transporters = [];

  for (const p of KNOWN_PROVIDERS) {
    const user = process.env[p.userEnv];
    const pass = process.env[p.passEnv];
    if (user && pass) {
      transporters.push({
        name: p.name,
        from: process.env.SMTP_FROM || user,
        transport: nodemailer.createTransport({ host: p.host, port: p.port, secure: p.secure, auth: { user, pass } })
      });
    }
  }

  // Произвольный SMTP (свой домен / другой провайдер), если заполнен
  if (process.env.SMTP_HOST) {
    transporters.push({
      name: 'custom',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@usport.local',
      transport: nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
      })
    });
  }

  const order = providerOrder();
  transporters.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return transporters;
}

let cachedTransporters = null;
function getTransporters(){
  if (!cachedTransporters) cachedTransporters = buildTransporters();
  return cachedTransporters;
}

function buildMail(email, code, from){
  return {
    from,
    to: email,
    subject: 'Код для входа в USPORT CRM',
    text: `Ваш код для входа: ${code}\n\nКод действует 10 минут. Если вы не запрашивали вход — просто проигнорируйте это письмо.`,
    html: `
      <div style="font-family: Arial, sans-serif; font-size: 15px; color: #10141A;">
        <p>Ваш код для входа в <strong>USPORT CRM</strong>:</p>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${code}</p>
        <p style="color:#5B6270; font-size: 13px;">Код действует 10 минут. Если вы не запрашивали вход — просто проигнорируйте это письмо.</p>
      </div>
    `
  };
}

// Пробует провайдеров по очереди, пока один не отправит успешно.
// Если ни один не настроен или все упали — код печатается в консоль,
// чтобы можно было работать/тестировать без почты.
async function sendLoginCode(email, code){
  const transporters = getTransporters();

  if (transporters.length === 0) {
    console.log(`[mailer] SMTP не настроен. Код для ${email}: ${code}`);
    return { sent: false, devCode: code };
  }

  const errors = [];
  for (const t of transporters) {
    try {
      await t.transport.sendMail(buildMail(email, code, t.from));
      console.log(`[mailer] Письмо отправлено через ${t.name} на ${email}`);
      return { sent: true, provider: t.name };
    } catch (err) {
      console.error(`[mailer] Провайдер ${t.name} не сработал:`, err.message);
      errors.push(`${t.name}: ${err.message}`);
    }
  }

  console.log(`[mailer] Все провайдеры недоступны (${errors.join(' | ')}). Код для ${email}: ${code}`);
  return { sent: false, devCode: code };
}

module.exports = { sendLoginCode };
