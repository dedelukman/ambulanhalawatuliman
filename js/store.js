/* store.js — Firestore untuk data aplikasi dan localStorage untuk sesi peramban. */

const STORE_KEYS = {
    AMBULANCES: 'si_ambulances',
    DRIVERS: 'si_drivers',
    PERMINTAAN: 'si_permintaan',
    KAS: 'si_kas',
    SESSION: 'si_session',
    DRIVER_SESSION: 'si_driver_session'
};

/* Kredensial demo (client-side). Hanya untuk prototipe/demo — BUKAN keamanan nyata,
   karena siapa pun bisa membaca kode ini di browser. */
const ADMIN_ACCOUNTS = [
    { username: 'admin', password: 'admin123', name: 'Admin Utama' }
];

function isFirestoreKey(key) {
    return typeof FS_DOC !== 'undefined' && Object.prototype.hasOwnProperty.call(FS_DOC, key);
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
        if (!window.db || !Array.isArray(value)) {
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
        const write = previous.then(() =>
            db.collection('si_state').doc(FS_DOC[key]).set({ items: snapshot })
        );
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
        const write = previous.then(() => db.collection('si_state').doc(FS_DOC[key]).delete());
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

/* ---------- Permintaan (dipakai home.js & admin.js) ---------- */

function getAllPermintaan() {
    const list = storeRead(STORE_KEYS.PERMINTAAN, []);
    return Array.isArray(list) ? list : [];
}

function saveAllPermintaan(list) {
    const ok = storeWrite(STORE_KEYS.PERMINTAAN, list);
    /* Sinkron otomatis: setiap perubahan permintaan (konfirmasi, selesai, status,
       hapus, lepas tugas) langsung diselaraskan ke status driver & armada,
       sehingga dashboard/admin selalu menampilkan data yang sama. */
    if (ok) syncAllDriverStatuses();
    return ok;
}

function addPermintaan(item) {
    const list = getAllPermintaan();
    list.unshift(item);
    return saveAllPermintaan(list) ? item : null;
}

function updatePermintaan(id, patch) {
    const list = getAllPermintaan();
    const idx = list.findIndex(p => p && p.id === id);
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], patch);
    return saveAllPermintaan(list) ? list[idx] : null;
}

function removePermintaan(id) {
    const list = getAllPermintaan().filter(p => !p || p.id !== id);
    return saveAllPermintaan(list);
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
    return saveAllPermintaan(list) ? list[idx] : null;
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
    return saveAllPermintaan(list) ? list[idx] : null;
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

    const done = (p.driverDone && typeof p.driverDone === 'object')
        ? Object.assign({}, p.driverDone) : {};
    const now = new Date().toISOString();
    done[String(driverId)] = now;

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
        });
    }

    /* Bila SEMUA driver yang mengonfirmasi tugas ini sudah menandai selesai
       (termasuk kru otomatis satu armada), status permintaan dinaikkan otomatis
       'Diproses' -> 'Selesai'. Masih ada pengkonfirm yang belum selesai ->
       tetap 'Diproses' sampai tuntas. */
    const confirmed = assignedDriversOf(p).filter(id => confirmMapOf(p)[id]);
    const semuaSelesai = confirmed.length > 0 &&
        confirmed.every(id => done[String(id)] && String(done[String(id)]).trim());

    const patch = { driverDone: done };
    if (semuaSelesai) patch.status = 'Selesai';

    list[idx] = Object.assign({}, p, patch);
    return saveAllPermintaan(list) ? list[idx] : null;
}

function isPermintaanDoneBy(p, driverId) {
    const done = (p && p.driverDone && typeof p.driverDone === 'object') ? p.driverDone : {};
    const v = done[driverId];
    return !!(v && String(v).trim());
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
   Diproses yang belum dikonfirmasi driver tersebut. */
function getPermintaanNotificationsForDriver(driverId) {
    return getActivePermintaan().filter(p => isAmbulanPermintaan(p) &&
        !isPermintaanConfirmedBy(p, driverId));
}

/* Semua permintaan yang sudah dikonfirmasi driver tertentu ("Tugas Saya"). */
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

/* ---------- Sinkron status driver & armada dengan tugas permintaan ----------
   Aturan:
   - Driver yang mengonfirmasi tugas aktif        -> status 'Sedang Bertugas'
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

/* Samakan SEMUA driver (dipakai setiap perubahan data permintaan). */
function syncAllDriverStatuses() {
    driverListSource().forEach(d => {
        if (!d || d.status === 'Off Duty') return;
        const desired = desiredDriverStatus(d.id);
        if (d.status !== desired) patchDriverRecord(d.id, { status: desired });
    });
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
        const status = crew.length ? 'En Route' : 'Standby';

        /* Tujuan rute mengikuti data tujuan pada permintaan yang sedang berjalan;
           tanpa tugas (atau tujuan kosong di data) -> kosong. */
        const task = activeTaskForCrewOf(amb.name);
        const destination = (task && task.detail && task.detail.tujuan)
            ? String(task.detail.tujuan) : '';

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
            gpsFromDriver: gpsFromDriver
        });
        if (typeof defLat === 'number' && isFinite(defLat)) {
            next.defaultLat = defLat; next.defaultLng = defLng;
        }
        if (gpsFromDriver || (amb.gpsFromDriver === true && gpsFromDriver === false)) {
            if (gpsFromDriver || typeof defLat === 'number') { next.lat = lat; next.lng = lng; }
        }

        const sama = ['status', 'destination', 'gpsFromDriver', 'defaultLat', 'defaultLng', 'lat', 'lng']
            .every(k => next[k] === amb[k]);
        if (sama) return amb;
        changed = true;
        return next;
    });

    if (changed) {
        storeWrite(STORE_KEYS.AMBULANCES, updated);
        if (typeof ambulances !== 'undefined' && Array.isArray(ambulances)) {
            ambulances.length = 0;
            updated.forEach(a => ambulances.push(a));
        }
    }
}

/* ---------- Sesi admin ---------- */

function adminLogin(username, password) {
    const u = String(username || '').trim().toLowerCase();
    const p = String(password || '');
    const account = ADMIN_ACCOUNTS.find(a => a.username === u && a.password === p);
    if (!account) return null;
    // Peran eksklusif: login admin mengakhiri sesi driver (dan sebaliknya),
    // sehingga pemegang satu peran tidak bisa membuka panel peran lain.
    storeRemove(STORE_KEYS.DRIVER_SESSION);
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

/* Terima ID driver (mis. drv-01) atau nama lengkap, plus PIN. */
function driverLogin(idOrName, pin) {
    const key = String(idOrName || '').trim().toLowerCase();
    const p = String(pin || '').trim();
    if (!key || !p) return null;

    const drv = driverListSource().find(d => d &&
        String(d.id || '').toLowerCase() === key ||
        (d && String(d.name || '').toLowerCase() === key));
    if (!drv || driverPinOf(drv) !== p) return null;

    // Peran eksklusif: login driver mengakhiri sesi admin.
    storeRemove(STORE_KEYS.SESSION);
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

/* Perbarui sebagian data satu driver (mis. lat/lng GPS) dan simpan ke Firestore. */
function patchDriverRecord(driverId, patch) {
    const stored = storeRead(STORE_KEYS.DRIVERS, null);
    const list = Array.isArray(stored)
        ? stored.slice()
        : driverListSource().map(d => Object.assign({}, d));
    const idx = list.findIndex(d => d && d.id === driverId);
    if (idx === -1) return null;

    list[idx] = Object.assign({}, list[idx], patch, { id: driverId });
    if (!storeWrite(STORE_KEYS.DRIVERS, list)) return null;
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

/* ---------- Navigasi per-peran (elemen dengan atribut data-nav) ----------
   - data-nav="admin"  : disembunyikan untuk sesi driver; bila sesi admin,
                         tautan dialihkan langsung ke admin.html.
   - data-nav="driver" : disembunyikan untuk sesi admin; bila sesi driver,
                         tautan dialihkan langsung ke driver.html.
   - data-nav="auto"   : tanpa sesi dibiarkan; sesi admin/driver diarahkan ke
                         panel masing-masing.
   Elemen berlabel bisa menambahkan [data-nav-label] untuk mengganti teks. */
function applyRoleNav() {
    const admin = isAdminLoggedIn();
    const driver = isDriverLoggedIn();

    document.querySelectorAll('[data-nav]').forEach(el => {
        const role = el.getAttribute('data-nav');

        if (role === 'admin') {
            // Sesi driver tidak boleh melihat pintu masuk panel admin
            if (driver) { el.classList.add('hidden'); return; }
            if (admin) setNavTarget(el, 'admin.html', 'Panel Admin');
        } else if (role === 'driver') {
            // Sesi admin tidak boleh melihat pintu masuk panel driver
            if (admin) { el.classList.add('hidden'); return; }
            if (driver) setNavTarget(el, 'driver.html', 'Panel Driver');
        } else if (role === 'auto') {
            if (admin && !driver) setNavTarget(el, 'admin.html', 'Panel Admin');
            else if (driver && !admin) setNavTarget(el, 'driver.html', 'Panel Driver');
        }
    });
}

function setNavTarget(el, href, label) {
    el.setAttribute('href', href);
    if (el.hasAttribute('title')) el.setAttribute('title', label);
    const text = el.querySelector('[data-nav-label]');
    if (text) text.textContent = label;
}
