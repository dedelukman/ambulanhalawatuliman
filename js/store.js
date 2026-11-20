/* store.js — Firestore untuk data aplikasi dan localStorage untuk sesi peramban. */

const STORE_KEYS = {
    AMBULANCES: 'si_ambulances',
    DRIVERS: 'si_drivers',
    PERMINTAAN: 'si_permintaan',
    ACTIVITY_LOGS: 'si_activity_logs',
    KAS: 'si_kas',
    SESSION: 'si_session',
    ADMIN_ACCOUNT: 'si_admin_account',
    DRIVER_SESSION: 'si_driver_session',
    JANAIZ_SESSION: 'si_janaiz_session',
    JANAIZ_MEMBERS: 'si_janaiz_members'
};
const DEFAULT_AMBULANCE_DESTINATION = 'Markaz Halawatuliman';

/* Kredensial demo (client-side). Hanya untuk prototipe/demo — BUKAN keamanan nyata,
   karena siapa pun bisa membaca kode ini di browser. */
const ADMIN_ACCOUNTS = [
    { username: 'admin', password: 'admin123', name: 'Admin Utama' }
];

/* Akun Tim Janaiz cadangan (demo client-side). Daftar utama dibaca dari
   STORE_KEYS.JANAIZ_MEMBERS dan dikelola di panel admin; akun ini dipakai
   hanya bila data anggota belum tersedia. */
const JANAIZ_ACCOUNTS = [
    { id: 'janaiz', username: 'janaiz', name: 'Tim Janaiz', pin: '1234', active: true }
];

function isFirestoreKey(key) {
    return key === STORE_KEYS.ACTIVITY_LOGS ||
        (typeof FS_DOC !== 'undefined' && Object.prototype.hasOwnProperty.call(FS_DOC, key));
}

function firestoreDocumentName(key) {
    return key === STORE_KEYS.ACTIVITY_LOGS ? 'activity_logs' : FS_DOC[key];
}

function reportStoreError(key, error) {
    console.error('Firestore gagal untuk key "' + key + '"', error);
    window.dispatchEvent(new CustomEvent('firestore:error', {
        detail: { key: key, message: error && error.message ? error.message : String(error) }
    }));
}

function syncCachedArrayToPage(key, items) {
    const target = key === STORE_KEYS.AMBULANCES ? window.ambulances
        : (key === STORE_KEYS.DRIVERS ? window.drivers : null);
    if (!Array.isArray(target) || !Array.isArray(items)) return;
    target.length = 0;
    items.forEach(item => target.push(item));
}

function appOnReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
        callback();
    }
}

/* Poling untuk halaman panel: lewati tick saat aplikasi di latar belakang
   (timer WebView tetap berjalan) dan langsung jalankan sekali saat aplikasi
   kembali terlihat, sehingga data tidak basi setelah dibuka lagi. */
function appPoll(fn, ms) {
    const tick = function () { if (!document.hidden) fn(); };
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) tick();
    });
    return setInterval(tick, ms);
}

/* Tanda isi data untuk melewati render DOM bila tidak ada perubahan. */
function dataSignature(value) {
    try {
        return JSON.stringify(value);
    } catch (err) {
        return String(Date.now());
    }
}

function storeRead(key, fallback) {
    if (isFirestoreKey(key)) {
        return Object.prototype.hasOwnProperty.call(__cache, key) ? __cache[key] : fallback;
    }
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null || raw === undefined || raw === '') return fallback;
        const parsed = JSON.parse(raw);
        return (parsed === null || parsed === undefined) ? fallback : parsed;
    } catch (err) {
        console.warn('storeRead gagal untuk key "' + key + '"', err);
        return fallback;
    }
}

function storeWrite(key, value) {
    if (isFirestoreKey(key)) {
        if (!window.db || !window.firebaseApi || !Array.isArray(value)) {
            reportStoreError(key, new Error('Data Firestore harus berupa array dan koneksi harus tersedia.'));
            return false;
        }
        let snapshot;
        try {
            snapshot = JSON.parse(JSON.stringify(value));
        } catch (error) {
            reportStoreError(key, error);
            return false;
        }
        __cache[key] = snapshot;
        __pendingWrites[key] = (__pendingWrites[key] || 0) + 1;
        const previous = __writeQueue[key] || Promise.resolve();
        const ref = window.firebaseApi.doc(db, 'si_state', firestoreDocumentName(key));
        const write = previous.then(() => window.firebaseApi.setDoc(ref, { items: snapshot }));
        __writeQueue[key] = write.then(() => {
            __remoteExists[key] = true;
            __confirmedCache[key] = JSON.parse(JSON.stringify(snapshot));
            __pendingWrites[key] -= 1;
            document.dispatchEvent(new CustomEvent('firestore:update', { detail: { key: key } }));
        }, error => {
            __pendingWrites[key] -= 1;
            if (__pendingWrites[key] === 0) {
                if (Object.prototype.hasOwnProperty.call(__confirmedCache, key)) {
                    __cache[key] = JSON.parse(JSON.stringify(__confirmedCache[key]));
                    syncCachedArrayToPage(key, __cache[key]);
                } else {
                    delete __cache[key];
                }
                document.dispatchEvent(new CustomEvent('firestore:update', {
                    detail: { key: key, failed: true }
                }));
            }
            reportStoreError(key, error);
        });
        return true;
    }
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (err) {
        console.error('storeWrite gagal untuk key "' + key + '"', err);
        return false;
    }
}

function storeRemove(key) {
    if (isFirestoreKey(key)) {
        const previousValue = Object.prototype.hasOwnProperty.call(__confirmedCache, key)
            ? JSON.parse(JSON.stringify(__confirmedCache[key]))
            : undefined;
        delete __cache[key];
        const previous = __writeQueue[key] || Promise.resolve();
        const ref = window.firebaseApi.doc(db, 'si_state', firestoreDocumentName(key));
        const write = previous.then(() => window.firebaseApi.deleteDoc(ref));
        __writeQueue[key] = write.then(() => {
            __remoteExists[key] = false;
            delete __confirmedCache[key];
        }, error => {
            if (previousValue !== undefined) {
                __cache[key] = previousValue;
                syncCachedArrayToPage(key, previousValue);
            }
            document.dispatchEvent(new CustomEvent('firestore:update', {
                detail: { key: key, failed: true }
            }));
            reportStoreError(key, error);
        });
        return true;
    }
    try {
        window.localStorage.removeItem(key);
        return true;
    } catch (err) {
        console.warn('storeRemove gagal untuk key "' + key + '"', err);
        return false;
    }
}

function makeId(prefix) {
    return prefix + '-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
}

function formatDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const pad = n => String(n).padStart(2, '0');
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function getActivityLogs() {
    const logs = storeRead(STORE_KEYS.ACTIVITY_LOGS, []);
    return Array.isArray(logs) ? logs : [];
}

function recordActivityLog(text) {
    const logs = getActivityLogs();
    logs.unshift({
        id: makeId('ACT'),
        createdAt: new Date().toISOString(),
        text: String(text)
    });
    return storeWrite(STORE_KEYS.ACTIVITY_LOGS, logs.slice(0, 100));
}

/* ---------- Permintaan (dipakai home.js & admin.js) ---------- */

function getAllPermintaan() {
    const list = storeRead(STORE_KEYS.PERMINTAAN, []);
    return Array.isArray(list) ? list : [];
}

function saveAllPermintaan(list) {
    const ok = storeWrite(STORE_KEYS.PERMINTAAN, list);
    /* Sinkron otomatis: setiap perubahan permintaan langsung menyelaraskan status
       driver/armada dan daftar driver/armada yang sedang bertugas. */
    if (ok) syncAllDriverStatuses();
    return ok;
}

function addPermintaan(item) {
    const list = getAllPermintaan();
    list.unshift(item);
    if (!saveAllPermintaan(list)) return null;
    if (item && isAmbulanPermintaan(item)) {
        const detail = item.detail && typeof item.detail === 'object' ? item.detail : {};
        const tujuan = String(detail.tujuan || detail.tpu || '').trim();
        recordActivityLog('Permintaan ambulans ' + item.id + ' masuk (' +
            String(item.jenis || item.type || 'Ambulans') + ')' +
            (item.lokasi ? ', lokasi jemput: ' + item.lokasi : '') +
            (tujuan ? ', tujuan: ' + tujuan : '') +
            '. Status: ' + String(item.status || 'Menunggu') + '.');
    }
    return item;
}

function updatePermintaan(id, patch) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    if (idx === -1) return null;
    const previousStatus = list[idx].status;
    list[idx] = Object.assign({}, list[idx], patch);
    if (!saveAllPermintaan(list)) return null;
    if (patch && patch.status && patch.status !== previousStatus) {
        const request = list[idx];
        const detail = request.detail && typeof request.detail === 'object' ? request.detail : {};
        const tujuan = String(detail.tujuan || detail.tpu || '').trim();
        recordActivityLog((isAmbulanPermintaan(request) ? 'Permintaan ambulans ' : 'Permintaan ') +
            id + ' (' + String(request.jenis || request.type || 'layanan') + '): status ' +
            previousStatus + ' → ' + patch.status +
            (tujuan ? ', tujuan: ' + tujuan : '') + '.');
    }
    return list[idx];
}

function removePermintaan(id) {
    const current = getAllPermintaan();
    const removed = current.find(p => p && p.id === id);
    const list = current.filter(p => !p || p.id !== id);
    if (!saveAllPermintaan(list)) return false;
    if (removed && isAmbulanPermintaan(removed)) {
        recordActivityLog('Permintaan ambulans ' + id + ' dihapus.');
    }
    return true;
}

function findPermintaanByCode(code) {
    const needle = String(code || '').trim().toUpperCase();
    if (!needle) return null;
    return getAllPermintaan().find(p => p && String(p.id).toUpperCase() === needle) || null;
}

/* ---------- Penugasan driver per permintaan (multi-driver + konfirmasi) ----------
   Field pada objek permintaan:
   - assignedDrivers : [driverId, ...]  — bisa lebih dari satu driver
   - driverConfirms  : { driverId: 'ISO-timestamp' } — konfirmasi tugas per driver */

function assignedDriversOf(p) {
    const arr = (p && Array.isArray(p.assignedDrivers)) ? p.assignedDrivers : [];
    return arr.filter(id => id !== undefined && id !== null && String(id).trim() !== '')
        .map(id => String(id));
}

function confirmMapOf(p) {
    return (p && p.driverConfirms && typeof p.driverConfirms === 'object')
        ? p.driverConfirms : {};
}

function isPermintaanConfirmedBy(p, driverId) {
    const v = confirmMapOf(p)[driverId];
    return !!(v && String(v).trim());
}

/* Tambah satu driver ke daftar penugasan (idempoten, tanpa duplikat). */
function assignPermintaanDriver(id, driverId) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    if (idx === -1 || !driverId) return null;

    const p = list[idx];
    const assigned = assignedDriversOf(p);
    if (assigned.indexOf(String(driverId)) === -1) assigned.push(String(driverId));

    list[idx] = Object.assign({}, p, { assignedDrivers: assigned });
    return saveAllPermintaan(list) ? list[idx] : null;
}

/* Lepas tugas driver; konfirmasi driver tersebut ikut dibersihkan. */
function unassignPermintaanDriver(id, driverId) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    if (idx === -1) return null;

    const p = list[idx];
    const assigned = assignedDriversOf(p).filter(x => x !== String(driverId));
    const confirms = Object.assign({}, confirmMapOf(p));
    const assignedAmbulances = (p.assignedAmbulances && typeof p.assignedAmbulances === 'object')
        ? Object.assign({}, p.assignedAmbulances) : {};
    delete confirms[driverId];
    delete assignedAmbulances[String(driverId)];

    list[idx] = Object.assign({}, p, {
        assignedDrivers: assigned,
        driverConfirms: confirms,
        assignedAmbulances: assignedAmbulances
    });
    return saveAllPermintaan(list) ? list[idx] : null;
}

/* Batalkan konfirmasi driver untuk tugas aktif agar tugas kembali ke notifikasi. */
function cancelPermintaanTask(id, driverId) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    if (idx === -1 || !driverId) return null;

    const p = list[idx];
    if (p.status !== 'Diproses' || !isPermintaanConfirmedBy(p, driverId) ||
        isPermintaanDoneBy(p, driverId)) return null;

    const driverKey = String(driverId);
    const driver = driverListSource().find(d => d && String(d.id) === driverKey);
    const driverName = driver ? driver.name : driverKey;
    const ambulanceName = permintaanAmbulanceOf(p, driverKey);
    const assigned = assignedDriversOf(p).filter(x => x !== driverKey);
    const confirms = Object.assign({}, confirmMapOf(p));
    const done = (p.driverDone && typeof p.driverDone === 'object')
        ? Object.assign({}, p.driverDone) : {};
    const assignedAmbulances = (p.assignedAmbulances && typeof p.assignedAmbulances === 'object')
        ? Object.assign({}, p.assignedAmbulances) : {};
    delete confirms[driverKey];
    delete done[driverKey];
    delete assignedAmbulances[driverKey];

    list[idx] = Object.assign({}, p, {
        assignedDrivers: assigned,
        driverConfirms: confirms,
        driverDone: done,
        assignedAmbulances: assignedAmbulances
    });
    if (!saveAllPermintaan(list)) return null;
    recordActivityLog(driverName + ' membatalkan konfirmasi tugas ' + id +
        (ambulanceName ? ' (' + ambulanceName + ')' : '') + '.');
    return list[idx];
}

function permintaanAmbulanceOf(p, driverId) {
    if (p && Object.prototype.hasOwnProperty.call(p, 'selectedAmbulance')) {
        return String(p.selectedAmbulance || '').trim();
    }
    const legacy = p && p.assignedAmbulances && typeof p.assignedAmbulances === 'object'
        ? p.assignedAmbulances[String(driverId)] : '';
    return String(legacy || '').trim();
}

/* Pilihan armada dibagikan oleh semua driver untuk satu permintaan. */
function setPermintaanAmbulance(id, ambulanceName) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    if (idx === -1 || list[idx].status !== 'Diproses') return null;

    const name = String(ambulanceName || '').trim();
    if (name && !ambulanceListSource().some(amb => amb && amb.name === name)) return null;

    const updated = Object.assign({}, list[idx], { selectedAmbulance: name });
    list[idx] = updated;
    return saveAllPermintaan(list) ? updated : null;
}

/* Driver menyetujui/mengonfirmasi tugas yang dibroadcast admin (status Diproses).
   Konfirmasi = driver ikut bertugas, jadi driver otomatis masuk daftar assignedDrivers
   (bisa lebih dari satu driver pada satu permintaan). */
function confirmPermintaanTask(id, driverId, ambulanceName) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    if (idx === -1 || !driverId) return null;

    const p = list[idx];
    if (p.status !== 'Diproses') return null; // hanya permintaan yang sedang diproses
    // Tugas pengurusan jenazah tidak ditawarkan/diambil driver (bukan tugas ambulans).
    if (!isAmbulanPermintaan(p)) return null;

    const driverKey = String(driverId);
    const hasAmbulanceSelection = ambulanceName !== undefined && ambulanceName !== null &&
        String(ambulanceName).trim() !== '';
    const selectedAmbulance = hasAmbulanceSelection ? String(ambulanceName).trim() : '';
    const driver = driverListSource().find(item => item && String(item.id) === driverKey);
    const sharedSelection = String(p.selectedAmbulance || '').trim();
    const chosenAmbulance = hasAmbulanceSelection ? selectedAmbulance
        : (sharedSelection || String((driver && driver.ambulanceAssigned) || '').trim());
    if (chosenAmbulance &&
        !ambulanceListSource().some(amb => amb && amb.name === chosenAmbulance)) return null;
    if (hasAmbulanceSelection && !driver) return null;
    if (!chosenAmbulance) return null;

    const isNewConfirmation = !isPermintaanConfirmedBy(p, driverKey);
    const confirms = Object.assign({}, confirmMapOf(p));
    confirms[driverKey] = new Date().toISOString();

    const assigned = assignedDriversOf(p);
    if (assigned.indexOf(driverKey) === -1) assigned.push(driverKey);
    const assignedAmbulances = (p.assignedAmbulances && typeof p.assignedAmbulances === 'object')
        ? Object.assign({}, p.assignedAmbulances) : {};
    assignedAmbulances[driverKey] = chosenAmbulance;

    list[idx] = Object.assign({}, p, {
        driverConfirms: confirms,
        assignedDrivers: assigned,
        assignedAmbulances: assignedAmbulances,
        selectedAmbulance: chosenAmbulance
    });
    if (!saveAllPermintaan(list)) return null;
    if (isNewConfirmation) {
        recordActivityLog((driver ? driver.name : driverKey) + ' mengonfirmasi tugas ' + id +
            ' menggunakan ' + chosenAmbulance + '.');
    }
    return list[idx];
}

/* Driver menandai tugas sudah SELESAI. Hanya driver yang sudah mengonfirmasi tugas
   (dan permintaan masih berstatus Diproses) yang boleh menandai selesai. */
function confirmPermintaanSelesai(id, driverId) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    if (idx === -1 || !driverId) return null;

    const p = list[idx];
    if (p.status !== 'Diproses') return null;
    if (!isPermintaanConfirmedBy(p, driverId)) return null;
    if (isPermintaanDoneBy(p, driverId)) return null;

    const done = (p.driverDone && typeof p.driverDone === 'object')
        ? Object.assign({}, p.driverDone) : {};
    const newlyDone = [];
    const now = new Date().toISOString();
    done[String(driverId)] = now;
    newlyDone.push(String(driverId));

    /* Satu armada = satu tugas. Driver LAIN pada armada yang sama yang ikut
       mengonfirmasi tugas ini otomatis ikut ditandai selesai, sehingga status
       mereka & armadanya kembali Standby (sinkronisasi dijalankan otomatis oleh
       saveAllPermintaan di bawah). Driver pada armada berbeda TIDAK ikut:
       tugas mereka di armada lain masih berjalan. */
    const me = driverListSource().find(d => d && String(d.id) === String(driverId));
    const myAmb = me ? ambulanceForDriverTask(p, driverId, me) : '';
    if (myAmb) {
        driverListSource().forEach(d => {
            if (!d || String(d.id) === String(driverId)) return;
            if (ambulanceForDriverTask(p, d.id, d) !== myAmb) return;
            if (assignedDriversOf(p).indexOf(String(d.id)) === -1) return;
            if (!isPermintaanConfirmedBy(p, d.id)) return;
            if (done[String(d.id)]) return;
            done[String(d.id)] = now;
            newlyDone.push(String(d.id));
        });
    }

    /* Bila SEMUA driver yang mengonfirmasi tugas ini sudah menandai selesai
       (termasuk kru otomatis satu armada), bagian ambulans tuntas. Status
       permintaan baru menjadi 'Selesai' bila bagian pengurusan jenazah
       (pada permintaan gabungan) juga sudah tuntas. */
    const confirmed = assignedDriversOf(p).filter(id => confirmMapOf(p)[id]);
    const semuaSelesai = confirmed.length > 0 &&
        confirmed.every(id => done[String(id)] && String(done[String(id)]).trim());
    const janaizPending = isCombinedJanaizPermintaan(p) && !isJanaizSelesai(p);

    const patch = { driverDone: done };
    if (semuaSelesai && !janaizPending) patch.status = 'Selesai';

    list[idx] = Object.assign({}, p, patch);
    if (!saveAllPermintaan(list)) return null;
    const driverNames = newlyDone.map(id => {
        const driver = driverListSource().find(d => d && String(d.id) === id);
        return driver ? driver.name : id;
    });
    recordActivityLog('Tugas ' + id + ' selesai dikonfirmasi oleh ' + driverNames.join(', ') +
        (myAmb ? ' untuk ' + myAmb : '') + '.');
    return list[idx];
}

function isPermintaanDoneBy(p, driverId) {
    const done = (p && p.driverDone && typeof p.driverDone === 'object') ? p.driverDone : {};
    const v = done[driverId];
    return !!(v && String(v).trim());
}

/* ---------- Tim Janaiz: tugas pengurusan jenazah + konfirmasi ----------
   Tim janaiz menangani permintaan yang memuat PENGURUSAN JENAZAH (bukan
   pengantaran ambulans saja). Konfirmasi disimpan per anggota:
   - janaizConfirms : { memberId: 'ISO-timestamp' }
   - janaizDone     : { memberId: 'ISO-timestamp' }
   Permintaan pengurusan jenazah murni otomatis menjadi 'Selesai' setelah
   konfirmasi selesai. Pada permintaan gabungan (ambulan + pengurusan),
   konfirmasi ini HANYA menutup bagian jenazah; status 'Selesai' baru
   diberikan setelah driver juga menyelesaikan bagian ambulans.
   Daftar anggota dibaca dari STORE_KEYS.JANAIZ_MEMBERS (dikelola admin). */

function isJanaizPermintaan(p) {
    if (!p) return false;
    const type = String(p.type || '').toLowerCase();
    if (type === 'jenazah' || type === 'dua') return true;
    if (type) return false;
    return jenisPermintaan(p).toLowerCase().indexOf('pengurusan jenazah') !== -1;
}

function janaizConfirmMapOf(p) {
    return (p && p.janaizConfirms && typeof p.janaizConfirms === 'object')
        ? p.janaizConfirms : {};
}

function janaizDoneMapOf(p) {
    return (p && p.janaizDone && typeof p.janaizDone === 'object')
        ? p.janaizDone : {};
}

function isJanaizConfirmedBy(p, memberId) {
    const v = janaizConfirmMapOf(p)[memberId];
    return !!(v && String(v).trim());
}

function isJanaizDoneBy(p, memberId) {
    const v = janaizDoneMapOf(p)[memberId];
    return !!(v && String(v).trim());
}

/* Bagian jenazah sudah ditandai selesai oleh minimal satu anggota tim. */
function isJanaizSelesai(p) {
    const done = janaizDoneMapOf(p);
    return Object.keys(done).some(id => done[id] && String(done[id]).trim());
}

/* Permintaan gabungan: ambulans + pengurusan jenazah. */
function isCombinedJanaizPermintaan(p) {
    return isJanaizPermintaan(p) && isAmbulanPermintaan(p);
}

/* Semua driver yang mengonfirmasi sudah menyelesaikan bagian ambulans. */
function isDriverSideSelesai(p) {
    const confirmed = assignedDriversOf(p).filter(id => confirmMapOf(p)[id]);
    return confirmed.length > 0 && confirmed.every(id => isPermintaanDoneBy(p, id));
}

/* Daftar anggota Tim Janaiz: Firestore (dikelola admin), lalu seed, lalu
   akun cadangan. Array kosong dari admin tetap dihormati (tidak diisi ulang). */
function janaizMembersSource() {
    const stored = storeRead(STORE_KEYS.JANAIZ_MEMBERS, null);
    if (Array.isArray(stored)) return stored;
    if (typeof JANAIZ_SEED !== 'undefined' && Array.isArray(JANAIZ_SEED)) return JANAIZ_SEED;
    return JANAIZ_ACCOUNTS;
}

function janaizMemberName(memberId) {
    const key = String(memberId || '').trim().toLowerCase();
    const member = janaizMembersSource().find(m => m && (
        String(m.id || '').toLowerCase() === key ||
        String(m.name || '').toLowerCase() === key));
    return member ? (member.name || member.id) : String(memberId || 'Tim Janaiz');
}

/* Notifikasi tugas jenazah: sedang Diproses & belum dikonfirmasi anggota ini. */
function getJanaizNotificationsFor(memberId) {
    const key = String(memberId || '');
    return getActivePermintaan().filter(p => isJanaizPermintaan(p) &&
        !isJanaizConfirmedBy(p, key));
}

/* Tugas jenazah yang sudah dikonfirmasi anggota ini (semua status). */
function getJanaizTasksFor(memberId) {
    const key = String(memberId || '');
    if (!key) return [];
    return getAllPermintaan().filter(p => isJanaizPermintaan(p) &&
        isJanaizConfirmedBy(p, key));
}

function confirmJanaizTask(id, memberId) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    const key = String(memberId || '').trim();
    if (idx === -1 || !key) return null;

    const p = list[idx];
    if (p.status !== 'Diproses' || !isJanaizPermintaan(p)) return null;
    if (isJanaizConfirmedBy(p, key)) return p;

    const confirms = Object.assign({}, janaizConfirmMapOf(p));
    confirms[key] = new Date().toISOString();
    list[idx] = Object.assign({}, p, { janaizConfirms: confirms });
    if (!saveAllPermintaan(list)) return null;
    recordActivityLog(janaizMemberName(key) + ' mengonfirmasi tugas jenazah ' + id + '.');
    return list[idx];
}

function finishJanaizTask(id, memberId) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    const key = String(memberId || '').trim();
    if (idx === -1 || !key) return null;

    const p = list[idx];
    if (p.status !== 'Diproses' || !isJanaizConfirmedBy(p, key) ||
        isJanaizDoneBy(p, key)) return null;

    const done = Object.assign({}, janaizDoneMapOf(p));
    done[key] = new Date().toISOString();

    const patch = { janaizDone: done };
    /* Pengurusan jenazah murni langsung Selesai. Untuk permintaan + ambulans,
       konfirmasi ini hanya menutup bagian jenazah; status tetap Diproses
       sampai bagian ambulans (driver) juga tuntas. */
    if (!isCombinedJanaizPermintaan(p) || isDriverSideSelesai(p)) patch.status = 'Selesai';
    list[idx] = Object.assign({}, p, patch);
    if (!saveAllPermintaan(list)) return null;
    recordActivityLog(janaizMemberName(key) + ' menandai pengurusan jenazah ' + id +
        ' selesai' + (patch.status === 'Selesai'
            ? ' (status: Selesai)' : ' (bagian ambulans masih berjalan)') + '.');
    return list[idx];
}

/* Daftar tugas yang perlu dilihat driver: permintaan berstatus Diproses
   (hasil keputusan admin) — dipakai untuk notifikasi & daftar tugas panel driver. */
function getActivePermintaan() {
    return getAllPermintaan().filter(p => p && p.status === 'Diproses');
}

/* ---------- Jenis tugas: panel driver HANYA menerima tugas ambulans ----------
   Permintaan murni 'Pengurusan Jenazah' tidak menugaskan ambulans, jadi TIDAK
   ditawarkan ke driver (notifikasi, badge, toast, tombol konfirmasi).
   'Jenazah + Ambulans' tetap masuk karena ada penugasan ambulans. */
function jenisPermintaan(p) {
    return String((p && (p.jenis || p.type)) || '').trim();
}

function isAmbulanPermintaan(p) {
    const type = String((p && p.type) || '').toLowerCase();
    if (type === 'dua') return true;      // gabungan ambulans + pengurusan jenazah
    const j = jenisPermintaan(p).toLowerCase();
    if (!j) return true;                  // data lama tanpa label jenis
    return j.indexOf('ambul') !== -1;     // 'Pengurusan Jenazah' tidak mengandung 'ambul'
}

/* Ringkasan detail rute/tugas yang dipakai dashboard dan panel driver. */
function permintaanTaskDetails(p) {
    const detail = p && p.detail && typeof p.detail === 'object' ? p.detail : {};
    const person = detail.namaJenazah || detail.namaPasien;
    return [
        { label: detail.namaJenazah ? 'Jenazah' : 'Pasien', value: person },
        { label: 'Jadwal', value: detail.jadwalAmbulan },
        { label: 'Jemput', value: detail.penjemputan },
        { label: 'Tujuan', value: detail.tujuan }
    ].filter(item => item.value !== undefined && item.value !== null &&
        String(item.value).trim() !== '');
}

/* Notifikasi tugas untuk satu driver: hanya permintaan ambulan berstatus
   Diproses yang belum dikonfirmasi driver tersebut. Permintaan gabungan yang
   bagian ambulansnya sudah tuntas tidak ditawarkan lagi ke driver lain. */
function getPermintaanNotificationsForDriver(driverId) {
    return getActivePermintaan().filter(p => isAmbulanPermintaan(p) &&
        !isPermintaanConfirmedBy(p, driverId) && !isDriverSideSelesai(p));
}

/* Semua permintaan yang sudah dikonfirmasi driver tertentu ("Tugas Saya").
   Hanya tugas ambulans; permintaan pengurusan jenazah murni bukan tugas driver. */
function getPermintaanForDriver(driverId) {
    const driverKey = String(driverId || '').trim();
    if (!driverKey) return [];

    const driver = driverListSource().find(item => item &&
        String(item.id || '').trim() === driverKey);
    const identities = [driverKey];
    if (driver && driver.name) identities.push(String(driver.name).trim());
    const normalizedIdentities = identities.map(value => value.toLowerCase()).filter(Boolean);
    const matchesDriver = value => {
        const candidate = value && typeof value === 'object'
            ? (value.driverId || value.id || value.name)
            : value;
        return normalizedIdentities.indexOf(String(candidate || '').trim().toLowerCase()) !== -1;
    };
    const isConfirmed = value => {
        if (value && typeof value === 'object') {
            return value.confirmed !== false && value.cancelled !== true && value.active !== false;
        }
        return !!(value && String(value).trim());
    };

    return getAllPermintaan().filter(p => {
        if (!p) return false;
        if (!isAmbulanPermintaan(p)) return false;

        const assignedSource = p.assignedDrivers;
        const assigned = Array.isArray(assignedSource)
            ? assignedSource
            : (typeof assignedSource === 'string'
                ? [assignedSource]
                : (assignedSource && typeof assignedSource === 'object'
                    ? Object.keys(assignedSource).filter(key => assignedSource[key])
                    : []));
        const confirms = confirmMapOf(p);
        const confirmedByDriver = Array.isArray(confirms)
            ? confirms.some(item => matchesDriver(item) && isConfirmed(item))
            : Object.keys(confirms).some(key =>
                matchesDriver(key) && isConfirmed(confirms[key])
            );

        return assigned.some(matchesDriver) || confirmedByDriver ||
            matchesDriver(p.assignedDriver) || matchesDriver(p.driverId);
    });
}

/* ---------- Sinkron data driver & armada dengan tugas permintaan ----------
   Aturan:
   - Driver yang mengonfirmasi tugas aktif        -> status 'Sedang Bertugas'
   - Ambulans tugas aktif                        -> ambulanceAssigned pada driver
   - Driver tugas aktif                          -> driversAssigned pada ambulans
   - Selesai / tugas ditutup admin / tanpa tugas  -> kembali 'Standby'
   - Armada yang dipakai driver sedang bertugas   -> 'En Route', selain itu 'Standby'
   - Status manual 'Off Duty' TIDAK pernah diubah otomatis.
   Dipanggil otomatis dari confirmPermintaanTask/Selesai, updatePermintaan,
   removePermintaan, unassignPermintaanDriver, cancelPermintaanTask — sehingga panel admin & dashboard
   selalu membaca data yang sama. */

function driverHasActiveTask(driverId) {
    return getActivePermintaan().some(p => isAmbulanPermintaan(p) &&
        isPermintaanConfirmedBy(p, driverId) && !isPermintaanDoneBy(p, driverId));
}

function desiredDriverStatus(driverId) {
    return driverHasActiveTask(driverId) ? 'Sedang Bertugas' : 'Standby';
}

/* Samakan satu driver + seluruh armada dengan keadaan tugas terkini. */
function syncDriverStatus(driverId) {
    if (!driverId) return;
    const drv = driverListSource().find(d => d && d.id === driverId);
    if (drv && drv.status !== 'Off Duty') {
        const desired = desiredDriverStatus(driverId);
        if (drv.status !== desired) patchDriverRecord(driverId, { status: desired });
    }
    syncAmbulanceStatuses();
}

/* Samakan semua driver dan daftar kru armada dari tugas yang masih aktif. */
function syncAllDriverStatuses() {
    const activeAmbulanceByDriver = new Map();
    const drivers = driverListSource();
    getActivePermintaan().filter(isAmbulanPermintaan).forEach(p => {
        assignedDriversOf(p).forEach(driverId => {
            if (!isPermintaanConfirmedBy(p, driverId) || isPermintaanDoneBy(p, driverId) ||
                activeAmbulanceByDriver.has(driverId)) return;
            const driver = drivers.find(d => d && String(d.id) === driverId);
            if (!driver || driver.status === 'Off Duty') return;
            const ambulanceName = ambulanceForDriverTask(p, driverId, driver);
            if (ambulanceName) activeAmbulanceByDriver.set(driverId, ambulanceName);
        });
    });

    let changed = false;
    const updated = drivers.map(d => {
        if (!d) return d;
        const next = Object.assign({}, d, {
            ambulanceAssigned: activeAmbulanceByDriver.get(String(d.id)) || 'Tidak Ada'
        });
        if (d.status !== 'Off Duty') next.status = desiredDriverStatus(d.id);
        const driverChanged = next.status !== d.status ||
            next.ambulanceAssigned !== d.ambulanceAssigned;
        if (driverChanged) changed = true;
        return driverChanged ? next : d;
    });
    if (changed) {
        storeWrite(STORE_KEYS.DRIVERS, updated);
        if (typeof window.drivers !== 'undefined' && Array.isArray(window.drivers)) {
            window.drivers.length = 0;
            updated.forEach(d => window.drivers.push(d));
        }
    }
    syncAmbulanceStatuses();
}/* Status armada diturunkan dari driver yang menempel padanya:
   ada driver bertugas (tugas aktif, belum selesai) -> En Route, else Standby. */
/* Tugas ambulan aktif yang dikerjakan kru sebuah armada — dipakai untuk
   menurunkan tujuan rute armada dari data tujuan permintaan. */
function activeTaskForCrewOf(ambName) {
    return getActivePermintaan().find(p => isAmbulanPermintaan(p) &&
        assignedDriversOf(p).some(id => {
            const driver = driverListSource().find(d => d && String(d.id) === id);
            return driver && driver.status !== 'Off Duty' &&
                isPermintaanConfirmedBy(p, id) && !isPermintaanDoneBy(p, id) &&
                ambulanceForDriverTask(p, id, driver) === ambName;
        })) || null;
}

function ambulanceForDriverTask(p, driverId, driver) {
    if (p && Object.prototype.hasOwnProperty.call(p, 'selectedAmbulance')) {
        return permintaanAmbulanceOf(p, driverId);
    }
    return permintaanAmbulanceOf(p, driverId) ||
        String((driver && driver.ambulanceAssigned) || '').trim();
}

function driverHasActiveTaskOnAmbulance(driverId, ambName) {
    const driver = driverListSource().find(d => d && String(d.id) === String(driverId));
    if (!driver || driver.status === 'Off Duty') return false;
    return getActivePermintaan().some(p => isAmbulanPermintaan(p) &&
        assignedDriversOf(p).indexOf(String(driverId)) !== -1 &&
        isPermintaanConfirmedBy(p, driverId) && !isPermintaanDoneBy(p, driverId) &&
        ambulanceForDriverTask(p, driverId, driver) === ambName);
}

function syncAmbulanceStatuses() {
    const ambList = ambulanceListSource();
    if (!ambList.length) return;

    let changed = false;
    const updated = ambList.map(amb => {
        if (!amb) return amb;
        // Kru yang benar-benar bertugas (punya tugas ambulan aktif & bukan Off Duty).
        const crew = driverListSource().filter(d => d &&
            driverHasActiveTaskOnAmbulance(d.id, amb.name));
        const driversAssigned = crew.map(d => String(d.name || '').trim()).filter(Boolean);
        const status = crew.length ? 'En Route' : 'Standby';

        /* Gunakan Tujuan atau TPU dari tugas aktif; setelah tugas berakhir,
           tampilkan kembali tujuan default markaz. */
        const task = activeTaskForCrewOf(amb.name);
        const taskDestination = task && task.detail &&
            (task.detail.tujuan || task.detail.tpu);
        const destination = String(taskDestination || '').trim() ||
            DEFAULT_AMBULANCE_DESTINATION;

        /* GPS armada mengikuti posisi driver yang bertugas. Koordinat asli (default)
           disimpan di defaultLat/defaultLng sebelum pertama kali ditimpa; saat tidak
           ada driver bertugas, GPS dikembalikan ke default. Bila GPS diubah manual
           saat idle, nilai barunya diadopsi menjadi default baru. */
        const onDuty = crew.find(d => typeof d.lat === 'number' && typeof d.lng === 'number' &&
            isFinite(d.lat) && isFinite(d.lng));
        let defLat = (typeof amb.defaultLat === 'number') ? amb.defaultLat
            : (typeof amb.lat === 'number' ? amb.lat : null);
        let defLng = (typeof amb.defaultLng === 'number') ? amb.defaultLng
            : (typeof amb.lng === 'number' ? amb.lng : null);

        let lat = amb.lat, lng = amb.lng, gpsFromDriver = false;
        if (onDuty) {
            if (defLat === null) { defLat = amb.lat; defLng = amb.lng; }
            lat = onDuty.lat; lng = onDuty.lng;
            gpsFromDriver = true;
        } else if (amb.gpsFromDriver === true && defLat !== null && typeof defLat === 'number') {
            lat = defLat; lng = defLng;                     // pulih dari posisi driver
        } else if (typeof amb.lat === 'number' && isFinite(amb.lat)) {
            defLat = amb.lat; defLng = amb.lng;             // idle: adopsi GPS terkini sbg default
        }

        const next = Object.assign({}, amb, {
            status: status,
            destination: destination,
            driversAssigned: driversAssigned,
            gpsFromDriver: gpsFromDriver
        });
        if (typeof defLat === 'number' && isFinite(defLat)) {
            next.defaultLat = defLat; next.defaultLng = defLng;
        }
        if (gpsFromDriver || (amb.gpsFromDriver === true && gpsFromDriver === false)) {
            if (gpsFromDriver || typeof defLat === 'number') { next.lat = lat; next.lng = lng; }
        }

        const currentDrivers = Array.isArray(amb.driversAssigned) ? amb.driversAssigned : [];
        const sameDrivers = currentDrivers.length === driversAssigned.length &&
            currentDrivers.every((name, index) => name === driversAssigned[index]);
        const sama = sameDrivers &&
            ['status', 'destination', 'gpsFromDriver', 'defaultLat', 'defaultLng', 'lat', 'lng']
                .every(k => next[k] === amb[k]);
        if (sama) return amb;
        changed = true;
        return next;
    });

    if (changed && storeWrite(STORE_KEYS.AMBULANCES, updated)) {
        if (typeof ambulances !== 'undefined' && Array.isArray(ambulances)) {
            ambulances.length = 0;
            updated.forEach(a => ambulances.push(a));
        }
        updated.forEach((next, index) => {
            const previous = ambList[index];
            if (!next || !previous) return;

            const changes = [];
            if (next.status !== previous.status) {
                changes.push('status ' + (previous.status || 'tidak diketahui') + ' → ' + next.status);
            }
            const previousDrivers = Array.isArray(previous.driversAssigned)
                ? previous.driversAssigned : [];
            const nextDrivers = Array.isArray(next.driversAssigned)
                ? next.driversAssigned : [];
            const sameDrivers = previousDrivers.length === nextDrivers.length &&
                previousDrivers.every((name, driverIndex) => name === nextDrivers[driverIndex]);
            if (!sameDrivers) {
                changes.push('kru ' + (nextDrivers.length ? nextDrivers.join(', ') : 'tidak ada'));
            }
            if (next.destination !== previous.destination) {
                changes.push('tujuan ' + (next.destination || 'Markaz Halawatuliman'));
            }
            if (changes.length) {
                recordActivityLog((next.name || next.id || 'Ambulans') + ': ' +
                    changes.join('; ') + '.');
            }
        });
    }
}

/* ---------- Sesi admin ---------- */

/* Akun admin tersimpan di Firestore agar perubahan username/kata sandi bertahan.
   ADMIN_ACCOUNTS hanya seed/fallback bila dokumen belum tersedia. */
function adminAccountsSource() {
    const stored = storeRead(STORE_KEYS.ADMIN_ACCOUNT, null);
    if (Array.isArray(stored) && stored.length) return stored;
    return ADMIN_ACCOUNTS;
}

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
}

function isValidUsername(value) {
    return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(String(value || ''));
}

function adminLogin(username, password) {
    const u = normalizeUsername(username);
    const p = String(password || '');
    const account = adminAccountsSource().find(a => a &&
        String(a.username || '').trim().toLowerCase() === u &&
        String(a.password || '') === p);
    if (!account) return null;
    // Peran eksklusif: login admin mengakhiri sesi driver & tim janaiz,
    // sehingga pemegang satu peran tidak bisa membuka panel peran lain.
    storeRemove(STORE_KEYS.DRIVER_SESSION);
    storeRemove(STORE_KEYS.JANAIZ_SESSION);
    const session = { username: account.username, name: account.name, loginAt: new Date().toISOString() };
    storeWrite(STORE_KEYS.SESSION, session);
    return session;
}

function getAdminSession() {
    const session = storeRead(STORE_KEYS.SESSION, null);
    return (session && session.username) ? session : null;
}

function isAdminLoggedIn() {
    return getAdminSession() !== null;
}

function adminLogout() {
    storeRemove(STORE_KEYS.SESSION);
}

/* Admin mengubah username/kata sandinya sendiri. Kata sandi lama wajib benar. */
function changeAdminCredentials(currentPassword, newUsername, newPassword) {
    const accounts = adminAccountsSource().slice();
    const account = accounts[0];
    if (!account) return { ok: false, error: 'Akun admin tidak ditemukan.' };
    if (String(currentPassword || '') !== String(account.password || '')) {
        return { ok: false, error: 'Kata sandi saat ini salah.' };
    }

    const username = normalizeUsername(newUsername || account.username);
    if (!isValidUsername(username)) {
        return { ok: false, error: 'Username minimal 3 karakter: huruf kecil, angka, titik, garis bawah, atau strip.' };
    }

    const rawPassword = String(newPassword === undefined || newPassword === null ? '' : newPassword);
    const password = rawPassword.trim() === '' ? String(account.password || '') : rawPassword;
    if (password.length < 4) {
        return { ok: false, error: 'Kata sandi minimal 4 karakter.' };
    }

    accounts[0] = Object.assign({}, account, { username: username, password: password });
    if (!storeWrite(STORE_KEYS.ADMIN_ACCOUNT, accounts)) {
        return { ok: false, error: 'Gagal menyimpan akun ke Firestore.' };
    }

    const session = getAdminSession();
    if (session) {
        storeWrite(STORE_KEYS.SESSION, Object.assign({}, session, { username: username }));
    }
    recordActivityLog('Admin memperbarui username/kata sandi akun.');
    return { ok: true, account: accounts[0] };
}

/* ---------- Sesi driver (login ID + PIN) ---------- */

/* PIN bawaan semua driver bila admin belum mengatur PIN khusus (lihat tab Driver
   di panel admin). Kredensial tetap demo client-side, sama seperti akun admin. */
const DRIVER_DEFAULT_PIN = '1234';

function driverListSource() {
    // Store cache selalu mencerminkan perubahan Firestore terbaru.
    const stored = storeRead(STORE_KEYS.DRIVERS, null);
    if (Array.isArray(stored)) return stored;
    if (typeof drivers !== 'undefined' && Array.isArray(drivers)) return drivers;
    return [];
}

function ambulanceListSource() {
    const stored = storeRead(STORE_KEYS.AMBULANCES, null);
    if (Array.isArray(stored)) return stored;
    if (typeof ambulances !== 'undefined' && Array.isArray(ambulances)) return ambulances;
    return [];
}

function driverPinOf(drv) {
    const pin = drv && drv.pin;
    return (pin !== undefined && pin !== null && String(pin).trim() !== '')
        ? String(pin).trim()
        : DRIVER_DEFAULT_PIN;
}

/* Terima username, ID driver (mis. drv-01), atau nama lengkap, plus PIN. */
function driverLogin(idOrName, pin) {
    const key = String(idOrName || '').trim().toLowerCase();
    const p = String(pin || '').trim();
    if (!key || !p) return null;

    const drv = driverListSource().find(d => d && (
        String(d.username || '').toLowerCase() === key ||
        String(d.id || '').toLowerCase() === key ||
        String(d.name || '').toLowerCase() === key));
    if (!drv || driverPinOf(drv) !== p) return null;

    // Peran eksklusif: login driver mengakhiri sesi admin & tim janaiz.
    storeRemove(STORE_KEYS.SESSION);
    storeRemove(STORE_KEYS.JANAIZ_SESSION);
    const session = { id: drv.id, name: drv.name, loginAt: new Date().toISOString() };
    storeWrite(STORE_KEYS.DRIVER_SESSION, session);
    return session;
}

function getDriverSession() {
    const session = storeRead(STORE_KEYS.DRIVER_SESSION, null);
    return (session && session.id) ? session : null;
}

function isDriverLoggedIn() {
    return getDriverSession() !== null;
}

function driverLogout() {
    storeRemove(STORE_KEYS.DRIVER_SESSION);
}

/* Driver mengubah username/PIN-nya sendiri. ID internal tetap agar penugasan
   dan riwayat konfirmasi tidak putus. */
function changeDriverCredentials(driverId, currentPin, newUsername, newPin) {
    const list = driverListSource().slice();
    const idx = list.findIndex(d => d && String(d.id) === String(driverId));
    if (idx === -1) return { ok: false, error: 'Akun driver tidak ditemukan.' };
    const drv = list[idx];
    if (driverPinOf(drv) !== String(currentPin || '').trim()) {
        return { ok: false, error: 'PIN saat ini salah.' };
    }

    const username = normalizeUsername(newUsername || drv.username || drv.id);
    if (!isValidUsername(username)) {
        return { ok: false, error: 'Username minimal 3 karakter: huruf kecil, angka, titik, garis bawah, atau strip.' };
    }
    const conflict = list.some((d, i) => i !== idx && d && [
        d.username, d.id, d.name
    ].some(value => String(value || '').trim().toLowerCase() === username));
    if (conflict) return { ok: false, error: 'Username sudah dipakai driver lain.' };

    const rawPin = String(newPin === undefined || newPin === null ? '' : newPin);
    const pin = rawPin.trim() === '' ? driverPinOf(drv) : rawPin.trim();
    if (pin.length < 4) return { ok: false, error: 'PIN minimal 4 karakter.' };

    list[idx] = Object.assign({}, drv, { username: username, pin: pin });
    if (!storeWrite(STORE_KEYS.DRIVERS, list)) {
        return { ok: false, error: 'Gagal menyimpan akun ke Firestore.' };
    }
    syncCachedArrayToPage(STORE_KEYS.DRIVERS, list);
    recordActivityLog((drv.name || drv.id) + ' memperbarui username/PIN login.');
    return { ok: true, account: list[idx] };
}

/* ---------- Sesi Tim Janaiz (ID tim + PIN) ---------- */

function janaizLogin(idOrName, pin) {
    const key = String(idOrName || '').trim().toLowerCase();
    const p = String(pin || '').trim();
    if (!key || !p) return null;

    const member = janaizMembersSource().find(m => m && m.active !== false && (
        String(m.username || '').toLowerCase() === key ||
        String(m.id || '').toLowerCase() === key ||
        String(m.name || '').toLowerCase() === key));
    if (!member || String(member.pin || '').trim() !== p) return null;

    // Peran eksklusif: login tim janaiz mengakhiri sesi admin & driver.
    storeRemove(STORE_KEYS.SESSION);
    storeRemove(STORE_KEYS.DRIVER_SESSION);
    const session = { id: member.id, name: member.name, loginAt: new Date().toISOString() };
    storeWrite(STORE_KEYS.JANAIZ_SESSION, session);
    return session;
}

function getJanaizSession() {
    const session = storeRead(STORE_KEYS.JANAIZ_SESSION, null);
    return (session && session.id) ? session : null;
}

function isJanaizLoggedIn() {
    return getJanaizSession() !== null;
}

function janaizLogout() {
    storeRemove(STORE_KEYS.JANAIZ_SESSION);
}

/* Anggota Tim Janaiz mengubah username/PIN-nya sendiri. ID internal tetap agar
   konfirmasi tugas yang sudah tercatat tidak kehilangan pemiliknya. */
function changeJanaizCredentials(memberId, currentPin, newUsername, newPin) {
    const list = janaizMembersSource().slice();
    const idx = list.findIndex(m => m && String(m.id) === String(memberId));
    if (idx === -1) return { ok: false, error: 'Akun Tim Janaiz tidak ditemukan.' };
    const member = list[idx];
    if (member.active === false) return { ok: false, error: 'Akun sudah nonaktif.' };
    if (String(member.pin || '').trim() !== String(currentPin || '').trim()) {
        return { ok: false, error: 'PIN saat ini salah.' };
    }

    const username = normalizeUsername(newUsername || member.username || member.id);
    if (!isValidUsername(username)) {
        return { ok: false, error: 'Username minimal 3 karakter: huruf kecil, angka, titik, garis bawah, atau strip.' };
    }
    const conflict = list.some((m, i) => i !== idx && m && [
        m.username, m.id, m.name
    ].some(value => String(value || '').trim().toLowerCase() === username));
    if (conflict) return { ok: false, error: 'Username sudah dipakai anggota Tim Janaiz lain.' };

    const rawPin = String(newPin === undefined || newPin === null ? '' : newPin);
    const pin = rawPin.trim() === '' ? String(member.pin || '').trim() : rawPin.trim();
    if (pin.length < 4) return { ok: false, error: 'PIN minimal 4 karakter.' };

    list[idx] = Object.assign({}, member, { username: username, pin: pin });
    if (!storeWrite(STORE_KEYS.JANAIZ_MEMBERS, list)) {
        return { ok: false, error: 'Gagal menyimpan akun ke Firestore.' };
    }
    recordActivityLog((member.name || member.id) + ' memperbarui username/PIN login.');
    return { ok: true, account: list[idx] };
}

/* Perbarui sebagian data satu driver (mis. lat/lng GPS) dan simpan ke Firestore. */
function patchDriverRecord(driverId, patch) {
    const stored = storeRead(STORE_KEYS.DRIVERS, null);
    const list = Array.isArray(stored)
        ? stored.slice()
        : driverListSource().map(d => Object.assign({}, d));
    const idx = list.findIndex(d => d && d.id === driverId);
    if (idx === -1) return null;

    const previous = list[idx];
    list[idx] = Object.assign({}, list[idx], patch, { id: driverId });
    if (!storeWrite(STORE_KEYS.DRIVERS, list)) return null;
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'status') &&
        patch.status !== previous.status) {
        recordActivityLog((previous.name || driverId) + ' mengubah status menjadi ' +
            patch.status + '.');
    }
    return list[idx];
}

/* ---------- Kas: catatan pemasukan & pengeluaran (halaman kas.html) ----------
   Setiap entri: { id, date ('YYYY-MM-DD'), type: 'masuk'|'keluar', category,
   amount (number), note, createdAt, by, role }. */

function getAllKas() {
    const list = storeRead(STORE_KEYS.KAS, []);
    return Array.isArray(list) ? list : [];
}

function saveAllKas(list) {
    return storeWrite(STORE_KEYS.KAS, list);
}

function addKas(item) {
    const list = getAllKas();
    list.unshift(item);
    return saveAllKas(list) ? item : null;
}

function removeKas(id) {
    return saveAllKas(getAllKas().filter(k => !k || k.id !== id));
}

/* from/to berformat 'YYYY-MM-DD'; kosong = tanpa batas. */
function filterKasByRange(list, from, to) {
    const arr = Array.isArray(list) ? list : [];
    if (!from && !to) return arr;
    return arr.filter(k => {
        const d = String((k && k.date) || '');
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    });
}

/* ---------- Kas: catatan pemasukan & pengeluaran (halaman kas.html) ----------
   Setiap entri: { id, date ('YYYY-MM-DD'), type: 'masuk'|'keluar', category,
   amount (number), note, createdAt, by, role }. */

function getAllKas() {
    const list = storeRead(STORE_KEYS.KAS, []);
    return Array.isArray(list) ? list : [];
}

function saveAllKas(list) {
    return storeWrite(STORE_KEYS.KAS, list);
}

function addKas(item) {
    const list = getAllKas();
    list.unshift(item);
    return saveAllKas(list) ? item : null;
}

function removeKas(id) {
    return saveAllKas(getAllKas().filter(k => !k || k.id !== id));
}

/* from/to berformat 'YYYY-MM-DD'; kosong = tanpa batas. */
function filterKasByRange(list, from, to) {
    const arr = Array.isArray(list) ? list : [];
    if (!from && !to) return arr;
    return arr.filter(k => {
        const d = String((k && k.date) || '');
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    });
}

/* ---------- Rekonsiliasi setelah data Firestore siap ----------
   Status yang tersimpan (termasuk nilai awal/seed di data.js) selalu diluruskan
   agar sama dengan data permintaan begitu sebuah halaman dibuka — mis. tanpa
   tugas aktif, semua driver & armada tampil Standby, sesuai isi permintaan.
   Menunggu app:ready agar cache awal tidak tertimpa sebelum Firestore selesai. */
document.addEventListener('app:ready', function () {
    try {
        syncAllDriverStatuses();
    } catch (e) {
        console.warn('Rekonsiliasi status awal gagal:', e);
    }
});

/* ---------- Filter rentang waktu permintaan (dipakai admin & halaman riwayat) ---------- */

/* from/to berformat 'YYYY-MM-DD' (value input type="date"); kosong = tanpa batas. */
function filterPermintaanByRange(list, from, to) {
    const arr = Array.isArray(list) ? list : [];
    const start = from ? new Date(from + 'T00:00:00') : null;
    const end = to ? new Date(to + 'T23:59:59.999') : null;
    if (!start && !end) return arr;

    return arr.filter(p => {
        const t = new Date(p && p.createdAt);
        if (isNaN(t.getTime())) return false;
        if (start && t < start) return false;
        if (end && t > end) return false;
        return true;
    });
}

/* Label human-readable untuk field detail permintaan (dipakai admin & riwayat). */
function fieldLabel(key) {
    const map = {
        hubungan: 'Hubungan', namaPasien: 'Nama pasien', namaJenazah: 'Nama jenazah',
        kelamin: 'Jenis kelamin', umur: 'Umur', riwayatSakit: 'Riwayat sakit',
        penyebab: 'Penyebab kematian', alamatRumah: 'Alamat rumah', rumahDuka: 'Rumah duka',
        maps: 'Google Maps', jadwalAmbulan: 'Jadwal ambulan', penjemputan: 'Penjemputan',
        tujuan: 'Tujuan', meninggal: 'Meninggal', jadwalPengurusan: 'Jadwal pengurusan',
        dishalatkan: 'Dishalatkan', tpu: 'TPU', parkirAmbulan: 'Parkir ambulan',
        almarhum: 'Almarhum', waktu: 'Waktu', tujuanJenazah: 'Tujuan jenazah',
        kondisi: 'Kondisi', catatan: 'Catatan', sumber: 'Sumber', ambulan: 'Armada'
    };
    return map[key] || key;
}

/* Satu baris detail permintaan untuk row-card (admin & halaman riwayat).
   Field "maps" yang berisi URL ditampilkan sebagai tautan yang langsung
   membuka Google Maps di tab baru. */
function detailLineHtml(key, value) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    const label = '<span class="text-slate-500">' + escapeDetailHtml(fieldLabel(key)) + ':</span> ';

    if (key === 'maps' && /^https?:\/\//i.test(text)) {
        return '<span class="block">' + label +
            '<a href="' + escapeDetailHtml(text) + '" target="_blank" rel="noopener noreferrer"' +
            ' class="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 underline">' +
            '<i class="fa-solid fa-map-location-dot"></i>Buka Google Maps</a></span>';
    }

    return '<span class="block">' + label + escapeDetailHtml(text) + '</span>';
}

function escapeDetailHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* ---------- Navigasi per-peran (elemen dengan atribut data-nav) ----------
   - data-nav="admin"  : disembunyikan untuk sesi driver/janaiz; bila admin,
                         tautan dialihkan langsung ke admin.html.
   - data-nav="driver" : disembunyikan untuk sesi admin/janaiz; bila driver,
                         tautan dialihkan langsung ke driver.html.
   - data-nav="janaiz" : disembunyikan untuk sesi admin/driver; bila tim janaiz,
                         tautan dialihkan langsung ke janaiz.html.
   - data-nav="auto"   : tanpa sesi dibiarkan; sesi yang login diarahkan ke
                         panel perannya masing-masing.
   Elemen berlabel bisa menambahkan [data-nav-label] untuk mengganti teks. */
function applyRoleNav() {
    const admin = isAdminLoggedIn();
    const driver = isDriverLoggedIn();
    const janaiz = isJanaizLoggedIn();

    document.querySelectorAll('[data-nav]').forEach(el => {
        const role = el.getAttribute('data-nav');

        if (role === 'admin') {
            if (driver || janaiz) { el.classList.add('hidden'); return; }
            if (admin) setNavTarget(el, 'admin.html', 'Panel Admin');
        } else if (role === 'driver') {
            if (admin || janaiz) { el.classList.add('hidden'); return; }
            if (driver) setNavTarget(el, 'driver.html', 'Panel Driver');
        } else if (role === 'janaiz') {
            if (admin || driver) { el.classList.add('hidden'); return; }
            if (janaiz) setNavTarget(el, 'janaiz.html', 'Panel Tim Janaiz');
        } else if (role === 'auto') {
            if (admin) setNavTarget(el, 'admin.html', 'Panel Admin');
            else if (driver) setNavTarget(el, 'driver.html', 'Panel Driver');
            else if (janaiz) setNavTarget(el, 'janaiz.html', 'Panel Tim Janaiz');
        }
    });
}

/* ---------- Badge jumlah permintaan baru pada floating nav ----------
   Permintaan dianggap "baru" bila statusnya masih Menunggu — sama dengan
   sumber notifikasi di panel admin. Diperbarui setiap snapshot Firestore. */
function countNewPermintaan() {
    const list = typeof getAllPermintaan === 'function' ? getAllPermintaan() : [];
    return list.filter(item => item && item.status === 'Menunggu').length;
}

function updateNavRequestBadge() {
    const badge = document.querySelector('.bottom-nav [data-nav-badge="permintaan"]');
    if (!badge) return;

    const count = countNewPermintaan();
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);

    const link = badge.closest('a');
    if (link) {
        link.setAttribute('aria-label', count
            ? 'Riwayat permintaan, ' + count + ' permintaan baru'
            : 'Riwayat permintaan');
    }
}

appOnReady(function () {
    updateNavRequestBadge();
    document.addEventListener('firestore:update', function (event) {
        if (event.detail && event.detail.key === STORE_KEYS.PERMINTAAN) updateNavRequestBadge();
    });
});

function setNavTarget(el, href, label) {
    el.setAttribute('href', href);
    if (el.hasAttribute('title')) el.setAttribute('title', label);
    const text = el.querySelector('[data-nav-label]');
    if (text) text.textContent = label;
}
