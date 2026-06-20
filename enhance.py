#!/usr/bin/env python3
"""Enhancing de los renders de oficina: denoise + super-resolución + nitidez/realce."""
import os, sys, time
import cv2
import numpy as np
from cv2 import dnn_superres

BASE = "/home/daniel/Documents/stonewell"
RAW = os.path.join(BASE, "office/raw")
FINAL = os.path.join(BASE, "office/final")
os.makedirs(FINAL, exist_ok=True)

# Cargar modelos SR
edsr = dnn_superres.DnnSuperResImpl_create()
edsr.readModel(os.path.join(BASE, "sr_models/EDSR_x3.pb")); edsr.setModel("edsr", 3)
fsrcnn = dnn_superres.DnnSuperResImpl_create()
fsrcnn.readModel(os.path.join(BASE, "sr_models/FSRCNN_x3.pb")); fsrcnn.setModel("fsrcnn", 3)

MAXDIM = 2560  # ancho/alto máximo final

def enhance(name, crop_bottom=0.055, model="edsr", contrast=1.06, sat=1.10, sharp=0.6):
    src = os.path.join(RAW, name + ".png")
    img = cv2.imread(src)
    h, w = img.shape[:2]
    # 1) quitar etiqueta inferior
    if crop_bottom:
        img = img[: int(h * (1 - crop_bottom)), :]
    # 2) denoise suave (quita ruido JPEG antes de ampliar)
    img = cv2.fastNlMeansDenoisingColored(img, None, 3, 3, 7, 21)
    # 3) super-resolución
    t = time.time()
    sr = edsr if model == "edsr" else fsrcnn
    up = sr.upsample(img)
    dt = time.time() - t
    # 4) limitar tamaño
    H, W = up.shape[:2]
    if max(H, W) > MAXDIM:
        s = MAXDIM / max(H, W)
        up = cv2.resize(up, (int(W*s), int(H*s)), interpolation=cv2.INTER_AREA)
    # 5) realce: contraste + saturación
    up = cv2.convertScaleAbs(up, alpha=contrast, beta=-6)
    hsv = cv2.cvtColor(up, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * sat, 0, 255)
    up = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    # 6) unsharp mask
    blur = cv2.GaussianBlur(up, (0, 0), 2.2)
    up = cv2.addWeighted(up, 1 + sharp, blur, -sharp, 0)
    out = os.path.join(FINAL, name + ".jpg")
    cv2.imwrite(out, up, [cv2.IMWRITE_JPEG_QUALITY, 86])
    print(f"  {name:18} {w}x{h} -> {up.shape[1]}x{up.shape[0]}  SR {dt:4.1f}s  {os.path.getsize(out)/1024:.0f}KB", flush=True)

if __name__ == "__main__":
    jobs = sys.argv[1:] or ["exec-office"]
    for j in jobs:
        enhance(j)
    print("OK")
