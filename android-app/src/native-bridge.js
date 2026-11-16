/* native-bridge.js — jembatan fitur Android (Capacitor).
   Hanya aktif di dalam aplikasi Android; di browser biasa file ini tidak melakukan apa pun.

   Fitur:
   1. Lokasi latar belakang: navigator.geolocation.watchPosition/getCurrentPosition
      dialihkan ke plugin BackgroundGeolocation (foreground service Android),
      sehingga posisi driver tetap terkirim ke Firestore walau layar mati /
      aplikasi di latar belakang. js/geotracker.js tidak perlu diubah.
   2. Notifikasi sistem: tugas baru (Diproses untuk driver, Menunggu untuk admin,
      jenazah untuk Tim Janaiz) ditampilkan sebagai notifikasi Android.
   3. Push notification (FCM) opsional: token perangkat disimpan ke
      si_state/push_tokens agar Cloud Function dapat mengirim notifikasi
      saat aplikasi ditutup. Aktif setelah google-services.json dipasang.
   4. Tombol back Android: kembali ke halaman sebelumnya, keluar hanya di halaman awal. */

(function () {
    'use strict';

    var cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

    var Plugins = cap.Plugins || {};
    var BgGeo = Plugins.BackgroundGeolocation || null;
    var Geo = Plugins.Geolocation || null;
    var LocalNotif = Plugins.LocalNotifications || null;
    var Push = Plugins.PushNotifications || null;
    var NativeApp = Plugins.App || null;

    var NOTIF_CHANNEL = 'si_tasks';
    var NOTIFIED_STORAGE_KEY = 'si_native_notified_v1';
    var APP_VERSION = '1.0.2';

    window.__SI_NATIVE_APP = true;
    document.documentElement.classList.add('si-native');

    function log() {
        try { console.log.apply(console, ['[native]'].concat([].slice.call(arguments))); } catch (e) { /* ignore */ }
    }

    function warn(message, error) {
        try { console.warn('[native] ' + message, error || ''); } catch (e) { /* ignore */ }
    }

    /* =====================================================================
       1. LOKASI LATAR BELAKANG
       ===================================================================== */

    var webWatchers = Object.create(null);
    var nextWatcherId = 1;

    function bgWatcherOptions() {
        return {
            backgroundMessage: 'SI-Ambulans membagikan lokasi Anda ke dashboard petugas.',
            backgroundTitle: 'Berbagi lokasi aktif',
            requestPermissions: true,
            stale: false,
            distanceFilter: 10
        };
    }

    function toGeoPosition(location) {
        return {
            coords: {
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: typeof location.accuracy === 'number' ? location.accuracy : null,
                altitude: location.altitude === undefined ? null : location.altitude,
                altitudeAccuracy: null,
                heading: location.bearing === undefined ? null : location.bearing,
                speed: location.speed === undefined ? null : location.speed
            },
            timestamp: location.time || Date.now()
        };
    }

    function geoError(err) {
        // 1 = izin ditolak, 2 = posisi tidak tersedia, 3 = timeout (mengikuti Geolocation API)
        var code = err && (err.code === 1 || err.code === 3) ? err.code : 2;
        return {
            code: code,
            message: (err && err.message) || 'Lokasi tidak tersedia.',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3
        };
    }

    var webGetCurrentPosition = navigator.geolocation
        ? navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
        : null;

    if (navigator.geolocation) {
        /* Pengambilan lokasi sekali pakai (isi alamat otomatis di form) memakai
           plugin Geolocation: cukup izin lokasi, tanpa foreground service dan
           tanpa notifikasi "berbagi lokasi" untuk pemohon yang bukan driver. */
        navigator.geolocation.getCurrentPosition = function (success, error, options) {
            if (!Geo) {
                if (webGetCurrentPosition) webGetCurrentPosition(success, error, options);
                return;
            }
            var timeoutMs = options && options.timeout ? options.timeout : 15000;

            Geo.requestPermissions()
                .then(function (perm) {
                    if (!perm || perm.location !== 'granted') throw new Error('PERMISSION_DENIED');
                    return Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 });
                })
                .then(function (position) {
                    if (typeof success === 'function') success(position);
                })
                .catch(function (err) {
                    var denied = err && err.message === 'PERMISSION_DENIED';
                    if (typeof error === 'function') {
                        error({
                            code: denied ? 1 : 2,
                            message: denied ? 'Izin lokasi ditolak.' : 'Lokasi tidak tersedia.',
                            PERMISSION_DENIED: 1,
                            POSITION_UNAVAILABLE: 2,
                            TIMEOUT: 3
                        });
                    }
                });
        };
    }

    if (BgGeo && navigator.geolocation) {
        navigator.geolocation.watchPosition = function (success, error) {
            var id = nextWatcherId++;
            var entry = { active: true, nativeId: null };
            webWatchers[id] = entry;

            var added;
            try {
                added = BgGeo.addWatcher(bgWatcherOptions(), function (location, err) {
                    if (!entry.active) return;
                    if (err) {
                        if (typeof error === 'function') error(geoError(err));
                        return;
                    }
                    if (location && typeof success === 'function') success(toGeoPosition(location));
                });
            } catch (err) {
                entry.active = false;
                if (typeof error === 'function') error(geoError(err));
                return id;
            }

            // Sebagian versi plugin mengembalikan Promise<string>, sebagian lagi
            // langsung id watcher. Tangani keduanya agar tidak memunculkan
            // "addWatcher(...).then is not a function" dan pelacakan tetap jalan.
            if (added && typeof added.then === 'function') {
                added.then(function (nativeId) {
                    entry.nativeId = nativeId;
                    // clearWatch() bisa dipanggil sebelum addWatcher selesai.
                    if (!entry.active) removeNativeWatcher(nativeId);
                }).catch(function (err) {
                    entry.active = false;
                    if (typeof error === 'function') error(geoError(err));
                });
            } else {
                entry.nativeId = added || null;
            }

            return id;
        };

        navigator.geolocation.clearWatch = function (id) {
            var entry = webWatchers[id];
            if (!entry) return;
            entry.active = false;
            delete webWatchers[id];
            if (entry.nativeId) removeNativeWatcher(entry.nativeId);
        };

        // Perbarui `stale: false` saat aplikasi dibuka kembali agar GPS hidup lagi.
        log('pelacakan lokasi latar belakang aktif');
    } else {
        warn('plugin BackgroundGeolocation tidak tersedia — memakai geolocation WebView (hanya saat aplikasi terbuka).');
    }

    function removeNativeWatcher(nativeId) {
        try {
            BgGeo.removeWatcher({ id: nativeId }).catch(function () { /* watcher sudah berhenti */ });
        } catch (e) { /* ignore */ }
    }

    /* =====================================================================
       2. NOTIFIKASI SISTEM
       ===================================================================== */

    var notifReady = false;
    var notifSetupStarted = false;
    var pushSetupStarted = false;

    function loadNotified() {
        var set = Object.create(null);
        try {
            var raw = window.localStorage.getItem(NOTIFIED_STORAGE_KEY);
            if (raw) {
                var arr = JSON.parse(raw);
                if (Array.isArray(arr)) arr.forEach(function (key) { set[key] = true; });
            }
        } catch (e) { /* ignore */ }
        return set;
    }

    var notifiedKeys = loadNotified();

    function persistNotified() {
        try {
            var keys = Object.keys(notifiedKeys).slice(-200);
            window.localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(keys));
        } catch (e) { /* ignore */ }
    }

    function currentRole() {
        try {
            if (typeof isDriverLoggedIn === 'function' && isDriverLoggedIn()) return 'driver';
            if (typeof isAdminLoggedIn === 'function' && isAdminLoggedIn()) return 'admin';
            if (typeof isJanaizLoggedIn === 'function' && isJanaizLoggedIn()) return 'janaiz';
        } catch (e) { /* belum siap */ }
        return 'guest';
    }

    function roleIdentity(role) {
        try {
            if (role === 'driver' && typeof getDriverSession === 'function') {
                var d = getDriverSession();
                return d ? { id: d.id, name: d.name || d.id } : null;
            }
            if (role === 'admin' && typeof getAdminSession === 'function') {
                var a = getAdminSession();
                return a ? { id: a.username, name: a.name || a.username } : null;
            }
            if (role === 'janaiz' && typeof getJanaizSession === 'function') {
                var j = getJanaizSession();
                return j ? { id: j.id, name: j.name || j.id } : null;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /* Daftar tugas yang layak dinotifikasi untuk peran yang sedang login. */
    function notificationCandidates(role) {
        var list = [];

        try {
            if (role === 'driver' && typeof getPermintaanNotificationsForDriver === 'function') {
                var session = typeof getDriverSession === 'function' ? getDriverSession() : null;
                if (!session) return list;
                getPermintaanNotificationsForDriver(session.id).forEach(function (p) {
                    if (!p || !p.id) return;
                    list.push({
                        key: 'driver:' + p.id,
                        id: p.id,
                        title: 'Tugas baru ' + p.id,
                        body: (p.jenis || p.type || 'Permintaan ambulans') + ' · ' + (p.lokasi || 'Lokasi menyusul') +
                            (p.nama ? ' · ' + p.nama : '')
                    });
                });
                return list;
            }

            if (role === 'admin' && typeof getAllPermintaan === 'function') {
                getAllPermintaan().forEach(function (p) {
                    if (!p || !p.id || p.status !== 'Menunggu') return;
                    list.push({
                        key: 'admin:' + p.id,
                        id: p.id,
                        title: 'Permintaan baru ' + p.id,
                        body: (p.jenis || p.type || 'Permintaan') + ' · ' + (p.nama || 'Pemohon') +
                            (p.hp ? ' · ' + p.hp : '')
                    });
                });
                return list;
            }

            if (role === 'janaiz' && typeof getJanaizNotificationsFor === 'function') {
                var member = typeof getJanaizSession === 'function' ? getJanaizSession() : null;
                if (!member) return list;
                getJanaizNotificationsFor(member.id).forEach(function (p) {
                    if (!p || !p.id) return;
                    list.push({
                        key: 'janaiz:' + p.id,
                        id: p.id,
                        title: 'Tugas jenazah ' + p.id,
                        body: (p.jenis || p.type || 'Pengurusan jenazah') + ' · ' + (p.lokasi || '-')
                    });
                });
            }
        } catch (e) {
            warn('gagal menyusun notifikasi tugas', e);
        }

        return list;
    }

    function notificationId(key) {
        var hash = 0;
        for (var i = 0; i < key.length; i++) {
            hash = (hash * 31 + key.charCodeAt(i)) % 2147483647;
        }
        return hash;
    }

    function showNotification(title, body, extra) {
        if (!notifReady || !LocalNotif) return;
        LocalNotif.schedule({
            notifications: [{
                id: notificationId(String(extra && extra.key ? extra.key : title + body + Date.now())),
                title: title,
                body: body,
                channelId: NOTIF_CHANNEL,
                smallIcon: 'ic_stat_ambulance',
                iconColor: '#DC2626',
                group: 'si-tasks',
                autoCancel: true,
                extra: extra || {}
            }]
        }).catch(function (err) { warn('gagal menampilkan notifikasi', err); });
    }

    function scanTasks() {
        if (!notifReady) return;
        var role = currentRole();
        if (role === 'guest') return;

        var candidates = notificationCandidates(role);
        var seen = [];
        candidates.forEach(function (item) { seen[item.key] = true; });

        // Buang penanda untuk tugas yang sudah tidak aktif (mis. sudah dikonfirmasi),
        // agar bila tugas yang sama muncul lagi nanti tetap dinotifikasi.
        Object.keys(notifiedKeys).forEach(function (key) {
            if (!seen[key]) delete notifiedKeys[key];
        });

        candidates.forEach(function (item) {
            // Sudah pernah dinotifikasi (tersimpan di perangkat) — jangan ulangi.
            if (notifiedKeys[item.key]) return;
            notifiedKeys[item.key] = true;
            showNotification(item.title, item.body, {
                key: item.key,
                type: 'task',
                id: item.id,
                role: role
            });
        });

        persistNotified();
    }

    function handleNotificationTap(data) {
        var role = currentRole();
        var page = role === 'driver' ? 'driver.html'
            : (role === 'admin' ? 'admin.html'
            : (role === 'janaiz' ? 'janaiz.html' : 'index.html'));
        var current = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
        if (current === page) return;
        try { window.location.assign(page); } catch (e) { /* ignore */ }
    }

    async function enableNotifications() {
        if (!LocalNotif) {
            warn('plugin LocalNotifications tidak tersedia.');
            return;
        }
        try {
            var perm = await LocalNotif.checkPermissions();
            if (perm.display !== 'granted') perm = await LocalNotif.requestPermissions();
            if (perm.display !== 'granted') {
                warn('izin notifikasi ditolak pengguna.');
                showPermissionBanner();
                return;
            }
            await LocalNotif.createChannel({
                id: NOTIF_CHANNEL,
                name: 'Notifikasi Tugas',
                description: 'Permintaan ambulans, tugas driver, dan jadwal jenazah',
                importance: 5,
                visibility: 1,
                vibration: true,
                lights: true,
                lightColor: '#DC2626'
            }).catch(function () { /* channel sudah ada */ });

            LocalNotif.addListener('localNotificationActionPerformed', function (event) {
                handleNotificationTap(event && event.notification && event.notification.extra);
            });

            notifReady = true;
            scanTasks();
        } catch (e) {
            warn('notifikasi lokal tidak aktif', e);
        }
    }

    async function setupNotifications() {
        if (notifSetupStarted) return;
        notifSetupStarted = true;
        await enableNotifications();
    }

    /* Bar bantuan bila izin notifikasi ditolak: tanpa izin ini Android tidak
       menampilkan notifikasi apa pun, termasuk notifikasi tugas. */
    function showPermissionBanner() {
        if (document.getElementById('siNotifBanner') || !document.body) return;
        var bar = document.createElement('div');
        bar.id = 'siNotifBanner';
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#7f1d1d;' +
            'color:#fff;font:12px/1.5 system-ui,-apple-system,sans-serif;padding:10px 14px;' +
            'display:flex;gap:10px;align-items:center;';
        var text = document.createElement('span');
        text.style.flex = '1';
        text.textContent = 'Notifikasi tugas nonaktif. Izinkan lewat Pengaturan > Aplikasi > SI Ambulans > Notifikasi.';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Aktifkan';
        btn.style.cssText = 'background:#fff;color:#7f1d1d;border:0;border-radius:8px;' +
            'padding:6px 12px;font-weight:600;';
        btn.addEventListener('click', function () {
            notifSetupStarted = false;
            enableNotifications().then(function () {
                if (notifReady) bar.remove();
            });
        });
        bar.appendChild(text);
        bar.appendChild(btn);
        document.body.appendChild(bar);
    }

    /* =====================================================================
       3. PUSH NOTIFICATION (FCM) — opsional
       ===================================================================== */

    /* Token disimpan di dokumen si_state/push_tokens (path yang sama dengan data
       aplikasi lain), jadi Firestore Rules yang sudah ada ikut berlaku. Setiap
       perangkat menulis field tokennnya sendiri dengan merge, sehingga perangkat
       lain tidak tertimpa. Cloud Function membaca dokumen ini untuk mengirim FCM. */
    async function savePushToken(token) {
        if (!token || token.length > 1000) return;
        var role = currentRole();
        if (role === 'guest') return;
        var who = roleIdentity(role);
        try {
            if (!window.db || !window.firebaseApi) return;
            var ref = window.firebaseApi.doc(window.db, 'si_state', 'push_tokens');
            var tokens = {};
            tokens[token] = {
                role: role,
                name: who && who.name ? who.name : '',
                memberId: who && who.id ? who.id : '',
                platform: 'android',
                appVersion: APP_VERSION,
                updatedAt: new Date().toISOString()
            };
            var saved = window.firebaseApi.setDoc(ref, { tokens: tokens }, { merge: true });
            if (saved && typeof saved.catch === 'function') {
                saved.catch(function (err) {
                    warn('gagal menyimpan token push ke Firestore', err);
                });
            }
        } catch (e) {
            warn('gagal menyimpan token push', e);
        }
    }

    async function setupPush() {
        if (pushSetupStarted || !Push) return;
        pushSetupStarted = true;
        try {
            var perm = await Push.checkPermissions();
            if (perm.receive !== 'granted') perm = await Push.requestPermissions();
            if (perm.receive !== 'granted') return;

            Push.addListener('registration', function (token) {
                savePushToken(token && token.value);
            });
            Push.addListener('registrationError', function (err) {
                warn('registrasi FCM gagal (pasang google-services.json untuk mengaktifkan push)', err);
            });
            Push.addListener('pushNotificationReceived', function (notification) {
                if (!notification) return;
                showNotification(
                    notification.title || 'SI-Ambulans',
                    notification.body || 'Ada pembaruan tugas.',
                    Object.assign({ key: 'push:' + (notification.id || Date.now()), type: 'task' }, notification.data || {})
                );
            });
            Push.addListener('pushNotificationActionPerformed', function (action) {
                handleNotificationTap(action && action.notification && action.notification.data);
            });

            await Push.register();
        } catch (e) {
            warn('push notification tidak aktif', e);
        }
    }

    /* =====================================================================
       4. TOMBOL BACK ANDROID
       ===================================================================== */

    /* Tombol back tidak boleh menutup aplikasi tiba-tiba: di halaman lain kembali
       ke halaman sebelumnya / beranda, dan di beranda perlu dua kali tekan dalam
       2 detik — sama seperti aplikasi Android lain. Tanpa ini, satu tekanan back
       (atau gesture back) langsung mengakhiri aplikasi. */
    var BACK_EXIT_WINDOW_MS = 2000;
    var lastBackPressAt = 0;

    function currentPageName() {
        var name = window.location.pathname.split('/').pop();
        return (name || 'index.html').toLowerCase();
    }

    function showBackHint() {
        var el = document.getElementById('siBackHint');
        if (!el) {
            el = document.createElement('div');
            el.id = 'siBackHint';
            el.style.cssText = 'position:fixed;left:50%;bottom:4.5rem;transform:translateX(-50%);' +
                'z-index:9999;background:#1e293b;border:1px solid #334155;color:#f1f5f9;' +
                'font:12px/1.4 system-ui,-apple-system,sans-serif;padding:8px 14px;' +
                'border-radius:999px;box-shadow:0 10px 25px -10px rgba(0,0,0,.8);' +
                'max-width:90vw;text-align:center;';
            document.body.appendChild(el);
        }
        el.textContent = 'Tekan tombol back sekali lagi untuk keluar';
        el.style.display = 'block';
        clearTimeout(showBackHint._timer);
        showBackHint._timer = setTimeout(function () { el.style.display = 'none'; }, BACK_EXIT_WINDOW_MS);
    }

    function handleBackPress() {
        var page = currentPageName();
        log('tombol back ditekan di ' + page);

        // Kembali ke halaman sebelumnya bila ada riwayat navigasi dalam aplikasi.
        if (page !== 'index.html' && window.history.length > 1) {
            window.history.back();
            return;
        }
        // Halaman panel: kembali ke beranda, bukan menutup aplikasi.
        if (page !== 'index.html') {
            window.location.assign('index.html');
            return;
        }
        // Beranda: tekan dua kali dalam 2 detik untuk keluar.
        var now = Date.now();
        if (now - lastBackPressAt < BACK_EXIT_WINDOW_MS) {
            if (NativeApp) NativeApp.exitApp();
            return;
        }
        lastBackPressAt = now;
        showBackHint();
    }

    /* Dipanggil dari MainActivity.java. Android 16 (targetSdk 36) selalu memakai
       predictive back, sehingga event "backButton" plugin App tidak selalu sampai
       ke JavaScript dan satu tekanan back langsung menutup aplikasi. */
    window.__siHandleBack = handleBackPress;

    if (NativeApp) {
        NativeApp.addListener('backButton', handleBackPress);

        NativeApp.addListener('appStateChange', function (state) {
            if (!state || !state.isActive) return;
            scanTasks();
            // Setelah login (peran bukan tamu), minta izin notifikasi & daftarkan push.
            if (currentRole() !== 'guest') {
                setupNotifications();
                setupPush();
            }
        });
    }

    /* =====================================================================
       5. PEMASANGAN
       ===================================================================== */

    document.addEventListener('firestore:update', function (event) {
        var key = event && event.detail && event.detail.key;
        if (key === 'si_permintaan') scanTasks();
    });

    /* bootstrap.js mengirim event "app:ready" lewat document, bukan window. */
    function onAppReady() {
        scanTasks();
        // Pemohon/tamu tidak perlu diminta izin notifikasi; izin baru diminta
        // setelah pengguna masuk sebagai driver, admin, atau Tim Janaiz.
        if (currentRole() !== 'guest') {
            setupNotifications();
            setupPush();
        }
    }

    document.addEventListener('app:ready', onAppReady);
    window.addEventListener('app:ready', onAppReady);

    // Cadangan: bila event app:ready terlewat, aktifkan notifikasi setelah
    // halaman selesai dimuat (mis. aplikasi dibuka langsung di panel driver).
    window.addEventListener('load', function () {
        setTimeout(function () {
            if (currentRole() !== 'guest') {
                setupNotifications();
                setupPush();
            }
            scanTasks();
        }, 1500);
    });

    // Cek berkala agar tugas yang masuk saat listener terlewat tetap tampil.
    setInterval(function () {
        if (notifReady) scanTasks();
    }, 20000);

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(function () { scanTasks(); }, 0);
    }

    log('native bridge siap');
})();
