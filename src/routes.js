const express = require('express'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const db = require('./db');
const r = express.Router();
const SECRET = process.env.JWT_SECRET;

class HttpError extends Error { constructor(s, m, f) { super(m); this.name = 'HttpError'; this.status = s; this.fields = f || {}; } }
const bad = (m, f) => new HttpError(400, m, f);
const notFound = () => new HttpError(404, 'Data tidak ditemukan.');
const wrap = fn => (req, res, next) => { try { fn(req, res); } catch (e) { next(e); } };
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isDate = s => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false; const d = new Date(s); return !isNaN(d) && d.toISOString().slice(0, 10) === s; };
const monthRange = (y, m) => [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-31`];
const posInt = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= 1e12 ? n : null; };

// ---------- Auth ----------
const sign = (res, uid) => res.cookie('token', jwt.sign({ uid }, SECRET, { expiresIn: '7d' }),
  { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 });
function auth(req, res, next) {
  try { req.uid = jwt.verify(req.cookies.token, SECRET).uid; next(); }
  catch { res.status(401).json({ error: 'Sesi berakhir. Silakan masuk kembali.' }); }
}
const INCOME = ['Gaji', 'Bonus', 'Lainnya'];
const EXPENSE = ['Makanan', 'Transportasi', 'Belanja', 'Pendidikan', 'Listrik', 'Air', 'Internet', 'Kesehatan', 'Hiburan', 'Lainnya'];

r.post('/auth/register', wrap((req, res) => {
  const { name, email, password } = req.body || {}, f = {};
  if (typeof name !== 'string' || !name.trim()) f.name = 'Nama wajib diisi.';
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) f.email = 'Email tidak valid.';
  if (typeof password !== 'string' || password.length < 8) f.password = 'Password minimal 8 karakter.';
  if (Object.keys(f).length) throw bad('Data tidak valid.', f);
  const em = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(em)) throw new HttpError(409, 'Email sudah terdaftar.', { email: 'Email sudah terdaftar.' });
  const nm = name.trim().slice(0, 100);
  const uid = db.transaction(() => {
    const id = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(nm, em, bcrypt.hashSync(password, 10)).lastInsertRowid;
    const ins = db.prepare('INSERT INTO categories(user_id,name,type) VALUES(?,?,?)');
    INCOME.forEach(n => ins.run(id, n, 'income')); EXPENSE.forEach(n => ins.run(id, n, 'expense'));
    return id;
  })();
  sign(res, uid); res.status(201).json({ user: { id: uid, name: nm, email: em } });
}));

r.post('/auth/login', wrap((req, res) => {
  const { email, password } = req.body || {};
  const u = typeof email === 'string' && typeof password === 'string' && db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.password_hash)) throw new HttpError(401, 'Email atau password salah.');
  sign(res, u.id); res.json({ user: { id: u.id, name: u.name, email: u.email } });
}));
r.post('/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

r.get('/auth/me', auth, wrap((req, res) => {
  const u = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.uid);
  if (!u) throw new HttpError(401, 'Sesi berakhir.'); res.json({ user: u });
}));
r.put('/auth/me', auth, wrap((req, res) => {
  const { name, current_password, new_password } = req.body || {}, f = {};
  if (typeof name !== 'string' || !name.trim()) f.name = 'Nama wajib diisi.';
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.uid);
  let hash = u.password_hash;
  if (new_password) {
    if (String(new_password).length < 8) f.new_password = 'Password baru minimal 8 karakter.';
    else if (!bcrypt.compareSync(String(current_password || ''), u.password_hash)) f.current_password = 'Password saat ini salah.';
    else hash = bcrypt.hashSync(String(new_password), 10);
  }
  if (Object.keys(f).length) throw bad('Data tidak valid.', f);
  db.prepare('UPDATE users SET name=?,password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name.trim().slice(0, 100), hash, req.uid);
  res.json({ user: { id: u.id, name: name.trim(), email: u.email } });
}));

// ---------- Categories ----------
r.get('/categories', auth, wrap((req, res) =>
  res.json(db.prepare('SELECT id,name,type FROM categories WHERE user_id=? ORDER BY type,name').all(req.uid))));
r.post('/categories', auth, wrap((req, res) => {
  const { name, type } = req.body || {}, f = {};
  if (!['income', 'expense'].includes(type)) f.type = 'Pilih jenis kategori.';
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 50) f.name = 'Nama wajib diisi (maks. 50 karakter).';
  if (Object.keys(f).length) throw bad('Data tidak valid.', f);
  const id = db.prepare('INSERT INTO categories(user_id,name,type) VALUES(?,?,?)').run(req.uid, name.trim(), type).lastInsertRowid;
  res.status(201).json({ id, name: name.trim(), type });
}));
r.put('/categories/:id', auth, wrap((req, res) => {
  const name = req.body && req.body.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 50) throw bad('Data tidak valid.', { name: 'Nama wajib diisi (maks. 50 karakter).' });
  if (!db.prepare('UPDATE categories SET name=? WHERE id=? AND user_id=?').run(name.trim(), req.params.id, req.uid).changes) throw notFound();
  res.json({ ok: true });
}));
r.delete('/categories/:id', auth, wrap((req, res) => {
  if (!db.prepare('DELETE FROM categories WHERE id=? AND user_id=?').run(req.params.id, req.uid).changes) throw notFound();
  res.json({ ok: true });
}));

// ---------- Transactions ----------
function txInput(uid, b) {
  b = b || {}; const f = {};
  if (!['income', 'expense'].includes(b.type)) f.type = 'Pilih jenis transaksi.';
  const amount = posInt(b.amount); if (!amount) f.amount = 'Jumlah harus bilangan bulat lebih dari 0.';
  if (!isDate(b.transaction_date)) f.transaction_date = 'Tanggal tidak valid.';
  const cat = db.prepare('SELECT id,type FROM categories WHERE id=? AND user_id=?').get(b.category_id, uid);
  if (!cat) f.category_id = 'Pilih kategori.'; else if (!f.type && cat.type !== b.type) f.category_id = 'Kategori tidak sesuai jenis transaksi.';
  if (Object.keys(f).length) throw bad('Data tidak valid.', f);
  return [b.type, amount, cat.id, b.transaction_date, String(b.payment_method || '').slice(0, 50), String(b.description || '').slice(0, 255)];
}
const TX_SEL = `SELECT t.id,t.type,t.amount,t.category_id,c.name category,t.transaction_date,t.payment_method,t.description
  FROM transactions t JOIN categories c ON c.id=t.category_id`;

r.get('/transactions', auth, wrap((req, res) => {
  const x = req.query, w = ['t.user_id=?'], p = [req.uid];
  if (['income', 'expense'].includes(x.type)) { w.push('t.type=?'); p.push(x.type); }
  if (x.category_id) { w.push('t.category_id=?'); p.push(Number(x.category_id)); }
  if (isDate(x.from)) { w.push('t.transaction_date>=?'); p.push(x.from); }
  if (isDate(x.to)) { w.push('t.transaction_date<=?'); p.push(x.to); }
  if (x.q) { const l = `%${String(x.q).slice(0, 100)}%`; w.push('(t.description LIKE ? OR c.name LIKE ? OR t.payment_method LIKE ?)'); p.push(l, l, l); }
  const limit = Math.min(Math.max(parseInt(x.limit) || 10, 1), 100), page = Math.max(parseInt(x.page) || 1, 1);
  const where = ' WHERE ' + w.join(' AND ');
  const total = db.prepare('SELECT COUNT(*) n FROM transactions t JOIN categories c ON c.id=t.category_id' + where).get(...p).n;
  const data = db.prepare(TX_SEL + where + ' ORDER BY t.transaction_date DESC,t.id DESC LIMIT ? OFFSET ?').all(...p, limit, (page - 1) * limit);
  res.json({ data, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
}));
r.get('/transactions/:id', auth, wrap((req, res) => {
  const t = db.prepare(TX_SEL + ' WHERE t.id=? AND t.user_id=?').get(req.params.id, req.uid);
  if (!t) throw notFound(); res.json(t);
}));
r.post('/transactions', auth, wrap((req, res) => {
  const v = txInput(req.uid, req.body);
  const id = db.prepare('INSERT INTO transactions(user_id,type,amount,category_id,transaction_date,payment_method,description) VALUES(?,?,?,?,?,?,?)').run(req.uid, ...v).lastInsertRowid;
  res.status(201).json({ id });
}));
r.put('/transactions/:id', auth, wrap((req, res) => {
  if (!db.prepare('SELECT 1 FROM transactions WHERE id=? AND user_id=?').get(req.params.id, req.uid)) throw notFound();
  db.prepare('UPDATE transactions SET type=?,amount=?,category_id=?,transaction_date=?,payment_method=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?')
    .run(...txInput(req.uid, req.body), req.params.id, req.uid);
  res.json({ ok: true });
}));
r.delete('/transactions/:id', auth, wrap((req, res) => {
  if (!db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(req.params.id, req.uid).changes) throw notFound();
  res.json({ ok: true });
}));

// ---------- Budgets ----------
const SPENT = `COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id=b.user_id AND t.category_id=b.category_id
  AND t.type='expense' AND t.transaction_date BETWEEN ? AND ?),0)`;
const budgetsFor = (uid, y, m) => db.prepare(`SELECT b.id,b.category_id,c.name category,b.amount,b.month,b.year,${SPENT} spent
  FROM budgets b JOIN categories c ON c.id=b.category_id WHERE b.user_id=? AND b.month=? AND b.year=? ORDER BY c.name`).all(...monthRange(y, m), uid, m, y);

r.get('/budgets', auth, wrap((req, res) => {
  const n = new Date(), m = parseInt(req.query.month) || n.getMonth() + 1, y = parseInt(req.query.year) || n.getFullYear();
  res.json(budgetsFor(req.uid, y, m));
}));
r.post('/budgets', auth, wrap((req, res) => {
  const b = req.body || {}, f = {}, amount = posInt(b.amount), m = Number(b.month), y = Number(b.year);
  if (!amount) f.amount = 'Jumlah harus bilangan bulat lebih dari 0.';
  if (!(Number.isInteger(m) && m >= 1 && m <= 12 && Number.isInteger(y) && y >= 2000 && y <= 2100)) f.month = 'Periode tidak valid.';
  const cat = db.prepare("SELECT id FROM categories WHERE id=? AND user_id=? AND type='expense'").get(b.category_id, req.uid);
  if (!cat) f.category_id = 'Pilih kategori pengeluaran.';
  if (Object.keys(f).length) throw bad('Data tidak valid.', f);
  db.prepare(`INSERT INTO budgets(user_id,category_id,amount,month,year) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id,category_id,month,year) DO UPDATE SET amount=excluded.amount,updated_at=CURRENT_TIMESTAMP`).run(req.uid, cat.id, amount, m, y);
  res.status(201).json({ ok: true });
}));
r.put('/budgets/:id', auth, wrap((req, res) => {
  const amount = posInt(req.body && req.body.amount);
  if (!amount) throw bad('Data tidak valid.', { amount: 'Jumlah harus bilangan bulat lebih dari 0.' });
  if (!db.prepare('UPDATE budgets SET amount=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(amount, req.params.id, req.uid).changes) throw notFound();
  res.json({ ok: true });
}));
r.delete('/budgets/:id', auth, wrap((req, res) => {
  if (!db.prepare('DELETE FROM budgets WHERE id=? AND user_id=?').run(req.params.id, req.uid).changes) throw notFound();
  res.json({ ok: true });
}));

// ---------- Dashboard ----------
r.get('/dashboard', auth, wrap((req, res) => {
  const u = req.uid, n = new Date(), y = n.getFullYear(), m = n.getMonth() + 1, [a, b] = monthRange(y, m);
  const balance = db.prepare("SELECT COALESCE(SUM(CASE type WHEN 'income' THEN amount ELSE -amount END),0) v FROM transactions WHERE user_id=?").get(u).v;
  const cur = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense, COUNT(*) count
    FROM transactions WHERE user_id=? AND transaction_date BETWEEN ? AND ?`).get(u, a, b);
  const start = ymd(new Date(y, n.getMonth() - 5, 1));
  const rows = db.prepare(`SELECT substr(transaction_date,1,7) m,COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense FROM transactions WHERE user_id=? AND transaction_date>=? GROUP BY m`).all(u, start);
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, n.getMonth() - i, 1), k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, f = rows.find(x => x.m === k);
    trend.push({ m: k, income: f ? f.income : 0, expense: f ? f.expense : 0 });
  }
  const byCategory = db.prepare(`SELECT c.name,SUM(t.amount) total FROM transactions t JOIN categories c ON c.id=t.category_id
    WHERE t.user_id=? AND t.type='expense' AND t.transaction_date BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`).all(u, a, b);
  const recent = db.prepare(TX_SEL + ' WHERE t.user_id=? ORDER BY t.transaction_date DESC,t.id DESC LIMIT 5').all(u);
  const alerts = budgetsFor(u, y, m).filter(x => x.spent / x.amount >= 0.7).sort((p, q) => q.spent / q.amount - p.spent / p.amount);
  res.json({ balance, ...cur, trend, byCategory, recent, alerts });
}));

// ---------- Reports ----------
function range(q) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth(); let a, b;
  switch (q.range) {
    case 'week': { const d = (n.getDay() + 6) % 7; a = new Date(y, m, n.getDate() - d); b = new Date(y, m, n.getDate() - d + 6); break; }
    case 'lastmonth': a = new Date(y, m - 1, 1); b = new Date(y, m, 0); break;
    case 'year': a = new Date(y, 0, 1); b = new Date(y, 11, 31); break;
    case 'custom':
      if (!isDate(q.from) || !isDate(q.to) || q.from > q.to) throw bad('Rentang tanggal tidak valid.');
      return [q.from, q.to];
    default: a = new Date(y, m, 1); b = new Date(y, m + 1, 0);
  }
  return [ymd(a), ymd(b)];
}
r.get('/reports', auth, wrap((req, res) => {
  const [a, b] = range(req.query), u = req.uid, days = (new Date(b) - new Date(a)) / 864e5;
  const key = days <= 62 ? 'transaction_date' : 'substr(transaction_date,1,7)';
  const sum = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense, COUNT(*) count
    FROM transactions WHERE user_id=? AND transaction_date BETWEEN ? AND ?`).get(u, a, b);
  const series = db.prepare(`SELECT ${key} k,COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense FROM transactions
    WHERE user_id=? AND transaction_date BETWEEN ? AND ? GROUP BY k ORDER BY k`).all(u, a, b);
  const byCategory = db.prepare(`SELECT c.name,SUM(t.amount) total FROM transactions t JOIN categories c ON c.id=t.category_id
    WHERE t.user_id=? AND t.type='expense' AND t.transaction_date BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`).all(u, a, b);
  res.json({ from: a, to: b, ...sum, net: sum.income - sum.expense, series, byCategory });
}));
r.get('/reports/export.csv', auth, wrap((req, res) => {
  const [a, b] = range(req.query);
  const rows = db.prepare(TX_SEL + ' WHERE t.user_id=? AND t.transaction_date BETWEEN ? AND ? ORDER BY t.transaction_date').all(req.uid, a, b);
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const csv = ['Tanggal,Jenis,Kategori,Jumlah,Metode,Catatan', ...rows.map(t =>
    [t.transaction_date, t.type === 'income' ? 'Pemasukan' : 'Pengeluaran', t.category, t.amount, t.payment_method, t.description].map(cell).join(','))].join('\r\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="home-finance-${a}_${b}.csv"` }).send('\ufeff' + csv);
}));

module.exports = r;
