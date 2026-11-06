# -*- coding: utf-8 -*-
"""Build the visual deck (without audio / PowerPoint timeline) from the report data."""
from __future__ import annotations

import json
import os
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches, Pt

from common import (
    AMBER, BLUE, BG1, CARD, CYAN, DIM, FONT, FONT_CN, FONT_MONO, FONT_NUM,
    GREEN, H, INK, LINE, M, MODELS, MUTED, PINK, RED, TOTAL_SLIDES, VIOLET, W,
    Anim, add_shadow, background, bullets, ellipse, fill_alpha, gradient_rect,
    header, line, model_dot, pill, rect, rich_text, stars, text,
)
from script import SLIDES

BASE = Path(__file__).resolve().parent
OUT = BASE / "output"
ANIM: dict[int, list] = {}


def new_slide(prs, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    a = Anim(page)
    return s, a


def finish_page(slide, anim):
    ANIM[anim.slide_no] = anim.to_dict()


def dims_line(slide, x, y, w, model, size=8.5):
    labels = ("功能", "稳定", "体验")
    runs = []
    for i, (lab, val) in enumerate(zip(labels, model["dims"])):
        if i:
            runs.append(("   ·   ", dict(size=size, color=DIM, font=FONT)))
        runs.append((f"{lab} ", dict(size=size, color=DIM, font=FONT)))
        runs.append((f"{val:.1f}", dict(size=size, color=model["color"], bold=True,
                                        font=FONT_NUM)))
    return rich_text(slide, x, y, w, 0.24, runs, line_spacing=1.0)


# ---------------------------------------------------------------------------
# 01 cover
# ---------------------------------------------------------------------------
def slide_cover(prs):
    s, a = new_slide(prs, 1)
    background(s, 1)

    a.mark(text(s, 0.9, 1.12, 7.0, 0.25, "AI × ENGINEERING BENCHMARK / 2026",
               size=9.5, color=CYAN, bold=True, spacing=2.2), 0.15, "fade", 0.45)

    title = rich_text(
        s, 0.86, 1.42, 7.1, 1.15,
        [("Nold", dict(size=72, color=INK, bold=True, font=FONT_NUM)),
         ("OJ", dict(size=72, color=CYAN, bold=True, font=FONT_NUM))],
        line_spacing=1.0,
    )
    a.mark(title, 0.28, "rise", 0.65)

    a.mark(text(s, 0.9, 2.33, 7.2, 0.8, "同题开发评测", size=46, color=INK,
               bold=True, spacing=1.0), 0.46, "rise", 0.6)

    a.mark(rect(s, 0.93, 3.26, 1.35, 0.045, fill=CYAN, lw=0), 0.68, "wipe", 0.5,
           direction="right")

    a.mark(text(s, 0.92, 3.45, 7.0, 0.35,
               "DeepSeek  ·  GLM  ·  MiMo   三模型工程化横评",
               size=17, color="C7D3E6"), 0.8, "fade", 0.5)

    a.mark(text(s, 0.92, 3.98, 6.65, 0.9,
               "一份 480 行的需求文档，三种交付哲学，三个可运行的完整工程。\n"
               "我们只读代码，用同一把尺子，量到底。",
               size=11.5, color=MUTED, line_spacing=1.55), 1.0, "fade", 0.55)

    stats = [
        ("03", "模型同台"),
        ("30", "分制"),
        ("480+", "行需求"),
        ("03", "评测维度"),
    ]
    for i, (num, lab) in enumerate(stats):
        x = 0.94 + i * 1.52
        a.mark(text(s, x, 5.42, 1.25, 0.48, num, size=25, color=INK,
                   bold=True, font=FONT_NUM), 1.45 + i * 0.09, "rise", 0.45)
        a.mark(text(s, x, 5.94, 1.3, 0.24, lab, size=8.5, color=MUTED,
                   spacing=0.8), 1.5 + i * 0.09, "fade", 0.4)
        if i:
            a.mark(rect(s, x - 0.18, 5.45, 0.008, 0.55, fill="2B3B56", lw=0), 1.42,
                   "fade", 0.4)

    # score board
    board = gradient_rect(s, 8.25, 1.45, 4.27, 4.45, "0D1728", "0A111E",
                          angle=105, line="2A3B58", lw=0.8, radius=0.12)
    a.mark(board, 0.85, "rise", 0.65)
    a.mark(text(s, 8.55, 1.68, 2.8, 0.24, "FINAL SCORE  /  30", size=8.5,
               color=CYAN, bold=True, spacing=1.6), 1.0, "fade", 0.4)
    a.mark(pill(s, 11.35, 1.63, 0.85, 0.25, "TOP 3", CYAN, fill_alpha_v=0.06,
                size=7.2), 1.05, "fade", 0.4)

    for i, m in enumerate(MODELS):
        y = 2.18 + i * 1.17
        a.mark(text(s, 8.55, y - 0.02, 0.45, 0.25, m["medal"], size=8.5,
                   color=m["color"], bold=True, font=FONT_NUM), 1.15 + i * 0.18,
               "fade", 0.35)
        a.mark(text(s, 8.96, y - 0.06, 2.3, 0.3, m["short"], size=13.5,
                   color=INK, bold=True), 1.2 + i * 0.18, "fade", 0.4)
        a.mark(text(s, 8.96, y + 0.22, 0.9, 0.2, "TOTAL", size=6.5, color=DIM,
                   spacing=1.2), 1.24 + i * 0.18, "fade", 0.35)
        a.mark(text(s, 11.25, y - 0.16, 1.0, 0.62, f"{m['total']:.1f}", size=26,
                   color=m["color"], bold=True, font=FONT_NUM, align="right"),
               1.3 + i * 0.18, "rise", 0.45)
        track = rect(s, 8.55, y + 0.53, 2.55, 0.075, fill="1B2940", lw=0, radius=0.04)
        a.mark(track, 1.3 + i * 0.18, "fade", 0.35)
        a.mark(rect(s, 8.55, y + 0.53, 2.55 * m["total"] / 30.0, 0.075,
                    fill=m["color"], alpha=0.9, lw=0, radius=0.04),
               1.38 + i * 0.18, "wipe", 0.55, direction="right")
        if i < 2:
            a.mark(rect(s, 8.55, y + 0.98, 3.65, 0.008, fill="263650", lw=0), 1.3,
                   "fade", 0.35)

    a.mark(text(s, 0.93, 6.55, 6.7, 0.25,
               "只读代码评审  /  统一评分标尺  /  以工程化水平推断真实可用性",
               size=8.5, color="667892", spacing=0.8), 2.35, "fade", 0.45)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 02 method
# ---------------------------------------------------------------------------
def slide_method(prs):
    s, a = new_slide(prs, 2)
    header(s, 2, "01 / 评测方法", "把 480 行需求，拆成同一把尺子",
           "只读代码评审  ·  不运行判题  ·  全流程统一标尺")

    stats = [
        ("480+", "行需求文档", "30+ 个功能模块逐条对照"),
        ("30+", "功能模块", "沙箱 / 判题 / AI / 权限 / 比赛"),
        ("03", "评测维度", "功能完整性 · 稳定性 · 用户体验"),
        ("03", "完整实现", "同一道命题，独立交付"),
    ]
    for i, (num, lab, desc) in enumerate(stats):
        col, row = i % 2, i // 2
        x = 0.72 + col * 2.43
        y = 1.98 + row * 1.9
        card = rect(s, x, y, 2.25, 1.72, fill=CARD, alpha=0.72, line="263650",
                    lw=0.7, radius=0.09)
        a.mark(card, 0.32 + i * 0.14, "rise", 0.52)
        a.mark(text(s, x + 0.2, y + 0.18, 1.8, 0.55, num, size=29, color=CYAN,
                   bold=True, font=FONT_NUM), 0.4 + i * 0.14, "fade", 0.4)
        a.mark(text(s, x + 0.2, y + 0.8, 1.85, 0.24, lab, size=10.5, color=INK,
                   bold=True), 0.44 + i * 0.14, "fade", 0.4)
        a.mark(text(s, x + 0.2, y + 1.12, 1.9, 0.4, desc, size=7.8, color=MUTED,
                   line_spacing=1.35), 0.48 + i * 0.14, "fade", 0.4)

    # pipeline
    steps = [
        ("01", "需求拆解", "把需求文档拆成 30+ 功能模块，建立逐项验收清单。"),
        ("02", "代码评审", "读路由、沙箱、判题队列、AI 能力与权限体系。"),
        ("03", "三维打分", "功能完整性、bug 与稳定性、用户体验，各 10 分。"),
        ("04", "排名结论", "总分排名，并给出不同场景下的选型建议。"),
    ]
    cx = 6.05
    a.mark(rect(s, cx, 2.08, 0.012, 4.25, fill="29405F", lw=0), 0.55, "wipe", 0.7,
           direction="down")
    for i, (num, title, desc) in enumerate(steps):
        y = 1.98 + i * 1.08
        dot = ellipse(s, cx - 0.09, y + 0.23, 0.19, 0.19, CYAN, alpha=0.95, soft=0)
        a.mark(dot, 0.75 + i * 0.25, "zoom", 0.4)
        card = rect(s, 6.35, y, 6.2, 0.9, fill=CARD, alpha=0.52, line="24324A",
                    lw=0.6, radius=0.08)
        a.mark(card, 0.8 + i * 0.25, "rise", 0.48)
        a.mark(text(s, 6.58, y + 0.12, 0.5, 0.22, num, size=8.5, color=CYAN,
                   bold=True, font=FONT_NUM, spacing=1.0), 0.88 + i * 0.25, "fade", 0.35)
        a.mark(text(s, 7.05, y + 0.11, 5.2, 0.25, title, size=12.5, color=INK,
                   bold=True), 0.9 + i * 0.25, "fade", 0.35)
        a.mark(text(s, 7.05, y + 0.42, 5.15, 0.35, desc, size=9, color=MUTED,
                   line_spacing=1.25), 0.94 + i * 0.25, "fade", 0.35)

    a.mark(text(s, 0.72, 6.6, 11.8, 0.26,
               "评分不是跑分：以代码完整度与工程化水平，推断真实可用性；环境差异不计入模型能力。",
               size=9.5, color="7185A1"), 2.4, "fade", 0.45)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 03 contestants
# ---------------------------------------------------------------------------
def slide_models(prs):
    s, a = new_slide(prs, 3)
    header(s, 3, "02 / 三位选手", "三种工程哲学，三份完整答卷",
           "同一道题，独立完成；架构选择，已经透露了各自的性格。")

    for i, m in enumerate(MODELS):
        x = 0.72 + i * 4.02
        w = 3.85
        card = rect(s, x, 1.98, w, 4.48, fill=CARD, alpha=0.78,
                    line=m["color"], lw=0.8, radius=0.1)
        a.mark(card, 0.3 + i * 0.18, "rise", 0.6)
        a.mark(rect(s, x, 1.98, w, 0.055, fill=m["color"], lw=0), 0.36 + i * 0.18,
               "wipe", 0.5, direction="right")
        a.mark(text(s, x + w - 1.2, 2.12, 0.95, 0.72,
                   f"0{i + 1}", size=44, color="FFFFFF", font=FONT_NUM,
                   bold=True, align="right", alpha=0.06), 0.42 + i * 0.18, "fade", 0.5)
        a.mark(pill(s, x + 0.24, 2.2, 0.86, 0.26, m["tag"], m["color"],
                    fill_alpha_v=0.1, size=8), 0.46 + i * 0.18, "fade", 0.4)
        a.mark(text(s, x + 0.24, 2.62, w - 0.45, 0.4, m["short"], size=19,
                   color=INK, bold=True), 0.5 + i * 0.18, "fade", 0.45)
        a.mark(text(s, x + 0.24, 3.02, w - 0.45, 0.38, m["arch"], size=8.2,
                   color=MUTED, line_spacing=1.35), 0.55 + i * 0.18, "fade", 0.4)
        a.mark(rect(s, x + 0.24, 3.48, w - 0.48, 0.008, fill="2A3A55", lw=0),
               0.58 + i * 0.18, "fade", 0.35)

        rows = [
            ("后端路由", f"{m['routes']}"),
            ("测试", m["tests"]),
            ("文档", m["doc"]),
        ]
        for j, (lab, val) in enumerate(rows):
            yy = 3.62 + j * 0.47
            a.mark(text(s, x + 0.24, yy + 0.06, 0.9, 0.22, lab, size=8, color=DIM,
                       spacing=0.8), 0.65 + i * 0.18 + j * 0.04, "fade", 0.35)
            a.mark(text(s, x + 1.12, yy, w - 1.35, 0.26, val, size=10.8,
                       color=INK if j < 2 else "C7D3E6", bold=j == 0,
                       align="right" if j < 2 else "left"), 0.68 + i * 0.18 + j * 0.04,
                   "fade", 0.35)
        a.mark(text(s, x + 0.24, 5.63, w - 0.45, 0.55, m["quote"], size=9.5,
                   color=m["color"], line_spacing=1.3), 0.95 + i * 0.18, "fade", 0.4)

    a.mark(text(s, 0.72, 6.65, 11.8, 0.25,
               "DeepSeek 赢在体系，GLM 赢在深度，MiMo 赢在均衡——三种路线，没有对错，只有适配。",
               size=9.5, color="7185A1"), 1.55, "fade", 0.45)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 04 total score
# ---------------------------------------------------------------------------
def slide_total(prs):
    s, a = new_slide(prs, 4)
    header(s, 4, "03 / 总分", "28.0 · 26.3 · 23.5，差距写在短板上",
           "满分 30；功能完整性、稳定性、用户体验各 10 分。")

    card = rect(s, 0.72, 1.98, 11.89, 4.35, fill=CARD, alpha=0.58,
                line="24324A", lw=0.8, radius=0.11)
    a.mark(card, 0.25, "fade", 0.5)
    a.mark(text(s, 1.02, 2.14, 3.0, 0.22, "TOTAL SCORE  /  RANKING", size=8.2,
               color=CYAN, bold=True, spacing=1.6), 0.35, "fade", 0.4)
    a.mark(text(s, 10.0, 2.14, 2.3, 0.22, "SCALE  /  30", size=8.2, color=DIM,
               bold=True, spacing=1.4, align="right"), 0.35, "fade", 0.4)

    for i, m in enumerate(MODELS):
        y = 2.62 + i * 1.16
        a.mark(text(s, 1.02, y + 0.18, 0.7, 0.3, m["medal"], size=16,
                   color=m["color"], bold=True, font=FONT_NUM), 0.5 + i * 0.55,
               "fade", 0.4)
        a.mark(text(s, 1.72, y + 0.04, 3.2, 0.34, m["name"], size=15.5,
                   color=INK, bold=True), 0.55 + i * 0.55, "rise", 0.45)
        a.mark(dims_line(s, 1.72, y + 0.44, 3.2, m), 0.6 + i * 0.55, "fade", 0.4)

        track = rect(s, 5.12, y + 0.27, 6.3, 0.36, fill="152135", lw=0,
                     radius=0.18)
        a.mark(track, 0.62 + i * 0.55, "fade", 0.35)
        bar = rect(s, 5.12, y + 0.27, 6.3 * m["total"] / 30.0, 0.36,
                   fill=m["color"], alpha=0.9, lw=0, radius=0.18)
        a.mark(bar, 0.72 + i * 0.55, "wipe", 0.7, direction="right")
        a.mark(text(s, 11.55, y + 0.02, 0.92, 0.62, f"{m['total']:.1f}",
                   size=25, color=m["color"], bold=True, font=FONT_NUM,
                   align="right"), 1.1 + i * 0.55, "rise", 0.45)
        a.mark(text(s, 12.42, y + 0.39, 0.4, 0.18, "/30", size=6.5, color=DIM,
                   font=FONT_NUM), 1.12 + i * 0.55, "fade", 0.3)
        if i < 2:
            a.mark(rect(s, 1.02, y + 0.98, 11.3, 0.008, fill="263650", lw=0),
                   1.1 + i * 0.55, "fade", 0.35)

    insight = rect(s, 0.72, 6.47, 11.89, 0.44, fill=CYAN, alpha=0.055,
                   line=CYAN, lw=0.6, radius=0.06)
    a.mark(insight, 2.35, "fade", 0.45)
    a.mark(rect(s, 0.72, 6.47, 0.05, 0.44, fill=CYAN, lw=0), 2.4, "wipe", 0.4,
           direction="down")
    a.mark(text(s, 0.98, 6.56, 11.4, 0.25,
               "三项全优的只有 DeepSeek；GLM 的稳定性单项，拉开了与冠军的最大差距。",
               size=9.5, color="C7D3E6"), 2.45, "fade", 0.4)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 05 feature completeness
# ---------------------------------------------------------------------------
FEATURES = [
    ("核心判题", "多语言 / SPJ / 子任务 / 128KB", (5, 4, 4)),
    ("Windows 沙箱", "Job Object / 受限令牌 / 低完整性", (4, 4, 5)),
    ("AI 能力", "安全审查 / 提示 / 数据生成 / 注入防护", (5, 4, 5)),
    ("权限与可见性", "用户组 / 隐私开关 / 可见性", (5, 4, 4)),
    ("比赛系统", "邀请 / 封榜 / 虚拟赛 / ACM 罚时", (4, 4, 5)),
    ("文章 / 讨论 / 公告", "内容社区基础能力", (4, 4, 4)),
    ("考试系统", "客观 + 主观 AI 评分 / Excel 导入", (5, 4, 4)),
    ("Markdown 等增强", "嵌入语法 / 验证码 / 搜索 / 查重", (5, 4, 4)),
]


def slide_features(prs):
    s, a = new_slide(prs, 5)
    header(s, 5, "04 / 功能完整性", "覆盖是广度，实现是深度",
           "对照 30+ 功能模块，逐项勾验；★ 越多，代表覆盖与实现越完整。")

    card = rect(s, 0.72, 1.98, 11.89, 4.42, fill=CARD, alpha=0.52,
                line="24324A", lw=0.8, radius=0.1)
    a.mark(card, 0.22, "fade", 0.5)
    a.mark(text(s, 1.02, 2.12, 4.4, 0.22, "功能领域  /  对照需求", size=8, color=DIM,
               spacing=1.2), 0.32, "fade", 0.35)
    for i, m in enumerate(MODELS):
        x = 6.12 + i * 2.33
        a.mark(text(s, x, 2.12, 1.35, 0.22, m["short"], size=9, color=m["color"],
                   bold=True, align="center", spacing=0.8), 0.34 + i * 0.08, "fade", 0.35)
    a.mark(text(s, 11.42, 2.12, 0.95, 0.22, "5★ = 最强", size=7.2, color=DIM,
               align="right"), 0.4, "fade", 0.3)
    a.mark(rect(s, 0.94, 2.43, 11.45, 0.008, fill="2B3B56", lw=0), 0.38, "fade", 0.3)

    for i, (name, note, vals) in enumerate(FEATURES):
        y = 2.53 + i * 0.445
        highlight = (i == 1)
        if highlight:
            bg = rect(s, 0.92, y - 0.03, 11.49, 0.4, fill=VIOLET, alpha=0.09,
                      line=VIOLET, lw=0.6, radius=0.05)
            a.mark(bg, 0.55 + i * 0.12, "fade", 0.35)
        elif i % 2 == 0:
            a.mark(rect(s, 0.92, y - 0.03, 11.49, 0.4, fill="FFFFFF", alpha=0.022,
                        lw=0), 0.5 + i * 0.12, "fade", 0.3)
        runs = [(name, dict(size=10.2, color=INK, bold=True))]
        if highlight:
            runs.append(("   BEST", dict(size=7, color=VIOLET, bold=True,
                                         spacing=1.0)))
        a.mark(rich_text(s, 1.02, y + 0.05, 4.9, 0.27, runs), 0.55 + i * 0.12,
               "fade", 0.35)
        a.mark(text(s, 1.02, y + 0.225, 4.4, 0.16, note, size=7.2, color=DIM),
               0.57 + i * 0.12, "fade", 0.3)
        for j, m in enumerate(MODELS):
            a.mark(stars(s, 6.2 + j * 2.33, y + 0.075, 1.3, vals[j], m["color"],
                         size=10.5), 0.6 + i * 0.12 + j * 0.025, "fade", 0.35)

    a.mark(text(s, 0.72, 6.56, 11.8, 0.25,
               "DeepSeek 八项全优；GLM 在沙箱与比赛最强；MiMo 广度好，但部分模块自己标注了“待扩展”。",
               size=9.3, color="7185A1"), 1.9, "fade", 0.45)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 06 stability
# ---------------------------------------------------------------------------
def slide_stability(prs):
    s, a = new_slide(prs, 6)
    header(s, 6, "05 / 稳定性", "工程化，决定交付的下限",
           "bug 数量与严重等级，最终都会反映在“能不能放心上线”上。")

    panel = rect(s, 0.72, 1.98, 4.42, 3.55, fill=CARD, alpha=0.55,
                 line="24324A", lw=0.8, radius=0.1)
    a.mark(panel, 0.25, "fade", 0.5)
    a.mark(text(s, 1.0, 2.14, 3.9, 0.22, "ENGINEERING  /  工程化配置", size=8,
               color=CYAN, bold=True, spacing=1.3), 0.35, "fade", 0.35)
    rows = [
        ("DeepSeek", "优", GREEN, "start / dev / init / migrate / test / lint"),
        ("MiMo", "良", AMBER, "start / dev / test / lint"),
        ("GLM", "差", RED, "无标准化启动、测试、代码检查脚本"),
    ]
    for i, (name, grade, color, desc) in enumerate(rows):
        y = 2.53 + i * 0.95
        a.mark(model_dot(s, 1.0, y + 0.06, color), 0.5 + i * 0.12, "fade", 0.3)
        a.mark(text(s, 1.18, y - 0.01, 2.2, 0.27, name, size=11.5, color=INK,
                   bold=True), 0.5 + i * 0.12, "fade", 0.35)
        a.mark(pill(s, 3.95, y - 0.02, 0.62, 0.27, grade, color,
                    fill_alpha_v=0.1, size=8), 0.54 + i * 0.12, "fade", 0.35)
        a.mark(text(s, 1.18, y + 0.3, 3.55, 0.32, desc, size=8, color=MUTED,
                   line_spacing=1.2), 0.58 + i * 0.12, "fade", 0.35)
        if i < 2:
            a.mark(rect(s, 1.0, y + 0.77, 3.7, 0.006, fill="263650", lw=0),
                   0.55 + i * 0.12, "fade", 0.3)

    a.mark(text(s, 0.72, 5.78, 4.45, 0.82, "沙箱做得最深，\n工程化却最薄。",
               size=19, color=VIOLET, bold=True, line_spacing=1.35), 1.45, "rise", 0.55)
    a.mark(text(s, 0.74, 6.55, 4.2, 0.24, "GLM 的最大反差", size=8.5, color=MUTED,
               spacing=1.0), 1.55, "fade", 0.35)

    chart = rect(s, 5.52, 1.98, 7.09, 4.55, fill=CARD, alpha=0.35,
                 line="24324A", lw=0.8, radius=0.1)
    a.mark(chart, 0.3, "fade", 0.5)
    a.mark(text(s, 5.8, 2.14, 3.4, 0.22, "STABILITY SCORE  /  10", size=8,
               color=CYAN, bold=True, spacing=1.3), 0.4, "fade", 0.35)

    base_y, top_y = 5.45, 2.95
    a.mark(rect(s, 5.8, base_y, 6.5, 0.008, fill="3A4D6B", lw=0), 0.45, "fade", 0.3)
    for value in (5, 10):
        yy = base_y - value / 10 * (base_y - top_y)
        a.mark(rect(s, 5.8, yy, 6.5, 0.006, fill="2A3A55", lw=0), 0.45, "fade", 0.25)
        a.mark(text(s, 5.82, yy - 0.19, 0.5, 0.18, str(value), size=6.5,
                   color=DIM, font=FONT_NUM), 0.45, "fade", 0.25)

    for i, m in enumerate(MODELS):
        score = m["dims"][1]
        x = 6.55 + i * 2.02
        h = (score / 10.0) * (base_y - top_y)
        y = base_y - h
        a.mark(text(s, x - 0.2, y - 0.36, 1.55, 0.3, f"{score:.1f}", size=18,
                   color=m["color"], bold=True, font=FONT_NUM, align="center"),
               0.7 + i * 0.28, "rise", 0.4)
        bar = rect(s, x, y, 1.18, h, fill=m["color"], alpha=0.88, lw=0,
                   radius=0.04)
        a.mark(bar, 0.75 + i * 0.28, "wipe", 0.8, direction="up")
        a.mark(rect(s, x, y, 1.18, 0.025, fill="FFFFFF", alpha=0.28, lw=0),
               0.78 + i * 0.28, "fade", 0.3)
        a.mark(text(s, x - 0.25, 5.56, 1.68, 0.25, m["short"], size=9.5,
                   color=INK, bold=True, align="center"), 0.9 + i * 0.28, "fade", 0.35)
        a.mark(pill(s, x + 0.02, 5.92, 1.14, 0.27, f"{m['risk']}风险",
                    m["risk_color"], fill_alpha_v=0.1, size=7.5),
               0.95 + i * 0.28, "fade", 0.35)

    a.mark(text(s, 5.8, 6.37, 6.5, 0.2, "GLM 的 7.0 分并非能力不足，而是工程化缺失带来的交付风险。",
               size=7.8, color="7185A1"), 1.7, "fade", 0.35)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 07 UX
# ---------------------------------------------------------------------------
UX = [
    ("文档易用性", "README / 示例 / 部署指引", (5, 4, 4)),
    ("配置体验", "env 覆盖 / 自动密钥 / 迁移", (5, 4, 4)),
    ("界面 / 交互", "暗黑模式 / Markdown / 实时推送", (5, 4, 4)),
    ("部署运维", "一键启动 / 依赖安装 / 排障", (5, 4, 3)),
]


def slide_ux(prs):
    s, a = new_slide(prs, 7)
    header(s, 7, "06 / 用户体验", "能不能十分钟跑起来？",
           "文档、配置、界面、部署——四道门槛，决定第一次上手的心情。")

    a.mark(pill(s, 10.0, 1.47, 2.6, 0.27, "TARGET  /  10 MINUTES", CYAN,
                fill_alpha_v=0.06, size=7.2), 0.3, "fade", 0.35)

    card = rect(s, 0.72, 1.98, 11.89, 3.42, fill=CARD, alpha=0.55,
                line="24324A", lw=0.8, radius=0.1)
    a.mark(card, 0.22, "fade", 0.5)
    a.mark(text(s, 1.02, 2.12, 4.5, 0.22, "体验维度  /  对照需求", size=8,
               color=DIM, spacing=1.2), 0.32, "fade", 0.35)
    for i, m in enumerate(MODELS):
        a.mark(text(s, 6.05 + i * 2.33, 2.12, 1.4, 0.22, m["short"], size=9,
                   color=m["color"], bold=True, align="center"), 0.34 + i * 0.08,
               "fade", 0.35)
    a.mark(rect(s, 0.94, 2.44, 11.45, 0.008, fill="2B3B56", lw=0), 0.38, "fade", 0.3)

    for i, (name, note, vals) in enumerate(UX):
        y = 2.55 + i * 0.68
        highlight = (i == 3)
        if highlight:
            a.mark(rect(s, 0.92, y - 0.05, 11.49, 0.62, fill=RED, alpha=0.05,
                        line=RED, lw=0.5, radius=0.05), 0.55 + i * 0.14, "fade", 0.35)
        a.mark(text(s, 1.02, y + 0.04, 2.8, 0.27, name, size=10.8, color=INK,
                   bold=True), 0.55 + i * 0.14, "fade", 0.35)
        a.mark(text(s, 1.02, y + 0.32, 4.4, 0.2, note, size=7.5, color=DIM),
               0.58 + i * 0.14, "fade", 0.3)
        for j, m in enumerate(MODELS):
            a.mark(stars(s, 6.1 + j * 2.33, y + 0.12, 1.35, vals[j], m["color"],
                         size=12.5), 0.62 + i * 0.14 + j * 0.02, "fade", 0.35)
        if highlight:
            a.mark(text(s, 10.75, y + 0.35, 1.2, 0.18, "手动部署", size=6.8,
                       color=RED, align="center"), 0.85 + i * 0.14, "fade", 0.3)

    notes = [
        ("DeepSeek", "一键启动", "start.bat / ps1 · 配置自动生成 · 数据库迁移", BLUE),
        ("MiMo", "脚本齐备", "start / dev / test · OpenAPI 友好 · 分层清晰", AMBER),
        ("GLM", "手动安装", "npm install 后手动启动 · 缺少标准脚本", VIOLET),
    ]
    for i, (name, tag, desc, color) in enumerate(notes):
        x = 0.72 + i * 4.02
        c = rect(s, x, 5.62, 3.85, 0.98, fill=color, alpha=0.06, line=color,
                 lw=0.6, radius=0.08)
        a.mark(c, 1.15 + i * 0.12, "rise", 0.45)
        a.mark(text(s, x + 0.22, 5.72, 2.1, 0.25, f"{name}  /  {tag}", size=9.5,
                   color=color, bold=True), 1.22 + i * 0.12, "fade", 0.35)
        a.mark(text(s, x + 0.22, 6.02, 3.45, 0.45, desc, size=7.8, color=MUTED,
                   line_spacing=1.3), 1.26 + i * 0.12, "fade", 0.35)

    a.mark(text(s, 0.72, 6.73, 11.8, 0.2, "“能跑起来”是用户体验的第一性原理。", size=8.5,
               color="7185A1", align="center"), 1.9, "fade", 0.4)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 08 podium
# ---------------------------------------------------------------------------
def slide_podium(prs):
    s, a = new_slide(prs, 8)
    header(s, 8, "07 / 最终排名", "冠军没有悬念，亚军更有看点",
           "总分排名；每一分，都来自功能、稳定与体验的合力。")

    a.mark(ellipse(s, 4.85, 4.15, 3.7, 2.4, BLUE, alpha=0.1, soft=45), 1.75, "fade", 0.7)
    a.mark(rect(s, 1.14, 6.45, 11.05, 0.02, fill="3A4D6B", alpha=0.8, lw=0),
           0.9, "wipe", 0.6, direction="right")

    podium = [
        (MODELS[2], 8.25, 4.85, 2.6, 1.6),
        (MODELS[1], 2.45, 4.35, 2.6, 2.1),
        (MODELS[0], 5.35, 3.55, 2.65, 2.9),
    ]
    delays = {2: 0.35, 1: 1.05, 0: 1.8}
    for m, x, y, w, h in podium:
        idx = MODELS.index(m)
        d = delays[idx]
        card = rect(s, x, y, w, h, fill=CARD, alpha=0.9, line=m["color"],
                    lw=1.0, radius=0.08)
        a.mark(card, d, "rise", 0.75)
        a.mark(rect(s, x, y, w, 0.05, fill=m["color"], lw=0), d + 0.05,
               "wipe", 0.5, direction="right")
        a.mark(text(s, x + 0.2, y + 0.14, 1.2, 0.22, f"RANK {m['medal']}", size=7.2,
                   color=m["color"], bold=True, spacing=1.2), d + 0.08, "fade", 0.35)
        a.mark(text(s, x + 0.2, y + 0.4, w - 0.4, 0.32, m["short"], size=15.5,
                   color=INK, bold=True), d + 0.12, "fade", 0.4)
        if h >= 2.6:
            score_size, score_y, total_y = 38, y + 0.78, y + 1.55
        elif h >= 2.0:
            score_size, score_y, total_y = 30, y + 0.74, y + 1.35
        else:
            score_size, score_y, total_y = 22, y + 0.66, None
        a.mark(text(s, x + 0.18, score_y, w - 0.3, 0.62, f"{m['total']:.1f}",
                   size=score_size, color=m["color"], bold=True, font=FONT_NUM),
               d + 0.18, "rise", 0.5)
        if total_y is not None:
            a.mark(text(s, x + 0.22, total_y, w - 0.4, 0.2, "TOTAL SCORE / 30",
                       size=6.2, color=DIM, spacing=1.0), d + 0.2, "fade", 0.3)
        if h >= 2.6:
            a.mark(rect(s, x + 0.18, y + 1.9, 0.035, 0.42, fill=m["color"], lw=0),
                   d + 0.24, "fade", 0.3)
            a.mark(text(s, x + 0.31, y + 1.87, w - 0.55, 0.68,
                        "领先亚军 1.7 分\n三科全部 9 分以上", size=7.8,
                        color="A9C2E4", line_spacing=1.35), d + 0.26, "fade", 0.4)
        a.mark(text(s, x + 0.2, 6.14, w - 0.4, 0.24, m["quote"], size=7.8,
                   color="B9C7DC"), d + 0.25, "fade", 0.35)

    a.mark(pill(s, 5.62, 3.13, 2.1, 0.28, "CHAMPION  /  2026", CYAN,
                fill_alpha_v=0.07, size=7.2), 2.45, "fade", 0.4)
    a.mark(text(s, 1.15, 6.58, 3.0, 0.2, "TOTAL SCORE  /  30", size=7.5, color=DIM,
               spacing=1.1), 2.0, "fade", 0.35)
    a.mark(text(s, 8.2, 6.58, 4.0, 0.2, "28.0  /  26.3  /  23.5", size=8, color=MUTED,
               align="right", font=FONT_NUM, spacing=1.4), 2.0, "fade", 0.35)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 09 highlights
# ---------------------------------------------------------------------------
def slide_highlights(prs):
    s, a = new_slide(prs, 9)
    header(s, 9, "08 / 关键亮点", "三种值得记住的能力",
           "同一个命题，三种不同的“最强项”。")

    highlights = [
        (MODELS[0], "工程闭环", [
            "零运行时依赖，模块边界清晰",
            "groups + visibility 权限体系完整",
            "测试、迁移、lint、文档全链路",
        ], "“第二天还能维护”的交付物"),
        (MODELS[2], "沙箱深度", [
            "挂起创建 → 加入 Job Object → Resume",
            "受限令牌 + 低完整性级别",
            "PowerShell 内嵌 C#，原生 API 互操作",
        ], "最贴近需求原文的安全架构"),
        (MODELS[1], "交付均衡", [
            "功能清单覆盖最广",
            "OpenAPI 3.0 规范清晰",
            "诚实标注“部分完成 / 待扩展”",
        ], "功能与可维护性的平衡点"),
    ]

    for i, (m, cap, items, tagline) in enumerate(highlights):
        x = 0.72 + i * 4.02
        w = 3.85
        card = rect(s, x, 1.98, w, 4.48, fill=CARD, alpha=0.72,
                    line=m["color"], lw=0.7, radius=0.1)
        a.mark(card, 0.3 + i * 0.18, "rise", 0.55)
        a.mark(rect(s, x, 1.98, w, 0.05, fill=m["color"], lw=0), 0.35 + i * 0.18,
               "wipe", 0.45, direction="right")
        a.mark(text(s, x + w - 1.15, 2.1, 0.95, 0.62, f"0{i + 1}", size=40,
                   color="FFFFFF", font=FONT_NUM, bold=True, align="right",
                   alpha=0.06), 0.4 + i * 0.18, "fade", 0.45)
        a.mark(text(s, x + 0.24, 2.18, 2.1, 0.2, m["short"], size=8.5,
                   color=m["color"], bold=True, spacing=1.0), 0.45 + i * 0.18,
               "fade", 0.35)
        a.mark(text(s, x + 0.24, 2.44, w - 0.45, 0.38, cap, size=19, color=INK,
                   bold=True), 0.5 + i * 0.18, "rise", 0.45)
        a.mark(rect(s, x + 0.24, 2.98, w - 0.48, 0.008, fill="2A3A55", lw=0),
               0.55 + i * 0.18, "fade", 0.3)
        for j, item in enumerate(items):
            a.mark(rect(s, x + 0.24, 3.28 + j * 0.58 + 0.07, 0.075, 0.075,
                        fill=m["color"], lw=0), 0.68 + i * 0.18 + j * 0.1,
                   "zoom", 0.3)
            a.mark(text(s, x + 0.44, 3.2 + j * 0.58, w - 0.65, 0.52, item,
                       size=9.2, color="C7D3E6", line_spacing=1.3),
                   0.7 + i * 0.18 + j * 0.1, "fade", 0.35)
        a.mark(text(s, x + 0.24, 5.6, w - 0.45, 0.6, tagline, size=8.5,
                   color=m["color"], line_spacing=1.3), 1.15 + i * 0.18, "fade", 0.4)

    a.mark(text(s, 0.72, 6.67, 11.8, 0.22,
               "技术深度、工程完整度、交付速度——三者很难同时最大化；选型，就是选择你愿意承担的代价。",
               size=8.8, color="7185A1", align="center"), 1.9, "fade", 0.4)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 10 selection
# ---------------------------------------------------------------------------
def slide_selection(prs):
    s, a = new_slide(prs, 10)
    header(s, 10, "09 / 选型建议", "没有全能冠军，只有场景最优解",
           "把评测结果翻译成一句可执行的话：你下一步要做什么？")

    scenarios = [
        ("从零搭建完整工程", "长周期项目 / 脚手架 / 交付完整度",
         MODELS[0], "交付完整，第二天还能维护"),
        ("底层系统级攻坚", "沙箱 / 驱动 / 协议 / Windows API",
         MODELS[2], "技术最深，建议配工程化收尾"),
        ("快速铺功能、做原型", "功能覆盖 / 交付速度 / 二次开发",
         MODELS[1], "覆盖广、速度快、状态标注诚实"),
    ]
    for i, (scene, sub, m, reason) in enumerate(scenarios):
        y = 1.98 + i * 1.4
        sc = rect(s, 0.72, y, 5.3, 1.16, fill=CARD, alpha=0.58, line="263650",
                  lw=0.6, radius=0.08)
        a.mark(sc, 0.35 + i * 0.3, "rise", 0.5)
        a.mark(text(s, 0.98, y + 0.17, 4.7, 0.3, scene, size=13, color=INK,
                   bold=True), 0.42 + i * 0.3, "fade", 0.35)
        a.mark(text(s, 0.98, y + 0.56, 4.7, 0.24, sub, size=8.5, color=MUTED),
               0.45 + i * 0.3, "fade", 0.35)
        a.mark(rect(s, 6.18, y + 0.56, 0.92, 0.012, fill=m["color"], alpha=0.55,
                    lw=0), 0.55 + i * 0.3, "wipe", 0.4, direction="right")
        a.mark(rect(s, 7.0, y + 0.45, 0.28, 0.28, fill=m["color"], lw=0,
                    radius=0.04), 0.58 + i * 0.3, "fade", 0.3)
        # chevron-ish arrow head
        a.mark(rect(s, 7.0, y + 0.52, 0.32, 0.12, fill=m["color"], lw=0),
               0.6 + i * 0.3, "fade", 0.3)
        rec = rect(s, 7.45, y, 5.16, 1.16, fill=m["color"], alpha=0.075,
                   line=m["color"], lw=0.7, radius=0.08)
        a.mark(rec, 0.5 + i * 0.3, "rise", 0.5)
        a.mark(text(s, 7.7, y + 0.16, 4.6, 0.35, m["short"], size=18,
                   color=m["color"], bold=True), 0.6 + i * 0.3, "fade", 0.4)
        a.mark(text(s, 7.7, y + 0.6, 4.6, 0.28, reason, size=9, color="C7D3E6"),
               0.65 + i * 0.3, "fade", 0.35)
        a.mark(text(s, 11.85, y + 0.18, 0.6, 0.4, f"{m['total']:.1f}", size=16,
                   color=m["color"], bold=True, font=FONT_NUM, align="right",
                   alpha=0.65), 0.7 + i * 0.3, "fade", 0.35)

    principle = rect(s, 0.72, 6.3, 11.89, 0.56, fill=CYAN, alpha=0.06,
                     line=CYAN, lw=0.6, radius=0.06)
    a.mark(principle, 1.5, "fade", 0.45)
    a.mark(pill(s, 0.9, 6.43, 0.3, 0.3, "!", CYAN, fill_alpha_v=0.1, size=10),
           1.55, "zoom", 0.35)
    a.mark(text(s, 1.35, 6.42, 11.0, 0.25,
               "看工程化自觉性，不只看代码行数；功能清单很长，不等于交付完整。",
               size=9.8, color="C7D3E6"), 1.62, "fade", 0.4)
    finish_page(s, a)


# ---------------------------------------------------------------------------
# 11 conclusion
# ---------------------------------------------------------------------------
def slide_conclusion(prs):
    s, a = new_slide(prs, 11)
    header(s, 11, "10 / 结论", "代码是答卷，工程化是分数",
           "把一次同题开发，压缩成三条可执行建议。")

    choices = [
        ("要上线", "DeepSeek", "完整工程 · 直接部署", MODELS[0], "28.0"),
        ("要突破", "GLM", "底层硬骨头 · 配工程化收尾", MODELS[2], "23.5"),
        ("要速度", "MiMo", "快速铺量 · 原型验证", MODELS[1], "26.3"),
    ]
    for i, (need, name, desc, m, score) in enumerate(choices):
        x = 0.72 + i * 4.02
        card = rect(s, x, 1.98, 3.85, 2.35, fill=m["color"], alpha=0.065,
                    line=m["color"], lw=0.7, radius=0.1)
        a.mark(card, 0.35 + i * 0.18, "rise", 0.55)
        a.mark(text(s, x + 0.24, 2.14, 1.5, 0.22, need, size=8.5, color=MUTED,
                   spacing=1.2), 0.45 + i * 0.18, "fade", 0.35)
        a.mark(text(s, x + 0.24, 2.45, 2.5, 0.45, name, size=24, color=m["color"],
                   bold=True), 0.5 + i * 0.18, "rise", 0.45)
        a.mark(text(s, x + 0.24, 3.0, 3.1, 0.3, desc, size=9, color="C7D3E6"),
               0.55 + i * 0.18, "fade", 0.35)
        a.mark(text(s, x + 2.55, 3.05, 1.0, 0.5, score, size=24, color=m["color"],
                   bold=True, font=FONT_NUM, align="right", alpha=0.55),
               0.65 + i * 0.18, "fade", 0.35)

    a.mark(rect(s, 0.72, 4.82, 1.2, 0.04, fill=CYAN, lw=0), 1.2, "wipe", 0.5,
           direction="right")
    a.mark(text(s, 0.72, 4.98, 11.9, 0.7, "没有全能冠军，只有场景最优解。", size=30,
               color=INK, bold=True, spacing=1.0), 1.3, "rise", 0.55)
    a.mark(text(s, 0.74, 5.7, 11.0, 0.3,
               "代码是答卷，工程化才是分数；下一次选型，先问场景，再看分数。",
               size=10.5, color=MUTED), 1.55, "fade", 0.45)

    a.mark(rect(s, 0.72, 6.3, 11.89, 0.008, fill="2B3B56", lw=0), 1.75, "fade", 0.3)
    a.mark(text(s, 0.72, 6.48, 5.4, 0.24, "THANKS  FOR  WATCHING", size=9,
               color=CYAN, bold=True, spacing=3.0), 1.85, "fade", 0.45)
    a.mark(text(s, 5.8, 6.48, 3.4, 0.24, "NOLDOJ  /  AI MATCH", size=8,
               color=DIM, align="center", spacing=1.6), 1.9, "fade", 0.4)
    a.mark(text(s, 9.2, 6.48, 3.4, 0.24, "2026.11  ·  EVALUATION REPORT", size=8,
               color=MUTED, align="right", spacing=1.0), 1.95, "fade", 0.4)
    finish_page(s, a)


# ---------------------------------------------------------------------------
def build():
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)
    prs.core_properties.title = "NoldOJ 同题开发评测报告"
    prs.core_properties.subject = "DeepSeek / GLM / MiMo 三模型横向评测"
    prs.core_properties.author = "NoldOJ Evaluation"
    prs.core_properties.keywords = "NoldOJ, 大模型评测, 工程化, DeepSeek, GLM, MiMo"

    slide_cover(prs)
    slide_method(prs)
    slide_models(prs)
    slide_total(prs)
    slide_features(prs)
    slide_stability(prs)
    slide_ux(prs)
    slide_podium(prs)
    slide_highlights(prs)
    slide_selection(prs)
    slide_conclusion(prs)

    for sl, meta in zip(prs.slides, SLIDES):
        sl.notes_slide.notes_text_frame.text = meta["text"]

    OUT.mkdir(parents=True, exist_ok=True)
    pptx_path = OUT / "NoldOJ_Evaluation_Report.pptx"
    prs.save(pptx_path)
    with open(OUT / "animation_spec.json", "w", encoding="utf-8") as f:
        json.dump({str(k): v for k, v in ANIM.items()}, f, ensure_ascii=False, indent=2)
    with open(OUT / "script.md", "w", encoding="utf-8") as f:
        f.write(__import__("script").script_markdown())
    print("saved", pptx_path)
    print("slides", len(prs.slides), "effects", sum(len(v) for v in ANIM.values()))
    return pptx_path


if __name__ == "__main__":
    build()
