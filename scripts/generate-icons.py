#!/usr/bin/env python3
"""Draw simple SummitLog mountain icons. No third-party image library."""

import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")

BG = (11, 17, 32, 255)
BACK = (30, 64, 140, 255)
FRONT = (59, 130, 246, 255)
SNOW = (241, 245, 249, 255)
SUN = (147, 197, 253, 255)


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, width, height, pixels):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride:(y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def inside(x, y, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    point = (x, y)
    b1 = sign(point, a, b) < 0
    b2 = sign(point, b, c) < 0
    b3 = sign(point, c, a) < 0
    return b1 == b2 == b3


def scene(x, y, pad):
    span = 1 - 2 * pad
    cx = (x - pad) / span
    cy = (y - pad) / span
    if cx < 0 or cy < 0 or cx > 1 or cy > 1:
        return BG
    color = BG
    if (cx - 0.22) ** 2 + (cy - 0.24) ** 2 <= 0.055 ** 2:
        color = SUN
    if inside(cx, cy, (0.02, 0.80), (0.36, 0.40), (0.64, 0.80)):
        color = BACK
    if inside(cx, cy, (0.22, 0.84), (0.58, 0.28), (0.96, 0.84)):
        color = FRONT
    if inside(cx, cy, (0.50, 0.40), (0.58, 0.28), (0.66, 0.40)):
        color = SNOW
    return color


def render(size, pad):
    pixels = bytearray(size * size * 4)
    samples = 2
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(samples):
                for sx in range(samples):
                    nx = (x + (sx + 0.5) / samples) / size
                    ny = (y + (sy + 0.5) / samples) / size
                    color = scene(nx, ny, pad)
                    for i in range(4):
                        acc[i] += color[i]
            base = (y * size + x) * 4
            count = samples * samples
            for i in range(4):
                pixels[base + i] = acc[i] // count
    return pixels


def png_bytes(width, height, pixels):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride:(y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def write_ico(path, images):
    # images: list of (size, png_bytes). PNG-compressed ICO entries.
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = b""
    blobs = b""
    for size, blob in images:
        entries += struct.pack("<BBBBHHII", size if size < 256 else 0, size if size < 256 else 0, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
        blobs += blob
    with open(path, "wb") as handle:
        handle.write(header + entries + blobs)


def main():
    os.makedirs(OUT, exist_ok=True)
    icons = [
        ("icon-192.png", 192, 0.04),
        ("icon-512.png", 512, 0.04),
        ("icon-maskable-512.png", 512, 0.16),
        ("apple-touch-icon.png", 180, 0.06),
    ]
    for name, size, pad in icons:
        write_png(os.path.join(OUT, name), size, size, render(size, pad))
        print(name)
    ico_images = []
    for size in (16, 32):
        ico_images.append((size, png_bytes(size, size, render(size, 0.08))))
    write_ico(os.path.join(ROOT, "favicon.ico"), ico_images)
    print("favicon.ico")


if __name__ == "__main__":
    main()
