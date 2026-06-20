#!/usr/bin/env python3
import os
from playwright.sync_api import sync_playwright

OUT = "/home/daniel/Documents/stonewell/shots"
os.makedirs(OUT, exist_ok=True)
URL = "http://localhost:8000/index.html"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1200)

    # Hero (above the fold)
    pg.screenshot(path=f"{OUT}/01-hero.png")

    # Secciones individuales
    for sid, name in [("firm","02-firm"),("services","03-services"),
                      ("industries","04-industries"),("approach","05-approach"),
                      ("contact","06-contact")]:
        el = pg.query_selector(f"#{sid}")
        if el:
            el.scroll_into_view_if_needed()
            pg.wait_for_timeout(700)
            el.screenshot(path=f"{OUT}/{name}.png")

    # Página completa
    pg.screenshot(path=f"{OUT}/00-full.png", full_page=True)
    b.close()
print("SHOTS OK")
