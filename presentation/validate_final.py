# -*- coding: utf-8 -*-
"""Final deliverable checks."""
from __future__ import annotations

import json
import re
import wave
import zipfile
from pathlib import Path

from pptx import Presentation

BASE = Path(__file__).resolve().parent
OUT = BASE / "output"
PPTX = OUT / "NoldOJ_Evaluation_Report.pptx"
PPSX = OUT / "NoldOJ_Evaluation_Report.ppsx"
META = json.loads((BASE / "assets" / "audio" / "audio_meta.json").read_text(encoding="utf-8"))
DURS = {int(s["slide"]): float(s["duration"]) for s in META["slides"]}

prs = Presentation(str(PPTX))
print(f"pptx slides={len(prs.slides)}  size={prs.slide_width/914400:.2f}x{prs.slide_height/914400:.2f} in")

# shape bounds
issues = 0
for i, slide in enumerate(prs.slides, 1):
    for shp in slide.shapes:
        if shp.left is None or shp.top is None:
            continue
        if shp.left < -9144 or shp.top < -9144:
            if not shp.name.startswith(("NARR", "Picture", "Audio")):
                print(f"  slide {i}: {shp.name} off-canvas at ({shp.left}, {shp.top})")
                issues += 1
        right = shp.left + (shp.width or 0)
        bottom = shp.top + (shp.height or 0)
        if right > prs.slide_width + 9144 or bottom > prs.slide_height + 9144:
            print(f"  slide {i}: {shp.name} exceeds canvas")
            issues += 1
print(f"canvas issues: {issues}")

with zipfile.ZipFile(PPTX) as z:
    for i in range(1, 12):
        x = z.read(f"ppt/slides/slide{i}.xml").decode("utf-8")
        media = z.read(f"ppt/slides/_rels/slide{i}.xml.rels").decode("utf-8")
        wavs = [l for l in media.splitlines() if ".wav" in l]
        adv = int(re.search(r'advTm="(\d+)"', x).group(1))
        clicks = len(re.findall(r'evt="onClick"', x))
        audio_tags = x.count("<p:audio")
        print(f"slide {i:02d}: wav_rel={len(wavs)} audio_tag={audio_tags} "
              f"onClick={clicks} advTm={adv/1000:.2f}s audio={DURS[i]:.2f}s")

print("\naudio durations:")
for i in range(1, 12):
    p = BASE / "assets" / "audio" / f"slide{i:02d}.wav"
    with wave.open(str(p)) as w:
        d = w.getnframes() / w.getframerate()
    print(f"  {p.name}: {d:6.2f}s   meta {DURS[i]:6.2f}s   diff {d - DURS[i]:+.3f}s")

with zipfile.ZipFile(PPSX) as z:
    names = z.namelist()
    slides = len([n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)])
print(f"\nppsx slides={slides}  bytes={PPSX.stat().st_size/1048576:.1f} MB")
