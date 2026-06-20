#!/usr/bin/env python3
"""Re-vectoriza los logos con una rampa de oro BRONCE (más profundo)."""
import os
import numpy as np
from PIL import Image
import vtracer, cairosvg

BASE = "/home/daniel/Documents/stonewell"
EXTRACT = os.path.join(BASE, "extract")
OUT = os.path.join(BASE, "logos")
TMP = os.path.join(OUT, "_prepped")
QC  = os.path.join(OUT, "previews")
for d in (OUT, TMP, QC):
    os.makedirs(d, exist_ok=True)

# ---- Paleta destino (bronce profundo) ----
NAVY = (12, 41, 66)          # #0C2942  navy real del logo

GOLD_RAMP_FULL = [           # metálico: sombra bronce -> dorado medio
    (104, 73, 36),           # #684924  bronce sombra profunda
    (138, 96, 46),           # #8A602E  bronce
    (166, 119, 56),          # #A67738  oro antiguo (tono principal)
    (190, 142, 70),          # #BE8E46  oro
    (214, 170, 98),          # #D6AA62  oro claro (brillo, NO amarillo pálido)
]
GOLD_RAMP_FLAT = [           # plano web: 3 tonos
    (138, 96, 46),           # #8A602E  bronce sombra
    (168, 120, 58),          # #A8783A  bronce-oro principal
    (200, 152, 80),          # #C89850  oro claro
]
GOLD_2COLOR = [(168, 120, 58)]   # #A8783A  un solo bronce-oro

def remap(in_path, out_path, gold_ramp, navy=NAVY,
          white_to_alpha=True, white_thresh=232, pad=12):
    """Mapea pixeles cálidos -> rampa de oro, fríos/oscuros -> navy, claros -> alpha."""
    img = Image.open(in_path).convert("RGBA")
    arr = np.asarray(img).astype(int)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    out = arr.copy()

    white = white_to_alpha & (r >= white_thresh) & (g >= white_thresh) & (b >= white_thresh)
    warm = (r > b + 8) & (~white)          # dorados (cálidos)
    cool = (~warm) & (~white)              # navy / oscuros

    # navy
    out[cool, 0], out[cool, 1], out[cool, 2], out[cool, 3] = navy[0], navy[1], navy[2], 255

    # oro: elegir tono por luminancia
    lum = (0.299 * r + 0.587 * g + 0.114 * b)
    ramp = np.array(gold_ramp)
    ramp_lum = ramp @ np.array([0.299, 0.587, 0.114])
    lo, hi = 70.0, 210.0                   # rango de luminancia del oro a mapear
    t = np.clip((lum - lo) / (hi - lo), 0, 1)
    idx = np.round(t * (len(ramp) - 1)).astype(int)
    idx = np.clip(idx, 0, len(ramp) - 1)
    wr, wg, wb = ramp[:, 0][idx], ramp[:, 1][idx], ramp[:, 2][idx]
    out[..., 0] = np.where(warm, wr, out[..., 0])
    out[..., 1] = np.where(warm, wg, out[..., 1])
    out[..., 2] = np.where(warm, wb, out[..., 2])
    out[warm, 3] = 255

    if white_to_alpha:
        out[white, 3] = 0

    res = Image.fromarray(out.astype(np.uint8), "RGBA")
    bbox = res.getbbox()
    if bbox:
        l, tt, rr, bb = bbox
        w, h = res.size
        res = res.crop((max(0, l-pad), max(0, tt-pad), min(w, rr+pad), min(h, bb+pad)))
    res.save(out_path)
    return out_path

def vec(src, dst, flat=False):
    p = dict(colormode="color", hierarchical="stacked", mode="spline",
             corner_threshold=58, length_threshold=4.0, max_iterations=10,
             splice_threshold=45)
    if flat:
        p.update(filter_speckle=20, color_precision=8, layer_difference=24, path_precision=4)
    else:
        p.update(filter_speckle=8, color_precision=8, layer_difference=14, path_precision=6)
    vtracer.convert_image_to_svg_py(src, dst, **p)

# name, source, ramp, flat?, white->alpha?
JOBS = [
    ("stonewell-logo-primary",      "img-053.png", GOLD_RAMP_FULL, False, True),
    ("stonewell-logo-primary-flat", "img-053.png", GOLD_RAMP_FLAT, True,  True),
    ("stonewell-logo-alt",          "img-015.png", GOLD_RAMP_FLAT, True,  True),
    ("stonewell-shield",            "img-049.png", GOLD_RAMP_FULL, False, True),
    ("stonewell-shield-flat",       "img-049.png", GOLD_RAMP_FLAT, True,  True),
    ("stonewell-shield-2color",     "img-049.png", GOLD_2COLOR,    True,  True),
    ("stonewell-badge-tagline",     "img-017.png", GOLD_RAMP_FULL, False, False),
]

for name, src_name, ramp, flat, w2a in JOBS:
    src = os.path.join(EXTRACT, src_name)
    prepped = os.path.join(TMP, name + ".png")
    svg = os.path.join(OUT, name + ".svg")
    qcpng = os.path.join(QC, name + ".png")
    remap(src, prepped, ramp, white_to_alpha=w2a)
    vec(prepped, svg, flat=flat)
    cairosvg.svg2png(url=svg, write_to=qcpng, output_width=520)
    print(f"{name:30} {os.path.getsize(svg)/1024:6.0f} KB", flush=True)

print("BRONZE DONE")
