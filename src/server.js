require('dotenv').config();
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET wajib diisi (minimal 32 karakter). Lihat .env.example');
  process.exit(1);
}
const express = require('express'), cookieParser = require('cookie-parser'), path = require('path');
const routes = require('./routes');
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:"
  });
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api', routes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use((err, req, res, next) => { // eslint-disable-line
  if (err.name === 'HttpError') return res.status(err.status).json({ error: err.message, fields: err.fields });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Format data tidak valid.' });
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Data tersebut sudah ada.' });
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY')
    return res.status(409).json({ error: 'Data ini masih dipakai data lain sehingga tidak bisa dihapus. Pindahkan atau hapus transaksi terkait terlebih dahulu.' });
  console.error(err); // detail hanya di log server
  res.status(500).json({ error: 'Terjadi kesalahan pada server. Coba lagi beberapa saat.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Home Finance berjalan di http://localhost:${port}`));
