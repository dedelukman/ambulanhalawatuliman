/* account.js — kartu "Akun Saya" untuk admin, driver, dan Tim Janaiz.
   Setiap peran hanya dapat mengubah akunnya sendiri, dengan verifikasi
   password/PIN lama. Perubahan disimpan ke Firestore lewat store.js. */

appOnReady(() => {
    const ctx = accountContext();
    if (!ctx) return;
    mountAccountCard(ctx);
});

function accountContext() {
    if (typeof isAdminLoggedIn === 'function' && isAdminLoggedIn()) {
        const session = getAdminSession();
        const account = (typeof adminAccountsSource === 'function' ? adminAccountsSource()[0] : null) || {};
        return {
            title: 'Akun Admin',
            credential: 'Kata sandi',
            username: account.username || (session && session.username) || 'admin',
            save: (current, username, password) => changeAdminCredentials(current, username, password)
        };
    }

    if (typeof isDriverLoggedIn === 'function' && isDriverLoggedIn()) {
        const session = getDriverSession();
        if (!session) return null;
        const drv = (typeof driverListSource === 'function' ? driverListSource() : [])
            .find(d => d && String(d.id) === String(session.id)) || {};
        return {
            title: 'Akun Driver',
            credential: 'PIN',
            username: drv.username || drv.id || session.id,
            save: (current, username, pin) => changeDriverCredentials(session.id, current, username, pin)
        };
    }

    if (typeof isJanaizLoggedIn === 'function' && isJanaizLoggedIn()) {
        const session = getJanaizSession();
        if (!session) return null;
        const member = (typeof janaizMembersSource === 'function' ? janaizMembersSource() : [])
            .find(m => m && String(m.id) === String(session.id)) || {};
        return {
            title: 'Akun Tim Janaiz',
            credential: 'PIN',
            username: member.username || member.id || session.id,
            save: (current, username, pin) => changeJanaizCredentials(session.id, current, username, pin)
        };
    }

    return null;
}

function mountAccountCard(ctx) {
    const html = '<section class="card mt-4" id="accountCard">' +
        '<div class="flex items-center justify-between gap-2">' +
            '<h2 class="text-sm font-bold text-slate-100"><i class="fa-solid fa-user-pen text-purple-400 mr-1.5"></i>' +
                ctx.title + '</h2>' +
            '<button type="button" id="accountToggle" class="btn btn-ghost btn-sm">' +
                '<i class="fa-solid fa-pen"></i> Ubah</button>' +
        '</div>' +
        '<p class="text-[11px] text-slate-400 mt-0.5">Username: ' +
            '<span class="mono text-slate-300" id="accountUsernameLabel"></span></p>' +
        '<form id="accountForm" class="hidden mt-3 space-y-3" novalidate>' +
            '<div>' +
                '<label class="label" for="accountUsername">Username baru</label>' +
                '<input id="accountUsername" class="input" type="text" autocomplete="username" placeholder="Username login">' +
            '</div>' +
            '<div>' +
                '<label class="label" for="accountCurrent">' + ctx.credential +
                    ' saat ini <span class="text-red-400">*</span></label>' +
                '<input id="accountCurrent" class="input" type="password" autocomplete="current-password" placeholder="' +
                    ctx.credential + ' sekarang">' +
            '</div>' +
            '<div>' +
                '<label class="label" for="accountNew">' + ctx.credential +
                    ' baru (kosongkan bila tidak diubah)</label>' +
                '<input id="accountNew" class="input" type="password" autocomplete="new-password" placeholder="Minimal 4 karakter">' +
            '</div>' +
            '<div>' +
                '<label class="label" for="accountConfirm">Ulangi ' +
                    ctx.credential.toLowerCase() + ' baru</label>' +
                '<input id="accountConfirm" class="input" type="password" autocomplete="new-password">' +
            '</div>' +
            '<p id="accountError" class="hidden text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"></p>' +
            '<div class="grid grid-cols-2 gap-2">' +
                '<button type="button" id="accountCancel" class="btn btn-ghost">Batal</button>' +
                '<button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Simpan</button>' +
            '</div>' +
        '</form>' +
        '<p id="accountSuccess" class="hidden mt-2 text-[11px] text-emerald-400"></p>' +
    '</section>';

    const footer = document.querySelector('footer');
    if (footer) footer.insertAdjacentHTML('beforebegin', html);
    else document.body.insertAdjacentHTML('beforeend', html);

    const form = document.getElementById('accountForm');
    if (!form) return;

    const toggle = document.getElementById('accountToggle');
    const usernameInput = document.getElementById('accountUsername');
    const currentInput = document.getElementById('accountCurrent');
    const newInput = document.getElementById('accountNew');
    const confirmInput = document.getElementById('accountConfirm');
    const errorBox = document.getElementById('accountError');
    const successBox = document.getElementById('accountSuccess');
    const usernameLabel = document.getElementById('accountUsernameLabel');

    const hideMessages = () => {
        if (errorBox) errorBox.classList.add('hidden');
        if (successBox) successBox.classList.add('hidden');
    };
    const showError = message => {
        if (successBox) successBox.classList.add('hidden');
        if (!errorBox) return;
        errorBox.textContent = message;
        errorBox.classList.remove('hidden');
    };
    const setOpen = open => {
        form.classList.toggle('hidden', !open);
        if (toggle) {
            toggle.innerHTML = open
                ? '<i class="fa-solid fa-xmark"></i> Tutup'
                : '<i class="fa-solid fa-pen"></i> Ubah';
        }
        if (!open) hideMessages();
        if (open && usernameInput) {
            usernameInput.focus();
            usernameInput.select();
        }
    };

    if (usernameLabel) usernameLabel.textContent = ctx.username;
    if (usernameInput) usernameInput.value = ctx.username;
    if (toggle) toggle.addEventListener('click', () => setOpen(form.classList.contains('hidden')));
    const cancel = document.getElementById('accountCancel');
    if (cancel) cancel.addEventListener('click', () => setOpen(false));

    form.addEventListener('submit', event => {
        event.preventDefault();
        hideMessages();

        const current = currentInput ? currentInput.value : '';
        const nextName = usernameInput ? usernameInput.value : '';
        const nextPass = newInput ? newInput.value : '';
        const confirmPass = confirmInput ? confirmInput.value : '';

        if (!String(current).trim()) {
            showError(ctx.credential + ' saat ini wajib diisi.');
            return;
        }
        if (nextPass && nextPass !== confirmPass) {
            showError('Konfirmasi ' + ctx.credential.toLowerCase() + ' baru tidak cocok.');
            return;
        }

        let result;
        try {
            result = ctx.save(current, nextName, nextPass);
        } catch (error) {
            showError('Gagal memperbarui akun: ' +
                (error && error.message ? error.message : String(error)));
            return;
        }
        if (!result || !result.ok) {
            showError((result && result.error) || 'Gagal memperbarui akun.');
            return;
        }

        const updatedName = (result.account && result.account.username) || nextName || ctx.username;
        ctx.username = updatedName;
        if (usernameLabel) usernameLabel.textContent = updatedName;
        if (usernameInput) usernameInput.value = updatedName;
        if (currentInput) currentInput.value = '';
        if (newInput) newInput.value = '';
        if (confirmInput) confirmInput.value = '';
        if (successBox) {
            successBox.textContent = 'Username dan ' + ctx.credential +
                ' berhasil diperbarui. Gunakan kredensial baru saat login berikutnya.';
            successBox.classList.remove('hidden');
        }
    });
}
