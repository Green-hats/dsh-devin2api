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

from PIL import Image

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


if __name__ == "__main__":
    banner("en")
    banner("zh")
    architecture()
