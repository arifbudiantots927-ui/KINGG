'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const app = $('#app'), S = { user: null, cats: null }, PAGES = {};
let charts = [];

async function api(path, o = {}) {
  const r = await fetch('/api' + path, { method: o.method || 'GET', credentials: 'same-origin',
    headers: o.body ? { 'Content-Type': 'application/json' } : {}, body: o.body ? JSON.stringify(o.body) : undefined });
  let d = {}; try { d = await r.json(); } catch { /* bukan JSON */ }
  if (r.status === 401 && !path.startsWith('/auth/')) { S.user = null; route(); throw Object.assign(new Error(d.error), { handled: true }); }
  if (!r.ok) throw Object.assign(new Error(d.error || 'Terjadi kesalahan. Coba lagi.'), { fields: d.fields });
  return d;
}
const toast = (msg, kind = '') => { const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), 3500); };
const ask = (msg, label = 'Hapus') => new Promise(res => {
  const d = $('#confirm');
  d.innerHTML = `<div class="dlg"><p>${esc(msg)}</p><div class="row end"><button class="btn ghost" value="0">Batal</button><button class="btn danger" value="1">${esc(label)}</button></div></div>`;
  d.onclose = () => res(d.returnValue === '1');
  $$('button', d).forEach(b => b.onclick = () => d.close(b.value)); d.showModal();
});
const openModal = html => { const d = $('#modal'); d.innerHTML = `<div class="dlg">${html}</div>`; d.showModal(); return d; };
const closeModal = () => $('#modal').close();
const empty = (t, extra = '') => `<div class="empty">${esc(t)}${extra ? '<br>' + extra : ''}</div>`;
const errState = m => `<div class="state">${esc(m)}<br><button class="btn" data-retry>Coba lagi</button></div>`;
const loading = '<div class="state load">Memuat…</div>';
const fld = (label, name, inner) => `<label class="f"><span>${label}</span>${inner}<small class="err" data-err="${name}"></small></label>`;
const clearErrs = f => { $$('[data-err]', f).forEach(e => e.textContent = ''); const g = $('.form-err', f); if (g) g.textContent = ''; };
function showErrs(f, x) {
  let shown = false;
  for (const [k, v] of Object.entries(x.fields || {})) { const e = $(`[data-err="${k}"]`, f); if (e) { e.textContent = v; shown = true; } }
  const g = $('.form-err', f); if (g && !shown) g.textContent = x.message; else if (!shown) toast(x.message, 'err');
}
async function guard(m, fn) { m.innerHTML = loading; try { await fn(); } catch (e) { if (!e.handled) m.innerHTML = errState(e.message); } }
const cats = async (force) => (!S.cats || force) ? (S.cats = await api('/categories')) : S.cats;
const go = h => location.hash === h ? route() : (location.hash = h);

// ---------- Charts ----------
const COLORS = ['#0f3d3e', '#1e8a5b', '#f0b429', '#e2662d', '#c93c50', '#6c5ce7', '#3c8dbc', '#8d6e63', '#9aa5a1', '#2fa8a0'];
const mk = (id, cfg) => { const el = $(id); if (el) charts.push(new Chart(el, cfg)); };
const tickFmt = { ticks: { callback: v => rp(v) } };
const barCfg = (labels, inc, exp) => ({ type: 'bar', data: { labels, datasets: [
  { label: 'Pemasukan', data: inc, backgroundColor: '#1e8a5b', borderRadius: 4 }, { label: 'Pengeluaran', data: exp, backgroundColor: '#c93c50', borderRadius: 4 }] },
  options: { responsive: true, maintainAspectRatio: false, scales: { y: { ...tickFmt, beginAtZero: true } }, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${rp(c.parsed.y)}` } } } } });
const pieCfg = rows => ({ type: 'doughnut', data: { labels: rows.map(x => x.name), datasets: [{ data: rows.map(x => x.total), backgroundColor: COLORS }] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.label}: ${rp(c.parsed)}` } } } } });
const monthLabel = k => new Date(k + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });

// ---------- Shared bits ----------
const bstat = p => p > 100 ? ['over', 'Budget Terlampaui'] : p > 90 ? ['high', 'Hampir habis!'] : p >= 70 ? ['warn', 'Perhatian: mendekati batas'] : ['ok', 'Normal'];
function budgetBar(b) {
  const p = b.spent / b.amount * 100, [c, t] = bstat(p);
  return `<div class="bud"><div class="row between"><b>${esc(b.category)}</b><span class="tag ${c}">${t}</span></div>
  <div class="bar"><i class="${c}" style="width:${Math.min(p, 100)}%"></i></div>
  <small>Terpakai ${rp(b.spent)} dari ${rp(b.amount)} (${Math.round(p)}%). ${b.spent > b.amount ? 'Lebih ' + rp(b.spent - b.amount) : 'Sisa ' + rp(b.amount - b.spent)}</small></div>`;
}
const txRow = t => `<div class="li"><div><b>${esc(t.category)}</b><small>${fmtDate(t.transaction_date)}${t.description ? ' — ' + esc(t.description) : ''}</small></div>
  <b class="${t.type === 'income' ? 'inc' : 'exp'}">${t.type === 'income' ? '+' : '−'}${rp(t.amount)}</b></div>`;

// ---------- Auth ----------
function authView(mode) {
  const reg = mode === 'register';
  app.innerHTML = `<main class="auth"><section class="auth-brand"><h1>Home Finance</h1><p>Catat pemasukan dan pengeluaran rumah tangga, pantau budget, dan lihat ke mana uang pergi.</p></section>
  <form class="auth-card" id="af"><h2>${reg ? 'Buat akun' : 'Masuk'}</h2>
  ${reg ? fld('Nama', 'name', '<input name="name" autocomplete="name" maxlength="100" required>') : ''}
  ${fld('Email', 'email', '<input name="email" type="email" autocomplete="email" required>')}
  ${fld('Password', 'password', `<input name="password" type="password" minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}" required>${reg ? '<small>Minimal 8 karakter.</small>' : ''}`)}
  <p class="form-err" role="alert"></p><button class="btn primary block">${reg ? 'Daftar' : 'Masuk'}</button>
  <p class="alt">${reg ? 'Sudah punya akun? <a href="#/login">Masuk</a>' : 'Belum punya akun? <a href="#/register">Daftar</a>'}</p></form></main>`;
  $('#af').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = $('button', f); b.disabled = true; clearErrs(f);
    try { const d = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); S.user = d.user; S.cats = null; go('#/dashboard'); }
    catch (x) { showErrs(f, x); } b.disabled = false;
  };
}

// ---------- Shell & routing ----------
const NAV = [['dashboard', 'Dashboard'], ['transactions', 'Transaksi'], ['add', 'Tambah transaksi'], ['budget', 'Budget'], ['categories', 'Kategori'], ['reports', 'Laporan'], ['profile', 'Profil']];
const BOTTOM = [['dashboard', 'Beranda'], ['transactions', 'Transaksi'], ['add', '+ Tambah'], ['budget', 'Budget'], ['reports', 'Laporan']];
function route() {
  charts.forEach(c => c.destroy()); charts = [];
  const p = location.hash.replace('#/', '').split('?')[0];
  if (!S.user) return authView(p === 'register' ? 'register' : 'login');
  const page = PAGES[p] ? p : 'dashboard', link = ([k, l]) => `<a href="#/${k}" ${k === page ? 'class="on" aria-current="page"' : ''}>${l}</a>`;
  app.innerHTML = `<div class="shell"><aside class="side"><div class="logo">Home Finance</div><nav>${NAV.map(link).join('')}</nav><div class="who">${esc(S.user.name)}</div></aside>
  <header class="top"><b>Home Finance</b><span><a href="#/categories">Kategori</a><a href="#/profile">Profil</a></span></header>
  <main id="main" class="main"></main><nav class="bottom">${BOTTOM.map(link).join('')}</nav></div>`;
  PAGES[page]($('#main'));
}
document.addEventListener('click', e => { if (e.target.closest('[data-retry]')) route(); });
window.addEventListener('hashchange', route);

// ---------- Dashboard ----------
PAGES.dashboard = m => guard(m, async () => {
  const d = await api('/dashboard');
  m.innerHTML = `<h1>Halo, ${esc(S.user.name.split(' ')[0])}</h1>
  <section class="grid stats"><div class="card hero"><span>Saldo saat ini</span><strong>${rp(d.balance)}</strong></div>
  <div class="card"><span>Pemasukan bulan ini</span><strong class="inc">${rp(d.income)}</strong></div>
  <div class="card"><span>Pengeluaran bulan ini</span><strong class="exp">${rp(d.expense)}</strong></div>
  <div class="card"><span>Transaksi bulan ini</span><strong>${d.count}</strong></div></section>
  <section class="grid two"><div class="card"><h3>Pemasukan vs pengeluaran (6 bulan)</h3><div class="chart"><canvas id="c1"></canvas></div></div>
  <div class="card"><h3>Pengeluaran per kategori bulan ini</h3>${d.byCategory.length ? '<div class="chart"><canvas id="c2"></canvas></div>' : empty('Belum ada pengeluaran bulan ini.')}</div></section>
  <section class="grid two"><div class="card"><h3>Transaksi terbaru</h3>${d.recent.length ? d.recent.map(txRow).join('') : empty('Belum ada transaksi.', '<a class="btn primary" href="#/add">Tambah transaksi</a>')}</div>
  <div class="card"><h3>Budget bulan ini</h3>${d.alerts.length ? d.alerts.map(budgetBar).join('') : empty('Tidak ada budget yang mendekati batas.')}</div></section>`;
  mk('#c1', barCfg(d.trend.map(t => monthLabel(t.m)), d.trend.map(t => t.income), d.trend.map(t => t.expense)));
  if (d.byCategory.length) mk('#c2', pieCfg(d.byCategory));
});

// ---------- Transaction form (dipakai halaman Tambah & modal Edit) ----------
const METHODS = ['Tunai', 'Transfer bank', 'Kartu debit', 'Kartu kredit', 'E-wallet', 'Lainnya'];
function txFormHTML(tx) {
  const t = tx || { type: 'expense', transaction_date: today(), payment_method: 'Tunai' };
  const ms = METHODS.includes(t.payment_method) || !t.payment_method ? METHODS : [...METHODS, t.payment_method];
  return `<form id="txf"><div class="seg" role="radiogroup" aria-label="Jenis transaksi">
  <label><input type="radio" name="type" value="expense" ${t.type === 'expense' ? 'checked' : ''}>Pengeluaran</label>
  <label><input type="radio" name="type" value="income" ${t.type === 'income' ? 'checked' : ''}>Pemasukan</label></div>
  ${fld('Jumlah (Rp)', 'amount', `<input name="amount" type="number" min="1" step="1" inputmode="numeric" value="${t.amount || ''}" required>`)}
  ${fld('Kategori', 'category_id', '<select name="category_id" required></select>')}
  ${fld('Tanggal', 'transaction_date', `<input name="transaction_date" type="date" value="${t.transaction_date}" required>`)}
  ${fld('Metode pembayaran', 'payment_method', `<select name="payment_method">${ms.map(x => `<option ${x === t.payment_method ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`)}
  ${fld('Catatan', 'description', `<input name="description" maxlength="255" value="${esc(t.description || '')}">`)}
  <p class="form-err" role="alert"></p><div class="row end">${tx ? '<button type="button" class="btn ghost" data-close>Batal</button>' : ''}<button type="submit" class="btn primary">${tx ? 'Simpan perubahan' : 'Simpan transaksi'}</button></div></form>`;
}
function bindTx(f, cs, tx, done) {
  const sel = f.elements.category_id;
  const fill = () => { const t = f.elements.type.value; sel.innerHTML = '<option value="">Pilih kategori</option>' + cs.filter(c => c.type === t).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join(''); if (tx && tx.type === t) sel.value = tx.category_id; };
  $$('[name=type]', f).forEach(r => r.onchange = fill); fill();
  const cl = $('[data-close]', f); if (cl) cl.onclick = closeModal;
  f.onsubmit = async e => {
    e.preventDefault(); clearErrs(f); const b = $('[type=submit]', f); b.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(f)); body.amount = Number(body.amount); body.category_id = Number(body.category_id) || null;
      await api(tx ? '/transactions/' + tx.id : '/transactions', { method: tx ? 'PUT' : 'POST', body });
      toast(tx ? 'Transaksi diperbarui.' : 'Transaksi ditambahkan.'); done();
    } catch (x) { if (!x.handled) showErrs(f, x); } b.disabled = false;
  };
}
PAGES.add = m => guard(m, async () => {
  const cs = await cats();
  m.innerHTML = `<h1>Tambah transaksi</h1><div class="card" style="max-width:520px">${txFormHTML()}</div>`;
  bindTx($('#txf', m), cs, null, () => go('#/dashboard'));
});

// ---------- Transactions ----------
PAGES.transactions = m => guard(m, async () => {
  const cs = await cats(), F = { q: '', type: '', category_id: '', from: '', to: '', page: 1 };
  m.innerHTML = `<div class="row between"><h1>Transaksi</h1><a class="btn primary" href="#/add">Tambah transaksi</a></div>
  <div class="card filters"><input name="q" type="search" placeholder="Cari catatan, kategori…" aria-label="Cari">
  <select name="type" aria-label="Jenis"><option value="">Semua jenis</option><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></select>
  <select name="category_id" aria-label="Kategori"><option value="">Semua kategori</option>${cs.map(c => `<option value="${c.id}">${esc(c.name)} (${c.type === 'income' ? 'masuk' : 'keluar'})</option>`).join('')}</select>
  <input name="from" type="date" aria-label="Dari tanggal"><input name="to" type="date" aria-label="Sampai tanggal"></div><div class="card" id="list"></div>`;
  const list = $('#list', m); let rows = [], timer;
  const draw = async () => {
    list.innerHTML = loading;
    try {
      const d = await api('/transactions?' + new URLSearchParams(Object.entries(F).filter(([, v]) => v))); rows = d.data;
      list.innerHTML = !rows.length ? empty(d.total || Object.values(F).some(v => v && v !== 1) ? 'Tidak ada transaksi yang cocok dengan filter.' : 'Belum ada transaksi.', '<a class="btn primary" href="#/add">Tambah transaksi</a>')
        : `<table class="tbl"><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th class="r">Jumlah</th><th>Metode</th><th>Catatan</th><th>Aksi</th></tr></thead><tbody>${rows.map(t => `<tr>
        <td data-l="Tanggal">${fmtDate(t.transaction_date)}</td><td data-l="Jenis">${t.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</td><td data-l="Kategori">${esc(t.category)}</td>
        <td data-l="Jumlah" class="r ${t.type === 'income' ? 'inc' : 'exp'}"><b>${rp(t.amount)}</b></td><td data-l="Metode">${esc(t.payment_method || '-')}</td><td data-l="Catatan">${esc(t.description || '-')}</td>
        <td class="acts"><button class="btn sm" data-edit="${t.id}">Edit</button> <button class="btn sm" data-del="${t.id}">Hapus</button></td></tr>`).join('')}</tbody></table>
        <div class="pager"><button class="btn sm" data-pg="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>Sebelumnya</button><span>Halaman ${d.page} dari ${d.pages} (${d.total} transaksi)</span><button class="btn sm" data-pg="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Berikutnya</button></div>`;
    } catch (e) { if (!e.handled) list.innerHTML = errState(e.message); }
  };
  $$('.filters [name]', m).forEach(el => el.oninput = () => { F[el.name] = el.value; F.page = 1; clearTimeout(timer); timer = setTimeout(draw, el.name === 'q' ? 300 : 0); });
  list.onclick = async e => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]'), pg = e.target.closest('[data-pg]');
    if (pg) { F.page = Number(pg.dataset.pg); draw(); }
    if (ed) { const t = rows.find(x => x.id == ed.dataset.edit); const d = openModal(`<h2>Edit transaksi</h2>${txFormHTML(t)}`); bindTx($('#txf', d), cs, t, () => { closeModal(); draw(); }); }
    if (del && await ask('Hapus transaksi ini? Tindakan ini tidak bisa dibatalkan.')) {
      try { await api('/transactions/' + del.dataset.del, { method: 'DELETE' }); toast('Transaksi dihapus.'); draw(); } catch (x) { if (!x.handled) toast(x.message, 'err'); }
    }
  };
  draw();
});

// ---------- Budget ----------
PAGES.budget = m => guard(m, async () => {
  const cs = (await cats()).filter(c => c.type === 'expense'), n = new Date();
  let ym = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`, rows = [];
  m.innerHTML = `<div class="row between"><h1>Budget</h1><div class="row"><input type="month" id="ym" value="${ym}" aria-label="Periode" style="width:auto"><button class="btn primary" id="addb">Tambah budget</button></div></div><div class="card" id="bl"></div>`;
  const bl = $('#bl', m), per = () => ym.split('-').map(Number);
  const draw = async () => {
    bl.innerHTML = loading; const [y, mo] = per();
    try {
      rows = await api(`/budgets?month=${mo}&year=${y}`);
      bl.innerHTML = rows.length ? rows.map(b => budgetBar(b).replace('</small></div>', `</small><div class="row" style="margin-top:8px"><button class="btn sm" data-eb="${b.id}">Ubah</button><button class="btn sm" data-db="${b.id}">Hapus</button></div></div>`)).join('') : empty('Belum ada budget untuk bulan ini.');
    } catch (e) { if (!e.handled) bl.innerHTML = errState(e.message); }
  };
  const form = b => {
    const d = openModal(`<h2>${b ? 'Ubah budget' : 'Tambah budget'}</h2><form id="bf">${b ? '' : fld('Kategori', 'category_id', `<select name="category_id" required><option value="">Pilih kategori</option>${cs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`)}
    ${fld('Budget (Rp)', 'amount', `<input name="amount" type="number" min="1" step="1" value="${b ? b.amount : ''}" required>`)}<small class="err" data-err="month"></small><p class="form-err" role="alert"></p>
    <div class="row end"><button type="button" class="btn ghost" data-close>Batal</button><button class="btn primary">Simpan</button></div></form>`);
    const f = $('#bf', d); $('[data-close]', f).onclick = closeModal;
    f.onsubmit = async e => {
      e.preventDefault(); clearErrs(f); const v = Object.fromEntries(new FormData(f)), [y, mo] = per();
      try { await api(b ? '/budgets/' + b.id : '/budgets', { method: b ? 'PUT' : 'POST', body: b ? { amount: Number(v.amount) } : { category_id: Number(v.category_id), amount: Number(v.amount), month: mo, year: y } }); toast('Budget disimpan.'); closeModal(); draw(); }
      catch (x) { if (!x.handled) showErrs(f, x); }
    };
  };
  $('#ym', m).onchange = e => { if (e.target.value) { ym = e.target.value; draw(); } };
  $('#addb', m).onclick = () => form(null);
  bl.onclick = async e => {
    const eb = e.target.closest('[data-eb]'), db = e.target.closest('[data-db]');
    if (eb) form(rows.find(x => x.id == eb.dataset.eb));
    if (db && await ask('Hapus budget ini?')) { try { await api('/budgets/' + db.dataset.db, { method: 'DELETE' }); toast('Budget dihapus.'); draw(); } catch (x) { if (!x.handled) toast(x.message, 'err'); } }
  };
  draw();
});

// ---------- Categories ----------
PAGES.categories = m => guard(m, async () => {
  const draw = async () => {
    const cs = await cats(true), col = (t, title) => `<div class="card"><h3>${title}</h3>${cs.filter(c => c.type === t).map(c => `<div class="li"><span>${esc(c.name)}</span><span><button class="btn sm" data-ec="${c.id}">Ubah</button> <button class="btn sm" data-dc="${c.id}">Hapus</button></span></div>`).join('') || empty('Belum ada kategori.')}</div>`;
    m.innerHTML = `<h1>Kategori</h1><form class="card row" id="cf" style="margin-bottom:14px;align-items:flex-start"><div style="flex:1;min-width:180px">${fld('Nama kategori', 'name', '<input name="name" maxlength="50" required>')}</div>
    <div style="min-width:160px">${fld('Jenis', 'type', '<select name="type"><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></select>')}</div>
    <button class="btn primary" style="margin-top:24px">Tambah</button><p class="form-err" role="alert" style="width:100%"></p></form>
    <section class="grid two">${col('expense', 'Pengeluaran')}${col('income', 'Pemasukan')}</section>`;
    const cf = $('#cf', m);
    cf.onsubmit = async e => { e.preventDefault(); clearErrs(cf); try { await api('/categories', { method: 'POST', body: Object.fromEntries(new FormData(cf)) }); toast('Kategori ditambahkan.'); draw(); } catch (x) { if (!x.handled) showErrs(cf, x); } };
    m.onclick = async e => {
      const ec = e.target.closest('[data-ec]'), dc = e.target.closest('[data-dc]');
      if (ec) {
        const c = cs.find(x => x.id == ec.dataset.ec), d = openModal(`<h2>Ubah kategori</h2><form id="ef">${fld('Nama', 'name', `<input name="name" maxlength="50" value="${esc(c.name)}" required>`)}<p class="form-err" role="alert"></p><div class="row end"><button type="button" class="btn ghost" data-close>Batal</button><button class="btn primary">Simpan</button></div></form>`);
        const f = $('#ef', d); $('[data-close]', f).onclick = closeModal;
        f.onsubmit = async ev => { ev.preventDefault(); clearErrs(f); try { await api('/categories/' + c.id, { method: 'PUT', body: { name: f.elements.name.value } }); toast('Kategori diperbarui.'); closeModal(); draw(); } catch (x) { if (!x.handled) showErrs(f, x); } };
      }
      if (dc && await ask('Hapus kategori ini? Kategori yang masih dipakai transaksi tidak bisa dihapus.')) {
        try { await api('/categories/' + dc.dataset.dc, { method: 'DELETE' }); toast('Kategori dihapus.'); draw(); } catch (x) { if (!x.handled) toast(x.message, 'err'); }
      }
    };
  };
  await draw();
});

// ---------- Reports ----------
PAGES.reports = m => guard(m, async () => {
  const P = { range: 'month', from: today(), to: today() };
  m.innerHTML = `<div class="row between"><h1>Laporan</h1><a class="btn" id="exp" href="#">Ekspor CSV</a></div>
  <div class="card filters"><select id="rg" aria-label="Periode"><option value="week">Minggu ini</option><option value="month" selected>Bulan ini</option><option value="lastmonth">Bulan sebelumnya</option><option value="year">Tahun ini</option><option value="custom">Rentang tanggal…</option></select>
  <input type="date" id="fr" value="${P.from}" hidden aria-label="Dari"><input type="date" id="to" value="${P.to}" hidden aria-label="Sampai"></div><div id="rp"></div>`;
  const out = $('#rp', m), qs = () => new URLSearchParams(P.range === 'custom' ? P : { range: P.range }).toString();
  const draw = async () => {
    charts.forEach(c => c.destroy()); charts = []; out.innerHTML = loading; $('#exp', m).href = '/api/reports/export.csv?' + qs();
    try {
      const d = await api('/reports?' + qs()), monthly = d.series.length && d.series[0].k.length === 7;
      out.innerHTML = `<p><small>${fmtDate(d.from)} – ${fmtDate(d.to)}</small></p><section class="grid stats"><div class="card"><span>Total pemasukan</span><strong class="inc">${rp(d.income)}</strong></div>
      <div class="card"><span>Total pengeluaran</span><strong class="exp">${rp(d.expense)}</strong></div><div class="card"><span>Selisih</span><strong class="${d.net < 0 ? 'exp' : 'inc'}">${rp(d.net)}</strong></div></section>
      ${d.count ? `<section class="grid two"><div class="card"><h3>Pemasukan dan pengeluaran</h3><div class="chart"><canvas id="r1"></canvas></div></div>
      <div class="card"><h3>Pengeluaran per kategori</h3>${d.byCategory.length ? '<div class="chart"><canvas id="r2"></canvas></div>' : empty('Tidak ada pengeluaran.')}</div></section>
      <div class="card"><h3>Rincian pengeluaran</h3>${d.byCategory.map(c => `<div class="li"><span>${esc(c.name)}</span><span><b>${rp(c.total)}</b> <small style="display:inline">(${d.expense ? Math.round(c.total / d.expense * 100) : 0}%)</small></span></div>`).join('') || empty('Tidak ada pengeluaran.')}</div>` : empty('Tidak ada transaksi pada periode ini.')}`;
      if (d.count) {
        mk('#r1', barCfg(d.series.map(s => monthly ? monthLabel(s.k) : fmtDate(s.k)), d.series.map(s => s.income), d.series.map(s => s.expense)));
        if (d.byCategory.length) mk('#r2', pieCfg(d.byCategory));
      }
    } catch (e) { if (!e.handled) out.innerHTML = errState(e.message); }
  };
  $('#rg', m).onchange = e => { P.range = e.target.value; $('#fr', m).hidden = $('#to', m).hidden = P.range !== 'custom'; draw(); };
  $('#fr', m).onchange = e => { P.from = e.target.value; if (P.from && P.to) draw(); };
  $('#to', m).onchange = e => { P.to = e.target.value; if (P.from && P.to) draw(); };
  draw();
});

// ---------- Profile ----------
PAGES.profile = m => {
  m.innerHTML = `<h1>Profil</h1><form class="card" id="pf" style="max-width:520px">${fld('Nama', 'name', `<input name="name" maxlength="100" value="${esc(S.user.name)}" required>`)}
  <label class="f"><span>Email</span><input value="${esc(S.user.email)}" disabled></label>
  <h3>Ganti password</h3>${fld('Password saat ini', 'current_password', '<input name="current_password" type="password" autocomplete="current-password">')}${fld('Password baru (min. 8 karakter)', 'new_password', '<input name="new_password" type="password" minlength="8" autocomplete="new-password">')}
  <p class="form-err" role="alert"></p><div class="row between"><button class="btn primary">Simpan</button><button type="button" class="btn" id="lo">Keluar</button></div></form>`;
  const f = $('#pf', m);
  f.onsubmit = async e => {
    e.preventDefault(); clearErrs(f);
    try { const d = await api('/auth/me', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); S.user = d.user; toast('Profil disimpan.'); f.elements.current_password.value = f.elements.new_password.value = ''; $('.who').textContent = d.user.name; }
    catch (x) { if (!x.handled) showErrs(f, x); }
  };
  $('#lo', m).onclick = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* abaikan */ } S.user = null; S.cats = null; go('#/login'); };
};

// ---------- Init ----------
(async () => { try { S.user = (await api('/auth/me')).user; } catch { /* belum login */ } route(); })();
