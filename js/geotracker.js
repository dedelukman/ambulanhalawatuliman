/* geotracker.js — update lokasi GPS otomatis di SEMUA halaman selama sesi driver aktif.
   Dipasang di semua halaman (store.js -> geotracker.js) sehingga posisi terus
   diperbarui walau driver membuka beranda / riwayat / dashboard, tidak hanya driver.html.

   Cara kerja:
   - DOMContentLoaded: bila isDriverLoggedIn() -> watchPosition().
   - Setiap posisi: patchDriverRecord() ke Firestore (si_drivers),
     sehingga dashboard/admin membaca perubahan (lihat js/script.js).
   - Event DOM untuk UI halaman driver (js/driver.js):
       si-geo-state   {active, reason}          perubahan status aktif/nonaktif
       si-geo-update  {lat,lng,accuracy,lastSeen,count}
       si-geo-error   {code,message,stopped}

   Urutan muat: store.js -> geotracker.js -> (data.js) -> script.js/driver.js/home.js/... */

let geoWatchId = null;
let geoUpdateCount = 0;

function isGeoTrackingActive() {
    return geoWatchId !== null;
}

function emitGeo(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail }));
}

function fmtGeoCoord(lat, lng) {
    return Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5);
}

function startGeoTracking() {
    if (geoWatchId !== null) return true;
    if (typeof isDriverLoggedIn !== 'function' || !isDriverLoggedIn()) return false;

    if (!('geolocation' in navigator)) {
        emitGeo('si-geo-error', {
            code: null,
            message: 'Perangkat ini tidak mendukung Geolocation.',
            stopped: true
        });
        emitGeo('si-geo-state', { active: false, reason: 'unsupported' });
        return false;
    }

    geoWatchId = navigator.geolocation.watchPosition(onGeoPosition, onGeoError, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000
    });
    emitGeo('si-geo-state', { active: true, reason: 'start' });
    return true;
}

function stopGeoTracking(reason) {
    if (geoWatchId !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(geoWatchId);
    }
    geoWatchId = null;
    emitGeo('si-geo-state', { active: false, reason: reason || 'stop' });
}

/* ---------- Pembatasan penyimpanan posisi ----------
   watchPosition mengirim posisi hampir tiap detik. Menulis seluruh dokumen
   driver ke Firestore pada setiap posisi membuat snapshot memicu render ulang
   di semua halaman, jadi posisi disimpan paling sering tiap 8 detik (dan hanya
   bila berpindah minimal 10 m). UI tetap menerima semua pembaruan. */
const GEO_SAVE_INTERVAL_MS = 8000;
const GEO_SAVE_MIN_METERS = 10;
let geoLastSavedAt = 0;
let geoLastSavedLat = null;
let geoLastSavedLng = null;

function geoDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shouldSaveGeoPosition(lat, lng) {
    if (Date.now() - geoLastSavedAt < GEO_SAVE_INTERVAL_MS) return false;
    if (geoLastSavedLat === null) return true;
    return geoDistanceMeters(geoLastSavedLat, geoLastSavedLng, lat, lng) >= GEO_SAVE_MIN_METERS;
}

function markGeoSaved(lat, lng) {
    geoLastSavedAt = Date.now();
    geoLastSavedLat = lat;
    geoLastSavedLng = lng;
}

function onGeoPosition(pos) {
    // Sesi driver berakhir (mis. logout di tab lain)? hentikan tracking.
    if (typeof isDriverLoggedIn === 'function' && !isDriverLoggedIn()) {
        stopGeoTracking('logout');
        return;
    }
    const session = (typeof getDriverSession === 'function') ? getDriverSession() : null;
    if (!session) {
        stopGeoTracking('no-session');
        return;
    }

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    geoUpdateCount++;

    const updated = (shouldSaveGeoPosition(lat, lng) && typeof patchDriverRecord === 'function')
        ? patchDriverRecord(session.id, {
            lat: lat,
            lng: lng,
            lastSeen: new Date().toISOString(),
            locationName: 'GPS: ' + fmtGeoCoord(lat, lng)
        })
        : null;
    if (updated) markGeoSaved(lat, lng);

    emitGeo('si-geo-update', {
        lat: lat,
        lng: lng,
        accuracy: pos.coords.accuracy,
        lastSeen: new Date().toISOString(),
        count: geoUpdateCount,
        saved: updated !== null
    });
}

function onGeoError(err) {
    let message;
    let stopped = false;
    if (err && err.code === 1) {          // PERMISSION_DENIED
        message = 'Izin lokasi ditolak. Izinkan akses lokasi di pengaturan browser lalu aktifkan kembali.';
        stopped = true;
    } else if (err && err.code === 3) {   // TIMEOUT
        message = 'Waktu tunggu lokasi habis. Coba lagi di tempat terbuka.';
    } else if (err && err.code === 2) {   // POSITION_UNAVAILABLE
        message = 'Sinyal GPS tidak tersedia. Pastikan layanan lokasi perangkat aktif.';
    } else {
        message = 'Gagal mendapatkan lokasi: ' + ((err && err.message) || 'tidak diketahui');
    }

    if (stopped && geoWatchId !== null) {
        geoWatchId = null;
        emitGeo('si-geo-state', { active: false, reason: 'permission-denied' });
    }
    emitGeo('si-geo-error', { code: err ? err.code : null, message: message, stopped: stopped });
}

appOnReady(() => {
    // Login driver = lokasi otomatis aktif di halaman ini
    startGeoTracking();
});
