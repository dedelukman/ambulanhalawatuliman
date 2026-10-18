/* permintaan.js — halaman riwayat permintaan (permintaan.html)
   - Menampilkan semua permintaan dari Firestore
   - Filter rentang waktu (dari/sampai tanggal) + preset cepat
   - Menggunakan utilitas store.js: getAllPermintaan, filterPermintaanByRange, fieldLabel
   - Laporan rekap Excel/PDF memakai mesin generik di js/report.js */

let rangeFrom = '';
let rangeTo = '';

appOnReady(() => {
    const from = document.getElementById('rangeFrom');
    const to = document.getElementById('rangeTo');
    if (from) from.addEventListener('change', onRangeChange);
    if (to) to.addEventListener('change', onRangeChange);

    const reset = document.getElementById('rangeReset');
    if (reset) reset.addEventListener('click', () => {
        rangeFrom = '';
        rangeTo = '';
        if (from) from.value = '';
        if (to) to.value = '';
        render();
    });

    document.addEventListener('firestore:update', event => {
        if (event.detail && event.detail.key === STORE_KEYS.PERMINTAAN) render();
    });

    document.querySelectorAll('#rangePresets [data-preset]').forEach(btn => {
        btn.addEventListener('click', () => applyPreset(btn.getAttribute('data-preset')));
    });

    // Laporan rekap Excel (.xlsx) & PDF — mengikuti filter rentang waktu aktif
    const btnXls = document.getElementById('btnExportExcel');
    if (btnXls) btnXls.addEventListener('click', exportRecapExcel);
    const btnPdf = document.getElementById('btnExportPdf');
    if (btnPdf) btnPdf.addEventListener('click', exportRecapPdf);

    if (typeof applyRoleNav === 'function') applyRoleNav();
    render();
});

function onRangeChange() {
    const from = document.getElementById('rangeFrom');
    const to = document.getElementById('rangeTo');
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

function applyPreset(preset) {
    const today = new Date();
    let from = '';
    let to = toDateInput(today);

    if (preset === 'today') {
        from = to;
    } else if (preset === 'thisYear') {
        from = today.getFullYear() + '-01-01';
    } else {
        const days = parseInt(preset, 10);
        if (!isNaN(days)) {
            const start = new Date(today);
            start.setDate(start.getDate() - (days - 1));
            from = toDateInput(start);
        }
    }

    rangeFrom = from;
    rangeTo = to;
    const fromEl = document.getElementById('rangeFrom');
    const toEl = document.getElementById('rangeTo');
    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;
    render();
}

function toDateInput(d) {
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function render() {
    const all = getAllPermintaan();
    const list = filterPermintaanByRange(all, rangeFrom, rangeTo);
    const container = document.getElementById('requestList');
    const empty = document.getElementById('emptyState');
    if (!container || !empty) return;

    container.innerHTML = list.map(renderRow).join('');
    empty.classList.toggle('hidden', list.length > 0);

    setText('listCount', list.length + ' data');
    setText('rangeInfo', (rangeFrom || rangeTo)
        ? 'Menampilkan ' + list.length + ' dari ' + all.length + ' permintaan (' +
            (rangeFrom || '…') + ' s/d ' + (rangeTo || '…') + ').'
        : 'Menampilkan semua rentang waktu (' + all.length + ' permintaan).');
}

function renderRow(p) {
    const statusClass = p.status === 'Selesai' ? 'badge-green'
        : (p.status === 'Diproses' ? 'badge-amber'
        : (p.status === 'Batal' ? 'badge-slate' : 'badge-red'));

    const detail = p.detail && typeof p.detail === 'object' ? p.detail : {};
    const detailLines = Object.keys(detail)
        .filter(k => detail[k] !== undefined && detail[k] !== null && String(detail[k]).trim() !== '')
        .map(k => '<span class="block"><span class="text-slate-500">' + esc(fieldLabel(k)) +
            ':</span> ' + esc(detail[k]) + '</span>')
        .join('');

    return '<div class="row-card">' +
        '<div class="flex items-start justify-between gap-2">' +
            '<div class="min-w-0">' +
                '<div class="flex items-center gap-2 flex-wrap">' +
                    '<span class="mono font-bold text-sm text-slate-100">' + esc(p.id) + '</span>' +
                    '<span class="badge badge-purple">' + esc(p.jenis || p.type) + '</span>' +
                    '<span class="badge ' + statusClass + '">' + esc(p.status) + '</span>' +
                '</div>' +
                '<p class="text-[11px] text-slate-400 mt-0.5">' + esc(formatDateTime(p.createdAt)) + '</p>' +
            '</div>' +
        '</div>' +
        '<div class="mt-2 text-xs text-slate-300 space-y-0.5">' +
            '<p><span class="text-slate-500">Pemohon:</span> ' + esc(p.nama) +
                ' · <span class="mono">' + esc(p.hp) + '</span></p>' +
            '<p><span class="text-slate-500">Lokasi:</span> ' + esc(p.lokasi) + '</p>' +
            (detailLines ? '<p class="text-[11px] text-slate-400 pt-1 block space-y-0.5">' + detailLines + '</p>' : '') +
        '</div>' +
    '</div>';
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

/* ============ LAPORAN REKAP: EXCEL (.xlsx) & PDF ============
   Baris yang diekspor = baris yang sedang ditampilkan (ikut filter rentang waktu).
   Pembuatan file (.xlsx ZIP stored / PDF 1.4) ada di js/report.js (mesin generik). */

function collectRecap() {
    const all = getAllPermintaan();
    const list = filterPermintaanByRange(all, rangeFrom, rangeTo);
    const columns = ['ID', 'Tanggal', 'Jenis', 'Status', 'Pemohon', 'HP',
        'Lokasi', 'Armada', 'Tujuan', 'Sumber'];
    const rows = list.map(p => {
        const d = (p.detail && typeof p.detail === 'object') ? p.detail : {};
        return [
            String(p.id || ''), formatDateTime(p.createdAt), String(p.jenis || p.type || ''),
            String(p.status || ''), String(p.nama || ''), String(p.hp || ''), String(p.lokasi || ''),
            String(d.ambulan || ''), String(d.tujuan || ''), String(d.sumber || '')
        ];
    });
    const byStatus = { 'Menunggu': 0, 'Diproses': 0, 'Selesai': 0, 'Batal': 0 };
    const byJenis = {};
    list.forEach(p => {
        const s = String(p.status || '');
        byStatus[s] = (byStatus[s] || 0) + 1;
        const j = String(p.jenis || p.type || '-');
        byJenis[j] = (byJenis[j] || 0) + 1;
    });
    const summary = [
        { label: 'Total pada rentang ini', value: list.length },
        { label: 'Total semua data', value: all.length }
    ].concat(Object.keys(byStatus).map(k => ({ label: 'Status ' + k, value: byStatus[k] })))
     .concat(Object.keys(byJenis).map(k => ({ label: 'Jenis ' + k, value: byJenis[k] })));

    return {
        title: 'LAPORAN REKAP PERMINTAAN',
        org: 'Markaz Halawatul Iman',
        sheetName: 'Rekap Permintaan',
        period: (rangeFrom || rangeTo)
            ? (rangeFrom || '...') + ' s/d ' + (rangeTo || '...')
            : 'Semua rentang waktu',
        generated: formatDateTime(new Date().toISOString()),
        columns: columns, rows: rows, summary: summary
    };
}

function exportMsg(text) { setText('rangeInfo', text); }

function recapFilename(ext) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    const rentang = (rangeFrom && rangeTo) ? rangeFrom + '_' + rangeTo
        : (rangeFrom || rangeTo || 'semua');
    return 'Rekap-Permintaan_' + rentang + '_' + stamp + '.' + ext;
}

function exportRecapExcel() {
    const d = collectRecap();
    if (!d.rows.length) { exportMsg('Tidak ada data untuk diekspor pada rentang waktu ini.'); return; }
    downloadBytes(buildTableXlsx(d), recapFilename('xlsx'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    exportMsg('Rekap Excel diunduh: ' + recapFilename('xlsx') + ' (' + d.rows.length + ' baris).');
}

function exportRecapPdf() {
    const d = collectRecap();
    if (!d.rows.length) { exportMsg('Tidak ada data untuk diekspor pada rentang waktu ini.'); return; }
    downloadBytes(buildTablePdf(d), recapFilename('pdf'), 'application/pdf');
    exportMsg('Rekap PDF diunduh: ' + recapFilename('pdf') + ' (' + d.rows.length + ' baris).');
}
