/* admin.js — logika panel admin (admin.html)
   - CRUD data ambulans & driver (tersimpan di Firestore, dibaca ulang oleh dashboard)
   - CRUD permintaan dari halaman utama (status: Menunggu / Diproses / Selesai / Batal)
   Semua aksi memakai utilitas di store.js. */

const TAB_META = {
    ambulans: { title: 'Data Ambulans', countLabel: 'unit terdaftar', addLabel: 'Tambah Ambulans' },
    driver: { title: 'Data Driver', countLabel: 'driver terdaftar', addLabel: 'Tambah Driver' },
    permintaan: { title: 'Permintaan Masuk', countLabel: 'permintaan', addLabel: 'Hapus Semua' }
};

const AMBULANCE_FIELDS = [
    { key: 'name', label: 'Nama armada', type: 'text', required: true, placeholder: 'Ambulans 03' },
    { key: 'type', label: 'Tipe armada', type: 'text', placeholder: 'Transport / Type B' },
    { key: 'plate', label: 'Plat nomor', type: 'text', placeholder: 'B 0000 XX' },
    { key: 'status', label: 'Status', type: 'select', options: ['En Route', 'Standby'] },
    { key: 'destination', label: 'Tujuan rute', type: 'text', placeholder: 'RSUD Cibinong' },
    { key: 'speed', label: 'Kecepatan', type: 'text', placeholder: '0 km/jam' },
    { key: 'phone', label: 'Nomor telepon', type: 'tel', placeholder: '0812-0000-0000' },
    { key: 'driversAssigned', label: 'Driver bertugas (pisahkan dengan koma)', type: 'list', placeholder: 'Nama Driver' },
    { key: 'lat', label: 'Latitude', type: 'number', placeholder: '-6.4800' },
    { key: 'lng', label: 'Longitude', type: 'number', placeholder: '106.8250' }
];

const DRIVER_FIELDS = [
    { key: 'name', label: 'Nama driver', type: 'text', required: true, placeholder: 'Nama lengkap' },
    { key: 'roleCategory', label: 'Tim', type: 'select', options: ['Tim Alpha', 'Tim Bravo'] },
    { key: 'roleTitle', label: 'Peran', type: 'select', options: ['Driver Inti', 'Driver Pendukung'] },
    { key: 'status', label: 'Status', type: 'select', options: ['Standby', 'Sedang Bertugas', 'Off Duty'] },
    { key: 'ambulanceAssigned', label: 'Armada terpasang', type: 'text', placeholder: 'Tidak Ada' },
    { key: 'phone', label: 'Nomor telepon', type: 'tel', placeholder: '0813-0000-0000' },
    { key: 'locationName', label: 'Lokasi terakhir', type: 'text', placeholder: 'Markaz Halawatul Iman' },
    { key: 'pin', label: 'PIN login driver (kosongkan untuk default 1234)', type: 'text', placeholder: '1234' },
    { key: 'lat', label: 'Latitude', type: 'number', placeholder: '-6.4800' },
    { key: 'lng', label: 'Longitude', type: 'number', placeholder: '106.8250' }
];

const REQUEST_STATUSES = ['Menunggu', 'Diproses', 'Selesai', 'Batal'];

let currentTab = 'ambulans';
let editingType = null;   // 'ambulans' | 'driver'
let editingId = null;     // null = mode tambah
let reqRangeFrom = '';    // filter rentang waktu tab permintaan (YYYY-MM-DD)
let reqRangeTo = '';
let lastSeenReqIds = null;   // null = render senyap saat pertama kali
let lastStatusSnapshot = null;

appOnReady(() => {
    // Panel admin khusus admin: sesi driver (atau keduanya) harus ditolak.
    const driverOwned = (typeof isDriverLoggedIn === 'function') && isDriverLoggedIn();
    if (!isAdminLoggedIn() || driverOwned) {
        window.location.replace('login.html');
        return;
    }

    const session = getAdminSession();
    setText('adminName', (session && (session.name || session.username)) || 'Admin');

    setupTabs();
    setupActions();
    setupNotifications();
    renderAll();
});

/* ---------- Penyiapan ---------- */
function setupTabs() {
    document.querySelectorAll('#adminTabs .tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.getAttribute('data-tab')));
    });
}

function setupActions() {
    const logout = document.getElementById('logoutBtn');
    if (logout) logout.addEventListener('click', () => { adminLogout(); window.location.replace('login.html'); });

    const add = document.getElementById('addBtn');
    if (add) add.addEventListener('click', onAddClicked);

    const reset = document.getElementById('resetBtn');
    if (reset) reset.addEventListener('click', onResetClicked);

    const list = document.getElementById('listContainer');
    if (list) list.addEventListener('click', onListClick);
    if (list) list.addEventListener('change', onListChange);

    const modal = document.getElementById('editModal');
    if (modal) {
        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    }
    const close = document.getElementById('modalClose');
    if (close) close.addEventListener('click', closeModal);
    const cancel = document.getElementById('cancelBtn');
    if (cancel) cancel.addEventListener('click', closeModal);

    const form = document.getElementById('editForm');
    if (form) form.addEventListener('submit', onSubmitForm);

    // Filter rentang waktu (tab permintaan)
    const from = document.getElementById('reqRangeFrom');
    const to = document.getElementById('reqRangeTo');
    if (from) from.addEventListener('change', onRangeChange);
    if (to) to.addEventListener('change', onRangeChange);
    const resetRange = document.getElementById('reqRangeReset');
    if (resetRange) resetRange.addEventListener('click', () => {
        reqRangeFrom = '';
        reqRangeTo = '';
        if (from) from.value = '';
        if (to) to.value = '';
        renderAll();
    });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function switchTab(tab) {
    if (!TAB_META[tab]) return;
    currentTab = tab;
    document.querySelectorAll('#adminTabs .tab').forEach(btn => {
        const active = btn.getAttribute('data-tab') === tab;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', String(active));
    });
    const rangeBox = document.getElementById('reqRangeFilter');
    if (rangeBox) rangeBox.classList.toggle('hidden', tab !== 'permintaan');
    renderAll();
}

function onRangeChange() {
    const from = document.getElementById('reqRangeFrom');
    const to = document.getElementById('reqRangeTo');
    reqRangeFrom = from ? from.value : '';
    reqRangeTo = to ? to.value : '';
    // Bila rentang terbalik, tukar agar hasil tetap masuk akal
    if (reqRangeFrom && reqRangeTo && reqRangeFrom > reqRangeTo) {
        const tmp = reqRangeFrom; reqRangeFrom = reqRangeTo; reqRangeTo = tmp;
        if (from) from.value = reqRangeFrom;
        if (to) to.value = reqRangeTo;
    }
    renderAll();
}

/* ---------- Render ---------- */
function renderAll() {
    renderStats();
    renderSectionHead();
    renderList();
}

function renderStats() {
    setText('admStatAmb', ambulances.length);
    setText('admStatDrv', drivers.length);
    setText('admStatReq', getAllPermintaan().filter(p => p && p.status === 'Menunggu').length);
}

function renderSectionHead() {
    const meta = TAB_META[currentTab];
    const list = getList();
    setText('sectionTitle', meta.title);
    setText('sectionCount', list.length + ' ' + meta.countLabel);

    const addBtn = document.getElementById('addBtn');
    const addLabel = currentTab === 'permintaan'
        ? 'Bersihkan'
        : meta.addLabel;
    if (addBtn) addBtn.innerHTML = '<i class="fa-solid ' +
        (currentTab === 'permintaan' ? 'fa-trash-can' : 'fa-plus') + '"></i> ' + addLabel;

    // Info rentang waktu (tab permintaan)
    const rangeInfo = document.getElementById('reqRangeInfo');
    if (rangeInfo) {
        const total = getAllPermintaan().length;
        if (currentTab === 'permintaan' && (reqRangeFrom || reqRangeTo)) {
            rangeInfo.textContent = 'Menampilkan ' + list.length + ' dari ' + total + ' permintaan' +
                ' (' + (reqRangeFrom || '…') + ' s/d ' + (reqRangeTo || '…') + ')';
        } else {
            rangeInfo.textContent = 'Menampilkan semua rentang waktu (' + total + ' permintaan).';
        }
    }
}

function getList() {
    if (currentTab === 'ambulans') return ambulances;
    if (currentTab === 'driver') return drivers;
    return filterPermintaanByRange(getAllPermintaan(), reqRangeFrom, reqRangeTo);
}

function renderList() {
    const container = document.getElementById('listContainer');
    const empty = document.getElementById('emptyState');
    if (!container || !empty) return;

    const list = getList();
    const isEmpty = list.length === 0;
    empty.classList.toggle('hidden', !isEmpty);

    // Pesan kosong yang lebih menjelaskan saat filter rentang waktu aktif
    const emptyText = empty.querySelector('p');
    if (emptyText && currentTab === 'permintaan') {
        const rangeActive = reqRangeFrom || reqRangeTo;
        const hasAny = getAllPermintaan().length > 0;
        emptyText.textContent = (rangeActive && hasAny)
            ? 'Tidak ada permintaan pada rentang waktu tersebut.'
            : 'Belum ada data di seksi ini.';
    }

    if (currentTab === 'ambulans') {
        container.innerHTML = list.map(renderAmbulanceRow).join('');
    } else if (currentTab === 'driver') {
        container.innerHTML = list.map(renderDriverRow).join('');
    } else {
        container.innerHTML = list.map(renderRequestRow).join('');
    }
}

function renderAmbulanceRow(a) {
    const badgeClass = a.status === 'En Route' ? 'badge-red' : 'badge-green';
    const driversText = Array.isArray(a.driversAssigned) ? a.driversAssigned.join(', ') : String(a.driversAssigned || '–');
    return '<div class="row-card">' +
        '<div class="flex items-start justify-between gap-2">' +
            '<div class="min-w-0">' +
                '<div class="flex items-center gap-2 flex-wrap">' +
                    '<span class="font-bold text-sm text-slate-100">' + esc(a.name) + '</span>' +
                    '<span class="badge ' + badgeClass + '">' + esc(a.status) + '</span>' +
                '</div>' +
                '<p class="text-[11px] text-slate-400 mt-0.5">' + esc(a.type) +
                    ' · <span class="mono">' + esc(a.plate) + '</span></p>' +
            '</div>' +
            '<div class="flex gap-1.5 shrink-0">' +
                '<button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="' + esc(a.id) + '">' +
                    '<i class="fa-solid fa-pen"></i> Ubah</button>' +
                '<button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="' + esc(a.id) + '" title="Hapus">' +
                    '<i class="fa-solid fa-trash"></i></button>' +
            '</div>' +
        '</div>' +
        '<div class="mt-2 pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-slate-400">' +
            '<span><i class="fa-solid fa-compass mr-1"></i>' + esc(a.destination || '–') + '</span>' +
            '<span class="mono truncate max-w-[55%]">' + esc(driversText || '–') + '</span>' +
        '</div>' +
    '</div>';
}

function renderDriverRow(d) {
    const isCore = d.roleTitle === 'Driver Inti';
    const badgeClass = d.status === 'Sedang Bertugas' ? 'badge-red'
        : (d.status === 'Standby' ? 'badge-green' : 'badge-slate');
    return '<div class="row-card">' +
        '<div class="flex items-start justify-between gap-2">' +
            '<div class="flex items-center gap-2.5 min-w-0">' +
                '<span class="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold border ' +
                    (isCore ? 'bg-purple-600/30 text-purple-300 border-purple-500/40'
                            : 'bg-blue-600/30 text-blue-300 border-blue-500/40') + '">' +
                    esc(String(d.name || '?').charAt(0)) + '</span>' +
                '<div class="min-w-0">' +
                    '<div class="flex items-center gap-2 flex-wrap">' +
                        '<span class="font-bold text-sm text-slate-100">' + esc(d.name) + '</span>' +
                        '<span class="badge ' + badgeClass + '">' + esc(d.status) + '</span>' +
                    '</div>' +
                    '<p class="text-[11px] text-slate-400 mt-0.5">' + esc(d.roleTitle) + ' · ' + esc(d.roleCategory) + '</p>' +
                '</div>' +
            '</div>' +
            '<div class="flex gap-1.5 shrink-0">' +
                '<button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="' + esc(d.id) + '">' +
                    '<i class="fa-solid fa-pen"></i> Ubah</button>' +
                '<button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="' + esc(d.id) + '" title="Hapus">' +
                    '<i class="fa-solid fa-trash"></i></button>' +
            '</div>' +
        '</div>' +
        '<div class="mt-2 pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-slate-400">' +
            '<span><i class="fa-solid fa-location-dot mr-1"></i>' + esc(d.locationName || '–') + '</span>' +
            '<span>' + esc(d.ambulanceAssigned || '–') + '</span>' +
        '</div>' +
    '</div>';
}

function renderRequestRow(p) {
    const statusOptions = REQUEST_STATUSES.map(s =>
        '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' + s + '</option>').join('');

    // Monitor konfirmasi driver: permintaan Diproses dibroadcast ke semua driver,
    // driver yang sanggup menekan Konfirmasi dan muncul di sini + di dashboard lacak.
    const assigned = (typeof assignedDriversOf === 'function') ? assignedDriversOf(p) : [];
    const confirms = (typeof confirmMapOf === 'function') ? confirmMapOf(p) : {};
    const doneMap = (p.driverDone && typeof p.driverDone === 'object') ? p.driverDone : {};
    const driverChips = assigned.map(drvId => {
        const drv = drivers.find(d => d && d.id === drvId);
        const name = drv ? drv.name : drvId;
        const done = !!doneMap[drvId];
        const ok = !!confirms[drvId];
        const cls = done ? 'badge-green' : (ok ? 'badge-amber' : 'badge-slate');
        const mark = done ? ' ✓ selesai' : (ok ? ' ✓' : '');
        return '<span class="badge ' + cls + '" title="' +
            (done ? 'Sudah konfirmasi selesai' : (ok ? 'Sudah konfirmasi tugas' : 'Belum konfirmasi')) + '">' +
            esc(name) + mark + '</span>';
    }).join('');
    const badgeClass = p.status === 'Selesai' ? 'badge-green'
        : (p.status === 'Diproses' ? 'badge-amber'
        : (p.status === 'Batal' ? 'badge-slate' : 'badge-red'));
    const detail = p.detail && typeof p.detail === 'object' ? p.detail : {};
    const detailLines = Object.keys(detail)
        .filter(k => detail[k] !== undefined && detail[k] !== null && String(detail[k]).trim() !== '')
        .map(k => '<span class="block"><span class="text-slate-500">' + esc(fieldLabel(k)) + ':</span> ' + esc(detail[k]) + '</span>')
        .join('');

    return '<div class="row-card">' +
        '<div class="flex items-start justify-between gap-2">' +
            '<div class="min-w-0">' +
                '<div class="flex items-center gap-2 flex-wrap">' +
                    '<span class="mono font-bold text-sm text-slate-100">' + esc(p.id) + '</span>' +
                    '<span class="badge badge-purple">' + esc(p.jenis || p.type) + '</span>' +
                    '<span class="badge ' + badgeClass + '">' + esc(p.status) + '</span>' +
                '</div>' +
                '<p class="text-[11px] text-slate-400 mt-0.5">' + esc(formatDateTime(p.createdAt)) + '</p>' +
            '</div>' +
            '<button type="button" class="btn btn-danger btn-sm shrink-0" data-action="delete-request" data-id="' + esc(p.id) + '" title="Hapus permintaan">' +
                '<i class="fa-solid fa-trash"></i></button>' +
        '</div>' +
        '<div class="mt-2 text-xs text-slate-300 space-y-0.5">' +
            '<p><span class="text-slate-500">Pemohon:</span> ' + esc(p.nama) + ' · <span class="mono">' + esc(p.hp) + '</span></p>' +
            '<p><span class="text-slate-500">Lokasi:</span> ' + esc(p.lokasi) + '</p>' +
            (detailLines ? '<p class="text-[11px] text-slate-400 pt-1 space-y-0.5 block">' + detailLines + '</p>' : '') +
        '</div>' +
        '<div class="mt-2.5 pt-2 border-t border-slate-800 flex items-center gap-2">' +
            '<label class="text-[11px] text-slate-400 shrink-0" for="status-' + esc(p.id) + '">Status:</label>' +
            '<select id="status-' + esc(p.id) + '" class="input text-xs py-1.5" data-action="status" data-id="' + esc(p.id) + '">' +
                statusOptions +
            '</select>' +
        '</div>' +
        '<div class="mt-2.5 pt-2 border-t border-slate-800">' +
            '<div class="flex items-center gap-2 flex-wrap">' +
                '<span class="text-[11px] text-slate-400 shrink-0"><i class="fa-solid fa-truck-medical mr-1"></i>' +
                    (p.status === 'Diproses' ? 'Konfirmasi driver:' : 'Driver bertugas:') + '</span>' +
                (driverChips || '<span class="text-[11px] text-slate-600">' +
                    (p.status === 'Diproses' ? 'Belum ada driver yang mengonfirmasi — tugas sudah dibroadcast ke semua driver.'
                        : 'Belum ada driver bertugas.') + '</span>') +
            '</div>' +
        '</div>' +
    '</div>';
}

/* fieldLabel() kini menetap di store.js (dipakai bersama halaman riwayat). */


/* ---------- Aksi daftar (delegasi event) ---------- */
function onListClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');

    if (action === 'edit') openEditModal(id);
    if (action === 'delete') deleteItem(id);
    if (action === 'delete-request') deleteRequest(id);

    // Lonceng notifikasi: buka tab permintaan & tutup panel notifikasi
    if (action === 'goto-request') {
        const panel = document.getElementById('notifPanel');
        if (panel) panel.classList.add('hidden');
        switchTab('permintaan');
    }
}

function onListChange(e) {
    const el = e.target.closest('[data-action="status"]');
    if (!el) return;
    const id = el.getAttribute('data-id');
    const updated = updatePermintaan(id, { status: el.value });
    if (updated) {
        if (el.value === 'Diproses') {
            toast('Permintaan ' + id + ' diproses — semua driver menerima notifikasi tugas ini.');
        } else {
            toast('Status ' + id + ' → ' + el.value);
        }
        renderStats();
        renderList();
        renderNotifications();
    } else {
        renderList();
    }
}

function deleteItem(id) {
    const list = getList();
    const item = list.find(x => x && x.id === id);
    if (!item) return;
    if (!confirm('Hapus "' + (item.name || id) + '"?')) return;

    if (currentTab === 'ambulans') {
        ambulances = ambulances.filter(x => x.id !== id);
        storeWrite(STORE_KEYS.AMBULANCES, ambulances);
    } else {
        drivers = drivers.filter(x => x.id !== id);
        storeWrite(STORE_KEYS.DRIVERS, drivers);
    }
    renderAll();
}

function deleteRequest(id) {
    if (!confirm('Hapus permintaan ' + id + '?')) return;
    removePermintaan(id);
    renderAll();
}

/* ---------- Notifikasi permintaan masuk ----------
   Permintaan baru (status Menunggu) memuncul lonceng + toast di panel admin.
   Diperbarui otomatis tiap 5 detik dan setiap ada snapshot Firestore. */

function setupNotifications() {
    const btn = document.getElementById('notifBtn');
    if (btn) btn.addEventListener('click', () => {
        const panel = document.getElementById('notifPanel');
        if (panel) panel.classList.toggle('hidden');
    });

    // Tutup panel saat klik di luar
    document.addEventListener('click', e => {
        const panel = document.getElementById('notifPanel');
        const btnEl = document.getElementById('notifBtn');
        if (!panel || panel.classList.contains('hidden')) return;
        if (!panel.contains(e.target) && !btnEl.contains(e.target)) panel.classList.add('hidden');
    });

    renderNotifications();
    refreshStatusData();
    setInterval(() => {
        refreshStatusData();
        renderNotifications();
    }, 5000);
    document.addEventListener('firestore:update', () => {
        refreshStatusData();
        renderNotifications();
    });
}

/* Sinkronkan data driver, armada & permintaan dari store: store.js otomatis
   mengubah status ('Sedang Bertugas'/'Standby'/En Route, dan 'Diproses' -> 'Selesai'
   setelah semua driver konfirmasi selesai) saat ada aksi dari panel driver,
   sehingga yang tampil di sini selalu sama dengan dashboard & halaman driver. */


function refreshStatusData() {
    if (typeof STORE_KEYS === 'undefined' || typeof storeRead !== 'function') return;
    const sd = storeRead(STORE_KEYS.DRIVERS, null);
    const sa = storeRead(STORE_KEYS.AMBULANCES, null);
    const sp = storeRead(STORE_KEYS.PERMINTAAN, null);
    const snap = JSON.stringify([sd, sa, sp]);
    if (snap === lastStatusSnapshot) return;
    lastStatusSnapshot = snap;

    if (Array.isArray(sd) && typeof drivers !== 'undefined') drivers = sd;
    if (Array.isArray(sa) && typeof ambulances !== 'undefined') ambulances = sa;

    if (typeof renderAll === 'function') renderAll();
}

function renderNotifications() {
    const waiting = getAllPermintaan().filter(p => p && p.status === 'Menunggu');
    const badge = document.getElementById('notifBadge');
    if (badge) {
        badge.classList.toggle('hidden', waiting.length === 0);
        badge.textContent = waiting.length;
    }

    const listEl = document.getElementById('notifList');
    if (listEl) {
        listEl.innerHTML = waiting.length
            ? waiting.map(p =>
                '<button type="button" class="w-full text-left bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 rounded-lg p-2 transition"' +
                ' data-action="goto-request" data-id="' + esc(p.id) + '">' +
                    '<span class="mono text-[11px] font-bold text-slate-100">' + esc(p.id) + '</span>' +
                    '<span class="badge badge-purple ml-1.5">' + esc(p.jenis || p.type || 'Permintaan') + '</span>' +
                    '<p class="text-[11px] text-slate-400 mt-0.5 truncate">' + esc(p.nama || '-') + ' · ' + esc(p.lokasi || '-') + '</p>' +
                    '<p class="text-[10px] text-slate-500">' + esc(formatDateTime(p.createdAt)) + ' — putuskan Proses / Batal di tab Permintaan</p>' +
                '</button>').join('')
            : '<p class="text-[11px] text-slate-500 text-center py-3">Tidak ada permintaan baru.</p>';
    }

    // Toast untuk permintaan baru yang muncul selama panel terbuka
    const ids = waiting.map(p => p.id);
    if (lastSeenReqIds !== null) {
        const fresh = ids.filter(id => lastSeenReqIds.indexOf(id) === -1);
        if (fresh.length) toast('Permintaan baru masuk: ' + fresh.join(', '));
    }
    lastSeenReqIds = ids;
}

/* ---------- Tambah / ubah ---------- */
function onAddClicked() {
    if (currentTab === 'permintaan') {
        const list = getAllPermintaan();
        if (!list.length) return;
        if (!confirm('Hapus SEMUA permintaan (' + list.length + ' data)?')) return;
        saveAllPermintaan([]);
        renderAll();
        return;
    }
    openEditModal(null);
}

function openEditModal(id) {
    editingType = currentTab;             // 'ambulans' | 'driver'
    editingId = id || null;

    const meta = TAB_META[editingType];
    const title = document.getElementById('modalTitle');
    if (title) title.textContent = (id ? 'Ubah ' : 'Tambah ') + (editingType === 'ambulans' ? 'Ambulans' : 'Driver');

    const fields = editingType === 'ambulans' ? AMBULANCE_FIELDS : DRIVER_FIELDS;
    const item = id ? getList().find(x => x && x.id === id) : null;
    const values = item ? Object.assign({}, item) : defaultValues(editingType);

    const container = document.getElementById('formFields');
    if (container) container.innerHTML = fields.map(f => buildField(f, values[f.key])).join('');

    const err = document.getElementById('formError');
    if (err) err.classList.add('hidden');

    if (title && !id) title.textContent = meta.addLabel.replace('Tambah', 'Tambah');
    openModal();
}

function defaultValues(type) {
    const base = { lat: typeof CENTER_LAT !== 'undefined' ? CENTER_LAT : -6.48, lng: typeof CENTER_LNG !== 'undefined' ? CENTER_LNG : 106.825 };
    if (type === 'ambulans') {
        return Object.assign(base, {
            name: '', type: 'Transport / Type B', plate: '', status: 'Standby',
            destination: 'Markaz Halawatul Iman', speed: '0 km/jam', phone: '',
            driversAssigned: []
        });
    }
    return Object.assign(base, {
        name: '', roleCategory: 'Tim Bravo', roleTitle: 'Driver Pendukung',
        status: 'Standby', ambulanceAssigned: 'Tidak Ada', phone: '', locationName: 'Kediaman (On Call)'
    });
}

function buildField(field, value) {
    const id = 'fld-' + field.key;
    let control;

    if (field.type === 'select') {
        const options = field.options.map(opt =>
            '<option value="' + esc(opt) + '"' + (String(value) === opt ? ' selected' : '') + '>' + esc(opt) + '</option>').join('');
        control = '<select id="' + id + '" class="input" data-key="' + field.key + '">' + options + '</select>';
    } else if (field.type === 'list') {
        const text = Array.isArray(value) ? value.join(', ') : String(value || '');
        control = '<input id="' + id + '" class="input" type="text" data-key="' + field.key +
            '" data-kind="list" placeholder="' + esc(field.placeholder || '') + '" value="' + esc(text) + '">';
    } else {
        const val = (value === null || value === undefined) ? '' : value;
        control = '<input id="' + id + '" class="input" type="' + (field.type || 'text') + '" data-key="' + field.key +
            '" placeholder="' + esc(field.placeholder || '') + '" value="' + esc(val) + '"' +
            (field.type === 'number' ? ' inputmode="decimal"' : '') + '>';
    }

    return '<div>' +
        '<label class="label" for="' + id + '">' + esc(field.label) +
            (field.required ? ' <span class="text-red-400">*</span>' : '') + '</label>' +
        control +
        '<p class="field-error" data-error-for="' + id + '">Kolom ini wajib diisi.</p>' +
    '</div>';
}

function onSubmitForm(e) {
    e.preventDefault();
    const fields = editingType === 'ambulans' ? AMBULANCE_FIELDS : DRIVER_FIELDS;
    const container = document.getElementById('formFields');
    if (!container) return;

    const values = {};
    let firstInvalid = null;

    fields.forEach(f => {
        const el = container.querySelector('[data-key="' + f.key + '"]');
        if (!el) return;
        let val = String(el.value || '').trim();
        const invalid = f.required && val.length === 0;
        el.classList.toggle('is-invalid', invalid);
        const err = container.querySelector('[data-error-for="' + el.id + '"]');
        if (err) err.classList.toggle('is-visible', invalid);
        if (invalid && !firstInvalid) firstInvalid = el.id;

        if (f.type === 'list') {
            values[f.key] = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
        } else if (f.type === 'number') {
            const num = parseFloat(val);
            values[f.key] = isNaN(num) ? (defaultValues(editingType)[f.key] || 0) : num;
        } else {
            values[f.key] = val;
        }
    });

    if (firstInvalid) {
        const err = document.getElementById('formError');
        if (err) err.classList.remove('hidden');
        const el = document.getElementById(firstInvalid);
        if (el) el.focus();
        return;
    }

    if (editingType === 'ambulans') {
        if (editingId) {
            ambulances = ambulances.map(a => a.id === editingId ? Object.assign({}, a, values, { id: editingId }) : a);
        } else {
            values.id = newId('amb');
            ambulances = ambulances.concat([values]);
        }
        storeWrite(STORE_KEYS.AMBULANCES, ambulances);
    } else {
        if (editingId) {
            drivers = drivers.map(d => d.id === editingId ? Object.assign({}, d, values, { id: editingId }) : d);
        } else {
            values.id = newId('drv');
            drivers = drivers.concat([values]);
        }
        storeWrite(STORE_KEYS.DRIVERS, drivers);
    }

    closeModal();
    renderAll();
    toast(editingId ? 'Perubahan tersimpan.' : 'Data ditambahkan.');
}

function onResetClicked() {
    if (currentTab === 'permintaan') { onAddClicked(); return; }
    const label = currentTab === 'ambulans' ? 'data ambulans' : 'data driver';
    if (!confirm('Kembalikan ' + label + ' ke data bawaan? Perubahan Anda akan hilang.')) return;

    if (currentTab === 'ambulans') {
        ambulances = AMBULANCE_SEED.map(a => Object.assign({}, a));
        storeWrite(STORE_KEYS.AMBULANCES, ambulances);
    } else {
        drivers = DRIVER_SEED.map(d => Object.assign({}, d));
        storeWrite(STORE_KEYS.DRIVERS, drivers);
    }
    renderAll();
    toast('Data dikembalikan ke bawaan.');
}

/* ---------- Modal ---------- */
function openModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.classList.add('is-open');
}

function closeModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.classList.remove('is-open');
    editingId = null;
    editingType = null;
}

/* ---------- Penolong ---------- */
function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.floor(Math.random() * 90 + 10);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

function toast(message) {
    let el = document.getElementById('toastBox');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toastBox';
        el.style.cssText = 'position:fixed;left:50%;bottom:1.25rem;transform:translateX(-50%);z-index:4000;' +
            'background:#1e293b;border:1px solid #334155;color:#f1f5f9;font-size:12px;' +
            'padding:.55rem .9rem;border-radius:.8rem;box-shadow:0 10px 25px -10px rgba(0,0,0,.8);max-width:90vw;';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.style.display = 'none'; }, 2400);
}

function esc(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
