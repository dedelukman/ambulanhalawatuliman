/* driver.js — logika halaman panel driver (driver.html)
   - Menampilkan info sesi driver (login ID + PIN, lihat store.js)
   - Mengubah status penugasan (langsung tersimpan ke Firestore)
   - Tracking GPS TIDAK di sini: modul js/geotracker.js mengaktifkan watchPosition
     otomatis di SEMUA halaman saat sesi driver aktif. Halaman ini hanya
     menampilkan status/hasilnya lewat event si-geo-* dari geotracker. */

let driverSession = null;
let lastNotifIds = null;

appOnReady(() => {
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
    document.addEventListener('firestore:update', event => {
        const key = event.detail && event.detail.key;
        if (key === STORE_KEYS.PERMINTAAN || key === STORE_KEYS.AMBULANCES ||
            key === STORE_KEYS.DRIVERS) {
            renderProfile();
            renderTasks();
        }
        if (key === STORE_KEYS.PERMINTAAN && event.detail.failed) {
            toast('Konfirmasi tugas gagal disimpan ke Firestore. Periksa koneksi dan Firestore Rules.');
        }
    });
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

function taskDetailSummary(p) {
    const parts = permintaanTaskDetails(p)
        .map(item => item.label + ': ' + item.value);
    if (!parts.length) return '';
    return '<p class="text-[10px] text-slate-400 mt-1">' +
        parts.map(escapeHtml).join(' · ') + '</p>';
}

/* Kartu notifikasi: tugas broadcast yang belum dikonfirmasi driver ini. */
function renderIncomingTask(p) {
    const assigned = (typeof assignedDriversOf === 'function') ? assignedDriversOf(p) : [];
    const confirms = (typeof confirmMapOf === 'function') ? confirmMapOf(p) : {};
    const confirmCount = assigned.filter(id => confirms[id]).length;
    const driver = (typeof driverListSource === 'function')
        ? driverListSource().find(item => item && item.id === driverSession.id) : null;
    const currentAmbulance = Object.prototype.hasOwnProperty.call(p, 'selectedAmbulance')
        ? String(p.selectedAmbulance || '')
        : (permintaanAmbulanceOf(p, driverSession.id) ||
            String((driver && driver.ambulanceAssigned) || ''));
    const ambulances = (typeof ambulanceListSource === 'function') ? ambulanceListSource() : [];
    const options = ambulances.filter(amb => amb && amb.name).map(amb =>
        '<option value="' + escapeHtml(amb.name) + '"' +
        (amb.name === currentAmbulance ? ' selected' : '') + '>' +
        escapeHtml(amb.name) + (amb.status ? ' · ' + escapeHtml(amb.status) : '') +
        '</option>'
    ).join('');
    const selectedAmbulanceExists = ambulances.some(amb => amb && amb.name === currentAmbulance);

    return '<div class="row-card border-amber-500/40 bg-amber-500/5">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="mono font-bold text-sm text-slate-100">' + escapeHtml(p.id) + '</span>' +
            '<span class="badge badge-purple">' + escapeHtml(p.jenis || p.type || 'Permintaan') + '</span>' +
            '<span class="badge badge-amber"><i class="fa-solid fa-bell mr-1"></i>Tugas Baru</span>' +
        '</div>' +
        '<p class="text-[11px] text-slate-400 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>' +
            escapeHtml(p.lokasi || '-') + '</p>' +
        taskDetailSummary(p) +
        '<p class="text-[11px] text-slate-500">Pemohon: ' + escapeHtml(p.nama || '-') +
            ' · <span class="mono">' + escapeHtml(p.hp || '-') + '</span></p>' +
        '<p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-users mr-1"></i>' +
            confirmCount + ' driver sudah konfirmasi</p>' +
        '<label class="block text-[11px] text-slate-400 mt-2" for="task-ambulance-' + escapeHtml(p.id) +
            '">Ambulan yang akan digunakan</label>' +
        '<select id="task-ambulance-' + escapeHtml(p.id) +
            '" class="input mt-1 text-xs py-1.5" data-action="select-ambulance" data-id="' +
            escapeHtml(p.id) + '">' +
            '<option value="">Pilih ambulan...</option>' +
            options +
        '</select>' +
        '<div class="flex gap-2 mt-2">' +
            '<button type="button" class="btn btn-primary btn-sm flex-1" data-action="confirm-task" data-id="' +
                escapeHtml(p.id) + '"><i class="fa-solid fa-handshake mr-1"></i> Konfirmasi Tugas</button>' +
        '</div>' +
        '<p class="text-[10px] text-slate-600 mt-1">' +
            (selectedAmbulanceExists
                ? 'Periksa pilihan ambulan sebelum mengonfirmasi tugas.'
                : 'Pilih ambulan yang akan digunakan sebelum mengonfirmasi tugas.') +
            '</p>' +
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
    const assignedAmbulance = permintaanAmbulanceOf(p, driverSession.id);

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
        taskDetailSummary(p) +
        '<p class="text-[11px] text-slate-500">Pemohon: ' + escapeHtml(p.nama || '-') +
            ' · <span class="mono">' + escapeHtml(p.hp || '-') + '</span></p>' +
        (assignedAmbulance
            ? '<p class="text-[10px] text-slate-400 mt-1"><i class="fa-solid fa-truck-medical mr-1"></i>Ambulan digunakan: ' +
                escapeHtml(assignedAmbulance) + '</p>' : '') +
        '<p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-users mr-1"></i>' +
            confirmCount + ' driver konfirmasi · ' + doneCount + ' sudah konfirmasi selesai</p>' +
        '<p class="text-[10px] text-emerald-500 mt-0.5"><i class="fa-solid fa-circle-check mr-1"></i>' +
            'Anda mengonfirmasi tugas ini (' + formatDateTime(confirms[driverSession.id]) + ')</p>' +
        (canFinish
            ? '<div class="flex gap-2 mt-2">' +
                    '<button type="button" class="btn btn-primary btn-sm flex-1" data-action="finish-task" data-id="' +
                        escapeHtml(p.id) + '"><i class="fa-solid fa-flag-checkered mr-1"></i> Konfirmasi Selesai</button>' +
                    '<button type="button" class="btn btn-danger btn-sm flex-1" data-action="cancel-task" data-id="' +
                        escapeHtml(p.id) + '"><i class="fa-solid fa-xmark mr-1"></i> Batal Konfirmasi</button>' +
                '</div>'
                : (done
                    ? '<p class="mt-2 text-[11px] text-emerald-400"><i class="fa-solid fa-trophy mr-1"></i> ' +
                    'Terima kasih! Anda sudah menandai tugas ini selesai (' + formatDateTime(doneMap[driverSession.id]) + ').</p>'
                : '<p class="mt-2 text-[11px] text-slate-500"><i class="fa-solid fa-hourglass-half mr-1"></i> ' +
                    'Tugas berakhir dengan status ' + escapeHtml(p.status) + '.</p>')) +
    '</div>';
}

function setupTaskActions() {
    const notifBox = document.getElementById('taskNotifList');
    if (notifBox) {
        notifBox.addEventListener('change', ev => {
            const select = ev.target.closest('[data-action="select-ambulance"]');
            if (!select) return;
            const id = select.getAttribute('data-id');
            const updated = setPermintaanAmbulance(id, select.value);
            if (updated) {
                toast(select.value
                    ? 'Pilihan ambulan tugas tersimpan dan terlihat oleh driver lain.'
                    : 'Pilihan ambulan tugas dihapus.');
            } else {
                toast('Gagal menyimpan pilihan ambulan. Periksa status tugas dan data armada.');
                renderTasks();
            }
        });
    }

    const handler = ev => {
        const btn = ev.target.closest('[data-action="confirm-task"], [data-action="finish-task"], [data-action="cancel-task"]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        let selectedAmbulance = '';
        if (action === 'confirm-task') {
            const card = btn.closest('.row-card');
            const select = card ? card.querySelector('[data-action="select-ambulance"]') : null;
            const currentTask = getAllPermintaan().find(task => task && task.id === id);
            selectedAmbulance = currentTask &&
                Object.prototype.hasOwnProperty.call(currentTask, 'selectedAmbulance')
                ? String(currentTask.selectedAmbulance || '')
                : ((select && select.value) || '');
            if (!selectedAmbulance) {
                toast('Pilih ambulan yang akan digunakan sebelum mengonfirmasi tugas.');
                return;
            }
        }
        const updated = action === 'finish-task'
            ? confirmPermintaanSelesai(id, driverSession.id)
            : (action === 'cancel-task'
                ? cancelPermintaanTask(id, driverSession.id)
                : confirmPermintaanTask(id, driverSession.id, selectedAmbulance));
        if (updated) {
            toast(action === 'finish-task'
                ? 'Tugas ' + id + ' ditandai SELESAI. Terima kasih!'
                : (action === 'cancel-task'
                    ? 'Konfirmasi tugas ' + id + ' dibatalkan. Tugas kembali ke notifikasi.'
                    : 'Tugas ' + id + ' terkonfirmasi. Siap bertugas!'));
            renderTasks();
            // Sinkron tampilan profil: status driver & armada ikut diperbarui
            // oleh store.js (Sedang Bertugas saat konfirmasi, Standby saat selesai).
            renderProfile();
        } else {
            toast(action === 'confirm-task'
                ? 'Konfirmasi gagal. Pastikan tugas masih Diproses, pilih ambulan yang tersedia, lalu coba lagi.'
                : (action === 'finish-task'
                    ? 'Tugas belum dapat ditandai selesai. Perbarui halaman dan coba lagi.'
                    : 'Konfirmasi tidak dapat dibatalkan. Perbarui halaman dan coba lagi.'));
        }
    };

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
