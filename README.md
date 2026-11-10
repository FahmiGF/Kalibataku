# Kalibataku

Kalibataku adalah aplikasi latihan hitung dasar untuk anak: **tambah, kurang, kali, dan bagi**. Satu babak berisi 10 soal, dengan empat pilihan jawaban besar, umpan balik langsung, dan rekor tersimpan di perangkat.

Aplikasi ini sengaja dibuat tanpa dependensi: HTML, CSS, dan JavaScript modul biasa, dilayani oleh server statis Node.js tanpa build step.

## Menjalankan

Prasyarat: Node.js 18 atau lebih baru.

```bash
npm start
```

Buka <http://localhost:4176>.

Port dapat diganti lewat variabel lingkungan:

```bash
PORT=5000 npm start
```

Tidak perlu `npm install`.

## Fitur

- **Lima mode operasi**: Campur, Tambah, Kurang, Kali, Bagi.
- **Tiga tingkat kesulitan**: Mudah, Sedang, Sulit.
- **10 soal per babak** tanpa soal kembar.
- **Empat pilihan unik** yang selalu memuat jawaban benar dan pengecoh yang masuk akal.
- **Pembagian bilangan bulat** tanpa sisa, dengan pembagi minimal 2.
- **Pengurangan tidak pernah negatif.**
- **Umpan balik langsung** berisi jawaban benar dan penjelasan singkat.
- **Skor, persentase, runtutan benar terbaik**, serta pesan hasil sesuai performa.
- **Rekor per mode + tingkat kesulitan** disimpan di `localStorage`.
- **Keyboard**: tekan `1`–`4` untuk memilih jawaban, `Enter` untuk lanjut saat umpan balik tampil.
- **Responsif** dari lebar 360 px; grid jawaban menjadi dua kolom di layar sempit.
- **Aksesibilitas**: target sentuh besar, fokus terlihat, `aria-live` untuk umpan balik, dan dukungan `prefers-reduced-motion`.

## Kontrol

| Aksi | Kontrol |
| --- | --- |
| Pilih jawaban | Klik/tap tombol, atau `1`–`4` |
| Lanjut setelah umpan balik | Klik **Lanjut** / **Lihat hasil**, atau `Enter` |
| Mulai babak | Tombol **Mulai latihan** |
| Ulangi mode yang sama | **Main lagi** di layar hasil |
| Kembali ke pemilihan mode | **Ganti mode** di layar hasil |

## Struktur berkas

```text
math-kalibataku/
├── index.html              # Kerangka tiga layar: mulai, kuis, hasil
├── styles.css              # Tampilan buku latihan, responsif, reduced motion
├── server.js               # Server statis Node tanpa dependensi (port 4176)
├── package.json            # Skrip npm, tanpa dependencies
├── README.md
├── .gitignore
├── src/
│   ├── game.js             # Logika murni: RNG, soal, pilihan, skor, rekor key
│   └── app.js              # DOM, state, localStorage, keyboard, transisi layar
├── test/
│   └── game.test.js        # Tes unit node:test untuk logika murni
└── scripts/
    └── browser-smoke.mjs   # Uji asap Chrome DevTools Protocol
```

## Pengujian

```bash
npm run check       # Pemeriksaan sintaks semua berkas JS/MJS
npm test            # Tes unit node:test
npm run test:browser  # Uji asap Chrome headless (desktop + mobile)
```

`npm run test:browser` membutuhkan Chrome atau Chromium. Secara bawaan skrip mencari lokasi pemasangan umum di Windows, macOS, dan Linux. Jika Chrome berada di lokasi lain, atur:

```bash
CHROME_PATH="/jalur/ke/chrome" npm run test:browser
```

Uji asap memakai profil Chrome sementara, port bebas, dan membersihkan server serta Chrome di blok `finally`. Pada Node 18, skrip otomatis memakai klien WebSocket minimal bawaan karena Node 18 belum menyediakan WebSocket global.

## Catatan desain

- Latihan dibuat sepenuhnya di browser; tidak ada akun, server data, atau panggilan jaringan eksternal.
- Rekor disimpan sebagai angka pada kunci `kalibataku:best:<mode>:<tingkat>`, misalnya `kalibataku:best:kali:sulit`.
- Font memakai font sistem agar tidak ada aset atau CDN eksternal.
- Warna aksen berubah mengikuti operasi yang dipilih.

## Kolaborasi multi-agent

Aplikasi ini dibangun lewat alur multi-agent, bukan satu agen saja:

- **Agent A — Freebuff/Buffy:** menulis spesifikasi, mengorkestrasi build, mengaudit kode, memperbaiki temuan, dan menjalankan verifikasi akhir.
- **Agent B — OpenCode (`opencode/deepseek-v4.1-flash-free`):** mengimplementasikan aplikasi, unit test, dan browser smoke test.
- **Agent C — OpenCode (`9router/ag/gemini-3.8-flash-medium`):** reviewer independen yang memeriksa logika, UX, aksesibilitas, responsivitas, dan celah tes tanpa mengubah file.

Temuan reviewer yang sudah diperbaiki: jawaban kosong tidak lagi dianggap benar untuk soal bernilai nol; tombol **Lanjut** dipisahkan dari live region; fokus berpindah ke soal baru, bukan tombol jawaban pertama; dan kontras catatan tingkat kesulitan dinaikkan.

## Batasan

- Hanya berjalan lokal lewat server Node; tidak ada backend, akun, atau sinkronisasi cloud.
- Rekor melekat pada browser/perangkat dan dapat hilang jika data situs dibersihkan.
- Tidak ada mode multiplayer, riwayat lengkap, atau unduhan laporan.
- Aplikasi membutuhkan JavaScript aktif.
