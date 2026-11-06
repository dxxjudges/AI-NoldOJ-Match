# -*- coding: utf-8 -*-
"""Inject narration, transitions, timings and entrance animations through PowerPoint COM."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import win32com.client as win32

BASE = Path(__file__).resolve().parent
OUT = BASE / "output"
PPTX = OUT / "NoldOJ_Evaluation_Report.pptx"
PPSX = OUT / "NoldOJ_Evaluation_Report.ppsx"

EFFECTS = {
    "fade": 10,
    "wipe": 22,
    "fly": 2,
    "zoom": 23,
    "rise": 34,
    "grow": 31,
}
DIRECTIONS = {"up": 1, "right": 2, "down": 3, "left": 4}
M = -1  # msoTrue


def main():
    spec = json.loads((OUT / "animation_spec.json").read_text(encoding="utf-8"))
    ameta = json.loads((BASE / "assets" / "audio" / "audio_meta.json").read_text(encoding="utf-8"))
    audio = {int(s["slide"]): s for s in ameta["slides"]}

    app = win32.gencache.EnsureDispatch("PowerPoint.Application")
    try:
        app.DisplayAlerts = 1  # ppAlertsNone
    except Exception:
        pass

    pres = app.Presentations.Open(str(PPTX), WithWindow=False)
    total_effects = 0
    t0 = time.time()
    try:
        for idx, slide in enumerate(pres.Slides, 1):
            meta = audio[idx]
            effect_items = spec[str(idx)]

            # ---- narration media -------------------------------------------------
            med = slide.Shapes.AddMediaObject2(str(Path(meta["audio"]).resolve()), False, True,
                                               -2.2, -2.2, 0.5, 0.5)
            med.Name = f"NARR_{idx:02d}"
            try:
                ps = med.AnimationSettings.PlaySettings
                ps.PlayOnEntry = M
                ps.HideWhileNotPlaying = M
                ps.LoopUntilStopped = 0
                ps.RewindMovie = M
            except Exception as exc:
                print(f"  media settings warn {idx}: {exc}")

            seq = slide.TimeLine.MainSequence
            # AddMediaObject2 creates a click-to-play media effect.  Remove it and
            # create an explicit Play effect that starts automatically.
            if seq.Count > 0:
                try:
                    seq(1).Delete()
                except Exception as exc:
                    print(f"  delete auto media effect warn {idx}: {exc}")

            try:
                play = seq.AddEffect(med, 83, 0, 3, -1)  # MediaPlay / AfterPrevious
                play.Timing.Duration = 0.1
                play.Timing.TriggerDelayTime = 0.0
            except Exception as exc:
                print(f"  media play effect warn {idx}: {exc}")

            # ---- entrance animations -------------------------------------------
            for item in effect_items:
                try:
                    shp = slide.Shapes(item["shape"])
                except Exception:
                    print(f"  missing shape {item['shape']} on slide {idx}")
                    continue
                kind = item.get("effect", "fade")
                eid = EFFECTS.get(kind, 10)
                try:
                    eff = seq.AddEffect(shp, eid, 0, 2, -1)  # WithPrevious
                    eff.Timing.Duration = max(0.1, float(item.get("dur", 0.5)))
                    eff.Timing.TriggerDelayTime = max(0.0, float(item.get("at", 0.0)))
                    if kind == "wipe":
                        d = item.get("direction") or "right"
                        try:
                            eff.EffectParameters.Direction = DIRECTIONS.get(d, 2)
                        except Exception:
                            pass
                    try:
                        eff.Timing.SmoothStart = M
                        eff.Timing.SmoothEnd = M
                    except Exception:
                        pass
                    total_effects += 1
                except Exception as exc:
                    print(f"  anim warn {idx} {item['shape']}: {exc}")

            # ---- transition + auto advance -------------------------------------
            tr = slide.SlideShowTransition
            tr.EntryEffect = 1793  # ppEffectFade
            try:
                tr.Duration = 0.7
            except Exception:
                pass
            tr.AdvanceOnClick = 0
            tr.AdvanceOnTime = M
            tr.AdvanceTime = float(meta["duration"]) + 0.12

            if idx % 2 == 1:
                print(f"slide {idx:02d}: {total_effects} effects, "
                      f"{float(meta['duration']):.1f}s, {time.time()-t0:.0f}s elapsed")

        # ---- kiosk / auto-play show settings ----------------------------------
        ss = pres.SlideShowSettings
        ss.ShowType = 3           # ppShowTypeKiosk
        ss.LoopUntilStopped = M
        ss.AdvanceMode = 2        # ppSlideShowUseSlideTimings
        ss.StartingSlide = 1
        ss.EndingSlide = pres.Slides.Count
        try:
            ss.ShowWithAnimation = M
        except Exception:
            pass
        try:
            ss.ShowWithNarration = M
        except Exception:
            pass

        pres.Save()
        if PPSX.exists():
            PPSX.unlink()
        # 28 = ppSaveAsOpenXMLShow
        pres.SaveAs(str(PPSX), 28)
        print(f"saved\n  {PPTX}\n  {PPSX}")
        print(f"effects={total_effects}, elapsed={time.time()-t0:.1f}s")
    finally:
        try:
            pres.Close()
        except Exception:
            pass
        try:
            app.Quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
