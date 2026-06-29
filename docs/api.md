# API Reference

TraceAIO exposes a REST API at `/api/*`. All endpoints require authentication via session cookie or Bearer token.

Interactive API documentation is available at `/api/docs` (Swagger UI) when logged in.

## Authentication

All API routes (except auth endpoints) require one of:

- **Session cookie** — obtained after `POST /api/auth/login`
- **Bearer token** — `Authorization: Bearer <api-key>` header using your user API key

Generate an API key from the sidebar MCP dialog, or via `POST /api/users/:id/api-key`.

## Endpoints Overview

### Auth
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/needs-setup` | Check if first-run setup is needed |
| GET | `/api/auth/session` | Get current session info |
| GET | `/api/public-config` | Public, unauthenticated client config (e.g. the `liveDemo` flag) |
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | End session |

`/api/public-config` and `/api/auth/*` are the only endpoints that do **not** require authentication.

## Live Demo mode

When the server is started with `LIVE_DEMO=1`, the instance runs read-only: every
data-mutating request (`POST`/`PUT`/`PATCH`/`DELETE`) under `/api/*` is rejected with
`403 { "error": "live_demo" }`. Only `POST /api/auth/login` and `POST /api/auth/logout`
remain writable. `GET /api/public-config` returns `{ "liveDemo": true }` so clients can
surface the read-only state. All read (`GET`) endpoints behave normally.

### Metrics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/metrics` | Overview metrics (mention rate, top competitor, sources) |
| GET | `/api/metrics/visibility-score` | Brand visibility score (avg across models) |
| GET | `/api/metrics/trends` | Per-run historical data for charting |
| GET | `/api/metrics/by-model` | Mention rate broken down by model |
| GET | `/api/counts` | Total response and mention counts |

All metrics endpoints support `?runId=`, `?model=`, `?from=`, `?to=` query parameters.

Valid `model` values: `chatgpt`, `perplexity`, `gemini`, `google-ai-mode`, `openai-api`, `anthropic-api`.

### Prompts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/prompts` | List prompts from the latest analysis (with topic) |
| GET | `/api/prompts/ranked` | Every prompt ranked by brand mention rate with per-model breakdown |
| GET | `/api/prompts/:id/analytics` | Per-prompt drill-down: totals, per-model rates, run trend, top competitors, top sources |

`ranked` accepts `?runId=`, `?model=`, `?topicId=`, `?from=`, `?to=`, `?sort=asc|desc`, `?limit=`, `?offset=`.
`:id/analytics` accepts `?runId=`, `?from=`, `?to=`.

### Analysis
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analysis/start` | Start analysis with existing prompts |
| GET | `/api/analysis/runs` | List completed analysis runs |
| GET | `/api/analysis/progress` | Current analysis progress |
| POST | `/api/analysis/cancel` | Cancel running analysis |

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/:key` | Read a setting |
| PUT | `/api/settings/:key` | Update a setting (admin) |

Available keys: `brand`, `models`, `openai-key`, `anthropic-key`, `apify-token`, `analysis-llm`, `analysis-schedule`, `browser-mode`, `brand-domains`, `competitor-subdomains`, `competitor-blocklist`, `chatgpt-credentials`.

## MCP Integration

TraceAIO includes a Model Context Protocol server at `/mcp` for use with Claude Desktop or Claude Code.

```bash
claude mcp add --transport http brand-tracker https://your-instance/mcp --header "Authorization:Bearer YOUR_API_KEY"
```
