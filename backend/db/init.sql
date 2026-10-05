-- Exécuté automatiquement au premier démarrage de la base
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE products (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  cat    TEXT NOT NULL,
  price  NUMERIC(10,2) NOT NULL CHECK (price > 0),
  color  TEXT NOT NULL,
  bg     TEXT NOT NULL,
  icon   TEXT NOT NULL,
  tag    TEXT,
  stock  INTEGER NOT NULL DEFAULT 100 CHECK (stock >= 0),
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE orders (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),  -- NULL si le compte a été supprimé
  total        NUMERIC(10,2) NOT NULL,
  shipping     NUMERIC(10,2) NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','shipped','cancelled')),
  ship_name    TEXT NOT NULL,
  ship_address TEXT NOT NULL,
  ship_zip     TEXT NOT NULL,
  ship_city    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name       TEXT NOT NULL,
  size       TEXT NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10,2) NOT NULL
);
CREATE INDEX orders_user_idx ON orders(user_id);

INSERT INTO products (name,cat,price,color,bg,icon,tag) VALUES
('T-shirt coton bio','Hauts','29','Bleu nuit','#14213d','shirt','Nouveau'),
('Chemise lin','Hauts','69','Sauge','#7a8f6b','shirt',NULL),
('Pull laine mérinos','Hauts','95','Brique','#a34a3a','shirt',NULL),
('Pantalon chino','Bas','79','Sable','#b9a98a','pants',NULL),
('Jean droit brut','Bas','89','Indigo','#2d4cff','pants','Best-seller'),
('Short en lin','Bas','49','Gris pierre','#8a8f98','pants',NULL),
('Veste workwear','Vestes','139','Olive','#4d5a3c','coat',NULL),
('Manteau long','Vestes','189','Anthracite','#2b2f38','coat','-20 %');
