#!/usr/bin/env python3
"""Generate Hearthnote icons for PWA + store packaging."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (10, 20, 36, 255)
NAVY = (30, 58, 95, 255)
FOAM = (232, 238, 246, 255)
SKY = (123, 168, 220, 255)
AMBER = (240, 179, 90, 255)


def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = size * 0.12
    d.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=size * 0.22,
        fill=NAVY,
    )
    # mic body
    cx, cy = size / 2, size / 2 - size * 0.04
    rw, rh = size * 0.11, size * 0.18
    d.rounded_rectangle(
        [cx - rw, cy - rh, cx + rw, cy + rh],
        radius=rw,
        fill=FOAM,
    )
    # mic stand
    stroke = max(2, int(size * 0.035))
    d.arc(
        [cx - size * 0.18, cy - size * 0.02, cx + size * 0.18, cy + size * 0.28],
        start=0,
        end=180,
        fill=SKY,
        width=stroke,
    )
    d.line([(cx, cy + size * 0.28), (cx, cy + size * 0.36)], fill=SKY, width=stroke)
    d.line(
        [(cx - size * 0.1, cy + size * 0.36), (cx + size * 0.1, cy + size * 0.36)],
        fill=AMBER,
        width=stroke,
    )
    return img


SIZES = [48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512]
for s in SIZES:
    make_icon(s).save(OUT / f"icon-{s}.png")

# maskable (more padding)
mask = make_icon(512)
canvas = Image.new("RGBA", (512, 512), BG)
inner = mask.resize((410, 410), Image.Resampling.LANCZOS)
canvas.paste(inner, (51, 51), inner)
canvas.save(OUT / "maskable-512.png")

# favicon
make_icon(64).save(OUT / "favicon.png")
print(f"Wrote icons to {OUT}")
