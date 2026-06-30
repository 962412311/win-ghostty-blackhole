#!/usr/bin/env python3
"""Capture the Windows virtual desktop to a PNG using Win32 GDI."""

from __future__ import annotations

import ctypes
import struct
import sys
import zlib
from ctypes import wintypes


SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79
SRCCOPY = 0x00CC0020
DIB_RGB_COLORS = 0


class BitmapInfoHeader(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


def check(value: int, name: str) -> int:
    if not value:
        raise ctypes.WinError(ctypes.get_last_error(), name)
    return value


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload)) +
        kind +
        payload +
        struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def write_png(path: str, width: int, height: int, bgra: bytes) -> None:
    rows = []
    stride = width * 4
    for y in range(height):
        src = memoryview(bgra)[y * stride:(y + 1) * stride]
        row = bytearray(1 + width * 3)
        out = 1
        for x in range(0, len(src), 4):
            row[out] = src[x + 2]
            row[out + 1] = src[x + 1]
            row[out + 2] = src[x]
            out += 3
        rows.append(bytes(row))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(png_chunk(b"IHDR", ihdr))
        f.write(png_chunk(b"IDAT", zlib.compress(b"".join(rows), 6)))
        f.write(png_chunk(b"IEND", b""))


def write_bmp(path: str, width: int, height: int, bgra: bytes) -> None:
    dib_header = struct.pack(
        "<IiiHHIIiiII",
        40,
        width,
        -height,
        1,
        32,
        0,
        len(bgra),
        0,
        0,
        0,
        0,
    )
    file_header = b"BM" + struct.pack("<IHHI", 14 + len(dib_header) + len(bgra), 0, 0, 54)
    with open(path, "wb") as f:
        f.write(file_header)
        f.write(dib_header)
        f.write(bgra)


def capture(path: str) -> None:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

    x = user32.GetSystemMetrics(SM_XVIRTUALSCREEN)
    y = user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
    width = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)
    height = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)
    if width <= 0 or height <= 0:
        raise RuntimeError(f"invalid desktop size: {width}x{height}")

    screen_dc = check(user32.GetDC(None), "GetDC")
    memory_dc = check(gdi32.CreateCompatibleDC(screen_dc), "CreateCompatibleDC")
    bitmap = check(gdi32.CreateCompatibleBitmap(screen_dc, width, height), "CreateCompatibleBitmap")
    old = check(gdi32.SelectObject(memory_dc, bitmap), "SelectObject")

    try:
        check(gdi32.BitBlt(memory_dc, 0, 0, width, height, screen_dc, x, y, SRCCOPY), "BitBlt")

        header = BitmapInfoHeader()
        header.biSize = ctypes.sizeof(BitmapInfoHeader)
        header.biWidth = width
        header.biHeight = -height
        header.biPlanes = 1
        header.biBitCount = 32
        header.biCompression = 0
        header.biSizeImage = width * height * 4

        pixels = ctypes.create_string_buffer(header.biSizeImage)
        lines = gdi32.GetDIBits(
            memory_dc,
            bitmap,
            0,
            height,
            pixels,
            ctypes.byref(header),
            DIB_RGB_COLORS,
        )
        if lines != height:
            raise ctypes.WinError(ctypes.get_last_error(), "GetDIBits")

        if path.lower().endswith(".bmp"):
            write_bmp(path, width, height, pixels.raw)
        else:
            write_png(path, width, height, pixels.raw)
    finally:
        gdi32.SelectObject(memory_dc, old)
        gdi32.DeleteObject(bitmap)
        gdi32.DeleteDC(memory_dc)
        user32.ReleaseDC(None, screen_dc)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: win_capture.py OUTPUT.png", file=sys.stderr)
        return 2
    capture(argv[1])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
