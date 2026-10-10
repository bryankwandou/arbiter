# Carry Hyperliquid

Beli HYPE spot dan short HYPE perp dengan ukuran sama di Hyperliquid, lalu kumpulkan funding. Harga naik atau turun tidak berpengaruh karena kedua kaki saling menutup. Hasilnya berasal dari funding dikurangi biaya.

Semua fill dan pembayaran funding tercatat publik. Siapa pun bisa memeriksa hasilnya dari alamat akun saja, tanpa kunci:

```
node carry-hl.js status 0xALAMAT --since 2026-10-18T00:00:00Z
```

## Perintah

| Perintah | Butuh kunci | Fungsi |
|---|---|---|
| `plan` | tidak | ukuran order, biaya, perkiraan balik modal, modal yang dibutuhkan |
| `status 0xALAMAT` | tidak | profit/rugi asli dari data publik |
| `open` / `close` | tidak (dry run) | menampilkan order yang akan dikirim |
| `open --live` / `close --live` | ya | mengirim order sungguhan |
| `selftest` | tidak | memastikan tanda tangan order benar (kunci sekali pakai, tanpa dana) |

## Pengaman

- Tanpa `--live`, tidak ada order yang dikirim.
- `HL_AGENT_KEY` adalah API wallet yang disetujui di aplikasi Hyperliquid. Kunci ini bisa trading, tapi tidak bisa menarik dana.
- `CARRY_MAX_USD` (bawaan 13) membatasi besar pembelian spot.
- Order maker (post-only) dicoba dulu. Biaya pulang-pergi 11 bps, dibanding 23 bps untuk taker.
- `close` hanya menjual sebanyak ukuran hedge, jadi koin lain di akun tidak ikut terjual.
- Order di bawah $10 ditolak Hyperliquid. Bot membeli satu lot lebih banyak karena fee spot dipotong dalam koin. Bot juga menolak `close` bila nilai jual spot sudah di bawah $10, supaya spot tidak tertinggal tanpa hedge.

## Diuji 2026-10-10

- `selftest`: alamat yang dibaca Hyperliquid sama dengan alamat penanda tangan.
- `status` pada akun carry publik 0x4fd0…12da: kaki spot dan perp saling menutup, funding ~2 bps/hari. Sesuai perhitungan.
- Belum ada order sungguhan. Uji dengan uang asli hanya dijalankan atas keputusan pemilik akun.
