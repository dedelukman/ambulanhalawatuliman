/* geotracker.js — update lokasi GPS otomatis di SEMUA halaman selama sesi driver aktif.
   Dipasang di semua halaman (store.js -> geotracker.js) sehingga posisi terus
   diperbarui walau driver membuka beranda / riwayat / dashboard, tidak hanya driver.html.

   Cara kerja:
   - DOMContentLoaded: bila isDriverLoggedIn() -> watchPosition().
   - Setiap posisi: patchDriverRecord() ke localStorage (si_drivers),
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

    const updated = (typeof patchDriverRecord === 'function')
        ? patchDriverRecord(session.id, {
            lat: lat,
            lng: lng,
            lastSeen: new Date().toISOString(),
            locationName: 'GPS: ' + fmtGeoCoord(lat, lng)
        })
        : null;

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

document.addEventListener('DOMContentLoaded', () => {
    // Login driver = lokasi otomatis aktif di halaman ini
    startGeoTracking();
});
