const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) {
  console.error("JWT_SECRET manquant ou trop court (16 caractères minimum). Vérifiez le fichier .env");
  process.exit(1);
}
const sign = u => jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: "7d" });
const auth = (req, res, next) => {
  const h = req.headers.authorization || "";
  try { req.user = jwt.verify(h.startsWith("Bearer ") ? h.slice(7) : "", SECRET); next(); }
  catch { res.status(401).json({ error: "Connexion requise" }); }
};
const admin = (req, res, next) =>
  req.user.role === "admin" ? next() : res.status(403).json({ error: "Accès réservé aux administrateurs" });
module.exports = { sign, auth, admin };
