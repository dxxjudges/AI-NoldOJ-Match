# -*- coding: utf-8 -*-
"""Shared theme + python-pptx drawing helpers for the NoldOJ report deck."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt
from lxml import etree

# ---------------------------------------------------------------------------
# canvas / palette
# ---------------------------------------------------------------------------
W, H = 13.333, 7.5
M = 0.72
TOTAL_SLIDES = 11

FONT = "Microsoft YaHei UI"
FONT_CN = "Microsoft YaHei"
FONT_NUM = "Bahnschrift"
FONT_MONO = "Cascadia Mono"

INK = "EEF3FF"
MUTED = "8B9AB3"
DIM = "5E6F89"
LINE = "24324A"
CARD = "0C1422"
CARD_2 = "101A2C"
BG1 = "05080F"
BG2 = "0B1324"

CYAN = "3DE1FF"
BLUE = "5B8CFF"
AMBER = "FFB547"
VIOLET = "B388FF"
GREEN = "42E8A6"
RED = "FF6B81"
PINK = "FF7AB6"

MODELS = [
    dict(
        key="deepseek", name="DeepSeek-V4.1-Flash", short="DeepSeek", tag="体系派",
        color=BLUE, glow="5B8CFF", total=28.0, dims=(9.5, 9.0, 9.5),
        routes=21, tests="3 个测试文件", arch="ESM + node:http + node:sqlite",
        doc="README + AGENTS + docs", risk="低", risk_color=GREEN,
        quote="最接近可直接交付的成品", medal="01",
    ),
    dict(
        key="mimo", name="MiMo-V2.6-Flash", short="MiMo", tag="均衡派",
        color=AMBER, glow="FFB547", total=26.3, dims=(9.0, 8.5, 8.8),
        routes=19, tests="4 个测试文件", arch="CommonJS · routes / services / ws",
        doc="详尽 README + OpenAPI 3.0", risk="中低", risk_color=AMBER,
        quote="均衡务实，功能铺得最广", medal="02",
    ),
    dict(
        key="glm", name="GLM-5.3-Flash", short="GLM", tag="硬核派",
        color=VIOLET, glow="B388FF", total=23.5, dims=(8.5, 7.0, 8.0),
        routes=13, tests="1 个测试入口", arch="扁平结构 · PowerShell + C#",
        doc="中文 README · 沙箱原理深入", risk="中高", risk_color=RED,
        quote="技术深度突出，工程化拖后腿", medal="03",
    ),
]


def rgb(hex_str: str) -> RGBColor:
    hex_str = hex_str.strip().lstrip("#")
    return RGBColor(int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16))


def _alpha_el(parent, alpha: float):
    el = etree.SubElement(parent, qn("a:alpha"))
    el.set("val", str(int(max(0.0, min(1.0, alpha)) * 100000)))
    return el


def fill_alpha(shape, alpha: float):
    """Set opacity of an existing solid fill (0..1)."""
    solid = shape.fill._xPr.find(qn("a:solidFill"))
    if solid is None:
        return
    clr = solid[0]
    for old in clr.findall(qn("a:alpha")):
        clr.remove(old)
    _alpha_el(clr, alpha)


def line_alpha(shape, alpha: float):
    ln = shape.line._get_or_add_ln()
    solid = ln.find(qn("a:solidFill"))
    if solid is None:
        return
    clr = solid[0]
    for old in clr.findall(qn("a:alpha")):
        clr.remove(old)
    _alpha_el(clr, alpha)


def run_alpha(run, alpha: float):
    rPr = run._r.get_or_add_rPr()
    solid = rPr.find(qn("a:solidFill"))
    if solid is None:
        return
    clr = solid[0]
    for old in clr.findall(qn("a:alpha")):
        clr.remove(old)
    _alpha_el(clr, alpha)


def add_shadow(shape, blur=18, dist=7, direction=5400000, alpha=0.38, color="000000"):
    spPr = shape._element.spPr
    effectLst = spPr.find(qn("a:effectLst"))
    if effectLst is None:
        effectLst = etree.SubElement(spPr, qn("a:effectLst"))
    shdw = etree.SubElement(effectLst, qn("a:outerShdw"))
    shdw.set("blurRad", str(int(blur * 12700)))
    shdw.set("dist", str(int(dist * 12700)))
    shdw.set("dir", str(direction))
    shdw.set("algn", "ctr")
    shdw.set("rotWithShape", "0")
    clr = etree.SubElement(shdw, qn("a:srgbClr"))
    clr.set("val", color)
    _alpha_el(clr, alpha)


def add_soft_edge(shape, radius=18):
    spPr = shape._element.spPr
    effectLst = spPr.find(qn("a:effectLst"))
    if effectLst is None:
        effectLst = etree.SubElement(spPr, qn("a:effectLst"))
    soft = etree.SubElement(effectLst, qn("a:softEdge"))
    soft.set("rad", str(int(radius * 12700)))


def _set_font(run, font: str):
    run.font.name = font
    rPr = run._r.get_or_add_rPr()
    latin = rPr.find(qn("a:latin"))
    for tag in ("a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = etree.Element(qn(tag))
            if latin is not None:
                latin.addnext(el)
            else:
                rPr.append(el)
        el.set("typeface", font)


@dataclass
class Anim:
    """Collects shape -> entrance effect specifications for one slide."""
    slide_no: int
    items: list[dict] = field(default_factory=list)
    _n: int = 0

    def mark(self, shape, at: float, effect: str = "fade", dur: float = 0.5,
             direction: str | None = None, trigger: str | None = None):
        self._n += 1
        name = f"A{self.slide_no:02d}_{self._n:02d}"
        shape.name = name
        self.items.append(dict(shape=name, at=round(at, 3), effect=effect,
                               dur=round(dur, 3), direction=direction,
                               trigger=trigger))
        return shape

    def to_dict(self):
        return self.items


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------
def rect(slide, x, y, w, h, fill=None, line=None, lw=1.0, radius=None,
         alpha=None, line_alpha_v=None, name=None, dash=None, shadow=False):
    shape_type = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    shp = slide.shapes.add_shape(shape_type, Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        shp.name = name
    if radius:
        shp.adjustments[0] = max(0.0, min(0.5, radius / max(0.001, min(w, h))))
    if fill:
        shp.fill.solid()
        shp.fill.fore_color.rgb = rgb(fill)
        if alpha is not None:
            fill_alpha(shp, alpha)
    else:
        shp.fill.background()
    if line:
        shp.line.color.rgb = rgb(line)
        shp.line.width = Pt(lw)
        if dash:
            shp.line.dash_style = dash
        if line_alpha_v is not None:
            line_alpha(shp, line_alpha_v)
    else:
        shp.line.fill.background()
    shp.shadow.inherit = False
    if shadow:
        add_shadow(shp)
    return shp


def gradient_rect(slide, x, y, w, h, c1, c2, angle=90, name=None,
                  line=None, lw=1.0, radius=None):
    shp = rect(slide, x, y, w, h, fill=None, line=line, lw=lw, radius=radius, name=name)
    shp.fill.gradient()
    shp.fill.gradient_angle = angle
    stops = shp.fill.gradient_stops
    stops[0].color.rgb = rgb(c1)
    stops[0].position = 0.0
    stops[1].color.rgb = rgb(c2)
    stops[1].position = 1.0
    return shp


def ellipse(slide, x, y, w, h, fill, alpha=0.1, soft=20, name=None):
    shp = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        shp.name = name
    shp.fill.solid()
    shp.fill.fore_color.rgb = rgb(fill)
    fill_alpha(shp, alpha)
    shp.line.fill.background()
    shp.shadow.inherit = False
    if soft:
        add_soft_edge(shp, soft)
    return shp


def text(slide, x, y, w, h, content: str, size=12, color=INK, bold=False,
         font=FONT, align="left", anchor="top", line_spacing=1.0,
         space_after=0, margins=(0, 0, 0, 0), name=None, alpha=None,
         italic=False, spacing=None, wrap=True):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        tb.name = name
    tf = tb.text_frame
    tf.word_wrap = wrap
    tf.margin_left, tf.margin_right, tf.margin_top, tf.margin_bottom = [Inches(v) for v in margins]
    tf.vertical_anchor = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE,
                          "bottom": MSO_ANCHOR.BOTTOM}[anchor]
    p = tf.paragraphs[0]
    p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                   "right": PP_ALIGN.RIGHT, "justify": PP_ALIGN.JUSTIFY}[align]
    p.line_spacing = line_spacing
    if space_after:
        p.space_after = Pt(space_after)
    r = p.add_run()
    r.text = content
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    r.font.color.rgb = rgb(color)
    _set_font(r, font)
    if spacing is not None:
        r._r.get_or_add_rPr().set("spc", str(int(spacing * 100)))
    if alpha is not None:
        run_alpha(r, alpha)
    return tb


def rich_text(slide, x, y, w, h, runs: Sequence[tuple[str, dict]], align="left",
              anchor="top", line_spacing=1.0, margins=(0, 0, 0, 0), name=None,
              space_after=0):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        tb.name = name
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left, tf.margin_right, tf.margin_top, tf.margin_bottom = [Inches(v) for v in margins]
    tf.vertical_anchor = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE,
                          "bottom": MSO_ANCHOR.BOTTOM}[anchor]
    p = tf.paragraphs[0]
    p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                   "right": PP_ALIGN.RIGHT}[align]
    p.line_spacing = line_spacing
    if space_after:
        p.space_after = Pt(space_after)
    for txt, kw in runs:
        r = p.add_run()
        r.text = txt
        r.font.size = Pt(kw.get("size", 12))
        r.font.bold = kw.get("bold", False)
        r.font.italic = kw.get("italic", False)
        r.font.color.rgb = rgb(kw.get("color", INK))
        _set_font(r, kw.get("font", FONT))
        if kw.get("spacing") is not None:
            r._r.get_or_add_rPr().set("spc", str(int(kw["spacing"] * 100)))
        if kw.get("alpha") is not None:
            run_alpha(r, kw["alpha"])
    return tb


def line(slide, x, y, w, color=LINE, alpha=1.0, thickness=0.01):
    return rect(slide, x, y, w, thickness, fill=color, alpha=alpha, lw=0)


def bullets(slide, x, y, w, h, items: Iterable[str], color=INK, marker_color=CYAN,
            size=10.5, gap=0.36, marker_size=0.07):
    """Draw a simple vertical bullet list; returns the shapes (for animation)."""
    shapes = []
    cy = y
    for item in items:
        dot = rect(slide, x, cy + 0.08, marker_size, marker_size, fill=marker_color, lw=0)
        shapes.append(dot)
        tx = text(slide, x + 0.22, cy - 0.02, w - 0.22, 0.32, item, size=size,
                  color=color, line_spacing=1.05)
        shapes.append(tx)
        cy += gap
    return shapes


# ---------------------------------------------------------------------------
# page furniture
# ---------------------------------------------------------------------------
def _grid(slide):
    for i in range(1, 13):
        x = i * W / 13
        rect(slide, x, 0, 0.006, H, fill="6D84A8", alpha=0.03, lw=0)
    for j in range(1, 8):
        y = j * H / 8
        rect(slide, 0, y, W, 0.006, fill="6D84A8", alpha=0.03, lw=0)


def background(slide, page: int, section: str = ""):
    bg = rect(slide, 0, 0, W, H, fill=BG1, lw=0)
    bg.fill.gradient()
    bg.fill.gradient_angle = 105
    stops = bg.fill.gradient_stops
    stops[0].color.rgb = rgb(BG1)
    stops[0].position = 0.0
    stops[1].color.rgb = rgb(BG2)
    stops[1].position = 1.0
    # faint technical grid
    _grid(slide)
    # ambient light blooms
    ellipse(slide, 9.1, -2.4, 6.8, 6.8, CYAN, alpha=0.055, soft=60)
    ellipse(slide, -2.6, 4.4, 6.2, 6.2, VIOLET, alpha=0.05, soft=70)
    ellipse(slide, 4.8, 7.2, 5.0, 3.0, BLUE, alpha=0.035, soft=60)
    # top hairline + corner ticks
    rect(slide, 0, 0, W, 0.018, fill=CYAN, alpha=0.22, lw=0)
    rect(slide, M, 0.38, 0.075, 0.075, fill=CYAN, lw=0)
    text(slide, M + 0.16, 0.335, 5.2, 0.2, "NOLDOJ // AI MATCH REPORT", size=7.5,
         color="7185A1", spacing=1.9, bold=True)
    text(slide, W - M - 3.0, 0.335, 3.0, 0.2, "2026.11  /  EVALUATION", size=7.5,
         color="7185A1", align="right", spacing=1.1)
    # bottom rule
    rect(slide, M, 7.1, W - 2 * M, 0.008, fill="3A4D6B", alpha=0.55, lw=0)
    text(slide, M, 7.17, 6.8, 0.18, "NoldOJ 同题开发 · 三模型横向评测", size=7.5,
         color="667892", spacing=0.4)
    text(slide, W - M - 2.0, 7.17, 2.0, 0.18, f"{page:02d}  /  {TOTAL_SLIDES:02d}",
         size=8, color=MUTED, align="right", spacing=1.0)
    # progress
    rect(slide, 0, H - 0.035, W, 0.035, fill="1B2940", lw=0)
    rect(slide, 0, H - 0.035, W * page / TOTAL_SLIDES, 0.035, fill=CYAN, alpha=0.75, lw=0)
    # giant page watermark
    text(slide, W - 2.8, 5.15, 2.1, 1.5, f"{page:02d}", size=92, color="FFFFFF",
         font=FONT_NUM, bold=True, align="right", alpha=0.026)


def header(slide, page: int, kicker: str, title: str, subtitle: str | None = None,
           accent: str = CYAN):
    background(slide, page)
    text(slide, M, 0.62, 8.8, 0.24, kicker, size=9.5, color=accent, bold=True,
         spacing=2.0)
    text(slide, M, 0.89, 11.9, 0.55, title, size=31, color=INK, bold=True,
         line_spacing=1.0)
    if subtitle:
        text(slide, M, 1.47, 11.9, 0.25, subtitle, size=11.5, color=MUTED,
             line_spacing=1.0)
    rect(slide, M, 1.79, 0.9, 0.022, fill=accent, alpha=0.95, lw=0)
    rect(slide, M + 0.9, 1.79, W - 2 * M - 0.9, 0.008, fill="2A3A55", alpha=0.7, lw=0)


def pill(slide, x, y, w, h, label, color, fill_alpha_v=0.10, size=8.5,
         bold=True, border=True):
    shp = rect(slide, x, y, w, h, fill=color, alpha=fill_alpha_v, lw=0.8,
               radius=h / 2) if border else rect(slide, x, y, w, h, fill=color,
                                                 alpha=fill_alpha_v, lw=0, radius=h / 2)
    if border:
        shp.line.color.rgb = rgb(color)
        line_alpha(shp, 0.34)
    tf = shp.text_frame
    tf.word_wrap = False
    tf.margin_left = tf.margin_right = Inches(0.02)
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.color.rgb = rgb(color)
    _set_font(r, FONT)
    return shp


def stars(slide, x, y, w, value: int, color: str, size=12, alpha_empty=0.22):
    runs = []
    for i in range(5):
        runs.append(("★", dict(size=size, color=color if i < value else color,
                                alpha=None if i < value else alpha_empty, font=FONT)))
    return rich_text(slide, x, y, w, 0.25, runs, align="left", anchor="middle",
                     line_spacing=1.0)


def model_dot(slide, x, y, color, size=0.09):
    return rect(slide, x, y, size, size, fill=color, lw=0, radius=size / 2)
