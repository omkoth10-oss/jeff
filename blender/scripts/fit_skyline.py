"""Searches offsets of the mountain noise for the skyline that best matches the
main reference, as seen from the default camera. Run inside Blender; prints the
best MOUNTAIN_SHIFT to paste into terrain_lib.py."""
import sys, os, importlib
import numpy as np
sys.path.insert(0, os.path.expanduser("~/moonlit-village/blender/scripts"))
import terrain_lib as T
importlib.reload(T)

CAM = np.array([1.5, 52.3, 3.3])
PITCH = np.radians(-16)
T25 = np.tan(np.radians(25))
# skyline row (in the 1536x1024 reference) per pixel column, read off the main reference
REF_SKY = {150: 60, 250: 40, 350: 30, 450: 35, 550: 90, 650: 110, 750: 160, 850: 175, 950: 150,
           1050: 110, 1110: 80, 1200: 110, 1300: 125, 1400: 135, 1500: 150}
RS = np.linspace(150, 5200, 900)


def skyline_rows():
    rows = {}
    for px, _ in REF_SKY.items():
        th = np.arctan((px / 768 - 1) * T25 * 1.5 / np.cos(PITCH))
        x = CAM[0] + np.sin(th) * RS
        z = CAM[2] - np.cos(th) * RS
        h, _ = T.height(x, z)
        el = np.arctan((h - CAM[1]) / RS).max()
        d = np.array([np.sin(th) * np.cos(el), np.sin(el), -np.cos(th) * np.cos(el)])
        c, s = np.cos(-PITCH), np.sin(-PITCH)
        vy, vz = d[1] * c - d[2] * s, d[1] * s + d[2] * c
        rows[px] = (1 - vy / -vz / T25) / 2 * 1024
    return rows


def error(rows):
    return float(np.mean([abs(rows[k] - v) for k, v in REF_SKY.items()]))


def search(candidates):
    best = None
    for shift in candidates:
        T.MOUNTAIN_SHIFT = shift
        e = error(skyline_rows())
        if best is None or e < best[0]:
            best = (e, shift)
    return best


rng = np.random.default_rng(3)
coarse = [(float(x), float(z)) for x, z in rng.uniform(-6000, 6000, (80, 2))]
e, shift = search([(0.0, 0.0)] + coarse)
fine = [(shift[0] + dx, shift[1] + dz) for dx in (-300, -150, 0, 150, 300) for dz in (-300, -150, 0, 150, 300)]
e, shift = search(fine)
T.MOUNTAIN_SHIFT = shift
rows = skyline_rows()
print(f"best MOUNTAIN_SHIFT = ({shift[0]:.0f}, {shift[1]:.0f})  mean error {e:.1f} px")
print("  ".join(f"{k}:{rows[k]:.0f}/{v}" for k, v in REF_SKY.items()))
