/* janaiz.js — logika halaman panel Tim Janaiz (janaiz.html)
   - Menampilkan info sesi tim (login ID + PIN, lihat store.js)
   - Notifikasi tugas pengurusan jenazah yang sedang Diproses
   - Konfirmasi tugas & konfirmasi selesai (tersimpan di Firestore)
   Tugas ambulans tetap ditangani panel driver. */

let janaizSession = null;
let lastJanaizNotifIds = null;
let lastJanaizRenderSignature = null;

appOnReady(() => {
    // Guard cadangan (bila JS di <head> tidak jalan karena alasan tertentu)
    if (typeof isJanaizLoggedIn !== 'function' || !isJanaizLoggedIn() ||
        (typeof isAdminLoggedIn === 'function' && isAdminLoggedIn()) ||
        (typeof isDriverLoggedIn === 'function' && isDriverLoggedIn())) {
        window.location.replace('login.html?role=janaiz');
        return;
    }

    janaizSession = getJanaizSession();
    if (!janaizSession) {
        window.location.replace('login.html?role=janaiz');
        return;
    }

    // Akun yang dinonaktifkan atau dihapus admin tidak boleh tetap masuk.
    const currentMember = (typeof janaizMembersSource === 'function')
        ? janaizMembersSource().find(m => m && String(m.id) === String(janaizSession.id))
        : null;
    if (!currentMember || currentMember.active === false) {
        janaizLogout();
        window.location.replace('login.html?role=janaiz');
        return;
    }
    janaizSession = Object.assign({}, janaizSession, {
        name: currentMember.name || janaizSession.name
    });

    renderProfile();
    setupLogout();
    setupTaskActions();
    renderTasks();

    // Perbarui notifikasi & daftar tugas tiap 5 detik agar tugas baru langsung muncul.
    // appPoll melewati tick saat aplikasi di latar belakang.
    appPoll(renderTasks, 5000);
    document.addEventListener('firestore:update', event => {
        const key = event.detail && event.detail.key;
        if (key === STORE_KEYS.PERMINTAAN) {
            renderTasks();
            if (event.detail.failed) {
                toast('Konfirmasi tugas gagal disimpan ke Firestore. Periksa koneksi dan Firestore Rules.');
            }
        }
    });
});

/* ---------- Info tim ---------- */
function renderProfile() {
    const name = (janaizSession && janaizSession.name) || 'Tim Janaiz';
    setText('jnzName', name);
    setText('jnzInitial', String(name).charAt(0).toUpperCase());
    setText('jnzMeta', [
        janaizSession ? janaizSession.id : '',
        'Pengurusan Jenazah'
    ].filter(Boolean).join(' · '));
}

function setupLogout() {
    const btn = document.getElementById('janaizLogoutBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        janaizLogout();
        window.location.replace('login.html?role=janaiz');
    });
}

/* ---------- Daftar tugas jenazah ---------- */
function renderTasks() {
    if (!janaizSession) return;

    const notifBox = document.getElementById('janaizNotifList');
    const notifEmpty = document.getElementById('janaizNotifEmpty');
    const notifCount = document.getElementById('janaizNotifCount');
    const container = document.getElementById('janaizTaskList');
    const empty = document.getElementById('janaizTaskEmpty');
    if (!notifBox || !container || !empty) return;

    const incoming = (typeof getJanaizNotificationsFor === 'function')
        ? getJanaizNotificationsFor(janaizSession.id) : [];
    const mine = (typeof getJanaizTasksFor === 'function')
        ? getJanaizTasksFor(janaizSession.id) : [];
    mine.sort((a, b) => String((b && b.createdAt) || '').localeCompare(String((a && a.createdAt) || '')));

    /* Hanya render ulang bila isi tugas berubah (render tiap 5 detik membuat
       browser menghitung layout lagi tanpa ada yang baru). */
    const signature = dataSignature([incoming, mine]);
    if (signature === lastJanaizRenderSignature) return;
    lastJanaizRenderSignature = signature;

    // 1. Notifikasi: Diproses & belum dikonfirmasi tim ini
    notifBox.innerHTML = incoming.map(renderIncomingTask).join('');
    if (notifEmpty) notifEmpty.classList.toggle('hidden', incoming.length > 0);
    if (notifCount) {
        notifCount.classList.toggle('hidden', incoming.length === 0);
        notifCount.textContent = incoming.length;
    }

    // Toast tugas baru
    const ids = incoming.map(p => p.id);
    if (lastJanaizNotifIds !== null) {
        const fresh = ids.filter(id => lastJanaizNotifIds.indexOf(id) === -1);
        if (fresh.length) toast('Tugas jenazah baru: ' + fresh.join(', ') + '. Silakan konfirmasi bila tim siap.');
    }
    lastJanaizNotifIds = ids;

    // 2. Tugas saya: sudah dikonfirmasi (menunggu selesai / sudah selesai)
    container.innerHTML = mine.map(renderTaskRow).join('');
    empty.classList.toggle('hidden', mine.length > 0);
}

/* Detail jenazah yang relevan untuk tim (termasuk tautan Google Maps). */
function janaizDetailLines(p) {
    const detail = (p && p.detail && typeof p.detail === 'object') ? p.detail : {};
    const keys = ['hubungan', 'namaJenazah', 'kelamin', 'umur', 'meninggal',
        'jadwalPengurusan', 'rumahDuka', 'dishalatkan', 'tpu', 'maps'];
    const lines = keys
        .filter(k => detail[k] !== undefined && detail[k] !== null && String(detail[k]).trim() !== '')
        .map(k => detailLineHtml(k, detail[k]))
        .join('');
    return lines ? '<div class="mt-1 text-[11px] text-slate-400 space-y-0.5">' + lines + '</div>' : '';
}

function janaizConfirmCount(p) {
    const confirms = (typeof janaizConfirmMapOf === 'function') ? janaizConfirmMapOf(p) : {};
    return Object.keys(confirms).filter(id => confirms[id]).length;
}

/* Kartu notifikasi: tugas yang belum dikonfirmasi tim ini. */
function renderIncomingTask(p) {
    const combined = (typeof isCombinedJanaizPermintaan === 'function') &&
        isCombinedJanaizPermintaan(p);
    return '<div class="row-card border-amber-500/40 bg-amber-500/5">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="mono font-bold text-sm text-slate-100">' + escapeHtml(p.id) + '</span>' +
            '<span class="badge badge-purple">' + escapeHtml(p.jenis || p.type || 'Permintaan') + '</span>' +
            '<span class="badge badge-amber"><i class="fa-solid fa-bell mr-1"></i>Tugas Baru</span>' +
            (combined ? '<span class="badge badge-slate">+ Ambulans</span>' : '') +
        '</div>' +
        '<p class="text-[11px] text-slate-400 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>' +
            escapeHtml(p.lokasi || '-') + '</p>' +
        janaizDetailLines(p) +
        '<p class="text-[11px] text-slate-500 mt-1">Pemohon: ' + escapeHtml(p.nama || '-') +
            ' · <span class="mono">' + escapeHtml(p.hp || '-') + '</span></p>' +
        '<p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-users mr-1"></i>' +
            janaizConfirmCount(p) + ' anggota tim sudah konfirmasi</p>' +
        '<div class="flex gap-2 mt-2">' +
            '<button type="button" class="btn btn-primary btn-sm flex-1" data-action="confirm-janaiz" data-id="' +
                escapeHtml(p.id) + '"><i class="fa-solid fa-handshake mr-1"></i> Konfirmasi Tugas</button>' +
        '</div>' +
    '</div>';
}

/* Kartu tugas saya: sudah dikonfirmasi — menunggu selesai / sudah selesai. */
function renderTaskRow(p) {
    const done = (typeof isJanaizDoneBy === 'function') && isJanaizDoneBy(p, janaizSession.id);
    const canFinish = p.status === 'Diproses' && !done;
    const combined = (typeof isCombinedJanaizPermintaan === 'function') &&
        isCombinedJanaizPermintaan(p);
    const confirms = (typeof janaizConfirmMapOf === 'function') ? janaizConfirmMapOf(p) : {};
    const doneMap = (typeof janaizDoneMapOf === 'function') ? janaizDoneMapOf(p) : {};

    const badgeClass = p.status === 'Selesai' ? 'badge-green'
        : (p.status === 'Diproses' ? 'badge-amber'
        : (p.status === 'Batal' ? 'badge-slate' : 'badge-red'));

    return '<div class="row-card">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="mono font-bold text-sm text-slate-100">' + escapeHtml(p.id) + '</span>' +
            '<span class="badge badge-purple">' + escapeHtml(p.jenis || p.type || 'Permintaan') + '</span>' +
            '<span class="badge ' + badgeClass + '">' + escapeHtml(p.status) + '</span>' +
            (done ? '<span class="badge badge-green"><i class="fa-solid fa-circle-check mr-1"></i>' +
                (combined && p.status !== 'Selesai' ? 'Pengurusan jenazah selesai' : 'Selesai') + '</span>' : '') +
        '</div>' +
        '<p class="text-[11px] text-slate-400 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>' +
            escapeHtml(p.lokasi || '-') + '</p>' +
        janaizDetailLines(p) +
        '<p class="text-[11px] text-slate-500 mt-1">Pemohon: ' + escapeHtml(p.nama || '-') +
            ' · <span class="mono">' + escapeHtml(p.hp || '-') + '</span></p>' +
        '<p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-users mr-1"></i>' +
            janaizConfirmCount(p) + ' anggota tim konfirmasi</p>' +
        '<p class="text-[10px] text-emerald-500 mt-0.5"><i class="fa-solid fa-circle-check mr-1"></i>' +
            'Anda mengonfirmasi tugas ini (' + formatDateTime(confirms[janaizSession.id]) + ')</p>' +
        (canFinish
            ? '<div class="flex gap-2 mt-2">' +
                    '<button type="button" class="btn btn-primary btn-sm flex-1" data-action="finish-janaiz" data-id="' +
                        escapeHtml(p.id) + '"><i class="fa-solid fa-flag-checkered mr-1"></i> ' +
                        (combined ? 'Selesai Pengurusan Jenazah' : 'Konfirmasi Selesai') + '</button>' +
                '</div>'
                : (done
                    ? '<p class="mt-2 text-[11px] text-emerald-400"><i class="fa-solid fa-trophy mr-1"></i> ' +
                        (combined && p.status === 'Diproses'
                            ? 'Pengurusan jenazah sudah selesai. Bagian ambulans masih ditangani driver; ' +
                                'status permintaan tetap Diproses sampai ambulans selesai (' +
                                formatDateTime(doneMap[janaizSession.id]) + ').'
                            : 'Terima kasih! Tugas ini sudah ditandai selesai (' +
                                formatDateTime(doneMap[janaizSession.id]) + ').') + '</p>'
                : '<p class="mt-2 text-[11px] text-slate-500"><i class="fa-solid fa-hourglass-half mr-1"></i> ' +
                    'Tugas berakhir dengan status ' + escapeHtml(p.status) + '.</p>')) +
    '</div>';
}

function setupTaskActions() {
    const handler = ev => {
        const btn = ev.target.closest('[data-action="confirm-janaiz"], [data-action="finish-janaiz"]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');

        const updated = (action === 'finish-janaiz')
            ? finishJanaizTask(id, janaizSession.id)
            : confirmJanaizTask(id, janaizSession.id);

        if (updated) {
            const finishedWhole = updated.status === 'Selesai';
            toast(action === 'finish-janaiz'
                ? (finishedWhole
                    ? 'Tugas ' + id + ' selesai. Terima kasih!'
                    : 'Pengurusan jenazah ' + id + ' selesai. Ambulans masih ditangani driver.')
                : 'Tugas ' + id + ' terkonfirmasi. Tim siap berangkat.');
            renderTasks();
        } else {
            toast(action === 'finish-janaiz'
                ? 'Tugas belum dapat ditandai selesai. Perbarui halaman dan coba lagi.'
                : 'Konfirmasi gagal. Pastikan tugas masih Diproses lalu coba lagi.');
        }
    };

    const notifBox = document.getElementById('janaizNotifList');
    if (notifBox) notifBox.addEventListener('click', handler);
    const container = document.getElementById('janaizTaskList');
    if (container) container.addEventListener('click', handler);
}

/* ---------- Penolong ---------- */
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
