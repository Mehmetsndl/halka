"""Draws Halka's app and tray icons (macOS-style squircle with a segmented ring)."""
import math, sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets'
S = 1024

def squircle_mask(size, inset, n=5.0):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    c = size / 2; a = c - inset
    pts = []
    for i in range(720):
        t = 2 * math.pi * i / 720
        ct, st = math.cos(t), math.sin(t)
        x = c + a * math.copysign(abs(ct) ** (2 / n), ct)
        y = c + a * math.copysign(abs(st) ** (2 / n), st)
        pts.append((x, y))
    d.polygon(pts, fill=255)
    return m

def vgrad(size, top, bottom):
    g = Image.new('RGB', (1, size))
    for y in range(size):
        k = y / (size - 1)
        g.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * k) for i in range(3)))
    return g.resize((size, size))

def ring(size, cx, cy, R, r, n, gap_deg, colors, hot, hot_color):
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    step = 360 / n
    for i in range(n):
        mid = -90 + i * step
        a1, a2 = mid - step / 2 + gap_deg / 2, mid + step / 2 - gap_deg / 2
        pts = []
        for k in range(41):
            a = math.radians(a1 + (a2 - a1) * k / 40)
            pts.append((cx + R * math.cos(a), cy + R * math.sin(a)))
        for k in range(41):
            a = math.radians(a2 - (a2 - a1) * k / 40)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        d.polygon(pts, fill=hot_color if i == hot else colors[i % len(colors)])
    return layer

def app_icon():
    big = S * 2
    mask = squircle_mask(big, big * 0.085)
    base = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    bg = vgrad(big, (255, 255, 255), (226, 229, 238)).convert('RGBA')
    base.paste(bg, (0, 0), mask)
    # soft drop shadow under the squircle
    shadow = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    sm = mask.filter(ImageFilter.GaussianBlur(big * 0.018))
    shadow.paste((0, 0, 0, 70), (0, int(big * 0.012)), sm)
    canvas = Image.alpha_composite(shadow, base)
    c = big / 2
    R, r = big * 0.33, big * 0.17
    seg = ring(big, c, c, R, r, 8, 7, [(10, 132, 255, 255), (64, 156, 255, 255)], 0, (245, 190, 72, 255))
    # subtle inner shadow for depth
    glow = seg.filter(ImageFilter.GaussianBlur(big * 0.012))
    glow = Image.eval(glow.getchannel('A'), lambda v: v * 0.35)
    dark = Image.new('RGBA', (big, big), (8, 40, 110, 0)); dark.putalpha(glow)
    canvas = Image.alpha_composite(canvas, ImageChops.offset(dark, 0, int(big * 0.01)))
    canvas = Image.alpha_composite(canvas, seg)
    d = ImageDraw.Draw(canvas)
    cr = big * 0.105
    d.ellipse([c - cr, c - cr, c + cr, c + cr], fill=(255, 255, 255, 255))
    d.ellipse([c - cr * 0.42, c - cr * 0.42, c + cr * 0.42, c + cr * 0.42], fill=(10, 132, 255, 255))
    return canvas.resize((S, S), Image.LANCZOS)

def tray_icon(size):
    big = size * 8
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    c = big / 2
    seg = ring(big, c, c, big * 0.47, big * 0.25, 8, 10, [(10, 132, 255, 255)], 0, (245, 182, 52, 255))
    img = Image.alpha_composite(img, seg)
    d = ImageDraw.Draw(img)
    cr = big * 0.1
    d.ellipse([c - cr, c - cr, c + cr, c + cr], fill=(10, 132, 255, 255))
    return img.resize((size, size), Image.LANCZOS)

icon = app_icon()
icon.save(f'{OUT}/icon.png')
icon.resize((512, 512), Image.LANCZOS).save(f'{OUT}/icon-512.png')
icon.save(f'{OUT}/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
t32 = tray_icon(64)
t32.resize((32, 32), Image.LANCZOS).save(f'{OUT}/tray.png')
tray_icon(256).save(f'{OUT}/tray.ico', sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64)])
print('icons written')
