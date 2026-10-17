        let map;
        let markers = {};
        let activeFilter = 'all';
        let simulationInterval = null;
        let isSimulating = false;

        // Broadcast State variables
        let activeBroadcast = null;
        let broadcastStartTime = null;
        let broadcastTimerInterval = null;


document.addEventListener('DOMContentLoaded', () => {
            initMap();
            renderAmbulanceList();
            renderDriverList();
            renderLogs();
            renderActiveTasks();
            setInterval(renderActiveTasks, 5000);
            setupMobileSidebar();
            updateDriverSimCards();
            updateStatsCounters();

            // Pantau lokasi terbaru dari halaman driver (localStorage)
            refreshDriverLocations();
            setInterval(refreshDriverLocations, 5000);

            // Pantau perubahan data armada (status En Route/Standy disinkronkan
            // dari tugas permintaan) supaya daftar & statistik selalu cocok.
            refreshAmbulanceData();
            setInterval(refreshAmbulanceData, 5000);

            // Update seketika bila halaman ini juga menjalankan geotracker
            // (sesi driver aktif di dashboard) — tanpa menunggu interval 5 detik.
            window.addEventListener('si-geo-update', () => refreshDriverLocations());

            // Sembunyikan pintu masuk panel lain sesuai peran login
            if (typeof applyRoleNav === 'function') applyRoleNav();
        });

        /* Halaman driver (driver.html) menulis lat/lng terbaru ke localStorage;
           fungsi ini membaca ulang data driver tiap 5 detik dan me-render ulang
           marker + daftar bila ada perubahan. */
        let lastDriverSnapshot = null;

        function refreshDriverLocations() {
            if (typeof STORE_KEYS === 'undefined' || typeof storeRead !== 'function') return;
            const stored = storeRead(STORE_KEYS.DRIVERS, null);
            if (!Array.isArray(stored) || !stored.length) return;

            const snapshot = JSON.stringify(stored);
            if (snapshot === lastDriverSnapshot) return;
            lastDriverSnapshot = snapshot;

            drivers = stored;

            // Buang marker milik driver/unit yang sudah dihapus dari data
            if (map) {
                Object.keys(markers).forEach(id => {
                    if (id === 'incident') return;
                    const known = drivers.some(d => d && d.id === id) ||
                        ambulances.some(a => a && a.id === id);
                    if (!known) {
                        map.removeLayer(markers[id]);
                        delete markers[id];
                    }
                });
                updateAllMarkers();
            }
            renderDriverList();
            updateStatsCounters();
            if (typeof updateDriverSimCards === 'function') updateDriverSimCards();
        }

        /* Data armada (status En Route/Standy + nama driver bertugas) disinkronkan
           oleh store.js setiap kali data permintaan berubah. Fungsi ini membaca ulang
           localStorage tiap 5 detik dan me-render ulang bila ada perubahan. */
        let lastAmbulanceSnapshot = null;

        function refreshAmbulanceData() {
            if (typeof STORE_KEYS === 'undefined' || typeof storeRead !== 'function') return;
            const stored = storeRead(STORE_KEYS.AMBULANCES, null);
            if (!Array.isArray(stored) || !stored.length) return;

            const snapshot = JSON.stringify(stored);
            if (snapshot === lastAmbulanceSnapshot) return;
            lastAmbulanceSnapshot = snapshot;

            ambulances = stored;
            renderAmbulanceList();
            if (map) updateAllMarkers();
            updateStatsCounters();
            if (typeof updateDriverSimCards === 'function') updateDriverSimCards();
        }

        function showMapFallback(msg) {
            const mapEl = document.getElementById('map');
            if (!mapEl) return;
            let box = document.getElementById('map-fallback-msg');
            if (!box) {
                box = document.createElement('div');
                box.id = 'map-fallback-msg';
                mapEl.appendChild(box);
            }
            box.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-2xl text-amber-400"></i><span>${msg}</span>`;
        }

        // Posisikan peta agar screenshot Jabodetabek menutupi seluruh panel peta
        // (mode "cover", jadi tidak ada area kosong di kiri/kanan peta).
        function fitBasemapView() {
            if (!map) return;
            const bounds = L.latLngBounds(BASEMAP_BOUNDS);
            const zoom = map.getBoundsZoom(bounds, true);
            map.setView(bounds.getCenter(), zoom, { animate: false });
        }

        function initMap() {
            // Guard: Leaflet gagal dimuat (CDN terblokir / file JS tidak ditemukan)
            if (typeof L === 'undefined') {
                showMapFallback('Pustaka Leaflet gagal dimuat. Pastikan folder <strong>vendor/leaflet</strong> ada di samping file HTML ini.');
                return;
            }

            map = L.map('map').setView([51.505, -0.09], 13);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }).addTo(map);

            // Leaflet Dark Theme Configuration
            // minZoom/maxBounds agar peta tidak keluar dari area screenshot,
            // maxZoom agar screenshot tidak diperbesar berlebihan (blur).
            // map = L.map('map', {
            //     zoomControl: false,
            //     fadeAnimation: true,
            //     minZoom: 9,
            //     maxZoom: 14,
            //     zoomSnap: 0.25,
            //     maxBounds: L.latLngBounds(BASEMAP_BOUNDS),
            //     maxBoundsViscosity: 0.8
            // }).setView([CENTER_LAT, CENTER_LNG], 13);
            // L.control.zoom({ position: 'topleft' }).addTo(map);

            // Basemap: screenshot peta Jabodetabek (file lokal, tanpa tile online)
            // sehingga peta tetap tampil walau CDN diblokir / offline.
            // L.imageOverlay(BASEMAP_SRC, BASEMAP_BOUNDS, {
            //     opacity: 1,
            //     interactive: false,
            //     attribution: '&copy; Esri, TOMTom, Garmin, HERE, OpenStreetMap contributors'
            // }).addTo(map);

            // Tampilkan screenshot Jabodetabek sebagai peta,
            // dan beri tahu user jika file screenshot tidak ditemukan.
            // const basemapImg = new Image();
            // basemapImg.onload = fitBasemapView;
            // basemapImg.onerror = function () {
            //     showMapFallback('File peta <strong>' + BASEMAP_SRC + '</strong> tidak ditemukan. Pastikan folder <strong>assets</strong> berada di samping file HTML ini.');
            // };
            // basemapImg.src = BASEMAP_SRC;

            updateAllMarkers();

            // Pastikan Leaflet menghitung ulang ukuran container (peta di dalam flex layout),
            // lalu sesuaikan tampilan agar screenshot pas mengisi panel peta.
            setTimeout(function () { map.invalidateSize(); fitBasemapView(); }, 250);
            window.addEventListener('resize', function () { map.invalidateSize(); });

            // Refit otomatis tiap ukuran panel peta berubah (CDN selesai dimuat, font termuat,
            // jendela di-resize) supaya screenshot selalu menutupi seluruh panel peta.
            if (window.ResizeObserver) {
                new ResizeObserver(function () {
                    if (!map) return;
                    map.invalidateSize({ animate: false });
                    fitBasemapView();
                }).observe(document.getElementById('map'));
            }
        }

        // Generate Icon Leaflet Markers
        function isCoreDriver(driver) {
            return driver.roleTitle === 'Driver Inti' || driver.roleCategory === 'Inti';
        }

        function createCustomIcon(type, data) {
            let bgColor = 'bg-slate-600';
            let iconClass = 'fa-location-dot';

            if (type === 'ambulance') {
                iconClass = 'fa-truck-medical';
                if (data.status === 'En Route') {
                    bgColor = 'bg-red-600 pulse-red';
                } else {
                    bgColor = 'bg-emerald-600';
                }
            } else if (type === 'driver') {
                iconClass = isCoreDriver(data) ? 'fa-user-shield' : 'fa-user';
                if (data.status === 'Sedang Bertugas') {
                    bgColor = 'bg-red-600';
                } else if (data.status === 'Standby') {
                    bgColor = isCoreDriver(data) ? 'bg-purple-600' : 'bg-blue-600';
                } else {
                    bgColor = 'bg-slate-600';
                }
            } else if (type === 'incident') {
                iconClass = 'fa-triangle-exclamation';
                bgColor = 'bg-red-600 pulse-broadcast';
            }

            const html = `<div class="custom-map-icon ${bgColor} w-9 h-9 text-xs">
                            <i class="fa-solid ${iconClass}"></i>
                          </div>`;

            return L.divIcon({
                html: html,
                className: '',
                iconSize: [36, 36],
                iconAnchor: [18, 18],
                popupAnchor: [0, -18]
            });
        }

        function updateMapLegend() {
            const container = document.getElementById('map-legend-items');
            if (!container) return;

            const mappedAmbulances = ambulances.filter(hasValidCoords);
            const mappedDrivers = drivers.filter(hasValidCoords);
            const driverStandby = mappedDrivers.filter(driver => driver.status === 'Standby');
            const driverOther = mappedDrivers.filter(driver =>
                driver.status !== 'Standby' && driver.status !== 'Sedang Bertugas');
            const entries = [
                {
                    color: 'bg-red-600',
                    label: 'Ambulans bertugas',
                    items: mappedAmbulances.filter(ambulance => ambulance.status === 'En Route')
                },
                {
                    color: 'bg-emerald-600',
                    label: 'Ambulans standby',
                    items: mappedAmbulances.filter(ambulance => ambulance.status !== 'En Route')
                },
                {
                    color: 'bg-red-600',
                    label: 'Driver sedang bertugas',
                    items: mappedDrivers.filter(driver => driver.status === 'Sedang Bertugas')
                },
                {
                    color: 'bg-purple-600',
                    label: 'Driver inti standby',
                    items: driverStandby.filter(isCoreDriver)
                },
                {
                    color: 'bg-blue-600',
                    label: 'Driver pendukung standby',
                    items: driverStandby.filter(driver => !isCoreDriver(driver))
                },
                {
                    color: 'bg-slate-600',
                    label: 'Driver status lainnya',
                    items: driverOther
                }
            ].filter(entry => entry.items.length > 0);

            if (!entries.length) {
                container.innerHTML = '<div class="text-slate-500">Belum ada marker dengan koordinat valid.</div>';
                return;
            }

            container.innerHTML = entries.map(entry => {
                const names = entry.items.map(item => escTask(item.name)).join(', ');
                return `
                    <div class="flex items-start gap-2 max-w-64" title="${names}">
                        <span class="w-2.5 h-2.5 mt-0.5 rounded-full ${entry.color} inline-block shrink-0"></span>
                        <div class="min-w-0">
                            <div class="text-slate-300">${entry.label} (${entry.items.length})</div>
                            <div class="text-[10px] text-slate-500 truncate">${names}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Validasi koordinat sebelum membuat/memindah marker — driver atau armada
        // tanpa lat/lng (mis. belum pernah kirim GPS) tidak boleh menjatuhkan render peta.
        function hasValidCoords(item) {
            return !!item &&
                typeof item.lat === 'number' && typeof item.lng === 'number' &&
                isFinite(item.lat) && isFinite(item.lng);
        }

        function updateAllMarkers() {
            updateMapLegend();
            if (!map) return;
            // Render Ambulance Markers
            ambulances.forEach(amb => {
                if (!hasValidCoords(amb)) return;
                const icon = createCustomIcon('ambulance', amb);
                // Nama kru benar-benar bertugas (dari tugas aktif), bukan daftar statis.
                const crewNames = crewNamesOf(amb);
                const popupContent = `
                    <div class="p-2 w-60 text-xs space-y-1.5">
                        <div class="flex items-center justify-between border-b border-slate-700 pb-1.5 mb-2">
                            <span class="font-bold text-sm text-red-400 flex items-center gap-1.5">
                                <i class="fa-solid fa-truck-medical"></i> ${amb.name}
                            </span>
                            <span class="text-[10px] px-2 py-0.5 rounded-full ${amb.status === 'En Route' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}">
                                ${amb.status}
                            </span>
                        </div>
                        <p><strong class="text-slate-400">Tipe Armada:</strong> ${amb.type}</p>
                        <p><strong class="text-slate-400">Plat Nomor:</strong> <span class="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-200">${amb.plate}</span></p>
                        <p><strong class="text-slate-400">Driver Tugas:</strong> <br/><span class="text-emerald-400 font-medium">${crewNames.join(' & ')}</span></p>
                        <p><strong class="text-slate-400">Tujuan Rute:</strong> ${amb.destination || '–'}</p>
                        
                        <div class="pt-2 border-t border-slate-700 flex gap-2">
                            <a href="tel:${amb.phone}" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-1 rounded text-center block">
                                <i class="fa-solid fa-phone"></i> Hubungi Armada
                            </a>
                        </div>
                    </div>
                `;

                if (markers[amb.id]) {
                    markers[amb.id].setLatLng([amb.lat, amb.lng]);
                    markers[amb.id].setIcon(icon);
                    // Sinkronkan isi popup (tujuan rute, kru, status) saat data berubah
                    markers[amb.id].setPopupContent(popupContent);
                } else {
                    const marker = L.marker([amb.lat, amb.lng], { icon: icon }).addTo(map);
                    marker.bindPopup(popupContent);
                    markers[amb.id] = marker;
                }
            });

            // Render Driver Markers
            drivers.forEach(drv => {
                if (!hasValidCoords(drv)) return;
                const icon = createCustomIcon('driver', drv);
                const popupContent = `
                    <div class="p-2 w-56 text-xs space-y-1.5">
                        <div class="flex items-center justify-between border-b border-slate-700 pb-1.5 mb-2">
                            <span class="font-bold text-sm ${isCoreDriver(drv) ? 'text-purple-400' : 'text-blue-400'} flex items-center gap-1.5">
                                <i class="fa-solid ${isCoreDriver(drv) ? 'fa-user-shield' : 'fa-user'}"></i> ${drv.name}
                            </span>
                            <span class="text-[10px] px-2 py-0.5 rounded-full ${isCoreDriver(drv) ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
                                ${escTask(drv.roleTitle || drv.roleCategory || 'Driver')}
                            </span>
                        </div>
                        <p class="italic text-slate-400">${drv.roleTitle}</p>
                        <p><strong class="text-slate-400">Status Active:</strong> <span class="font-semibold ${drv.status === 'Sedang Bertugas' ? 'text-red-400' : 'text-emerald-400'}">${drv.status}</span></p>
                        <p><strong class="text-slate-400">Ambulans Bertugas:</strong> ${drv.ambulanceAssigned}</p>
                        <p><strong class="text-slate-400">Lokasi:</strong> ${drv.locationName}</p>
                        ${drv.lastSeen ? `<p class="text-[11px] text-slate-500"><i class="fa-solid fa-satellite-dish mr-1"></i>GPS update: ${formatDateTime(drv.lastSeen)}</p>` : ''}
                        <div class="pt-2 border-t border-slate-700">
                            <a href="tel:${drv.phone}" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-1 rounded text-center block">
                                <i class="fa-solid fa-phone"></i> Kontak Driver
                            </a>
                        </div>
                    </div>
                `;

                if (markers[drv.id]) {
                    markers[drv.id].setLatLng([drv.lat, drv.lng]);
                    markers[drv.id].setIcon(icon);
                    // Sinkronkan isi popup (status, armada) saat data berubah
                    markers[drv.id].setPopupContent(popupContent);
                } else {
                    const marker = L.marker([drv.lat, drv.lng], { icon: icon }).addTo(map);
                    marker.bindPopup(popupContent);
                    markers[drv.id] = marker;
                }
            });

            // Incident Broadcast Point Marker (If Active)
            if (activeBroadcast && activeBroadcast.lat && activeBroadcast.lng) {
                const incidentIcon = createCustomIcon('incident', {});
                const popupContent = `
                    <div class="p-2 w-48 text-xs text-slate-200">
                        <strong class="text-red-400 block text-sm font-bold border-b border-slate-700 pb-1 mb-1">PANGGILAN BROADCAST</strong>
                        <p><strong>Lokasi:</strong> ${activeBroadcast.location}</p>
                        <p class="text-slate-400 italic">${activeBroadcast.notes}</p>
                    </div>
                `;

                if (markers['incident']) {
                    markers['incident'].setLatLng([activeBroadcast.lat, activeBroadcast.lng]);
                } else {
                    const marker = L.marker([activeBroadcast.lat, activeBroadcast.lng], { icon: incidentIcon }).addTo(map);
                    marker.bindPopup(popupContent);
                    markers['incident'] = marker;
                }
            } else if (markers['incident']) {
                map.removeLayer(markers['incident']);
                delete markers['incident'];
            }
        }

        /* Nama driver yang BENAR-BENAR sedang bertugas dengan sebuah armada —
           diturunkan dari data permintaan aktif (sinkron via store.js), bukan dari
           daftar statis driversAssigned. Tanpa tugas aktif -> "Belum ada driver bertugas". */
        function crewNamesOf(amb) {
            const aktif = drivers.filter(d => d && d.ambulanceAssigned === amb.name &&
                typeof driverHasActiveTask === 'function' && driverHasActiveTask(d.id));
            return aktif.length ? aktif.map(d => d.name) : ['Belum ada driver bertugas'];
        }

        // Render Ambulances Side List
        function renderAmbulanceList() {
            const container = document.getElementById('ambulance-list-container');
            container.innerHTML = ambulances.map(amb => {
                const kru = crewNamesOf(amb);
                const kruAktif = kru.length > 0 && kru[0] !== 'Belum ada driver bertugas';
                return `
                <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 hover:border-slate-600 transition">
                    <div class="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                        <div>
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-bold text-sm text-slate-100">${amb.name}</span>
                                <span class="text-[10px] font-mono bg-slate-900 border border-slate-700 px-1.5 py-0.2 rounded text-slate-300">${amb.plate}</span>
                            </div>
                            <p class="text-xs text-slate-400 mt-0.5">${amb.type}</p>
                        </div>
                        <span class="text-[10px] font-medium px-2 py-0.5 rounded-full ${amb.status === 'En Route' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}">
                            ${amb.status}
                        </span>
                    </div>
                    <div class="mt-2 text-xs text-slate-300 bg-slate-900/60 p-2 rounded-lg border border-slate-800 space-y-1">
                        <p class="text-slate-400 text-[11px]"><i class="fa-solid fa-users text-slate-500 mr-1"></i> <strong>Driver Bertugas:</strong></p>
                        <p class="${kruAktif ? 'text-emerald-400' : 'text-slate-500 italic'} font-medium pl-3">${kru.join(', ')}</p>
                    </div>
                    <div class="mt-2 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-slate-700/40 pt-2">
                        <span class="text-slate-400 text-[11px]"><i class="fa-solid fa-compass mr-1"></i> ${amb.destination || '–'}</span>
                        <button onclick="focusOnMap('${amb.id}')" class="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium">
                            <i class="fa-solid fa-location-crosshairs"></i> Lacak
                        </button>
                    </div>
                </div>
            `;
            }).join('');
        }

        // Render 7 Drivers List
        function renderDriverList() {
            const container = document.getElementById('driver-list-container');
            container.innerHTML = drivers.map(drv => {
                const isCore = drv.roleCategory === 'Inti';
                const badgeStyle = isCore ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' : 'bg-blue-500/20 text-blue-300 border-blue-500/40';
                
                let statusBadge = 'bg-slate-800 text-slate-400';
                if (drv.status === 'Sedang Bertugas') statusBadge = 'bg-red-500/20 text-red-400 border border-red-500/30';
                if (drv.status === 'Standby') statusBadge = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';

                return `
                    <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 hover:border-slate-600 transition">
                        <div class="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                            <div class="flex flex-wrap items-center gap-2.5">
                                <div class="w-8 h-8 rounded-full ${isCore ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40' : 'bg-blue-600/30 text-blue-300 border border-blue-500/40'} flex items-center justify-center text-xs font-bold">
                                    ${drv.name.charAt(0)}
                                </div>
                                <div>
                                    <div class="flex flex-wrap items-center gap-1.5">
                                        <h3 class="font-bold text-sm text-slate-100">${drv.name}</h3>
                                        <span class="text-[9px] px-1.5 py-0.2 rounded font-semibold border ${badgeStyle}">
                                            ${drv.roleCategory}
                                        </span>
                                    </div>
                                    <p class="text-[11px] text-slate-400">${drv.roleTitle}</p>
                                </div>
                            </div>
                            <span class="text-[10px] font-medium px-2 py-0.5 rounded-full ${statusBadge}">
                                ${drv.status}
                            </span>
                        </div>
                        <div class="mt-2 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-slate-700/40 pt-2">
                            <span class="text-slate-400 text-[11px]"><i class="fa-solid fa-location-dot mr-1 text-slate-500"></i> ${drv.locationName}${drv.lastSeen ? ` <span class="text-slate-600">· ${formatDateTime(drv.lastSeen)}</span>` : ''}</span>
                            <button onclick="focusOnMap('${drv.id}')" class="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium">
                                <i class="fa-solid fa-location-crosshairs"></i> Lacak
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function renderLogs() {
            const container = document.getElementById('activity-log');
            container.innerHTML = activityLogs.map(log => `
                <div class="flex items-start gap-2 text-slate-300">
                    <span class="text-slate-500 text-[10px] whitespace-nowrap pt-0.5">${log.time}</span>
                    <p class="leading-tight text-slate-300 text-[11px]">${log.text}</p>
                </div>
            `).join('');
        }

        function addLog(text) {
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            activityLogs.unshift({ time: timeStr, text: text });
            if (activityLogs.length > 12) activityLogs.pop();
            renderLogs();
        }

        function clearLogs() {
            activityLogs.length = 0;
            renderLogs();
        }

        function updateStatsCounters() {
            const readyCount = drivers.filter(d => d.status === 'Standby').length;
            document.getElementById('stat-driver-ready').textContent = readyCount;

            const activeAmb = ambulances.filter(a => a.status === 'En Route').length;
            document.getElementById('stat-amb-active').textContent = activeAmb;
        }

        /* Tugas ambulans dari panel admin: permintaan berstatus "Diproses" yang sudah
           ditugaskan ke satu atau lebih driver, lengkap dengan status konfirmasi tiap
           driver. Muncul otomatis di dashboard tanpa reload (dicek tiap 5 detik). */
        function escTask(v) {
            return String(v === null || v === undefined ? '' : v)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function renderActiveTasks() {
            if (typeof getAllPermintaan !== 'function') return;
            const container = document.getElementById('task-list-container');
            const countEl = document.getElementById('task-count');
            if (!container) return;

            const list = getAllPermintaan().filter(p => {
                if (!p || p.status !== 'Diproses') return false;
                // Section "Tugas Ambulans" — hanya penugasan yang butuh ambulans;
                // permintaan murni pengurusan jenazah tidak ditampilkan di sini.
                if (typeof isAmbulanPermintaan === 'function' && !isAmbulanPermintaan(p)) return false;
                const arr = (typeof assignedDriversOf === 'function') ? assignedDriversOf(p) : [];
                return arr.length > 0;
            });
            if (countEl) countEl.textContent = list.length + ' Aktif';

            if (!list.length) {
                container.innerHTML = '<p class="text-[11px] text-slate-500 text-center py-3">' +
                    'Belum ada tugas aktif. Permintaan yang diproses admin akan muncul di sini.</p>';
                return;
            }

            container.innerHTML = list.map(p => {
                const assigned = (typeof assignedDriversOf === 'function') ? assignedDriversOf(p) : [];
                const confirms = (typeof confirmMapOf === 'function') ? confirmMapOf(p) : {};
                const doneMap = (p.driverDone && typeof p.driverDone === 'object') ? p.driverDone : {};
                const confirmCount = assigned.filter(id => confirms[id]).length;
                const doneCount = assigned.filter(id => doneMap[id]).length;
                const drvById = id => drivers.find(d => d && d.id === id);
                const chips = assigned.map(id => {
                    const drv = drvById(id);
                    const name = drv ? drv.name : id;
                    const done = !!doneMap[id];
                    const ok = !!confirms[id];
                    const cls = done
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:border-emerald-400'
                        : (ok
                            ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 hover:border-amber-400'
                            : 'bg-slate-600/10 border-slate-600/40 text-slate-400');
                    const icon = done ? 'fa-circle-check' : (ok ? 'fa-truck-medical' : 'fa-hourglass-half');
                    const title = done ? 'Sudah konfirmasi selesai' : (ok ? 'Sedang bertugas' : 'Menunggu konfirmasi');
                    const drvInfo = drv
                        ? '\nStatus: ' + drv.status + (drv.ambulanceAssigned ? ' · ' + drv.ambulanceAssigned : '')
                        : '';
                    return '<button onclick="focusOnMap(\'' + escTask(id) + '\')"' +
                        ' title="' + escTask(title + ' — klik untuk lacak di peta' + drvInfo) + '"' +
                        ' class="text-[10px] px-1.5 py-0.5 rounded font-medium border transition ' + cls + '">' +
                        '<i class="fa-solid ' + icon + ' mr-1"></i>' +
                        escTask(name) + '</button>';
                }).join(' ');

                // Armada yang dipakai driver bertugas pada tugas ini, dengan status
                // terkininya — disinkronkan dengan data permintaan oleh store.js.
                const ambNames = [];
                assigned.forEach(id => {
                    if (doneMap[id]) return;
                    const drv = drvById(id);
                    const ambName = drv && drv.ambulanceAssigned;
                    if (ambName && ambNames.indexOf(ambName) === -1) ambNames.push(ambName);
                });
                const ambLine = ambNames.map(nm => {
                    const amb = ambulances.find(a => a && a.name === nm);
                    const st = amb && amb.status ? amb.status : 'Standby';
                    const cls = st === 'En Route'
                        ? 'bg-red-500/15 border-red-500/40 text-red-300'
                        : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
                    return '<span class="text-[10px] px-1.5 py-0.5 rounded font-medium border ' + cls + '">' +
                        '<i class="fa-solid fa-truck-medical mr-1"></i>' +
                        escTask(nm) + ' · ' + escTask(st) + '</span>';
                }).join('');

                return '<div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3">' +
                    '<div class="flex items-center justify-between gap-2 flex-wrap">' +
                        '<span class="mono font-bold text-xs text-slate-100">' + escTask(p.id) + '</span>' +
                        '<span class="badge badge-purple">' + escTask(p.jenis || p.type || 'Permintaan') + '</span>' +
                    '</div>' +
                    '<p class="text-[11px] text-slate-400 mt-1"><i class="fa-solid fa-location-dot mr-1 text-slate-500"></i>' +
                        escTask(p.lokasi || '-') + '</p>' +
                    '<p class="text-[10px] text-slate-500 mt-0.5">Pemohon: ' + escTask(p.nama || '-') + '</p>' +
                    '<div class="flex items-center gap-1.5 flex-wrap mt-2 pt-2 border-t border-slate-700/40">' + chips + '</div>' +
                    (ambLine ? '<div class="flex items-center gap-1.5 flex-wrap mt-1.5" title="Armada yang ditugaskan mengikuti status permintaan">' + ambLine + '</div>' : '') +
                    '<p class="text-[10px] text-slate-500 mt-1"><i class="fa-solid fa-handshake mr-1"></i>' +
                        confirmCount + '/' + assigned.length + ' konfirmasi · ' + doneCount + ' selesai · klik nama driver untuk lacak posisi</p>' +
                '</div>';
            }).join('');
        }

        function focusOnMap(id) {
            if (!map) return;
            const item = ambulances.find(a => a.id === id) || drivers.find(d => d.id === id);
            if (item && markers[id]) {
                map.flyTo([item.lat, item.lng], 16, { duration: 1.2 });
                markers[id].openPopup();

                if (window.innerWidth < 768) {
                    closeMobileSidebar();
                }
            }
        }

        function resetMapView() {
            if (!map) return;
            // Kembali ke tampilan awal: screenshot peta Jabodetabek mengisi panel peta
            fitBasemapView();
        }

        function filterMarkers(category) {
            activeFilter = category;
            if (!map) return;

            ['all', 'ambulance', 'driver'].forEach(type => {
                const btn = document.getElementById(`filter-${type}`);
                if (type === category) {
                    btn.className = "flex-1 py-1.5 rounded-md font-medium text-slate-200 bg-slate-800 transition shadow";
                } else {
                    btn.className = "flex-1 py-1.5 rounded-md font-medium text-slate-400 hover:text-slate-200 transition";
                }
            });

            const ambSec = document.getElementById('section-ambulance');
            const drvSec = document.getElementById('section-driver');

            if (category === 'all') {
                ambSec.classList.remove('hidden');
                drvSec.classList.remove('hidden');
            } else if (category === 'ambulance') {
                ambSec.classList.remove('hidden');
                drvSec.classList.add('hidden');
            } else if (category === 'driver') {
                ambSec.classList.add('hidden');
                drvSec.classList.remove('hidden');
            }

            ambulances.forEach(a => {
                if (markers[a.id]) {
                    if (category === 'all' || category === 'ambulance') map.addLayer(markers[a.id]);
                    else map.removeLayer(markers[a.id]);
                }
            });

            drivers.forEach(d => {
                if (markers[d.id]) {
                    if (category === 'all' || category === 'driver') map.addLayer(markers[d.id]);
                    else map.removeLayer(markers[d.id]);
                }
            });
        }

        function toggleSimulation() {
            isSimulating = !isSimulating;
            const btnIcon = document.getElementById('simIcon');
            const btnText = document.getElementById('simText');
            const simBtn = document.getElementById('simBtn');

            if (isSimulating) {
                btnIcon.className = "fa-solid fa-pause text-amber-400";
                btnText.textContent = "Jeda";
                simBtn.classList.add("border-emerald-500/50");

                addLog("Simulasi pergerakan Ambulans 01 & driver aktif dimulai.");

                simulationInterval = setInterval(() => {
                    // Moving Ambulans 01
                    const amb1 = ambulances.find(a => a.id === 'amb-01');
                    if (amb1) {
                        amb1.lat += (Math.random() - 0.3) * 0.0012;
                        amb1.lng += (Math.random() - 0.2) * 0.0012;
                    }

                    // Synchronize assigned drivers on duty (Budi & Doni)
                    const drvBudi = drivers.find(d => d.id === 'drv-01');
                    const drvDoni = drivers.find(d => d.id === 'drv-03');

                    if (amb1) {
                        if (drvBudi) { drvBudi.lat = amb1.lat - 0.0001; drvBudi.lng = amb1.lng - 0.0001; }
                        if (drvDoni) { drvDoni.lat = amb1.lat + 0.0001; drvDoni.lng = amb1.lng + 0.0001; }
                    }

                    updateAllMarkers();
                    renderAmbulanceList();
                    renderDriverList();
                }, 2000);

            } else {
                btnIcon.className = "fa-solid fa-play text-emerald-400";
                btnText.textContent = "Simulasi Rute";
                simBtn.classList.remove("border-emerald-500/50");
                clearInterval(simulationInterval);
                addLog("Simulasi rute dihentikan.");
            }
        }

        function openBroadcastModal() {
            // Pilihan armada selalu mengikuti data armada terkini (nama, tipe,
            // status dari store) — bukan opsi hardcode di HTML.
            populateBroadcastAmbulances();
            document.getElementById('broadcastModal').classList.remove('hidden');
        }

        /* Isi dropdown armada dari data store; unit yang Standby diprioritaskan. */
        function populateBroadcastAmbulances() {
            const sel = document.getElementById('bcAmbulance');
            if (!sel) return;
            const list = (typeof ambulanceListSource === 'function')
                ? ambulanceListSource()
                : (typeof ambulances !== 'undefined' && Array.isArray(ambulances) ? ambulances : []);

            sel.innerHTML = list.length
                ? list.map(a => {
                    const label = [a.name, a.type].filter(Boolean).join(' - ') +
                        ' (' + (a.status || 'Standby') + (a.plate ? ' · ' + a.plate : '') + ')';
                    return '<option value="' + escTask(a.id) + '">' + escTask(label) + '</option>';
                }).join('')
                : '<option value="">Belum ada data armada</option>';

            const standby = list.find(a => a && a.status === 'Standby');
            if (standby) sel.value = standby.id;
        }

        function closeBroadcastModal() {
            document.getElementById('broadcastModal').classList.add('hidden');
        }

        function toggleDriverSimulatorModal() {
            const modal = document.getElementById('driverSimModal');
            modal.classList.toggle('hidden');
            if (!modal.classList.contains('hidden')) {
                updateDriverSimCards();
            }
        }

        function submitBroadcastEmergency(e) {
            e.preventDefault();
            // Input mengikuti Formulir Permohonan Ambulan Pasien YHI (lihat formambulan.txt)
            const val = id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

            const ambId = val('bcAmbulance');
            const patient = {
                applicant: val('bcName'),
                phone: val('bcPhone'),
                relation: val('bcRelation'),
                name: val('bcPatient'),
                gender: val('bcGender'),
                age: val('bcAge'),
                history: val('bcRiwayat'),
                home: val('bcHome'),
                maps: val('bcMaps'),
                schedule: [val('bcReqDay'), val('bcReqDate'), val('bcReqTime')].filter(Boolean).join(' | '),
                pickup: val('bcPickup'),
                destination: val('bcDest')
            };

            // Lokasi broadcast = alamat penjemputan (fallback: alamat rumah)
            const location = patient.pickup || patient.home || 'Lokasi belum diisi';
            const notes = [
                patient.name ? 'Pasien: ' + patient.name : '',
                (patient.age || patient.gender) ? '(' + [patient.gender, patient.age ? patient.age + ' th' : ''].filter(Boolean).join(', ') + ')' : '',
                patient.history ? 'Riwayat: ' + patient.history : '',
                patient.destination ? 'Tujuan: ' + patient.destination : ''
            ].filter(Boolean).join(' — ') || 'Darurat Segera';

            activeBroadcast = {
                id: 'BC-' + Date.now().toString().slice(-4),
                location: location,
                notes: notes,
                patient: patient,
                ambulanceId: ambId,
                lat: CENTER_LAT + (Math.random() - 0.5) * 0.02,
                lng: CENTER_LNG + (Math.random() - 0.5) * 0.02,
                claimedBy: null,
                responseTimeSec: null
            };

            /* Catat broadcast sebagai permintaan → tampil di permintaan.html
               (status Diproses: admin bisa memantau, driver menerima notifikasi tugas). */
            const ambRec = (typeof ambulanceListSource === 'function')
                ? ambulanceListSource().find(a => a && a.id === ambId) : null;
            const permintaan = (typeof addPermintaan === 'function')
                ? addPermintaan({
                    id: makeId('REQ'),
                    status: 'Diproses',
                    jenis: 'Permintaan Ambulans',
                    nama: patient.applicant || patient.name || '-',
                    hp: patient.phone || '-',
                    lokasi: location,
                    createdAt: new Date().toISOString(),
                    detail: {
                        sumber: 'Broadcast Emergency Call',
                        ambulan: ambRec ? ambRec.name : ambId,
                        hubungan: patient.relation,
                        namaPasien: patient.name,
                        kelamin: patient.gender,
                        umur: patient.age,
                        riwayatSakit: patient.history,
                        alamatRumah: patient.home,
                        maps: patient.maps,
                        jadwalAmbulan: patient.schedule,
                        penjemputan: patient.pickup,
                        tujuan: patient.destination
                    }
                }) : null;
            activeBroadcast.requestId = permintaan ? permintaan.id : null;

            broadcastStartTime = Date.now();

            // Update UI card
            document.getElementById('active-broadcast-card').classList.remove('hidden');
            document.getElementById('bc-location-text').textContent = location;
            document.getElementById('bc-notes-text').textContent = notes;
            document.getElementById('bc-status-text').textContent = 'MENUNGGU RESPONS DRIVER TERCEPAT...';
            document.getElementById('bc-status-text').className = 'text-amber-400 font-bold animate-pulse';

            // Start Timer Counter
            if (broadcastTimerInterval) clearInterval(broadcastTimerInterval);
            broadcastTimerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - broadcastStartTime) / 1000);
                const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
                const secs = String(elapsed % 60).padStart(2, '0');
                document.getElementById('broadcast-timer').textContent = `${mins}:${secs}`;
            }, 1000);

            addLog(`BROADCAST DARURAT: ${patient.name} (${patient.gender}${patient.age ? ', ' + patient.age + ' th' : ''}) — jemput: ${location} → ${patient.destination} | Pemohon: ${patient.applicant} (${patient.phone})`);
            if (permintaan) addLog(`Permintaan ${permintaan.id} tercatat di daftar permintaan (status Diproses, armada: ${ambRec ? ambRec.name : '-'}).`);

            closeBroadcastModal();
            document.getElementById('broadcastForm').reset();
            updateAllMarkers();
            
            // Auto open driver action simulator
            toggleDriverSimulatorModal();
        }

        // Render Driver Action Simulation Cards for FCFS logic
        function updateDriverSimCards() {
            const container = document.getElementById('driver-response-buttons');
            const statusBox = document.getElementById('sim-broadcast-status');

            if (!activeBroadcast) {
                statusBox.innerHTML = `
                    <div class="text-slate-400 flex items-center justify-between">
                        <span><i class="fa-solid fa-info-circle mr-1 text-blue-400"></i> Belum ada broadcast tugas yang aktif saat ini.</span>
                        <button onclick="toggleDriverSimulatorModal(); openBroadcastModal();" class="bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded text-xs font-semibold">Buat Broadcast Baru</button>
                    </div>
                `;
            } else if (activeBroadcast.claimedBy) {
                statusBox.innerHTML = `
                    <div class="text-emerald-400 font-medium">
                        <i class="fa-solid fa-check-circle mr-1"></i> Broadcast <strong>${activeBroadcast.id}</strong> telah DIAMBIL OLEH <strong>${activeBroadcast.claimedBy}</strong> dalam waktu <strong>${activeBroadcast.responseTimeSec} detik</strong>.
                    </div>
                `;
            } else {
                statusBox.innerHTML = `
                    <div class="text-amber-400 font-semibold flex items-center justify-between">
                        <span><i class="fa-solid fa-spinner fa-spin mr-1"></i> BROADCAST AKTIF: Menunggu driver menekan "Terima Tugas"...</span>
                        <span class="bg-amber-500/20 px-2 py-0.5 rounded text-[11px] text-amber-300">Fastest Finger Wins</span>
                    </div>
                `;
            }

            container.innerHTML = drivers.map(drv => {
                const isCore = drv.roleCategory === 'Inti';
                const isAvailable = drv.status === 'Standby' && activeBroadcast && !activeBroadcast.claimedBy;

                return `
                    <div class="bg-slate-950 p-3 rounded-xl border ${isAvailable ? 'border-slate-700' : 'border-slate-800 opacity-70'} flex flex-col justify-between">
                        <div>
                            <div class="flex items-center justify-between mb-1">
                                <div class="flex items-center gap-1.5">
                                    <span class="font-bold text-sm text-slate-100">${drv.name}</span>
                                    <span class="text-[9px] px-1.5 py-0.2 rounded ${isCore ? 'bg-purple-900/60 text-purple-300' : 'bg-blue-900/60 text-blue-300'}">
                                        Driver ${drv.roleCategory}
                                    </span>
                                </div>
                                <span class="text-[10px] ${drv.status === 'Standby' ? 'text-emerald-400' : 'text-slate-400'}">${drv.status}</span>
                            </div>
                            <p class="text-[11px] text-slate-400">${drv.roleTitle}</p>
                        </div>
                        
                        <div class="mt-3">
                            ${isAvailable ? `
                                <button onclick="driverClaimBroadcast('${drv.id}', '${drv.name}')" class="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold py-2 px-3 rounded-lg text-xs transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5">
                                    <i class="fa-solid fa-bolt"></i> Terima Tugas (Claim)
                                </button>
                            ` : `
                                <button disabled class="w-full bg-slate-800 text-slate-500 font-medium py-2 px-3 rounded-lg text-xs cursor-not-allowed border border-slate-700/50">
                                    ${activeBroadcast && activeBroadcast.claimedBy === drv.name ? '✓ Tugas Diterima' : (drv.status !== 'Standby' ? 'Tidak Standby' : 'Tugas Terklaim')}
                                </button>
                            `}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Driver Accepts Broadcast (First Come First Served Logic)
        function driverClaimBroadcast(driverId, driverName) {
            if (!activeBroadcast || activeBroadcast.claimedBy) return;

            const responseTime = ((Date.now() - broadcastStartTime) / 1000).toFixed(1);

            activeBroadcast.claimedBy = driverName;
            activeBroadcast.responseTimeSec = responseTime;

            clearInterval(broadcastTimerInterval);

            // Klaim tugas:
            // 1) tugaskan driver ke ARMADA YANG DIPILIH di form broadcast (bukan hardcode)
            //    dan simpan ke store;
            // 2) konfirmasi tugas pada permintaan broadcast — status driver
            //    'Sedang Bertugas' & armada 'En Route' disinkronkan otomatis oleh store.js.
            const claimedAmb = ambulances.find(a => a && a.id === activeBroadcast.ambulanceId) || null;
            const claimPatch = { locationName: 'On Duty (' + activeBroadcast.location + ')' };
            if (claimedAmb) claimPatch.ambulanceAssigned = claimedAmb.name;
            if (typeof patchDriverRecord === 'function') patchDriverRecord(driverId, claimPatch);

            if (activeBroadcast.requestId && typeof confirmPermintaanTask === 'function') {
                confirmPermintaanTask(activeBroadcast.requestId, driverId);
            }

            // Tujuan armada TIDAK ditulis manual di sini — store.js mengisinya dari
            // data tujuan permintaan aktif (kosong bila tidak ada tugas).

            // Muat ulang data dari store agar render di bawah memakai data terkini
            if (typeof driverListSource === 'function') drivers = driverListSource();
            if (typeof ambulanceListSource === 'function') ambulances = ambulanceListSource();

            // Update UI Broadcast Panel
            document.getElementById('bc-status-text').textContent = `DITERIMA OLEH: ${driverName} (${responseTime}s)`;
            document.getElementById('bc-status-text').className = 'text-emerald-400 font-bold';

            addLog(`TUGAS DITERIMA: ${driverName} memenangkan broadcast tugas dalam ${responseTime} detik! (First-Come First-Served)`);

            updateAllMarkers();
            renderAmbulanceList();
            renderDriverList();
            updateDriverSimCards();
            updateStatsCounters();
        }

        // Mobile Responsive Drawer Helper
        function closeMobileSidebar() {
            document.getElementById('sidebar').classList.remove('is-open');
        }

        function setupMobileSidebar() {
            const toggleBtn = document.getElementById('sidebarToggleBtn');
            const sidebar = document.getElementById('sidebar');

            toggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('is-open');
                // Peta menyesuaikan ukurannya karena sidebar mendorong layout
                if (map) setTimeout(() => map.invalidateSize(), 50);
            });
        }
