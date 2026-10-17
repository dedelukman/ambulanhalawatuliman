/* driver.js — logika halaman panel driver (driver.html)
   - Menampilkan info sesi driver (login ID + PIN, lihat store.js)
   - Mengubah status penugasan (langsung tersimpan ke localStorage)
   - Tracking GPS TIDAK di sini: modul js/geotracker.js mengaktifkan watchPosition
     otomatis di SEMUA halaman saat sesi driver aktif. Halaman ini hanya
     menampilkan status/hasilnya lewat event si-geo-* dari geotracker. */

let driverSession = null;

document.addEventListener('DOMContentLoaded', () => {
    // Guard cadangan (bila JS di <head> tidak jalan karena alasan tertentu)
    if (typeof isDriverLoggedIn !== 'function' || !isDriverLoggedIn()) {
        window.location.replace('login.html?role=driver');
        return;
    }

    driverSession = getDriverSession();

    renderProfile();
    setupStatus();
    setupLogout();
    setupGeoUI();
    setupTaskActions();
    renderTasks();
    // Perbarui notifikasi & daftar tugas tiap 5 detik agar broadcast admin langsung muncul
    setInterval(renderTasks, 5000);
});

/* ---------- Info driver ---------- */
function currentDriverRecord() {
    const list = (typeof driverListSource === 'function') ? driverListSource() : [];
    return list.find(d => d && driverSession && d.id === driverSession.id) || null;
}

function renderProfile() {
    const drv = currentDriverRecord();
    const name = (driverSession && driverSession.name) || (drv && drv.name) || 'Driver';

    setText('drvName', name);
    setText('drvInitial', String(name).charAt(0).toUpperCase());
    setText('drvMeta', [
        driverSession ? driverSession.id : '',
        drv ? drv.roleTitle : '',
        drv ? drv.ambulanceAssigned : ''
    ].filter(Boolean).join(' · '));

    const status = (drv && drv.status) || 'Standby';
    setText('drvStatusBadge', status);

    const select = document.getElementById('drvStatusSelect');
    if (select) select.value = status;

    // Tampilkan posisi terakhir yang tersimpan (bila ada)
    if (drv && typeof drv.lat === 'number' && typeof drv.lng === 'number') {
        setText('geoCoord', fmtCoord(drv.lat, drv.lng));
        if (drv.lastSeen) setText('geoUpdated', formatDateTime(drv.lastSeen));
    }
}

function setupStatus() {
    const select = document.getElementById('drvStatusSelect');
    if (!select) return;
    select.addEventListener('change', () => {
        const updated = patchDriverRecord(driverSession.id, { status: select.value });
        if (updated) {
            setText('drvStatusBadge', updated.status);
            toast('Status diperbarui: ' + updated.status);
        }
    });
}

function setupLogout() {
    const btn = document.getElementById('driverLogoutBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        // Hentikan tracking GPS dulu (modul geotracker), baru akhiri sesi
        if (typeof stopGeoTracking === 'function') stopGeoTracking('logout');
        driverLogout();
        window.location.replace('login.html?role=driver');
    });
}

/* ---------- Tugas dari admin (broadcast ke semua driver + konfirmasi) ----------
   Alur: admin memproses permintaan (status Diproses) -> SEMUA driver menerima
   notifikasi tugas -> driver yang sanggup menekan Konfirmasi (bisa lebih dari
   satu driver) -> tugas muncul di dashboard lacak ambulan -> bila sudah selesai,
   driver menekan Konfirmasi Selesai. */
let lastNotifIds = null;   // untuk toast tugas baru (pertama kali = senyap)

function renderTasks() {
    const notifBox = document.getElementById('taskNotifList');
    const notifEmpty = document.getElementById('taskNotifEmpty');
    const notifCount = document.getElementById('taskNotifCount');
    if (!notifBox || !driverSession) return;

    // 1. Notifikasi tugas masuk: Diproses & belum dikonfirmasi driver ini
    const incoming = (typeof getPermintaanNotificationsForDriver === 'function')
        ? getPermintaanNotificationsForDriver(driverSession.id) : [];
    notifBox.innerHTML = incoming.map(renderIncomingTask).join('');
    if (notifEmpty) notifEmpty.classList.toggle('hidden', incoming.length > 0);
    if (notifCount) {
        notifCount.classList.toggle('hidden', incoming.length === 0);
        notifCount.textContent = incoming.length;
    }

    // Toast tugas baru
    const ids = incoming.map(p => p.id);
    if (lastNotifIds !== null) {
        const fresh = ids.filter(id => lastNotifIds.indexOf(id) === -1);
        if (fresh.length) toast('Tugas baru masuk: ' + fresh.join(', ') + '. Silakan konfirmasi bila sanggup.');
    }
    lastNotifIds = ids;

    // 2. Tugas saya: yang sudah dikonfirmasi (menunggu selesai / sudah selesai)
    const container = document.getElementById('taskList');
    const empty = document.getElementById('taskEmpty');
    if (!container || !empty) return;

    const mine = (typeof getPermintaanForDriver === 'function')
        ? getPermintaanForDriver(driverSession.id) : [];
    mine.sort((a, b) => String((b && b.createdAt) || '').localeCompare(String((a && a.createdAt) || '')));

    container.innerHTML = mine.map(renderTaskRow).join('');
    empty.classList.toggle('hidden', mine.length > 0);
}

/* Kartu notifikasi: tugas broadcast yang belum dikonfirmasi driver ini. */
function renderIncomingTask(p) {
    const assigned = (typeof assignedDriversOf === 'function') ? assignedDriversOf(p) : [];
    const confirms = (typeof confirmMapOf === 'function') ? confirmMapOf(p) : {};
    const confirmCount = assigned.filter(id => confirms[id]).length;

    return '<div class="row-card border-amber-500/40 bg-amber-500/5">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="mono font-bold text-sm text-slate-100">' + escapeHtml(p.id) + '</span>' +
            '<span class="badge badge-purple">' + escapeHtml(p.jenis || p.type || 'Permintaan') + '</span>' +
            '<span class="badge badge-amber"><i class="fa-solid fa-bell mr-1"></i>Tugas Baru</span>' +
        '</div>' +
        '<p class="text-[11px] text-slate-400 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>' +
            escapeHtml(p.lokasi || '-') + '</p>' +
        '<p class="text-[11px] text-slate-500">Pemohon: ' + escapeHtml(p.nama || '-') +
            ' · <span class="mono">' + escapeHtml(p.hp || '-') + '</span></p>' +
        '<p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-users mr-1"></i>' +
            confirmCount + ' driver sudah konfirmasi</p>' +
        '<div class="flex gap-2 mt-2">' +
            '<button type="button" class="btn btn-primary btn-sm flex-1" data-action="confirm-task" data-id="' +
                escapeHtml(p.id) + '"><i class="fa-solid fa-handshake mr-1"></i> Konfirmasi Tugas</button>' +
        '</div>' +
        '<p class="text-[10px] text-slate-600 mt-1">Tekan konfirmasi hanya bila Anda sanggup menugaskan ambulans.</p>' +
    '</div>';
}

/* Kartu tugas saya: sudah dikonfirmasi — menunggu selesai / sudah konfirmasi selesai. */
function renderTaskRow(p) {
    const done = (typeof isPermintaanDoneBy === 'function') && isPermintaanDoneBy(p, driverSession.id);
    const canFinish = p.status === 'Diproses' && !done;

    const assigned = (typeof assignedDriversOf === 'function') ? assignedDriversOf(p) : [];
    const confirms = (typeof confirmMapOf === 'function') ? confirmMapOf(p) : {};
    const doneMap = (p.driverDone && typeof p.driverDone === 'object') ? p.driverDone : {};
    const confirmCount = assigned.filter(id => confirms[id]).length;
    const doneCount = assigned.filter(id => doneMap[id]).length;

    const badgeClass = p.status === 'Selesai' ? 'badge-green'
        : (p.status === 'Diproses' ? 'badge-amber'
        : (p.status === 'Batal' ? 'badge-slate' : 'badge-red'));

    return '<div class="row-card">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="mono font-bold text-sm text-slate-100">' + escapeHtml(p.id) + '</span>' +
            '<span class="badge badge-purple">' + escapeHtml(p.jenis || p.type || 'Permintaan') + '</span>' +
            '<span class="badge ' + badgeClass + '">' + escapeHtml(p.status) + '</span>' +
            (done ? '<span class="badge badge-green"><i class="fa-solid fa-circle-check mr-1"></i>Selesai</span>' : '') +
        '</div>' +
        '<p class="text-[11px] text-slate-400 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>' +
            escapeHtml(p.lokasi || '-') + '</p>' +
        '<p class="text-[11px] text-slate-500">Pemohon: ' + escapeHtml(p.nama || '-') +
            ' · <span class="mono">' + escapeHtml(p.hp || '-') + '</span></p>' +
        '<p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-users mr-1"></i>' +
            confirmCount + ' driver konfirmasi · ' + doneCount + ' sudah konfirmasi selesai</p>' +
        '<p class="text-[10px] text-emerald-500 mt-0.5"><i class="fa-solid fa-circle-check mr-1"></i>' +
            'Anda mengonfirmasi tugas ini (' + formatDateTime(confirms[driverSession.id]) + ')</p>' +
        (canFinish
            ? '<button type="button" class="btn btn-primary btn-sm mt-2 w-full" data-action="finish-task" data-id="' +
                escapeHtml(p.id) + '"><i class="fa-solid fa-flag-checkered mr-1"></i> Konfirmasi Selesai</button>'
            : (done
                ? '<p class="mt-2 text-[11px] text-emerald-400"><i class="fa-solid fa-trophy mr-1"></i> ' +
                    'Terima kasih! Anda sudah menandai tugas ini selesai (' + formatDateTime(doneMap[driverSession.id]) + ').</p>'
                : '<p class="mt-2 text-[11px] text-slate-500"><i class="fa-solid fa-hourglass-half mr-1"></i> ' +
                    'Tugas berakhir dengan status ' + escapeHtml(p.status) + '.</p>')) +
    '</div>';
}

function setupTaskActions() {
    const handler = ev => {
        const btn = ev.target.closest('[data-action="confirm-task"], [data-action="finish-task"]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const finish = btn.getAttribute('data-action') === 'finish-task';
        const updated = finish
            ? confirmPermintaanSelesai(id, driverSession.id)
            : confirmPermintaanTask(id, driverSession.id);
        if (updated) {
            toast(finish
                ? 'Tugas ' + id + ' ditandai SELESAI. Terima kasih!'
                : 'Tugas ' + id + ' terkonfirmasi. Siap bertugas!');
            renderTasks();
            // Sinkron tampilan profil: status driver & armada ikut diperbarui
            // oleh store.js (Sedang Bertugas saat konfirmasi, Standby saat selesai).
            renderProfile();
        }
    };

    const notifBox = document.getElementById('taskNotifList');
    if (notifBox) notifBox.addEventListener('click', handler);
    const container = document.getElementById('taskList');
    if (container) container.addEventListener('click', handler);
}

/* ---------- Geolocation: hanya UI, tracking di js/geotracker.js ---------- */
function setupGeoUI() {
    const btn = document.getElementById('geoToggleBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            if (typeof isGeoTrackingActive !== 'function') return;
            if (isGeoTrackingActive()) stopGeoTracking('user');
            else startGeoTracking();
        });
    }

    // Sinkronkan tampilan dengan status tracking yang sudah berjalan
    renderTrackState(typeof isGeoTrackingActive === 'function' && isGeoTrackingActive());

    window.addEventListener('si-geo-state', e => renderTrackState(!!(e.detail && e.detail.active)));
    window.addEventListener('si-geo-update', e => renderGeoUpdate(e.detail || {}));
    window.addEventListener('si-geo-error', e => {
        setGeoMsg((e.detail && e.detail.message) || 'Gagal mendapatkan lokasi.', true);
    });
}

function renderTrackState(active) {
    const btn = document.getElementById('geoToggleBtn');
    if (btn) {
        btn.innerHTML = active
            ? '<i class="fa-solid fa-circle-stop"></i> Hentikan'
            : '<i class="fa-solid fa-location-crosshairs"></i> Aktifkan';
    }
    if (active) {
        setGeoMsg('Lokasi aktif — posisi Anda dikirim ke dashboard setiap beberapa detik.', false);
    }
}

function renderGeoUpdate(d) {
    if (typeof d.lat === 'number' && typeof d.lng === 'number') {
        setText('geoCoord', fmtCoord(d.lat, d.lng));
    }
    setText('geoAccuracy', (typeof d.accuracy === 'number')
        ? '± ' + Math.round(d.accuracy) + ' m' : '–');
    setText('geoUpdated', formatDateTime(d.lastSeen || new Date().toISOString()));
    setText('geoCount', d.count || 0);

    if (d.saved === false) {
        setGeoMsg('Lokasi terdeteksi, tetapi gagal disimpan ke penyimpanan browser.', true);
    } else {
        setGeoMsg('Lokasi terkirim ke dashboard (' + (d.count || 0) + ' update).', false);
    }
}

/* ---------- Penolong ---------- */
function fmtCoord(lat, lng) {
    return Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5);
}

function setGeoMsg(text, isError) {
    const box = document.getElementById('geoMsg');
    if (!box) return;
    box.className = 'mt-3 rounded-xl p-3 text-[11px] leading-relaxed border ' +
        (isError
            ? 'bg-red-500/10 border-red-500/30 text-red-300'
            : 'bg-slate-950/70 border-slate-800 text-slate-400');
    box.innerHTML = '<i class="fa-solid ' + (isError ? 'fa-triangle-exclamation' : 'fa-circle-info') +
        ' mr-1"></i> ' + escapeHtml(text);
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

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
