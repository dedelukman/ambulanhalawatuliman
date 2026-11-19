"""make-launcher-icons.py — membuat ikon launcher Android dari emblem
play-store/icon-512.png (sumber kebenaran ikon aplikasi).

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

from PIL import Image, ImageDraw

APP = Path(__file__).resolve().parent.parent
SRC = APP / "play-store" / "icon-512.png"
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
    """Siluet ambulans putih (alpha) untuk smallIcon notifikasi."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = size
    def r(x0, y0, x1, y1):
        return (int(x0 * w), int(y0 * w), int(x1 * w), int(y1 * w))
    # badan
    d.rounded_rectangle(r(0.06, 0.30, 0.94, 0.72), radius=int(w * 0.06), fill=(255, 255, 255, 255))
    # kabin depan (lebih tinggi)
    d.rounded_rectangle(r(0.62, 0.20, 0.94, 0.72), radius=int(w * 0.06), fill=(255, 255, 255, 255))
    # lampu rotator
    d.rounded_rectangle(r(0.66, 0.12, 0.80, 0.22), radius=int(w * 0.03), fill=(255, 255, 255, 255))
    # palang di samping
    d.rectangle(r(0.16, 0.38, 0.26, 0.64), fill=(255, 255, 255, 255))
    d.rectangle(r(0.10, 0.46, 0.32, 0.56), fill=(255, 255, 255, 255))
    # roda
    for cx, cy in ((0.24, 0.78), (0.78, 0.78)):
        d.ellipse(r(cx - 0.09, cy - 0.09, cx + 0.09, cy + 0.09), fill=(255, 255, 255, 255))
    # lubang roda (transparan)
    for cx, cy in ((0.24, 0.78), (0.78, 0.78)):
        d.ellipse(r(cx - 0.045, cy - 0.045, cx + 0.045, cy + 0.045), fill=(0, 0, 0, 0))
    return img


def make_notifications() -> None:
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
