"""Draw original cloud layers with deterministic, multi-scale density fields."""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "apps/web/src/sky"
WIDTH, HEIGHT = 1600, 860


def noise(width, height, random):
    detail = np.zeros((height, width), dtype=np.float32)
    for frequency, amplitude in [(4, .58), (8, .32), (16, .20), (32, .11),
                                 (64, .07), (128, .045), (240, .025)]:
        shape = (max(3, int(frequency * height / width)), frequency)
        grid = Image.fromarray(random.random(shape, dtype=np.float32))
        sample = np.asarray(grid.resize((width, height), Image.Resampling.BICUBIC))
        detail += (sample - .5) * amplitude
    return detail


def cloud(width, height, seed, opacity):
    random = np.random.default_rng(seed)
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    x, y = x / width, y / height
    envelope = np.full_like(x, -1)
    for index in range(11):
        tip = .14 + .072 * index
        peak = .55 - .23 * np.sin(np.pi * index / 10) + random.uniform(-.09, .09)
        radius_x = random.uniform(.11, .19)
        radius_y = random.uniform(.22, .35)
        lobe = 1 - np.sqrt(((x - tip) / radius_x)**2 + ((y - peak) / radius_y)**2)
        envelope = np.maximum(envelope, lobe)
    detail = noise(width, height, random)
    volume = envelope + 1.35 * detail
    alpha = np.clip((volume + .12) / .26, 0, 1) * np.clip((1 - y) * 6, 0, 1)
    alpha *= np.clip(np.minimum(x, 1 - x) * 28, 0, 1)
    alpha *= np.clip(y * 15, 0, 1)
    shade = np.clip(.24 + y * .66 + detail * .72 + np.maximum(volume, 0) * .12, 0, 1)
    shade -= np.clip((.16 - volume) * 1.5, 0, .18)
    pixels = np.stack([255 - shade * 77, 255 - shade * 57, 255 - shade * 24,
                       alpha * 255 * opacity], axis=-1)
    return Image.fromarray(np.uint8(np.clip(pixels, 0, 255)))


def paint(name, forms):
    canvas = Image.new("RGBA", (WIDTH, HEIGHT))
    for seed, (x, y, width, height, opacity, angle) in enumerate(forms, 173):
        shape = cloud(width, height, seed, opacity)
        if angle:
            shape = shape.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
        canvas.alpha_composite(shape, (x, y))
    canvas.save(OUT / f"clouds-{name}.webp", method=6, quality=84)


paint("landing", [
    (-86, 580, 490, 240, .9, -12), (756, 602, 360, 224, .96, 9),
    (-70, 736, 220, 142, .77, 3), (585, 768, 200, 106, .76, 10),
    (679, 716, 83, 61, .9, -9), (1180, 775, 170, 86, .72, -8),
    (1517, 553, 184, 201, .8, 12),
])
paint("desktop", [
    (-324, -220, 897, 430, .96, 72), (-390, -3, 895, 420, .96, 57),
    (535, -290, 768, 408, .91, 47), (752, -180, 384, 240, .89, 59),
    (1004, 414, 115, 79, .65, 10), (1510, 524, 255, 139, .78, 10),
    (920, 740, 262, 128, .71, -9), (-120, 745, 700, 215, .87, 9),
])
paint("quiet", [
    (16, 394, 725, 228, .83, -4), (-84, 522, 1420, 328, .89, -4),
])
