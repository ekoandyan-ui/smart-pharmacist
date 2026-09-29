const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new DatabaseSync(path.join(__dirname, "smart-pharmacist.db"));

const USERS = {
  apoteker: { username: "apoteker", password: "apoteker123" },
  kurir: { username: "kurir", password: "kurir123" },
};
const TOKENS = new Map();

function bearerToken(req) {
  const head = req.headers.authorization || "";
  return head.startsWith("Bearer ") ? head.slice(7) : "";
}

function authRole(req, allowedRoles = []) {
  const token = bearerToken(req);
  const role = [...TOKENS.entries()].find(([, value]) => value === token)?.[0];
  if (!role || !allowedRoles.includes(role)) {
    return null;
  }
  return role;
}

db.exec(`
CREATE TABLE IF NOT EXISTS resep (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode TEXT UNIQUE, nama TEXT, no_hp TEXT, alamat TEXT, obat TEXT,
  metode TEXT, status TEXT DEFAULT 'Diterima', otp TEXT,
  dibuat TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT, resep_id INTEGER,
  pengirim TEXT, pesan TEXT, waktu TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pasien (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no_hp TEXT UNIQUE, sandi TEXT, dibuat TEXT DEFAULT CURRENT_TIMESTAMP
);`);

const ALUR = [
  "Diterima",
  "Ditelaah",
  "Disiapkan",
  "Dikemas",
  "Diantar",
  "Selesai",
];
const chatOf = (id) =>
  db
    .prepare(
      "SELECT pengirim,pesan,waktu FROM chat WHERE resep_id=? ORDER BY id",
    )
    .all(id);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/apoteker", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "apoteker.html"));
});

app.get("/kurir", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "kurir.html"));
});

app.post("/api/auth/login", (req, res) => {
  const { role, username, password } = req.body || {};
  if (!role || !USERS[role]) {
    return res.status(400).json({ error: "Role tidak valid" });
  }
  const account = USERS[role];
  if (username !== account.username || password !== account.password) {
    return res.status(401).json({ error: "Username atau password salah" });
  }
  const token = `smart-pharmacist-${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  TOKENS.set(role, token);
  res.json({ ok: true, role, token, username: account.username });
});

app.post("/api/auth/logout", (req, res) => {
  const token = bearerToken(req);
  for (const [key, value] of TOKENS) {
    if (value === token) TOKENS.delete(key);
  }
  res.json({ ok: true });
});

// Pasien: daftar akun
app.post("/api/pasien/daftar", (req, res) => {
  const no_hp = String((req.body || {}).no_hp || "").trim();
  const password = String((req.body || {}).password || "");
  if (!/^0\d{8,13}$/.test(no_hp))
    return res
      .status(400)
      .json({ error: "No. HP tidak valid, contoh: 081234567890" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password minimal 6 karakter" });
  if (db.prepare("SELECT 1 FROM pasien WHERE no_hp=?").get(no_hp))
    return res.status(400).json({ error: "No. HP sudah terdaftar" });
  db.prepare("INSERT INTO pasien (no_hp,sandi) VALUES (?,?)").run(
    no_hp,
    password,
  );
  res.json({ ok: true, no_hp });
});

// Pasien: login dengan no. HP + password
app.post("/api/pasien/login", (req, res) => {
  const no_hp = String((req.body || {}).no_hp || "").trim();
  const password = String((req.body || {}).password || "");
  const u = db.prepare("SELECT * FROM pasien WHERE no_hp=?").get(no_hp);
  if (!u || u.sandi !== password)
    return res.status(401).json({ error: "No. HP atau password salah" });
  const token = `smart-pharmacist-pasien-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  TOKENS.set(`pasien:${no_hp}`, token);
  res.json({ ok: true, role: "pasien", no_hp, token });
});

// Pasien: ajukan resep
app.post("/api/resep", (req, res) => {
  const { nama, no_hp, alamat, obat, metode } = req.body;
  if (!nama || !no_hp || !obat)
    return res
      .status(400)
      .json({ error: "Nama, No. HP, dan obat wajib diisi" });
  if (metode === "antar" && !alamat)
    return res.status(400).json({ error: "Alamat wajib untuk pengantaran" });
  const n = db.prepare("SELECT COALESCE(MAX(id),0)+1 AS n FROM resep").get().n;
  const kode = "SP-" + String(n).padStart(4, "0");
  db.prepare(
    "INSERT INTO resep (kode,nama,no_hp,alamat,obat,metode) VALUES (?,?,?,?,?,?)",
  ).run(
    kode,
    nama,
    no_hp,
    alamat || "",
    obat,
    metode === "ambil" ? "ambil" : "antar",
  );
  res.json({ kode });
});

// Pasien: lacak status (OTP hanya tampil saat obat diantar)
app.get("/api/track/:kode", (req, res) => {
  const r = db
    .prepare("SELECT * FROM resep WHERE kode=?")
    .get(req.params.kode.toUpperCase());
  if (!r) return res.status(404).json({ error: "Kode tidak ditemukan" });
  res.json({
    kode: r.kode,
    nama: r.nama,
    obat: r.obat,
    metode: r.metode,
    status: r.status,
    otp: r.status === "Diantar" ? r.otp : null,
    chat: chatOf(r.id),
    alur: ALUR,
  });
});

// Apoteker & Kurir: daftar resep
app.get("/api/resep", (req, res) => {
  const role = authRole(req, ["apoteker", "kurir"]);
  if (!role) return res.status(401).json({ error: "Unauthorized" });
  const rows = db
    .prepare(
      "SELECT id,kode,nama,no_hp,alamat,obat,metode,status,dibuat FROM resep ORDER BY id DESC",
    )
    .all();
  rows.forEach((r) => (r.chat = chatOf(r.id)));
  res.json({ alur: ALUR, data: rows });
});

// Apoteker: ubah status
app.patch("/api/resep/:id/status", (req, res) => {
  const role = authRole(req, ["apoteker"]);
  if (!role) return res.status(401).json({ error: "Unauthorized" });
  const { status } = req.body;
  if (!ALUR.includes(status))
    return res.status(400).json({ error: "Status tidak valid" });
  const otp =
    status === "Diantar"
      ? String(Math.floor(1000 + Math.random() * 9000))
      : null;
  db.prepare("UPDATE resep SET status=?, otp=COALESCE(?,otp) WHERE id=?").run(
    status,
    otp,
    req.params.id,
  );
  res.json({ ok: true });
});

// Chat pasien <-> apoteker
app.post("/api/resep/:id/chat", (req, res) => {
  const role = authRole(req, ["apoteker"]);
  if (!role) return res.status(401).json({ error: "Unauthorized" });
  const { pengirim, pesan } = req.body;
  if (!pesan || !["Pasien", "Apoteker"].includes(pengirim))
    return res.status(400).json({ error: "Pesan tidak valid" });
  db.prepare("INSERT INTO chat (resep_id,pengirim,pesan) VALUES (?,?,?)").run(
    req.params.id,
    pengirim,
    pesan,
  );
  res.json({ ok: true });
});

// Chat dari sisi pasien memakai kode resep
app.post("/api/track/:kode/chat", (req, res) => {
  const r = db
    .prepare("SELECT id FROM resep WHERE kode=?")
    .get(req.params.kode.toUpperCase());
  if (!r || !req.body.pesan)
    return res.status(400).json({ error: "Gagal mengirim pesan" });
  db.prepare("INSERT INTO chat (resep_id,pengirim,pesan) VALUES (?,?,?)").run(
    r.id,
    "Pasien",
    req.body.pesan,
  );
  res.json({ ok: true });
});

// Kurir: serah terima dengan OTP
app.post("/api/resep/:id/serah", (req, res) => {
  const role = authRole(req, ["kurir"]);
  if (!role) return res.status(401).json({ error: "Unauthorized" });
  const r = db.prepare("SELECT * FROM resep WHERE id=?").get(req.params.id);
  if (!r || r.status !== "Diantar")
    return res.status(400).json({ error: "Resep tidak dalam status diantar" });
  if (String(req.body.otp) !== r.otp)
    return res.status(400).json({ error: "OTP salah" });
  db.prepare("UPDATE resep SET status='Selesai' WHERE id=?").run(r.id);
  res.json({ ok: true });
});

app.listen(PORT, () =>
  console.log(`SMART PHARMACIST berjalan di http://localhost:${PORT}`),
);
