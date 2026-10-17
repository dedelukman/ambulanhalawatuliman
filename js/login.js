/* login.js — logika halaman login (peran: Admin atau Driver).
   Demo client-side, lihat store.js untuk kredensial & sesi. */

let loginRole = 'admin'; // 'admin' | 'driver'

const ROLE_META = {
    admin: {
        title: 'Login Admin',
        subtitle: 'Panel kelola armada, driver & permintaan',
        icon: 'fa-solid fa-user-shield text-xl',
        iconClass: 'bg-slate-800 border border-slate-700 p-3 rounded-2xl text-purple-400',
        userLabel: 'Nama pengguna',
        userPlaceholder: 'admin',
        userEmpty: 'Nama pengguna wajib diisi.',
        passLabel: 'Kata sandi',
        passPlaceholder: '••••••••',
        passEmpty: 'Kata sandi wajib diisi.',
        badCredentials: 'Nama pengguna atau kata sandi salah.',
        autoComplete: 'username',
        hint: '<span class="text-slate-300 font-semibold">Akun demo:</span> ' +
            'username <span class="mono text-amber-400">admin</span> · ' +
            'sandi <span class="mono text-amber-400">admin123</span><br>' +
            'Login bersifat demo client-side (tersimpan di browser) — bukan keamanan untuk produksi.',
        fallback: 'admin.html'
    },
    driver: {
        title: 'Login Driver',
        subtitle: 'Aktifkan lokasi GPS Anda saat bertugas',
        icon: 'fa-solid fa-id-card-clip text-xl',
        iconClass: 'bg-slate-800 border border-slate-700 p-3 rounded-2xl text-emerald-400',
        userLabel: 'ID Driver',
        userPlaceholder: 'drv-01 (atau nama driver)',
        userEmpty: 'ID driver wajib diisi.',
        passLabel: 'PIN',
        passPlaceholder: '1234',
        passEmpty: 'PIN wajib diisi.',
        badCredentials: 'ID driver atau PIN salah.',
        autoComplete: 'username',
        hint: '<span class="text-slate-300 font-semibold">Akun driver demo:</span> ' +
            'ID <span class="mono text-amber-400\">drv-01</span> · ' +
            'PIN <span class="mono text-amber-400">1234</span> (PIN default semua driver, bisa diubah di panel admin).<br>' +
            'Login driver mengaktifkan update lokasi GPS yang tampil di dashboard.',
        fallback: 'driver.html'
    }
};

document.addEventListener('DOMContentLoaded', () => {
    setupRoleTabs();

    // Peran eksklusif: bila kedua sesi sempat terpasang (data lama), reset keduanya.
    if (isAdminLoggedIn() && isDriverLoggedIn()) {
        adminLogout();
        driverLogout();
    }

    // Sudah login? selalu arahkan ke panel peran masing-masing —
    // admin tidak melihat form/panel driver, driver tidak melihat form/panel admin.
    if (isAdminLoggedIn()) {
        window.location.replace('admin.html');
        return;
    }
    if (isDriverLoggedIn()) {
        window.location.replace('driver.html');
        return;
    }

    setRole(requestedRole());

    const form = document.getElementById('loginForm');
    if (form) form.addEventListener('submit', onLogin);

    const toggle = document.getElementById('togglePass');
    const pass = document.getElementById('loginPass');
    if (toggle && pass) {
        toggle.addEventListener('click', () => {
            const showing = pass.type === 'text';
            pass.type = showing ? 'password' : 'text';
            const icon = toggle.querySelector('i');
            if (icon) icon.className = showing ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
            toggle.title = showing ? 'Tampilkan kata sandi' : 'Sembunyikan kata sandi';
        });
    }
});

/* Peran bisa dipilih dari tab atau dari URL: login.html?role=driver */
function requestedRole() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('role') === 'driver') return 'driver';
    } catch (err) { /* URLSearchParams tidak tersedia */ }
    return 'admin';
}

function setupRoleTabs() {
    document.querySelectorAll('#roleTabs .tab').forEach(tab => {
        tab.addEventListener('click', () => setRole(tab.getAttribute('data-role')));
    });
}

function setRole(role) {
    if (!ROLE_META[role]) role = 'admin';
    loginRole = role;
    const meta = ROLE_META[role];

    document.querySelectorAll('#roleTabs .tab').forEach(btn => {
        const active = btn.getAttribute('data-role') === role;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', String(active));
    });

    setText('loginTitle', meta.title);
    setText('loginSubtitle', meta.subtitle);
    setText('loginUserLabel', meta.userLabel);
    setText('loginUserError', meta.userEmpty);
    setText('loginPassLabel', meta.passLabel);
    setText('loginErrorText', meta.badCredentials);

    const icon = document.getElementById('loginIcon');
    if (icon) {
        icon.className = meta.iconClass;
        icon.innerHTML = '<i class="' + meta.icon + '"></i>';
    }

    const user = document.getElementById('loginUser');
    if (user) { user.placeholder = meta.userPlaceholder; user.setAttribute('autocomplete', meta.autoComplete); }
    const pass = document.getElementById('loginPass');
    if (pass) pass.placeholder = meta.passPlaceholder;

    const hint = document.getElementById('demoHint');
    if (hint) hint.innerHTML = meta.hint;

    const err = document.getElementById('loginError');
    if (err) err.classList.add('hidden');
    showFieldError('loginUser', false);
    showFieldError('loginPass', false);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function onLogin(e) {
    e.preventDefault();

    const user = document.getElementById('loginUser');
    const pass = document.getElementById('loginPass');
    const errorBox = document.getElementById('loginError');
    const meta = ROLE_META[loginRole];

    if (errorBox) errorBox.classList.add('hidden');

    const userEmpty = !user || user.value.trim().length === 0;
    const passEmpty = !pass || pass.value.length === 0;
    showFieldError('loginUser', userEmpty);
    showFieldError('loginPass', passEmpty);
    if (userEmpty || passEmpty) return;

    const session = (loginRole === 'driver')
        ? driverLogin(user.value, pass.value)
        : adminLogin(user.value, pass.value);

    if (!session) {
        if (errorBox) errorBox.classList.remove('hidden');
        if (pass) {
            pass.value = '';
            pass.focus();
        }
        return;
    }

    window.location.replace(nextDestination(meta.fallback, loginRole));
}

/* Halaman yang meminta login (mis. dashboard.html) menyimpan tujuan di si_next.
   Tujuan hanya diizinkan bila sesuai peran login (admin -> kecuali driver.html,
   driver -> hanya driver.html). */
function nextDestination(fallback, role) {
    let target = fallback;
    try {
        const saved = window.localStorage.getItem('si_next');
        const allowed = saved && /^[a-z0-9_-]+\.html$/i.test(saved) &&
            (role === 'driver'
                ? ['driver.html', 'dashboard.html'].indexOf(saved.toLowerCase()) !== -1
                : saved.toLowerCase() !== 'driver.html');
        if (allowed) target = saved;
        window.localStorage.removeItem('si_next');
    } catch (err) { /* localStorage tidak tersedia */ }
    return target;
}

function showFieldError(id, invalid) {
    const field = document.getElementById(id);
    const err = document.querySelector('[data-error-for="' + id + '"]');
    if (field) field.classList.toggle('is-invalid', invalid);
    if (err) err.classList.toggle('is-visible', invalid);
}
