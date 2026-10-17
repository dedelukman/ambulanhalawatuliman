/* kas.js — halaman catatan kas (kas.html)
   - Pemasukan: infak, sedekah, donasi, dll.
   - Pengeluaran: bensin, konsumsi driver, dll.
   - Hanya bisa diakses sesi admin atau driver (guard di kas.html + di sini)
   - Data di localStorage via utilitas store.js: getAllKas, addKas, removeKas, filterKasByRange */

const KAS_CATEGORIES = {
    masuk: ['Infak', 'Sedekah', 'Donasi', 'Infaq Jumat', 'Hasil Kegiatan', 'Lainnya'],
    keluar: ['Bensin', 'Konsumsi Driver', 'Servis Ambulans', 'Parkir', 'Administrasi', 'Lainnya']
};

let rangeFrom = '';
let rangeTo = '';
let currentRole = '';   // 'admin' | 'driver'
let currentName = '';

document.addEventListener('DOMContentLoaded', () => {
    // Guard ulang: tanpa sesi admin/driver, kembalikan ke login (kirim tujuan awal)
    const isAdmin = typeof isAdminLoggedIn === 'function' && isAdminLoggedIn();
    const isDrv = typeof isDriverLoggedIn === 'function' && isDriverLoggedIn();
    if (!isAdmin && !isDrv) {
        try { window.localStorage.setItem('si_next', 'kas.html'); } catch (e) {}
        window.location.replace('login.html');
        return;
    }

    currentRole = isAdmin ? 'admin' : 'driver';
    currentName = isAdmin
        ? (function () { const s = getAdminSession(); return (s && (s.name || s.username)) || 'Admin'; })()
        : (function () { const s = getDriverSession(); return (s && s.name) || 'Driver'; })();

    setText('kasWho', (currentRole === 'admin' ? 'Admin · ' : 'Driver · ') + currentName);

    // Tampilkan pintu balik ke panel peran masing-masing
    const navAdmin = document.getElementById('navAdmin');
    const navDriver = document.getElementById('navDriver');
    if (navAdmin) navAdmin.classList.toggle('hidden', currentRole !== 'admin');
    if (navDriver) navDriver.classList.toggle('hidden', currentRole !== 'driver');

    // Tanggal default = hari ini
    const dateEl = document.getElementById('kasDate');
    if (dateEl) dateEl.value = toDateInput(new Date());

    setupForm();
    setupFilter();
    setupLogout();
    setupExport();
    render();
});

function setupForm() {
    const typeEl = document.getElementById('kasType');
    if (typeEl) typeEl.addEventListener('change', fillCategories);
    fillCategories();

    const form = document.getElementById('kasForm');
    if (!form) return;
    form.addEventListener('submit', ev => {
        ev.preventDefault();

        const date = (document.getElementById('kasDate') || {}).value || '';
        const type = (document.getElementById('kasType') || {}).value || 'masuk';
        const category = (document.getElementById('kasCategory') || {}).value || '';
        const amount = Math.floor(Number((document.getElementById('kasAmount') || {}).value));
        const note = String((document.getElementById('kasNote') || {}).value || '').trim();
        const errorEl = document.getElementById('kasError');

        const valid = date && !isNaN(new Date(date + 'T00:00:00').getTime()) &&
            amount > 0 && KAS_CATEGORIES[type] && KAS_CATEGORIES[type].indexOf(category) !== -1;
        if (!valid) {
            if (errorEl) errorEl.classList.remove('hidden');
            return;
        }
        if (errorEl) errorEl.classList.add('hidden');

        addKas({
            id: makeId('KAS'),
            date: date,
            type: type,
            category: category,
            amount: amount,
            note: note,
            createdAt: new Date().toISOString(),
            by: currentName,
            role: currentRole
        });

        form.reset();
        if (typeEl) typeEl.value = type;
        fillCategories();
        const dateEl = document.getElementById('kasDate');
        if (dateEl && !dateEl.value) dateEl.value = toDateInput(new Date());
        render();
    });
}

function fillCategories() {
    const typeEl = document.getElementById('kasType');
    const catEl = document.getElementById('kasCategory');
    if (!catEl) return;
    const type = typeEl ? typeEl.value : 'masuk';
    const options = KAS_CATEGORIES[type] || KAS_CATEGORIES.masuk;
    const previous = catEl.value;
    catEl.innerHTML = options.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
    if (options.indexOf(previous) !== -1) catEl.value = previous;
}

function setupFilter() {
    const from = document.getElementById('kasRangeFrom');
    const to = document.getElementById('kasRangeTo');
    if (from) from.addEventListener('change', onRangeChange);
    if (to) to.addEventListener('change', onRangeChange);

    const reset = document.getElementById('kasRangeReset');
    if (reset) reset.addEventListener('click', () => {
        rangeFrom = '';
        rangeTo = '';
        if (from) from.value = '';
        if (to) to.value = '';
        render();
    });
}

function onRangeChange() {
    const from = document.getElementById('kasRangeFrom');
    const to = document.getElementById('kasRangeTo');
    rangeFrom = from ? from.value : '';
    rangeTo = to ? to.value : '';

    // Rentang terbalik? tukar agar hasil tetap masuk akal
    if (rangeFrom && rangeTo && rangeFrom > rangeTo) {
        const tmp = rangeFrom; rangeFrom = rangeTo; rangeTo = tmp;
        if (from) from.value = rangeFrom;
        if (to) to.value = rangeTo;
    }
    render();
}

function setupExport() {
    const btnXls = document.getElementById('btnKasExportExcel');
    if (btnXls) btnXls.addEventListener('click', exportKasExcel);
    const btnPdf = document.getElementById('btnKasExportPdf');
    if (btnPdf) btnPdf.addEventListener('click', exportKasPdf);
}

function setupLogout() {
    const btn = document.getElementById('kasLogoutBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (currentRole === 'admin') adminLogout();
        else driverLogout();
        window.location.href = 'index.html';
    });
}

function render() {
    const all = getAllKas();
    const list = filterKasByRange(all, rangeFrom, rangeTo).slice().sort((a, b) => {
        const da = String((a && a.date) || '');
        const db = String((b && b.date) || '');
        if (da !== db) return db.localeCompare(da);
        return String((b && b.createdAt) || '').localeCompare(String((a && a.createdAt) || ''));
    });

    let totalIn = 0;
    let totalOut = 0;
    list.forEach(k => {
        if (!k) return;
        if (k.type === 'masuk') totalIn += Number(k.amount) || 0;
        else totalOut += Number(k.amount) || 0;
    });

    setText('sumIn', formatRupiah(totalIn));
    setText('sumOut', formatRupiah(totalOut));
    setText('sumBalance', formatRupiah(totalIn - totalOut));

    const container = document.getElementById('kasList');
    const empty = document.getElementById('kasEmpty');
    if (container) container.innerHTML = list.map(renderRow).join('');
    if (empty) empty.classList.toggle('hidden', list.length > 0);

    setText('kasRangeInfo', (rangeFrom || rangeTo)
        ? 'Menampilkan ' + list.length + ' dari ' + all.length + ' transaksi (' +
            (rangeFrom || '…') + ' s/d ' + (rangeTo || '…') + ').'
        : 'Menampilkan semua transaksi (' + all.length + ' data).');
}

function renderRow(k) {
    const isMasuk = k.type === 'masuk';
    const sign = isMasuk ? '+' : '−';
    const amountClass = isMasuk ? 'text-emerald-400' : 'text-red-400';
    const badgeClass = isMasuk ? 'badge-green' : 'badge-red';

    return '<div class="row-card">' +
        '<div class="flex items-start justify-between gap-2">' +
            '<div class="min-w-0">' +
                '<div class="flex items-center gap-2 flex-wrap">' +
                    '<span class="badge ' + badgeClass + '">' + (isMasuk ? 'Masuk' : 'Keluar') + '</span>' +
                    '<span class="text-sm font-semibold text-slate-100">' + esc(k.category) + '</span>' +
                '</div>' +
                '<p class="text-[11px] text-slate-400 mt-0.5">' + esc(formatDateID(k.date)) +
                    (k.note ? ' · ' + esc(k.note) : '') + '</p>' +
                '<p class="text-[10px] text-slate-500 mt-0.5">' + esc(k.id) +
                    (k.by ? ' · dicatat ' + esc(k.by) : '') + '</p>' +
            '</div>' +
            '<div class="text-right shrink-0">' +
                '<div class="text-sm font-bold ' + amountClass + '">' + sign + ' ' + esc(formatRupiah(k.amount)) + '</div>' +
                '<button type="button" class="btn btn-ghost btn-sm mt-1 text-[11px]" data-del="' + esc(k.id) + '" title="Hapus catatan">' +
                    '<i class="fa-solid fa-trash"></i>' +
                '</button>' +
            '</div>' +
        '</div>' +
    '</div>';
}

// Delegasi event hapus (daftar dirender ulang tiap perubahan)
document.addEventListener('click', ev => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('[data-del]') : null;
    if (!btn) return;
    const id = btn.getAttribute('data-del');
    if (!id) return;
    if (window.confirm('Hapus catatan kas ' + id + '?')) {
        removeKas(id);
        render();
    }
});

function toDateInput(d) {
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function formatDateID(dateStr) {
    const d = new Date(String(dateStr || '') + 'T00:00:00');
    if (isNaN(d.getTime())) return '-';
    const pad = n => String(n).padStart(2, '0');
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

function formatRupiah(value) {
    const n = Number(value) || 0;
    try {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency', currency: 'IDR', maximumFractionDigits: 0
        }).format(n);
    } catch (err) {
        return 'Rp ' + n.toLocaleString('id-ID');
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

function esc(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* ============ LAPORAN REKAP KAS: EXCEL (.xlsx) & PDF ============
   Baris yang diekspor = transaksi yang sedang ditampilkan (ikut filter tanggal).
   Pembuatan file (.xlsx ZIP stored / PDF 1.4) memakai mesin generik di js/report.js. */

function collectKasRecap() {
    const all = getAllKas();
    const list = filterKasByRange(all, rangeFrom, rangeTo).slice().sort((a, b) => {
        const da = String((a && a.date) || '');
        const db = String((b && b.date) || '');
        if (da !== db) return da.localeCompare(db);
        return String((a && a.createdAt) || '').localeCompare(String((b && b.createdAt) || ''));
    });

    let totalIn = 0;
    let totalOut = 0;
    list.forEach(k => {
        if (!k) return;
        if (k.type === 'masuk') totalIn += Number(k.amount) || 0;
        else totalOut += Number(k.amount) || 0;
    });

    const columns = ['ID', 'Tanggal', 'Jenis', 'Kategori', 'Jumlah', 'Keterangan', 'Dicatat'];
    const rows = list.map(k => [
        String((k && k.id) || ''),
        formatDateID(k && k.date),
        (k && k.type === 'masuk') ? 'Pemasukan' : 'Pengeluaran',
        String((k && k.category) || ''),
        // Sel angka untuk Excel (bisa dijumlah), tampilan 'Rp …' untuk PDF
        { t: String(Number(k && k.amount) || 0), n: true, f: formatRupiah(k && k.amount) },
        String((k && k.note) || ''),
        (k && k.by) ? (k.by + (k.role ? ' (' + k.role + ')' : '')) : ''
    ]);

    const summary = [
        { label: 'Jumlah transaksi (rentang ini)', value: list.length },
        { label: 'Total semua transaksi', value: all.length },
        { label: 'Total Pemasukan (Rp)', value: totalIn },
        { label: 'Total Pengeluaran (Rp)', value: totalOut },
        { label: 'Saldo (Rp)', value: totalIn - totalOut }
    ];

    return {
        title: 'LAPORAN REKAP KAS',
        org: 'Markaz Halawatul Iman',
        sheetName: 'Rekap Kas',
        period: (rangeFrom || rangeTo)
            ? (rangeFrom || '...') + ' s/d ' + (rangeTo || '...')
            : 'Semua rentang waktu',
        generated: formatDateTime(new Date().toISOString()),
        columns: columns, rows: rows, summary: summary
    };
}

function exportKasMsg(text) { setText('kasRangeInfo', text); }

function kasRecapFilename(ext) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    const rentang = (rangeFrom && rangeTo) ? rangeFrom + '_' + rangeTo
        : (rangeFrom || rangeTo || 'semua');
    return 'Rekap-Kas_' + rentang + '_' + stamp + '.' + ext;
}

function exportKasExcel() {
    const d = collectKasRecap();
    if (!d.rows.length) { exportKasMsg('Tidak ada data untuk diekspor pada rentang waktu ini.'); return; }
    downloadBytes(buildTableXlsx(d), kasRecapFilename('xlsx'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    exportKasMsg('Rekap Excel diunduh: ' + kasRecapFilename('xlsx') + ' (' + d.rows.length + ' baris).');
}

function exportKasPdf() {
    const d = collectKasRecap();
    if (!d.rows.length) { exportKasMsg('Tidak ada data untuk diekspor pada rentang waktu ini.'); return; }
    downloadBytes(buildTablePdf(d), kasRecapFilename('pdf'), 'application/pdf');
    exportKasMsg('Rekap PDF diunduh: ' + kasRecapFilename('pdf') + ' (' + d.rows.length + ' baris).');
}