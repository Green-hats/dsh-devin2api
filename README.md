<div align="center">

<img src="docs/banner.png" alt="dsh-devin2api — Devin2API model provider for DeepSeek Harness" width="100%">

**A model-provider plugin that brings [devin-2api-lite](https://github.com/Green-hats/devin-2api-lite) into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.3-4d6bfe?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Gateway](https://img.shields.io/badge/gateway-devin--2api--lite-2ea44f?style=flat-square)](https://github.com/Green-hats/devin-2api-lite)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)
[![CI](https://github.com/Green-hats/dsh-devin2api/actions/workflows/ci.yml/badge.svg)](https://github.com/Green-hats/dsh-devin2api/actions/workflows/ci.yml)

English | [中文](README.zh-CN.md)

[Why](#why) · [Quick start](#quick-start) · [Configuration](#configuration) · [Web UI](#web-ui) · [Protocol](#protocol-mapping) · [Troubleshooting](#troubleshooting)

</div>

---

> [!IMPORTANT]
> This plugin is the **client half**. [devin-2api-lite](https://github.com/Green-hats/devin-2api-lite) owns the Devin
> protocol, the model catalog, the quota snapshot and your upstream token. The plugin only adapts DeepSeek Harness'
> model API to the gateway's OpenAI-compatible Chat Completions endpoint.
>
> Start the gateway first: the plugin advertises no models and cannot stream without it.

`dsh-devin2api` registers the provider route **`devin2api`** inside DeepSeek Harness. It reads the gateway catalog from
`GET /v1/models`, streams `POST /v1/chat/completions` as DSH `StreamChunk`s, and adds a settings page, per-model
visibility switches, and a daily/weekly quota pill to the Web UI.

No build step. No runtime dependencies beyond the packages DSH already provides.

## Why

| Area | What you get |
| --- | --- |
| **Catalog** | `/v1/models` cached for `refreshMinutes`, single-flight, graceful fallback to a configured model list |
| **Chat** | Streaming text, `reasoning_content`, tool calls, usage, mapped finish reasons |
| **Reasoning** | Per-model efforts from `reasoning_efforts`; `high` is the default when advertised |
| **Images** | Current-turn images as base64 data URLs, resized and byte-capped; history becomes placeholder text |
| **Control** | `models` allowlist and per-model switches (`modelVisibility`) with an all-off safety fallback |
| **Settings** | Editable row in **Settings → Models** and a dedicated **Settings → Devin2API** page |
| **Quota** | Daily/weekly remaining percentage in the composer; click to bypass the gateway cache |
| **Ops** | Stable error codes for auth, quota, timeout, aborts and image budgets; optional local debug log |

### Gateway endpoints this plugin uses

| Endpoint | Caller | Credential |
| --- | --- | --- |
| `GET /healthz` | settings panel | none |
| `GET /v1/models` | catalog, visibility, model discovery | Host: `Bearer`; browser: no header |
| `GET /v1/quota` | quota pill and panel | browser: no header |
| `POST /v1/chat/completions` | every model call | `Bearer` |
| `POST /__clientlog` | optional diagnostics | none; local only |

The browser reads the three GET endpoints directly (and the gateway must allow CORS on them, as lite does). It never
carries the API key — see [Web UI](#web-ui).

## Requirements

- **DeepSeek Harness** `0.2.x` (verified on `0.2.1-rc.3`). Peer packages:
  `@deepseek-ai/dsh-llm >= 0.1.5-rc.1`, `@deepseek-ai/schemastery >= 3.18.0`.
- **Node.js** `^22.19.0 || >=24.0.0`.
- **devin-2api-lite** with `/v1/quota` and read-only CORS enabled (both are in current lite releases).
- The Host `attachments` service (present in the default composition) for image input.
- Gateway reachable from the Host **and** from the browser that renders the settings page and quota pill.

## Quick start

### 1. Start the gateway

```bash
git clone https://github.com/Green-hats/devin-2api-lite.git
cd devin-2api-lite
cp config.example.yaml config.yaml     # set devin.token
go run ./cmd/devin-2api -config config.yaml

curl -s http://127.0.0.1:18089/healthz
# {"status":"ok"}
```

See the [lite quick start](https://github.com/Green-hats/devin-2api-lite#quick-start) for tokens, Docker and
configuration.

### 2. Install the plugin

```bash
# from GitHub
dsh plugin --profile desktop add github:Green-hats/dsh-devin2api

# or from a local checkout
dsh plugin --profile desktop add /absolute/path/to/dsh-devin2api
```

Restart the profile (or reload the plugin) after installing. The bundle patch inserts this row:

```yaml
- id: devin2api
  name: dsh-devin2api
  config:
    providers:
      devin2api:
        displayName: Devin2API
        baseURL: http://127.0.0.1:18089/v1
        apiKeyEnv: DEVIN2API_API_KEY
        enabled: true
        images: true
        models: []
```

### 3. Point it at the gateway

Either edit the row in **Settings → Models → Devin2API**, or override the same `id` in
`$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: devin2api
  config:
    providers:
      devin2api:
        baseURL: http://127.0.0.1:18089/v1
        apiKeyEnv: DEVIN2API_API_KEY
```

### 4. Pick a model

Open `/model` in DSH and choose **Devin2API**. The catalog is the gateway's `/v1/models`; a model switch or a
draft endpoint change is reflected by the provider directory and model discovery.

### 5. Verify

```bash
curl -s http://127.0.0.1:18089/v1/models | head -c 200
curl -s http://127.0.0.1:18089/v1/quota
```

## Configuration

All plugin configuration lives under `providers.devin2api` so that the Models page can address one provider object
(`settingsPath: ["providers", "devin2api"]`).

```yaml
- id: devin2api
  name: dsh-devin2api
  config:
    providers:
      devin2api:
        displayName: Devin2API
        baseURL: http://127.0.0.1:18089/v1
        apiKeyEnv: DEVIN2API_API_KEY
        apiKey: ''
        enabled: true
        models: []
        modelVisibility: {}
        images: true
        contextWindow: 262144
        maxTokens: 128000
        refreshMinutes: 5
        requestTimeoutMs: 300000
        imagePixelBudget: 4194304
        imageMaxBytes: 1048576
        maxRequestImageBytes: 20971520
```

| Field | Default | Notes |
| --- | --- | --- |
| `displayName` | `Devin2API` | Provider name in the model selector and provider list |
| `baseURL` | `http://127.0.0.1:18089/v1` | Gateway root including `/v1`; trailing slashes are tolerated |
| `apiKey` | `''` | Direct key; `role('secret')` so the settings document redacts it. Prefer `apiKeyEnv` |
| `apiKeyEnv` | `DEVIN2API_API_KEY` | Environment variable read at request time when `apiKey` is empty |
| `enabled` | `true` | Mount-time gate: changing it requires reloading the plugin or restarting the profile |
| `models` | `[]` | Empty advertises every gateway model. Non-empty is an allowlist of ids or `{ id, name }` objects |
| `modelVisibility` | `{}` | Per-model switch written by the settings page; `false` hides a model (all-off falls back to the full catalog) |
| `images` | `true` | Declares image input for vision-capable models; `false` forces text-only projection |
| `contextWindow` | `262144` | Reported to DSH because `/v1/models` does not disclose limits |
| `maxTokens` | `128000` | Default output cap sent as `max_tokens` |
| `refreshMinutes` | `5` | Catalog cache TTL (minimum 1 minute) |
| `requestTimeoutMs` | `300000` | Per-request timeout, including the stream |
| `imagePixelBudget` | `4194304` | Pixel budget used to resize an image before encoding |
| `imageMaxBytes` | `1048576` | Per-image byte cap after encoding |
| `maxRequestImageBytes` | `20971520` | Total base64 data-URL characters allowed in one request |

`DEVIN2API_BASE_URL` is reported to the Models page as the provider's endpoint environment hint; the adapter itself
resolves `baseURL` from the config.

### Hot updates

Every editable field except `enabled` is declared `.volatile()`, so the settings page writes take effect on the running
adapter without a remount. `enabled` is evaluated once when the plugin mounts; changing it from `false` to `true` (or
the reverse) requires a plugin reload. See [Known limitations](#known-limitations).

## Web UI

<img src="docs/surfaces.png" alt="UI surfaces: the Devin2API settings page, the Models provider row, and the composer quota pill" width="100%">

_Schematic of the three surfaces; the UI copy is Chinese today._

**Settings → Devin2API** (own page):

- gateway connection state and resolved root URL;
- today's and this week's remaining quota, reset times and stale-snapshot marker;
- the model catalog with search, one switch per model, **all on** / **all off**, and refresh.

**Settings → Models → Devin2API** (provider card):

- editable `baseURL`, API key, image capability and model discovery. The row lives in the shared Models page; the
  plugin does not duplicate it in its own panel.

**Composer quota pill** (`conversation.input.right`):

- renders only while the session's selected provider is `devin2api`;
- polls `GET /v1/quota` every 60 seconds and is hidden when the endpoint is unavailable;
- click to request `?fresh=1` (lite bypasses its 5-minute cache);
- shows `日 71% │ 周 65%` today; UI copy is Chinese-only for now (see [Known limitations](#known-limitations)).

### Browser and credentials

The panel and pill run in the renderer process and call the gateway directly. They send **no** `Authorization`
header, so with `auth.api_key` set on the gateway:

- chat still works (the Host sends `Bearer`);
- `GET /v1/models` and `GET /v1/quota` return `401`, so the panel shows no catalog and the pill disappears.

Keep `auth.api_key` empty for a local gateway, or terminate CORS/auth in a proxy you control. `GET /healthz` and
`POST /__clientlog` are public in lite; keep the gateway bound to loopback.

## Model catalog

- The catalog is fetched with `GET /v1/models`, cached for `refreshMinutes`, and refreshed in a single flight.
- On a transient failure the adapter serves the last snapshot; without a snapshot it falls back to `models`, or reports
  `EMPTY_CATALOG` when both are empty.
- `models` is an allowlist. If none of its ids exist in the gateway catalog, the adapter warns and advertises the whole
  catalog instead of silently hiding everything.
- `modelVisibility` is applied after the allowlist. If every remaining model is switched off, the full remaining list is
  advertised so the selector never empties; the panel explains this fallback.

`GET /v1/models` does not disclose context windows or output limits, so `contextWindow` / `maxTokens` are per-provider
configuration values.

## Images

- Only the **current turn** is uploaded. The boundary is the last `user` message: images in that message and in tool
  results after it stay; earlier images become `[Image omitted from history]`. This keeps vision working across tool
  loops without re-uploading the whole conversation.
- Each image is resized within `imagePixelBudget` and capped at `imageMaxBytes`; a request whose data URLs exceed
  `maxRequestImageBytes` fails with `IMAGE_BUDGET` instead of sending a truncated body.
- `images: false`, a model with `supports_images: false`, or a missing `attachments` service makes DSH project images
  to text before dispatch; the gateway never receives an unsupported image.
- Requires the Host `attachments` service (present in the default composition).

## Protocol mapping

### Request

| DSH input | OpenAI Chat Completions request |
| --- | --- |
| `options.system` + leading `system` messages | one `system` message |
| `developer` message | `system` message |
| mid-history `system` message | `system` message (preserved, not dropped) |
| user text / images | string, or `[{ type: "text" }, { type: "image_url", image_url: { url } }]` |
| assistant text / tool calls | `{ role: "assistant", content, tool_calls }` with JSON-string arguments |
| tool result | `{ role: "tool", tool_call_id, content }` |
| `tools` | OpenAI `function` tools; `deferLoading` entries are skipped |
| `maxTokens` | `max_tokens` |
| `reasoningEffort` | `reasoning_effort` |
| `temperature` / `stop` | `temperature` / `stop` |
| — | `stream: true`, `stream_options: { include_usage: true }` |

> [!NOTE]
> Current lite releases fix sampling (`max_tokens=128000`, `temperature=1`, `top_p=0.95`, `top_k=40`) and ignore
> client values; this plugin still forwards them for gateways that honor them. See
> [lite caveats](https://github.com/Green-hats/devin-2api-lite#caveats).

### Stream

| DSH chunk | Upstream source |
| --- | --- |
| `block-start` / `block-end` | one per reasoning, text or tool-call block |
| `reasoning-delta` | `choices[0].delta.reasoning_content` |
| `text-delta` | `choices[0].delta.content` |
| `tool-call-delta` | `choices[0].delta.tool_calls[].function.arguments` |
| `usage` | final `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`, cached tokens) |
| `finish` | `finish_reason`: `length` → `max-tokens`, `tool_calls` / `function_call` → `tool-calls`, otherwise `stop` |

### Error codes

| Code | Meaning |
| --- | --- |
| `AUTH` | `401` / `403` from the gateway |
| `QUOTA` | `429` |
| `INVALID_REQUEST` | `400` / `413` / `422` |
| `TIMEOUT` | `504` or the per-request timeout fired |
| `ABORTED` | The caller cancelled the stream or request |
| `TRANSPORT` | Gateway unreachable, connection dropped mid-stream, or unreadable response |
| `SERVER` | Any other HTTP status |
| `IMAGE_BUDGET` | The request's images exceed `maxRequestImageBytes` |
| `IMAGE_UNAVAILABLE` | An attachment could not be read |
| `EMPTY_CATALOG` | `/v1/models` returned no usable entries |
| `EMPTY_RESPONSE` | The stream ended without content or a finish reason |
| `UPSTREAM_ERROR` | The gateway sent an error chunk |

Cancellation is reported as `ABORTED` (not `TRANSPORT`), so the harness can distinguish a user stop from a failure.

## Architecture

<img src="docs/architecture.png" alt="Architecture: DeepSeek Harness to dsh-devin2api to devin-2api-lite to Devin" width="100%">

| File | Role |
| --- | --- |
| `lib/index.js` | Host adapter: registration, catalog, stream, images, discovery, settings policy |
| `lib/protocol.js` | Message/tool/SSE translation; no DSH imports |
| `lib/catalog.js` | Catalog and quota parsing, visibility, error mapping, volatile unwrapping |
| `lib/schema.js` | Config schema; every editable field is `.volatile()` |
| `lib/client.js` | Web UI: settings page, catalog switches, quota pill |
| `cordis.patch.yml` | Profile patch inserted by the bundle |
| `test/` | `node:test` suite; `test/register.mjs` + `test/fixtures/dsh-llm` make it runnable outside DSH |

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `cannot reach the gateway` | `curl /healthz`, `baseURL`, firewall; the Host must reach it too |
| `AUTH` on chat | `apiKey` / `apiKeyEnv`; lite's `auth.api_key` must match |
| Empty model selector | `curl /v1/models`; set `models` as a fallback; reload the plugin |
| Images become placeholder text | Expected for history. Check `images`, `supports_images`, `attachments`, and the image budgets |
| Settings page says unavailable | The namespace needs volatile fields; check the Host log and `POST /__clientlog` |
| Model switches do nothing | Settings are read-only, or every model is off and the host falls back to the full catalog |
| Quota pill missing | Session is not on a `devin2api` model; gateway down; CORS blocked; `auth.api_key` set |
| Client render errors | `POST /__clientlog`; lite appends browser and Host reports to `$TMPDIR/dsh-devin2api-client.log` |

To remove the plugin, remove the bundle from the profile (`dsh plugin --profile desktop remove dsh-devin2api`) and
restart; the inserted row and its settings go with it.

## Known limitations

- **No replay state.** Reasoning text is not sent back as provider state; multi-turn requests replay visible text and
  tool calls only.
- **One gateway per plugin instance.** A second endpoint needs a second plugin instance and provider route.
- **`enabled` requires a reload.** The route is registered at mount time.
- **The browser UI is unauthenticated.** The panel and pill call the gateway without an API key; use a loopback
  gateway with `auth.api_key` unset.
- **No multi-account failover or local usage analytics.** Those are the gateway's job (or a future plugin surface).
- **Chinese-only UI copy.** The settings page and pill are not yet wired to the Client locale service.
- **Sampling is gateway-owned.** Current lite ignores client `max_tokens` / `temperature` / `stop`; see its caveats.
- **Per-provider limits.** `/v1/models` does not disclose context windows, so `contextWindow` and `maxTokens` are
  configured, not discovered.

## Compared with dsh-opencode-go

| | `dsh-opencode-go` | `dsh-devin2api` |
| --- | --- | --- |
| Protocol | OpenAI / Anthropic / Google SDK | OpenAI Chat Completions |
| Multi-account failover | Yes | No |
| Usage dashboard | Local log scan | Gateway `/v1/quota` |
| Quota pill | Host remote | Browser direct + CORS |
| Images | Yes | Current turn |
| Footprint | ~60k lines + build | ~2.1k lines, dependency-free ESM, no build |

## Development

```bash
npm install --legacy-peer-deps   # installs the schemastery peer used by the schema tests
npm test                         # node --test, 30 tests
npm run check                    # node --check for every lib/*.js
```

`--legacy-peer-deps` is required because the published `@deepseek-ai/dsh-llm` is older than the version DSH ships; the
test loader maps that specifier to `test/fixtures/dsh-llm/index.js` so the suite runs without a DSH installation.
`schemastery` is a real dev dependency.

Layout:

```
lib/index.js       Host adapter
lib/protocol.js    pure translation layer
lib/catalog.js     pure parsing layer
lib/schema.js      Config schema
lib/client.js      Web client module
test/              node:test suites + DSH stub
.github/workflows  Node 22/24 CI
docs/              README artwork (regenerate with `scripts/make-images.py`)
```

Adding a configuration field: add it to `profileSchema` with `.volatile()`, add its default to `PROFILE_DEFAULTS`,
extend the volatile-form guard in `test/protocol.test.mjs`, and update both READMEs. Settings writes must remain live
on the running adapter; do not unwrap the config object in `apply`.

The artwork is generated, not hand-edited: `python3 scripts/make-images.py` renders the banners and diagrams from
`docs/` (needs `rsvg-convert` and Pillow).

## Related

- [**devin-2api-lite**](https://github.com/Green-hats/devin-2api-lite) — the gateway this plugin talks to
  ([中文](https://github.com/Green-hats/devin-2api-lite/blob/main/README.zh-CN.md)). It owns the Devin protocol, the
  catalog, `/v1/quota` and `/__clientlog`.
- [**DeepSeek Harness**](https://github.com/deepseek-ai/deepseek-harness) — the host application and its plugin API.
- [**leookun/devin-2api**](https://github.com/leookun/devin-2api) — the original protocol research lite is derived
  from (MIT).

## Status

The Host path (catalog, streaming, tools, images, settings writes) is covered by the test suite and has been exercised
against a live lite gateway. The Settings models row and the quota pill are implemented against the current Client
APIs and register live; their visual rendering has not been verified on every DSH theme and locale.

## License

[MIT](LICENSE) © 2026 Green-hats.
