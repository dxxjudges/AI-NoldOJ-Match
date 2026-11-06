# -*- coding: utf-8 -*-
"""Live slideshow test with retries around busy COM calls."""
import time
from pathlib import Path
import win32com.client as win32

BASE = Path(__file__).resolve().parent
META = __import__("json").loads((BASE / "assets" / "audio" / "audio_meta.json").read_text(encoding="utf-8"))
DUR = {int(s["slide"]): float(s["duration"]) for s in META["slides"]}

app = win32.gencache.EnsureDispatch("PowerPoint.Application")
app.Visible = True
pres = app.Presentations.Open(str(BASE / "output" / "NoldOJ_Evaluation_Report.pptx"), WithWindow=True)
w = pres.SlideShowSettings.Run()


def read_pos():
    for _ in range(120):
        try:
            return int(w.View.CurrentShowPosition)
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("COM stayed busy")


pos = read_pos()
while pos == 0:
    time.sleep(0.2)
    pos = read_pos()
t0 = time.time()
print(f"first visible slide={pos} at t0", flush=True)
last = pos
stamps = {pos: 0.0}
try:
    while time.time() - t0 < 75:
        time.sleep(0.2)
        p = read_pos()
        if p != last and p > 0:
            t = time.time() - t0
            stamps[p] = t
            prev_dur = DUR.get(last, 0) + 0.12
            print(f"{t:6.2f}s -> slide {p:02d}   prev shown {t - stamps.get(last, 0):6.2f}s "
                  f"(expected {prev_dur:6.2f}s)", flush=True)
            last = p
        if last >= 4:
            break
finally:
    for _ in range(40):
        try:
            w.View.Exit()
            break
        except Exception:
            time.sleep(0.25)
    time.sleep(1)
    try:
        pres.Close()
    except Exception:
        pass
    app.Quit()
print("stamps:", {k: round(v, 2) for k, v in stamps.items()})
