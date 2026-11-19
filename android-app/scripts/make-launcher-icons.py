"""make-launcher-icons.py — membuat ikon launcher Android dari emblem
play-store/icon-512.png (sumber kebenaran ikon aplikasi) dan small icon
notifikasi dari play-store/ic_stat.png.

Butuh Pillow:  python -m pip install pillow
Pakai:         python scripts/make-launcher-icons.py

Menghasilkan:
  android/app/src/main/res/mipmap-*/ic_launcher.png        (legacy)
  android/app/src/main/res/mipmap-*/ic_launcher_round.png  (legacy bulat)
  android/app/src/main/res/drawable-*/ic_launcher_foreground.png
                                                           (lapisan adaptive icon)
Adaptive icon memakai latar putih (@color/ic_launcher_background), sedangkan
emblem digambar 68/108 dp agar aman di dalam safe zone semua bentuk mask.
"""
from pathlib import Path

from PIL import Image

APP = Path(__file__).resolve().parent.parent
SRC = APP / "play-store" / "icon-512.png"
NOTIF_SRC = APP / "play-store" / "ic_stat.png"
RES = APP / "android" / "app" / "src" / "main" / "res"

DENSITIES = {
    "mdpi": 1,
    "hdpi": 1.5,
    "xhdpi": 2,
    "xxhdpi": 3,
    "xxxhdpi": 4,
}

FG_EMBLEM_RATIO = 68 / 108  # safe zone adaptive icon
NOTIF_SIZES = {"mdpi": 24, "hdpi": 36, "xhdpi": 48, "xxhdpi": 72, "xxxhdpi": 96}
SPLASH_DP = 132


def emblem(size: int) -> Image.Image:
    """Emblem RGBA pada kanvas persegi `size`, mengisi seluruh kanvas."""
    src = Image.open(SRC).convert("RGBA")
    box = src.getbbox()
    if box:
        src = src.crop(box)
    side = max(src.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(src, ((side - src.width) // 2, (side - src.height) // 2), src)
    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"sumber ikon tidak ditemukan: {SRC}")

    for density, scale in DENSITIES.items():
        # Ikon legacy: 48 dp pada mdpi, isi penuh (emblem sudah bulat).
        legacy = round(48 * scale)
        img = emblem(legacy)
        out = RES / f"mipmap-{density}"
        out.mkdir(parents=True, exist_ok=True)
        img.save(out / "ic_launcher.png")
        img.save(out / "ic_launcher_round.png")
        print(f"[launcher] mipmap-{density}/ic_launcher.png ({legacy}x{legacy})")

        # Lapisan foreground adaptive icon: kanvas 108 dp, emblem di tengah.
        layer = round(108 * scale)
        fg = Image.new("RGBA", (layer, layer), (0, 0, 0, 0))
        size = round(layer * FG_EMBLEM_RATIO)
        art = emblem(size)
        fg.paste(art, ((layer - size) // 2, (layer - size) // 2), art)
        dout = RES / f"drawable-{density}"
        dout.mkdir(parents=True, exist_ok=True)
        fg.save(dout / "ic_launcher_foreground.png")
        print(f"[launcher] drawable-{density}/ic_launcher_foreground.png ({layer}x{layer})")


def ambulance_icon(size: int) -> Image.Image:
    """Siluet ambulans putih (alpha) untuk smallIcon notifikasi,
    diambil dari play-store/ic_stat.png."""
    src = Image.open(NOTIF_SRC).convert("RGBA")
    box = src.getbbox()
    if box:
        src = src.crop(box)
    # isi lebar kanvas, pertahankan rasio aspek, dan pusatkan vertikal.
    height = max(1, round(size * src.height / src.width))
    art = src.resize((size, height), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(art, (0, (size - height) // 2))
    return canvas


def make_notifications() -> None:
    if not NOTIF_SRC.exists():
        raise SystemExit(f"sumber ikon notifikasi tidak ditemukan: {NOTIF_SRC}")
    for density, scale in DENSITIES.items():
        size = NOTIF_SIZES[density]
        img = ambulance_icon(size)
        out = RES / f"drawable-{density}"
        out.mkdir(parents=True, exist_ok=True)
        img.save(out / "ic_stat_ambulance.png")
        print(f"[notif] drawable-{density}/ic_stat_ambulance.png ({size}x{size})")


def make_splash() -> None:
    for density, scale in DENSITIES.items():
        size = round(SPLASH_DP * scale)
        art = emblem(size)
        out = RES / f"drawable-{density}"
        out.mkdir(parents=True, exist_ok=True)
        art.save(out / "splash_logo.png")
        print(f"[splash] drawable-{density}/splash_logo.png ({size}x{size})")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"sumber ikon tidak ditemukan: {SRC}")

    make_launcher()
    make_notifications()
    make_splash()


def make_launcher() -> None:
    for density, scale in DENSITIES.items():
        # Ikon legacy: 48 dp pada mdpi, isi penuh (emblem sudah bulat).
        legacy = round(48 * scale)
        img = emblem(legacy)
        out = RES / f"mipmap-{density}"
        out.mkdir(parents=True, exist_ok=True)
        img.save(out / "ic_launcher.png")
        img.save(out / "ic_launcher_round.png")
        print(f"[launcher] mipmap-{density}/ic_launcher.png ({legacy}x{legacy})")

        # Lapisan foreground adaptive icon: kanvas 108 dp, emblem di tengah.
        layer = round(108 * scale)
        fg = Image.new("RGBA", (layer, layer), (0, 0, 0, 0))
        size = round(layer * FG_EMBLEM_RATIO)
        art = emblem(size)
        fg.paste(art, ((layer - size) // 2, (layer - size) // 2), art)
        dout = RES / f"drawable-{density}"
        dout.mkdir(parents=True, exist_ok=True)
        fg.save(dout / "ic_launcher_foreground.png")
        print(f"[launcher] drawable-{density}/ic_launcher_foreground.png ({layer}x{layer})")


if __name__ == "__main__":
    main()
