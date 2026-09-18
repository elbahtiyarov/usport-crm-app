-- USPORT CRM — схема PostgreSQL
-- Применить: psql -U usport -d usport_crm -f schema.sql

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  source TEXT,
  requisites TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  specs TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT,
  stage TEXT NOT NULL DEFAULT 'request',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT,
  name TEXT NOT NULL,
  qty NUMERIC(12,2) NOT NULL DEFAULT 1,
  price NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  doc_type TEXT NOT NULL, -- kp | invoice | waybill | contract
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | sent | confirmed | declined
  notes TEXT,
  valid_until DATE,
  due_date DATE,
  ship_date DATE,
  sign_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_items (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  qty NUMERIC(12,2) NOT NULL DEFAULT 1,
  price NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Единственная строка с реквизитами компании
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  name TEXT NOT NULL DEFAULT 'USPORT',
  legal_address TEXT,
  phone TEXT,
  email TEXT,
  director_name TEXT,
  requisites TEXT,
  logo_url TEXT,
  CONSTRAINT settings_single_row CHECK (id = 1)
);

INSERT INTO settings (id, name) VALUES (1, 'USPORT')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_orders_stage ON orders(stage);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_document_items_doc ON document_items(document_id);

-- Авторизация: вход по коду на почту (без паролей)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'manager', -- manager | admin
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS auth_codes (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes(email);

-- Владелец записи: кто создал клиента/заказ/документ.
-- ON DELETE SET NULL — если пользователя удалят, его старые записи не
-- пропадают, просто становятся "ничьими" (редактировать сможет любой).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Фото товара (необязательное) — путь вида /uploads/<файл>
ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Фото позиции (переносится из каталога при добавлении в заказ/документ)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE document_items ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Кто добавил товар в каталог — только для отображения ("Автор"),
-- редактировать товар может любой (каталог общий для всей команды).
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Категории товаров — редактируемый список (раньше был зашит в коде).
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
-- Стартовый набор — те же категории, что раньше были жёстко зашиты.
-- ON CONFLICT ничего не делает, если их уже добавили/переименовали.
INSERT INTO categories (name) VALUES ('Обувь'), ('Одежда'), ('Инвентарь'), ('Аксессуары'), ('Прочее')
ON CONFLICT (name) DO NOTHING;

