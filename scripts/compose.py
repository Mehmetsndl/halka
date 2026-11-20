"""Composites transparent overlay captures over a desktop-like wallpaper for review."""
import sys, glob, os
from PIL import Image, ImageDraw, ImageFilter
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
def wallpaper(w, h, dark):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    top, bot = ((40, 52, 92), (18, 20, 34)) if dark else ((128, 170, 230), (236, 196, 210))
    for y in range(h):
        k = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * k) for i in range(3)))
    # a fake app window behind
    win = Image.new('RGBA', (w, h), (0, 0, 0, 0)); wd = ImageDraw.Draw(win)
    wd.rounded_rectangle([140, 90, w - 220, h - 120], 14, fill=(32, 32, 36, 255) if dark else (252, 252, 253, 255))
    for i in range(14):
        wd.rounded_rectangle([190, 160 + i * 34, 190 + (i * 97) % 520 + 260, 176 + i * 34], 6, fill=(70, 70, 78, 255) if dark else (226, 228, 234, 255))
    img = Image.alpha_composite(img.convert('RGBA'), win)
    return img
for path in sorted(glob.glob(os.path.join(src, '*.png'))):
    name = os.path.basename(path)
    if name.startswith('settings') or name == 'toast.png':
        continue
    ov = Image.open(path).convert('RGBA')
    dark = 'dark' in name
    bg = wallpaper(ov.width, ov.height, dark)
    out = Image.alpha_composite(bg, ov)
    out.convert('RGB').save(os.path.join(dst, name))
print('ok')
