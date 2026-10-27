#!/usr/bin/env python3
"""Generate the README artwork in docs/.

Requires `rsvg-convert` (librsvg) and Pillow. Run from the repo root:

    python3 scripts/make-images.py
"""
from __future__ import annotations

import html
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

SANS = "Helvetica Neue, Hiragino Sans GB, Arial, sans-serif"
MONO = "Menlo, SF Mono, monospace"

BG1, BG2 = "#0A101E", "#101E36"
TEXT, MUTED, DIM = "#F8FAFC", "#93A4BD", "#5F7694"
BLUE, GREEN, AMBER, VIOLET, RED = "#7AA2FF", "#34D399", "#F5A524", "#A78BFA", "#F87171"
BORDER, PANEL, PANEL2 = "#243450", "#0C1526", "#0D1728"
GRID = "#16233A"


def esc(value: object) -> str:
    return html.escape(str(value))


def text(x, y, value, size=16, fill=TEXT, weight=400, family=SANS, anchor="start", spacing=None, opacity=None):
    extra = ""
    if anchor != "start":
        extra += f' text-anchor="{anchor}"'
    if spacing is not None:
        extra += f' letter-spacing="{spacing}"'
    if opacity is not None:
        extra += f' opacity="{opacity}"'
    return (
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" fill="{fill}" '
        f'font-weight="{weight}"{extra}>{esc(value)}</text>'
    )


def rect(x, y, w, h, fill=PANEL, stroke=BORDER, rx=14, sw=1, dash=None, opacity=None):
    extra = ""
    if dash:
        extra += f' stroke-dasharray="{dash}"'
    if opacity is not None:
        extra += f' opacity="{opacity}"'
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" '
        f'stroke="{stroke}" stroke-width="{sw}"{extra}/>'
    )


def line(x1, y1, x2, y2, color=BORDER, width=1, dash=None, marker=None, opacity=None):
    extra = ""
    if dash:
        extra += f' stroke-dasharray="{dash}"'
    if marker:
        extra += f' marker-end="url(#{marker})"'
    if opacity is not None:
        extra += f' opacity="{opacity}"'
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}"{extra}/>'


def defs(prefix="d"):
    return f"""
<defs>
  <linearGradient id="{prefix}bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{BG1}"/>
    <stop offset="0.6" stop-color="#0C1729"/>
    <stop offset="1" stop-color="{BG2}"/>
  </linearGradient>
  <radialGradient id="{prefix}glow" cx="0.82" cy="0.08" r="0.7">
    <stop offset="0" stop-color="#3B82F6" stop-opacity="0.24"/>
    <stop offset="1" stop-color="#3B82F6" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="{prefix}glow2" cx="0.12" cy="0.95" r="0.55">
    <stop offset="0" stop-color="#34D399" stop-opacity="0.10"/>
    <stop offset="1" stop-color="#34D399" stop-opacity="0"/>
  </radialGradient>
  <pattern id="{prefix}dots" width="26" height="26" patternUnits="userSpaceOnUse">
    <circle cx="1" cy="1" r="1" fill="#22314B" opacity="0.55"/>
  </pattern>
  <pattern id="{prefix}grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M40,0 L0,0 L0,40" fill="none" stroke="{GRID}" stroke-width="1" opacity="0.55"/>
  </pattern>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" fill="#6D84A6"/>
  </marker>
  <marker id="arrowBlue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" fill="{BLUE}"/>
  </marker>
  <marker id="arrowGreen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" fill="{GREEN}"/>
  </marker>
  <marker id="arrowAmber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" fill="{AMBER}"/>
  </marker>
</defs>
"""


def render(name: str, width: int, height: int, body: str, scale: int = 2) -> Path:
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">{defs()}{body}</svg>'
    )
    DOCS.mkdir(exist_ok=True)
    out = DOCS / name
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "image.svg"
        source.write_text(svg, encoding="utf-8")
        big = Path(tmp) / "image@2x.png"
        subprocess.run(
            ["rsvg-convert", "-w", str(width * scale), "-h", str(height * scale), str(source), "-o", str(big)],
            check=True,
        )
        Image.open(big).convert("RGB").resize((width, height), Image.LANCZOS).save(out, optimize=True)
    print(f"{out.relative_to(ROOT)}  {width}x{height}  {out.stat().st_size // 1024} KiB")
    return out


def banner(lang: str) -> None:
    zh = lang == "zh"
    tagline = (
        "把 devin-2api-lite 接入 DeepSeek Harness 的模型提供方插件"
        if zh
        else "Devin2API model provider for DeepSeek Harness"
    )
    features = (
        "流式 · 思考 · 工具 · 当前轮图片 · 额度胶囊"
        if zh
        else "Streaming · reasoning · tools · current-turn images · quota pill"
    )
    chip = "DEEPSEEK HARNESS 插件" if zh else "DEEPSEEK HARNESS PLUGIN"

    rows = [
        ("provider", "devin2api"),
        ("catalog", "GET /v1/models"),
        ("chat", "POST /v1/chat/completions"),
        ("stream", "text · reasoning · tools"),
        ("quota", "GET /v1/quota"),
    ]
    code = []
    for index, (key, value) in enumerate(rows):
        y = 178 + index * 27
        code.append(text(1024, y, key, 14, "#6E8BB0", 400, MONO))
        color = BLUE if value.startswith(("GET", "POST")) else "#DCE7F5"
        code.append(text(1132, y, value, 14, color, 400, MONO))

    body = f"""
{rect(0, 0, 1600, 400, "url(#dbg)", "none", 0, 0)}
{rect(0, 0, 1600, 400, "url(#dglow)", "none", 0, 0)}
{rect(0, 0, 1600, 400, "url(#dglow2)", "none", 0, 0)}
{rect(0, 0, 1600, 400, "url(#ddots)", "none", 0, 0)}
<rect x="80" y="78" width="{320 if zh else 300}" height="34" rx="17" fill="#13213A" stroke="#24395C"/>
{text(96, 100, chip, 12.5, "#8FB8FF", 600, SANS, spacing=1.4)}
<text x="80" y="200" font-family="{SANS}" font-size="70" font-weight="300">
  <tspan fill="#7C8DA8">dsh-</tspan><tspan fill="{TEXT}" font-weight="700">devin2api</tspan>
</text>
{text(80, 248, tagline, 24, "#B9C7DD")}
<circle cx="86" cy="282" r="3.5" fill="{GREEN}"/>
{text(98, 287, features, 17, "#7F90A8")}
{text(80, 352, "github.com/Green-hats/dsh-devin2api", 14, DIM)}

{rect(1000, 88, 520, 244, "#0B1526", BORDER, 16)}
<circle cx="1024" cy="112" r="5" fill="{RED}" opacity="0.85"/>
<circle cx="1040" cy="112" r="5" fill="{AMBER}" opacity="0.85"/>
<circle cx="1056" cy="112" r="5" fill="{GREEN}" opacity="0.85"/>
<line x1="1000" y1="132" x2="1520" y2="132" stroke="#1B2940"/>
{''.join(code)}
<line x1="1000" y1="298" x2="1520" y2="298" stroke="#1B2940"/>
<circle cx="1024" cy="322" r="3.5" fill="{GREEN}"/>
{text(1036, 326, "gateway 127.0.0.1:18089", 12, "#7F90A8", 400, MONO)}
"""
    render("banner.zh-CN.png" if zh else "banner.png", 1600, 400, body)


def architecture() -> None:
    boxes = [
        # x, w, title, subtitle, accent, lines
        (20, 300, "DeepSeek Harness", "host application", BLUE, ["Agent loop", "Model selector", "Settings UI", "Quota pill", "Tool execution"]),
        (440, 300, "dsh-devin2api", "this plugin", GREEN, ["LLM adapter", "protocol translation", "catalog + schema", "web client", "image budgets"]),
        (860, 300, "devin-2api-lite", "OpenAI-compatible gateway", AMBER, ["GET  /v1/models", "POST /v1/chat/completions", "GET  /v1/quota", "GET  /healthz"]),
        (1280, 300, "Devin", "upstream", VIOLET, ["Connect RPC", "GetChatMessage", "protobuf frames", "streamed events", ""]),
    ]
    body = [
        rect(0, 0, 1600, 760, "url(#dbg)", "none", 0, 0),
        rect(0, 0, 1600, 760, "url(#dgrid)", "none", 0, 0),
        text(64, 70, "ARCHITECTURE", 13, DIM, 600, spacing=2.4),
        text(64, 108, "One provider, four hops", 30, TEXT, 600),
        text(64, 140, "Chat streams through the adapter; settings and quota talk to the gateway directly.", 15, "#8496B0"),
    ]
    for x, w, title, subtitle, accent, lines in boxes:
        body.append(rect(x, 190, w, 300, PANEL, BORDER, 16))
        body.append(rect(x, 190, w, 4, accent, "none", 2))
        body.append(text(x + 24, 232, title, 23, TEXT, 600))
        body.append(text(x + 24, 256, subtitle, 12.5, DIM))
        body.append(line(x + 24, 274, x + w - 24, 274, "#1B2940"))
        for index, content in enumerate(lines):
            if not content:
                continue
            y = 306 + index * 29
            body.append(text(x + 24, y, content, 14, "#C3D0E2", 400, MONO if title.startswith("devin") else SANS))
        if title == "devin-2api-lite":
            body.append(text(x + 24, 470, "5-minute caches · CORS on GET", 11.5, DIM))

    # protocol labels and arrows
    body.extend(
        [
            # 1 <-> 2
            text(370, 302, "GenerateOptions", 11.5, "#8FA3BF", 400, MONO, anchor="middle"),
            line(320, 318, 440, 318, "#4E6A90", 1.5, marker="arrow"),
            line(440, 372, 320, 372, "#4E6A90", 1.5, marker="arrow"),
            text(380, 396, "StreamChunk", 11.5, "#8FA3BF", 400, MONO, anchor="middle"),
            # 2 <-> 3
            text(800, 318, "HTTP + SSE", 11.5, "#8FA3BF", 400, MONO, anchor="middle"),
            line(740, 336, 860, 336, GREEN, 1.8, marker="arrowGreen"),
            text(800, 378, "Chat Completions", 11.5, "#8FA3BF", 400, MONO, anchor="middle"),
            # 3 <-> 4
            text(1220, 318, "Connect RPC", 11.5, "#8FA3BF", 400, MONO, anchor="middle"),
            line(1160, 336, 1280, 336, VIOLET, 1.8, marker="arrow"),
            text(1220, 378, "protobuf", 11.5, "#8FA3BF", 400, MONO, anchor="middle"),
            # host/gateway labels
            text(20, 176, "HOST", 11, DIM, 600, spacing=2),
            text(860, 176, "GATEWAY", 11, DIM, 600, spacing=2),
            text(1280, 176, "UPSTREAM", 11, DIM, 600, spacing=2),
        ]
    )

    # browser strip
    body.extend(
        [
            rect(440, 572, 720, 92, "#0B1526", "#2A3D5B", 14, 1, dash="6 6"),
            text(464, 602, "Browser (renderer)", 15, "#DCE7F5", 600),
            text(464, 628, "Settings page and quota pill read /v1/models + /v1/quota", 12.5, "#8496B0"),
            text(464, 648, "CORS allowed · no API key in the request", 12.5, "#8496B0"),
            line(1080, 572, 1080, 490, "#6D84A6", 1.4, dash="5 5", marker="arrow"),
            text(1094, 536, "direct GETs", 11, "#8FA3BF", 400, MONO),
        ]
    )
    body.append(text(64, 712, "Catalog and quota are read on demand; every chat step streams through the adapter.", 12, DIM))
    render("architecture.png", 1600, 760, "".join(body))


HELV = "/System/Library/Fonts/HelveticaNeue.ttc"
HIRA = "/System/Library/Fonts/Hiragino Sans GB.ttc"

UI_TEXT = (248, 250, 252, 255)
UI_MUTED = (147, 164, 189, 255)
UI_DIM = (95, 118, 148, 255)
UI_GREEN = (52, 211, 153, 255)
UI_PANEL = (12, 21, 38, 255)
UI_BORDER = (36, 52, 80, 255)


def _ui_font(zh: bool, size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    if zh:
        return ImageFont.truetype(HIRA, int(size), index=2 if bold else 0)
    return ImageFont.truetype(HELV, int(size), index=1 if bold else 0)


def _spaced_text(draw, xy, value, font, fill, spacing=2.2):
    x, y = xy
    for char in value:
        draw.text((x, y), char, font=font, fill=fill)
        x += draw.textlength(char, font=font) + spacing


def _ui_background(w, h):
    canvas = Image.new("RGBA", (w, h))
    draw = ImageDraw.Draw(canvas)
    top, bottom = (10, 16, 30), (16, 30, 54)
    for y in range(h):
        t = y / max(1, h - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line((0, y, w, y), fill=color + (255,))
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((-w * 0.25, -h * 0.55, w * 0.8, h * 0.5), fill=(59, 130, 246, 55))
    glow_draw.ellipse((w * 0.55, h * 0.55, w * 1.3, h * 1.2), fill=(52, 211, 153, 24))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(140)))
    for y in range(0, h, 26):
        for x in range(0, w, 26):
            draw.ellipse((x, y, x + 2, y + 2), fill=(34, 49, 75, 70))
    return canvas


def _card(draw, box):
    draw.rounded_rectangle(box, radius=18, fill=UI_PANEL, outline=UI_BORDER, width=1)


def _paste_rounded(canvas, image, xy, radius, border=UI_BORDER):
    x, y = xy
    w, h = image.size
    shadow = Image.new("RGBA", (w + 48, h + 48), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((24, 24, 24 + w, 24 + h), radius=radius, fill=(0, 0, 0, 120))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)), (x - 24, y - 24 + 8))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    layer = image.convert("RGBA").copy()
    layer.putalpha(mask)
    canvas.alpha_composite(layer, (x, y))
    ImageDraw.Draw(canvas).rounded_rectangle((x, y, x + w - 1, y + h - 1), radius=radius, outline=border, width=1)


def ui_showcase(lang: str) -> None:
    zh = lang == "zh"
    W, H = 1600, 1080
    canvas = _ui_background(W, H)
    draw = ImageDraw.Draw(canvas)

    _spaced_text(draw, (64, 50), "WEB UI", _ui_font(zh, 12), UI_DIM)
    draw.text(
        (64, 84),
        "设置页与额度胶囊" if zh else "Settings and quota, in place",
        font=_ui_font(zh, 34, True),
        fill=UI_TEXT,
    )
    draw.text(
        (64, 134),
        "设置 → Devin2API 与输入区胶囊的真实截图。" if zh else "The real settings page and the composer, side by side.",
        font=_ui_font(zh, 15),
        fill=UI_MUTED,
    )

    # settings page
    _card(draw, (56, 180, 1056, 1000))
    draw.text((84, 206), "设置 → Devin2API" if zh else "Settings → Devin2API", font=_ui_font(True, 20, True), fill=UI_TEXT)
    draw.text((84, 236), "额度与模型目录" if zh else "quota and catalog", font=_ui_font(zh, 12), fill=UI_DIM)
    draw.line((84, 260, 1028, 260), fill=(27, 41, 64, 255))
    settings = Image.open(DOCS / "settings.jpg")
    settings = settings.resize((827, round(827 * settings.height / settings.width)), Image.LANCZOS)
    _paste_rounded(canvas, settings, (142, 276), 10)

    # composer
    _card(draw, (1088, 180, 1544, 430))
    draw.text((1112, 206), "输入区" if zh else "Composer", font=_ui_font(zh, 20, True), fill=UI_TEXT)
    draw.text((1112, 236), "额度胶囊在这里" if zh else "the quota pill lives here", font=_ui_font(zh, 12), fill=UI_DIM)
    draw.line((1112, 260, 1520, 260), fill=(27, 41, 64, 255))
    composer = Image.open(DOCS / "composer.png")
    composer = composer.resize((408, round(408 * composer.height / composer.width)), Image.LANCZOS)
    _paste_rounded(canvas, composer, (1112, 276), 8)
    draw.text(
        (1112, 352),
        "60 秒轮询 · 点击跳过缓存" if zh else "60 s poll · click for ?fresh=1",
        font=_ui_font(zh, 12),
        fill=UI_MUTED,
    )
    draw.text(
        (1112, 374),
        "仅在 devin2api 模型下出现" if zh else "only for a devin2api model",
        font=_ui_font(zh, 12),
        fill=UI_MUTED,
    )

    # pill close-up
    _card(draw, (1088, 450, 1544, 700))
    draw.text((1112, 476), "额度胶囊" if zh else "Quota pill", font=_ui_font(zh, 20, True), fill=UI_TEXT)
    draw.text((1112, 506), "日 / 周剩余额度" if zh else "daily / weekly remaining", font=_ui_font(zh, 12), fill=UI_DIM)
    draw.line((1112, 530, 1520, 530), fill=(27, 41, 64, 255))
    source = Image.open(DOCS / "composer.png")
    pill = source.crop((1034, 138, 1306, 192))
    pill = pill.resize((408, round(408 * pill.height / pill.width)), Image.LANCZOS)
    _paste_rounded(canvas, pill, (1112, 546), 8)
    draw.text(
        (1112, 646),
        "日 / 周剩余额度 · 点击刷新" if zh else "daily / weekly remaining · click to refresh",
        font=_ui_font(zh, 12),
        fill=UI_MUTED,
    )
    draw.text(
        (1112, 672),
        "跳过网关 5 分钟缓存" if zh else "bypasses the gateway's 5-minute cache",
        font=_ui_font(zh, 12),
        fill=UI_DIM,
    )

    # status summary
    _card(draw, (1088, 720, 1544, 1000))
    draw.text((1112, 746), "一眼看" if zh else "At a glance", font=_ui_font(zh, 20, True), fill=UI_TEXT)
    rows = [
        ("网关 · 127.0.0.1:18089" if zh else "gateway · 127.0.0.1:18089"),
        ("目录 · 122 个模型 · 已启用 5" if zh else "catalog · 122 models · 5 enabled"),
        ("设置 · 即时生效（volatile）" if zh else "settings · live (volatile)"),
        ("浏览器 · 只读端点不带密钥" if zh else "browser · CORS, no API key"),
        ("路由 · devin2api" if zh else "route · devin2api"),
    ]
    y = 782
    for row in rows:
        draw.ellipse((1112, y + 6, 1118, y + 12), fill=UI_GREEN)
        draw.text((1126, y), row, font=_ui_font(zh, 13), fill=UI_MUTED)
        y += 28

    draw.text((64, 1038), "Devin2API · DeepSeek Harness", font=_ui_font(zh, 12), fill=UI_DIM)
    draw.text(
        (1536, 1038),
        "github.com/Green-hats/dsh-devin2api",
        font=_ui_font(False, 12),
        fill=UI_DIM,
        anchor="ra",
    )

    out = DOCS / ("ui.zh-CN.png" if zh else "ui.png")
    canvas.convert("RGB").save(out, optimize=True)
    print(f"{out.relative_to(ROOT)}  {W}x{H}  {out.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    banner("en")
    banner("zh")
    architecture()
    ui_showcase("en")
    ui_showcase("zh")
