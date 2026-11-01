"""Generate PWA icons, apple-touch-icon and iOS splash screens (needs Pillow).

    python scripts/generate_assets.py

The PNGs are committed to public/, so this only needs re-running when the brand mark changes.
"""

from pathlib import Path

from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"
BG = (11, 13, 18)
TOP = (129, 140, 248)
BOTTOM = (67, 56, 202)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            px[x, y] = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
    return img


def mark(size: int, safe: float = 1.0, rounded: bool = True) -> Image.Image:
    """Brand mark: indigo tile with three ascending bars."""
    scale = 4  # supersample for smooth edges
    s = size * scale
    tile = gradient(s // 4).resize((s, s), Image.BICUBIC).convert("RGBA")
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s, s), radius=int(s * 0.22) if rounded else 0, fill=255)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(tile, (0, 0), mask)
    d = ImageDraw.Draw(out)
    unit = s / 64 * safe
    off = (s - 64 * unit) / 2
    for x, y, h, a in ((14, 34, 16, 190), (27.5, 24, 26, 230), (41, 14, 36, 255)):
        d.rounded_rectangle(
            (off + x * unit, off + y * unit, off + (x + 9) * unit, off + (y + h) * unit), radius=int(3 * unit), fill=(255, 255, 255, a)
        )
    return out.resize((size, size), Image.LANCZOS)


def splash(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h), BG)
    icon_size = int(min(w, h) * 0.22)
    icon = mark(icon_size)
    img.paste(icon, ((w - icon_size) // 2, (h - icon_size) // 2), icon)
    return img


def main() -> None:
    (PUBLIC / "icons").mkdir(parents=True, exist_ok=True)
    (PUBLIC / "splash").mkdir(parents=True, exist_ok=True)
    mark(192).save(PUBLIC / "icons" / "icon-192.png")
    mark(512).save(PUBLIC / "icons" / "icon-512.png")
    maskable = Image.new("RGBA", (512, 512), BOTTOM + (255,))
    maskable.paste(mark(512, safe=0.7, rounded=False), (0, 0))
    maskable.save(PUBLIC / "icons" / "icon-maskable-512.png")
    # iOS ignores transparency on touch icons: render on a solid square
    touch = mark(180, rounded=False)
    touch.convert("RGB").save(PUBLIC / "apple-touch-icon.png")
    for w, h in ((1179, 2556), (1242, 2208), (750, 1334)):
        splash(w, h).save(PUBLIC / "splash" / f"splash-{w}x{h}.png", optimize=True)
    print("assets written to", PUBLIC)


if __name__ == "__main__":
    main()
