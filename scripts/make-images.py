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


def surfaces(lang: str) -> None:
    zh = lang == "zh"
    title = "三个界面，一个提供方" if zh else "Three surfaces, one provider"
    subtitle = (
        "设置页负责额度与模型开关，Models 行负责路由，输入区胶囊只显示额度。"
        if zh
        else "A settings page for quota and switches, a Models row for routing, a pill for quota."
    )
    panel1 = "设置 → Devin2API" if zh else "Settings → Devin2API"
    panel1_sub = "额度 · 模型目录" if zh else "quota · catalog"
    panel2 = "设置 → 模型 → Devin2API" if zh else "Settings → Models → Devin2API"
    panel2_sub = "提供方行" if zh else "provider row"
    panel3 = "输入区" if zh else "Composer"
    panel3_sub = "额度胶囊" if zh else "quota pill"
    connected = "已连接 · 127.0.0.1:18089"
    daily = "今日剩余"
    weekly = "本周剩余"
    reset = "周一 09:00 重置"
    discover = "发现模型" if zh else "Discover models"
    base_url = "Base URL"
    api_key = "API key"
    images = "图片输入"
    composer = "有什么可以帮你？"
    caption = (
        "示意图，非截图。当前 UI 文案为中文；胶囊只会在选中 devin2api 模型时出现。"
        if zh
        else "Schematic, not a screenshot. UI copy is Chinese today; the pill appears only for a devin2api model."
    )

    def toggle(x, y, on=True):
        fill = "#2F6B55" if on else "#1E2C44"
        knob = GREEN if on else "#5F7694"
        return (
            rect(x, y, 38, 22, fill, "none", 11)
            + f'<circle cx="{x + (26 if on else 12)}" cy="{y + 11}" r="7.5" fill="{knob}"/>'
        )

    def bar(x, y, w, pct, color):
        return (
            rect(x, y, w, 7, "#16233A", "none", 4)
            + f'<rect x="{x}" y="{y}" width="{int(w * pct / 100)}" height="7" rx="4" fill="{color}"/>'
        )

    body = [
        rect(0, 0, 1600, 780, "url(#dbg)", "none", 0, 0),
        rect(0, 0, 1600, 780, "url(#dgrid)", "none", 0, 0),
        text(64, 70, "WEB UI", 13, DIM, 600, spacing=2.4),
        text(64, 108, title, 30, TEXT, 600),
        text(64, 138, subtitle, 14.5, "#8496B0"),
    ]

    # panel 1
    body.extend(
        [
            rect(64, 176, 470, 520, PANEL, BORDER, 18),
            text(88, 216, panel1, 20, TEXT, 600),
            text(88, 238, panel1_sub, 12, DIM),
            line(88, 256, 510, 256, "#1B2940"),
            f'<circle cx="98" cy="284" r="4" fill="{GREEN}"/>',
            text(110, 289, connected, 12.5, "#A9B8CD", 400, MONO),
            rect(88, 306, 422, 162, PANEL2, "#1E2C44", 12),
            text(106, 334, "额度 · Pro", 13, "#8496B0", 500),
            text(106, 366, daily, 13, "#A9B8CD"),
            text(492, 368, "71%", 18, GREEN, 600, anchor="end"),
            bar(106, 378, 386, 71, GREEN),
            text(106, 414, weekly, 13, "#A9B8CD"),
            text(492, 416, "65%", 18, AMBER, 600, anchor="end"),
            bar(106, 426, 386, 65, AMBER),
            text(106, 452, reset, 11.5, DIM),
            text(88, 500, "模型目录", 13, "#8496B0", 600),
        ]
    )
    rows = [
        ("claude-opus-5", True),
        ("deepseek-v4-1-flash", True),
        ("gemini-3-5-flash", False),
    ]
    for index, (name, on) in enumerate(rows):
        y = 522 + index * 46
        body.append(rect(88, y, 422, 38, "#0E1A2D" if on else "#0B1524", "#1C2A42", 9))
        body.append(text(104, y + 24, name, 12.5, "#C3D0E2" if on else "#6F819B", 400, MONO))
        body.append(toggle(462, y + 8, on))
    body.append(text(88, 674, "开关立即写入 · 全部关闭时回退完整目录" if zh else "Writes immediately · all-off falls back to the full catalog", 11, DIM))

    # panel 2
    body.extend(
        [
            rect(574, 176, 470, 520, PANEL, BORDER, 18),
            text(598, 216, panel2, 18, TEXT, 600),
            text(598, 238, panel2_sub, 12, DIM),
            line(598, 256, 1020, 256, "#1B2940"),
            text(598, 296, base_url, 12, "#8496B0", 500),
            rect(598, 308, 422, 38, PANEL2, "#1E2C44", 9),
            text(614, 332, "http://127.0.0.1:18089/v1", 12, "#C3D0E2", 400, MONO),
            text(598, 380, api_key, 12, "#8496B0", 500),
            rect(598, 392, 422, 38, PANEL2, "#1E2C44", 9),
            text(614, 416, "••••••••••••••••", 12, "#C3D0E2", 400, MONO),
            text(598, 464, images, 12, "#8496B0", 500),
            toggle(990, 446, True),
            rect(598, 500, 160, 40, "#173A5E", "#2D5C8C", 10),
            text(678, 526, discover, 13, "#BBD4F8", 600, anchor="middle"),
            text(598, 570, "上下文 262144 · 输出上限 128000" if zh else "context 262144 · max output 128000", 11.5, DIM),
            text(598, 596, "apiKey 为空时读取 DEVIN2API_API_KEY" if zh else "reads DEVIN2API_API_KEY when apiKey is empty", 11.5, DIM),
            text(598, 640, "settingsNs    devin2api", 10.5, DIM, 400, MONO),
            text(598, 662, "settingsPath  providers.devin2api", 10.5, DIM, 400, MONO),
        ]
    )

    # panel 3
    body.extend(
        [
            rect(1084, 176, 452, 250, PANEL, BORDER, 18),
            text(1108, 216, panel3, 20, TEXT, 600),
            text(1108, 238, panel3_sub, 12, DIM),
            line(1108, 256, 1512, 256, "#1B2940"),
            rect(1108, 296, 404, 64, PANEL2, "#2A3D5B", 12),
            text(1124, 334, composer, 13, "#6F819B"),
            rect(1300, 312, 196, 32, "#0F1D31", "#2A3D5B", 16),
            f'<circle cx="1318" cy="328" r="3.5" fill="{GREEN}"/>',
            text(1328, 333, "日 71%", 11, "#C3D0E2"),
            text(1372, 333, "│", 11, "#41536E"),
            f'<circle cx="1386" cy="328" r="3.5" fill="{AMBER}"/>',
            text(1396, 333, "周 65%", 11, "#C3D0E2"),
            text(1108, 390, "点击胶囊：跳过网关 5 分钟缓存" if zh else "Click the pill: bypass the gateway's 5-minute cache", 11.5, DIM),
            text(1108, 412, "非 devin2api 模型时自动隐藏" if zh else "Hidden while another provider is selected", 11.5, DIM),
        ]
    )

    body.append(text(64, 748, caption, 11.5, DIM))
    render("surfaces.zh-CN.png" if zh else "surfaces.png", 1600, 780, "".join(body))


if __name__ == "__main__":
    banner("en")
    banner("zh")
    architecture()
    surfaces("en")
    surfaces("zh")
