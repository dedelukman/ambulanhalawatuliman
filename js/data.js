// Default Base Coordinates (Cibinong / Bogor Area)
        const CENTER_LAT = -6.4800;
        const CENTER_LNG = 106.8250;

        // Basemap statis: screenshot peta Jabodetabek (file lokal, tampil walau offline).
        // Bounds diambil dari hasil capture: center [-6.475, 106.85], zoom 12, container 3899x2785.
        // Karena bounds ini dipakai untuk menempel gambar, seluruh koordinat marker
        // (lat/lng) otomatis sejajar dengan peta pada screenshot.
        const BASEMAP_SRC = 'assets/peta-jabodetabek.png';
        const BASEMAP_BOUNDS = [
            [-6.94994264171917, 106.18080139160158],   // sudut bawah-kiri (selatan / barat)
            [-5.999898944276991, 107.51941680908203]   // sudut atas-kanan (utara / timur)
        ];

// Data Definition: Ambulances (nilai awal / seed)
        const AMBULANCE_SEED = [
            {
                id: 'amb-01',
                name: 'Ambulans 01',
                type: 'Emergency SUV / Type A',
                plate: 'B 1118 EMR',
                status: 'Standby', // En Route, Standby (default sinkron dgn permintaan)
                driversAssigned: ['Suwarjiyo (Inti)', 'Faisal (Pendukung)'],
                lat: -6.4860,
                lng: 106.8330,
                speed: '0 km/jam',
                destination: 'RSUD Cibinong',
                phone: '0812-6000-2341'
            },
            {
                id: 'amb-02',
                name: 'Ambulans 02',
                type: 'Transport / Type B',
                plate: 'B 9022 TRP',
                status: 'Standby',
                driversAssigned: ['None'],
                lat: -6.4740,
                lng: 106.8180,
                speed: '0 km/jam',
                destination: 'Markaz halawatul Iman',
                phone: '0812-6000-2341'
            }
        ];

        // Data Definition: 7 Driver Relawan (2 Inti + 5 Pendukung) — nilai awal / seed
        const DRIVER_SEED = [
            {
                id: 'drv-01',
                name: 'Suwarjiyo',
                roleCategory: 'Tim Alpha', // Inti or Pendukung
                roleTitle: 'Driver Inti',
                status: 'Standby', // Sedang Bertugas, Standby, Off Duty
                ambulanceAssigned: 'Ambulans 01',
                lat: -6.4862,
                lng: 106.8328,
                phone: '0813-1000-0001',
                locationName: 'Standby (Ambulans 01)'
            },
            {
                id: 'drv-02',
                name: 'Andi Harsoyo',
                roleCategory: 'Tim Alpha',
                roleTitle: 'Driver Inti',
                status: 'Standby',
                ambulanceAssigned: 'Tidak Ada',
                lat: -6.4738,
                lng: 106.8182,
                phone: '0813-1000-0002',
                locationName: 'Markaz halawatul Iman',
            },
            {
                id: 'drv-03',
                name: 'Bambang S',
                roleCategory: 'Tim Bravo',
                roleTitle: 'Driver Pendukung',
                status: 'Standby',
                ambulanceAssigned: 'Ambulans 01',
                lat: -6.4858,
                lng: 106.8332,
                phone: '0813-1000-0003',
                locationName: 'Markaz halawatul Iman (Stand By)',
            },
            {
                id: 'drv-04',
                name: 'Faisal',
                roleCategory: 'Tim Bravo',
                roleTitle: 'Driver Pendukung',
                status: 'Standby',
                ambulanceAssigned: 'Tidak Ada',
                lat: -6.4742,
                lng: 106.8178,
                phone: '0813-1000-0004',
                locationName: 'Markaz halawatul Iman'
            },
            {
                id: 'drv-05',
                name: 'M. Rizal',
                roleCategory: 'Tim Bravo',
                roleTitle: 'Driver Pendukung',
                status: 'Standby',
                ambulanceAssigned: 'Tidak Ada',
                lat: -6.4680,
                lng: 106.8210,
                phone: '0813-1000-0005',
                locationName: 'Kediaman (On Call)'
            },
            {
                id: 'drv-06',
                name: 'Imam A',
                roleCategory: 'Tim Bravo',
                roleTitle: 'Driver Pendukung',
                status: 'Standby',
                ambulanceAssigned: 'Tidak Ada',
                lat: -6.4890,
                lng: 106.8150,
                phone: '0813-1000-0006',
                locationName: 'Kediaman (On Call)'
            },
            {
                id: 'drv-07',
                name: 'Lukmanul H',
                roleCategory: 'Tim Bravo',
                roleTitle: 'Driver Pendukung',
                status: 'Off Duty',
                ambulanceAssigned: 'Tidak Ada',
                lat: -6.4950,
                lng: 106.8080,
                phone: '0813-1000-0007',
                locationName: 'Kediaman (On Call)'
            }
        ];

        // Audit Logs Initial Array
        const activityLogs = [
            { time: '18:10', text: 'Ambulans 01 dalam rute darurat menuju RSUD Cibinong bersama Driver Suwarjiyo & Faisal.' },
            { time: '18:00', text: '5 Driver (Andi Harsoyo, Bambang S, M. Rizal, Imam A, Lukmanul H) Siaga untuk panggilan broadcast.' },
            { time: '17:45', text: 'Sistem Monitoring 7 Relawan Driver diaktifkan.' }
        ];

        /* Data aktif dibaca dari Firestore cache (hasil CRUD halaman admin).
           Bila belum pernah disimpan, kembali ke seed di atas. */
        var ambulances = storeRead(STORE_KEYS.AMBULANCES, AMBULANCE_SEED);
        var drivers = storeRead(STORE_KEYS.DRIVERS, DRIVER_SEED);
