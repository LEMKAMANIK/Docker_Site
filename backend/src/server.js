const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { sign, auth, admin } = require("./auth");

const SIZES = ["XS", "S", "M", "L", "XL"];
const FREE_SHIPPING = 10000, SHIPPING = 490; // en centimes
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 10);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const app = express();
app.set("trust proxy", 1); // derrière nginx
app.use(helmet());
app.use(express.json({ limit: "100kb" }));

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role });

app.get("/api/health", wrap(async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
}));

// ---------- Comptes ----------
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Trop de tentatives, réessayez dans quelques minutes" } });

app.post("/api/auth/register", authLimiter, wrap(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (typeof email !== "string" || !EMAIL.test(email) || email.length > 254) throw httpErr(400, "Adresse e-mail invalide");
  if (typeof password !== "string" || password.length < 8 || password.length > 72) throw httpErr(400, "Le mot de passe doit contenir entre 8 et 72 caractères");
  if (typeof name !== "string" || !name.trim() || name.length > 100) throw httpErr(400, "Nom requis");
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows: [u] } = await pool.query(
      "INSERT INTO users(email,password_hash,name) VALUES($1,$2,$3) RETURNING id,email,name,role",
      [email.trim().toLowerCase(), hash, name.trim()]);
    res.status(201).json({ token: sign(u), user: publicUser(u) });
  } catch (e) {
    if (e.code === "23505") throw httpErr(409, "Un compte existe déjà avec cet e-mail");
    throw e;
  }
}));

app.post("/api/auth/login", authLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") throw httpErr(400, "E-mail et mot de passe requis");
  const { rows: [u] } = await pool.query("SELECT * FROM users WHERE email=$1", [email.trim().toLowerCase()]);
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw httpErr(401, "E-mail ou mot de passe incorrect");
  res.json({ token: sign(u), user: publicUser(u) });
}));

app.get("/api/auth/me", auth, wrap(async (req, res) => {
  const { rows: [u] } = await pool.query("SELECT id,email,name,role FROM users WHERE id=$1", [req.user.id]);
  if (!u) throw httpErr(401, "Compte introuvable");
  res.json({ user: publicUser(u) });
}));

// Suppression du compte : les données personnelles sont effacées,
// les commandes sont conservées de façon anonyme (comptabilité).
app.delete("/api/auth/me", authLimiter, auth, wrap(async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== "string") throw httpErr(400, "Mot de passe requis");
  const { rows: [u] } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
  if (!u) throw httpErr(401, "Compte introuvable");
  if (!(await bcrypt.compare(password, u.password_hash))) throw httpErr(403, "Mot de passe incorrect");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("UPDATE orders SET user_id=NULL, ship_name='Compte supprimé', ship_address='', ship_zip='', ship_city='' WHERE user_id=$1", [req.user.id]);
    await c.query("DELETE FROM users WHERE id=$1", [req.user.id]);
    await c.query("COMMIT");
    res.status(204).end();
  } catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}));

// ---------- Produits ----------
app.get("/api/products", wrap(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id,name,cat,price::float AS price,color,bg,icon,tag FROM products WHERE active AND stock>0 ORDER BY id");
  res.json(rows);
}));

app.post("/api/products", auth, admin, wrap(async (req, res) => {
  const { name, cat, price, color, bg, icon, tag, stock } = req.body || {};
  if (![name, cat, color, bg, icon].every(v => typeof v === "string" && v.trim()) || !(price > 0) || !Number.isInteger(stock ?? 0))
    throw httpErr(400, "Champs invalides (name, cat, price, color, bg, icon requis)");
  const { rows: [p] } = await pool.query(
    "INSERT INTO products(name,cat,price,color,bg,icon,tag,stock) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [name, cat, price, color, bg, icon, tag || null, stock ?? 100]);
  res.status(201).json({ id: p.id });
}));

app.delete("/api/products/:id", auth, admin, wrap(async (req, res) => {
  const r = await pool.query("UPDATE products SET active=false WHERE id=$1", [parseInt(req.params.id, 10)]);
  if (!r.rowCount) throw httpErr(404, "Produit introuvable");
  res.status(204).end();
}));

// ---------- Commandes (les prix sont toujours relus en base) ----------
app.post("/api/orders", auth, wrap(async (req, res) => {
  const { items, address: a } = req.body || {};
  if (!Array.isArray(items) || !items.length || items.length > 50) throw httpErr(400, "Panier invalide");
  if (!a || !["name", "address", "zip", "city"].every(k => typeof a[k] === "string" && a[k].trim() && a[k].length <= 120))
    throw httpErr(400, "Adresse de livraison incomplète");
  for (const it of items)
    if (!Number.isInteger(it.id) || !SIZES.includes(it.size) || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > 20)
      throw httpErr(400, "Article invalide dans le panier");

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    let sub = 0; const lines = [];
    for (const it of items) {
      const { rows: [p] } = await c.query("SELECT id,name,price FROM products WHERE id=$1 AND active", [it.id]);
      if (!p) throw httpErr(400, "Un article n'existe plus");
      const u = await c.query("UPDATE products SET stock=stock-$1 WHERE id=$2 AND stock>=$1", [it.qty, p.id]);
      if (!u.rowCount) throw httpErr(409, `Stock insuffisant : ${p.name}`);
      const cents = Math.round(Number(p.price) * 100);
      sub += cents * it.qty; lines.push({ p, it, cents });
    }
    const ship = sub >= FREE_SHIPPING ? 0 : SHIPPING;
    const { rows: [o] } = await c.query(
      `INSERT INTO orders(user_id,total,shipping,ship_name,ship_address,ship_zip,ship_city)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,status`,
      [req.user.id, (sub + ship) / 100, ship / 100, a.name.trim(), a.address.trim(), a.zip.trim(), a.city.trim()]);
    for (const { p, it, cents } of lines)
      await c.query("INSERT INTO order_items(order_id,product_id,name,size,qty,unit_price) VALUES($1,$2,$3,$4,$5,$6)",
        [o.id, p.id, p.name, it.size, it.qty, cents / 100]);
    await c.query("COMMIT");
    res.status(201).json({ id: o.id, status: o.status, shipping: ship / 100, total: (sub + ship) / 100 });
  } catch (e) { await c.query("ROLLBACK"); throw e.code === "23503" ? httpErr(401, "Compte introuvable") : e; }
  finally { c.release(); }
}));

app.get("/api/orders", auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id,o.total::float AS total,o.shipping::float AS shipping,o.status,o.created_at,
       COALESCE(json_agg(json_build_object('name',i.name,'size',i.size,'qty',i.qty,'price',i.unit_price::float))
                FILTER (WHERE i.id IS NOT NULL),'[]') AS items
     FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
     WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC`, [req.user.id]);
  res.json(rows);
}));

app.use("/api", (req, res) => res.status(404).json({ error: "Route introuvable" }));
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") err = httpErr(400, "JSON invalide");
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? "Erreur interne du serveur" : err.message });
});

// Migration pour les bases créées avant l'ajout de la suppression de compte (sans effet sinon)
pool.query("ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL")
  .catch(e => console.error("Migration :", e.message))
  .then(() => app.listen(3000, () => console.log("API prête sur le port 3000")));
