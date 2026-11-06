# -*- coding: utf-8 -*-
"""Compare the timing tree written by PowerPoint with animation_spec.json."""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

BASE = Path(__file__).resolve().parent
PPTX = BASE / "output" / "NoldOJ_Evaluation_Report.pptx"
SPEC = BASE / "output" / "animation_spec.json"

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
P = "{%s}" % NS["p"]
A = "{%s}" % NS["a"]


def target_name(par):
    sp = par.find(".//p:spTgt", NS)
    if sp is None:
        return None
    return sp.get("spid")


def shape_names(xml_root):
    """spid -> shape name"""
    m = {}
    for sp in xml_root.iter(P + "sp"):
        nv = sp.find("p:nvSpPr/p:cNvPr", NS)
        if nv is not None:
            m[nv.get("id")] = nv.get("name")
    return m


def as_ms(value):
    if not value or value == "indefinite":
        return 0
    return int(value)


def walk(node, inherited, out, level=0):
    """Collect (absolute_ms, shape_name, duration_ms) for every anim effect."""
    tag = node.tag
    if tag == P + "par" or tag == P + "seq":
        cond = node.find("p:cTn/p:stCondLst/p:cond", NS)
        delay = as_ms(cond.get("delay")) if cond is not None else 0
        # a par's own cTn delay applies once for the group
        ctn = node.find("p:cTn", NS)
        if ctn is not None and ctn.get("nodeType") in ("afterEffect", "withEffect"):
            # per-effect node: delay relative to the enclosing group start
            abs_ms = inherited + delay
            dur = as_ms(ctn.get("dur", "0"))
            tgt = None
            for child in node.iter():
                t = child.find(".//p:spTgt", NS)
                if t is not None:
                    tgt = t.get("spid")
                    break
            out.append((abs_ms, tgt, dur, level))
            return
        for child in node:
            walk(child, inherited + delay, out, level + 1)
    else:
        for child in node:
            walk(child, inherited, out, level + 1)


def main():
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    total_bad = 0
    with zipfile.ZipFile(PPTX) as z:
        for i in range(1, 12):
            raw = z.read(f"ppt/slides/slide{i}.xml")
            root = ET.fromstring(raw)
            names = shape_names(root)
            timing = root.find("p:timing", NS)
            seq = timing.find(".//p:seq", NS) if timing is not None else None
            out = []
            if seq is not None:
                walk(seq, 0, out)
            got = [o for o in out if o[1] is not None]
            want = spec[str(i)]
            print(f"--- slide {i}: xml effects={len(got)} spec effects={len(want)}")
            # map name->spec at
            want_by = {w["shape"]: w for w in want}
            bad = 0
            for abs_ms, spid, dur, _lvl in got:
                nm = names.get(spid, spid)
                w = want_by.get(nm)
                if w is None:
                    print(f"   ? {nm} at {abs_ms}ms (not in spec)")
                    continue
                exp = round(float(w["at"]) * 1000)
                diff = abs_ms - exp
                if abs(diff) > 60:
                    bad += 1
                    if bad <= 12:
                        print(f"   x {nm}: xml={abs_ms}ms spec={exp}ms diff={diff:+d}ms")
            print(f"   mismatches={bad}")
            if bad:
                total_bad += bad
    print(f"\ntotal mismatches: {total_bad}")


if __name__ == "__main__":
    sys.exit(main())
