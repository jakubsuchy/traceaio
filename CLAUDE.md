# CLAUDE.md

## Project Overview

TraceAIO — a web app that analyzes how your brand and competitors are mentioned across LLM providers (Perplexity, ChatGPT, Google Gemini). Generates brand-neutral prompts, runs them against multiple providers via browser automation (local or Apify Cloud), and tracks which brands get mentioned organically.

## Tech Stack

- **Backend**: Node.js/Express, TypeScript, ESM modules
- **Frontend**: React 18, Vite, Tailwind CSS, Radix UI, wouter (routing), TanStack Query
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI GPT-4o for prompt generation and response analysis
- **Browser**: Apify actors with Camoufox (local container or Apify Cloud)
- **Auth**: PassportJS (local login, Google OAuth, SAML SSO)
- **MCP**: Model Context Protocol server at `/mcp` for Claude AI integration
- **Deployment**: Docker Compose (app + postgres + optional browser-actor)

## Commands

```bash
npm run dev                          # Start dev server (tsx, port 3000)
npm run build                        # Vite build + esbuild server bundle
npm run start                        # Production server (node dist/index.js)
npm run db:push                      # Push schema to DB (drizzle-kit push)
npm run swagger                      # Regenerate OpenAPI spec → server/swagger-output.json
npm run docs                         # Build docs/ markdown → public/docs/ static HTML
docker compose up --build            # Build and run with postgres
docker compose up                    # Includes local browser container
docker compose down -v               # Wipe DB and stop
```

## Project Structure

```
shared/schema.ts            # Drizzle schema — single source of truth for all tables
server/routes.ts            # Route orchestrator — imports all modules, startup logic
server/routes/helpers.ts    # Shared route helpers (requireRole, parseDateRange, launchAnalysis, etc.)
server/routes/auth.ts       # Auth routes (login, session, OAuth, SAML, guard)
server/routes/users.ts      # User CRUD + API key regeneration
server/routes/metrics.ts    # Dashboard metrics (visibility, trends, by-model, counts)
server/routes/topics.ts     # Topics + prompts + topic analysis
server/routes/competitors.ts # Competitor CRUD, merge, analysis, blocking
server/routes/sources.ts    # Source (domain-level) analysis + reclassification
server/routes/pages.ts      # Source Pages (per-URL view) — list, detail, citing responses
server/routes/watched-urls.ts # Source Watchlist CRUD + new-citations polling
server/routes/responses.ts  # Responses, prompts list, per-prompt analytics, data clear
server/routes/analysis.ts   # Brand analysis, prompt gen, run execution, progress, export
server/routes/settings.ts   # Unified GET/PUT /api/settings/:key + browser-status
server/routes/docs.ts       # Swagger UI at /api-docs (authenticated)
server/routes/export.ts     # Data export: README.md + CSVs streamed as zip
server/routes/recommendations.ts # Recommendations CRUD + state mutations
server/mcp.ts               # MCP server with 20 tools for Claude AI integration
server/services/analyzer.ts # BrandAnalyzer class — job queue worker loop
server/services/auth.ts     # PassportJS config, user CRUD, API key generation
server/services/settings.ts # DB-stored settings (override env vars)
server/services/analysis.ts # Generic analysis utilities (brand detection, URL extraction, similarity)
server/services/openai.ts   # OpenAI-specific LLM calls: prompt generation, competitor extraction
server/services/openai-api.ts       # OpenAI Responses API + web_search — "openai-api" model
server/services/anthropic-api.ts    # Anthropic Messages API + web_search — "anthropic-api" model
server/services/browser-actor.ts    # Browser actor client (local + Apify Cloud)
server/services/recommendations/    # Deterministic recommendation pipeline:
                                    #   index.ts (orchestrator runDetectors)
                                    #   context.ts (RunContext loader)
                                    #   fingerprint.ts (stable hash + slug)
                                    #   types.ts, templates/shared.ts
                                    #   detectors/ (10 detectors, co-located template + detect)
server/config.ts            # Public API paths config
shared/models.ts            # Canonical model metadata (labels, brand colors, icons, descriptions)
server/database-storage.ts  # All DB queries (implements IStorage interface)
server/storage.ts           # IStorage interface + in-memory implementation
client/src/pages/           # Page components (dashboard, competitors, sources, etc.)
client/src/components/      # Shared UI components (metrics, charts, topic analysis, etc.)
client/src/components/settings/ # Settings page card components (extracted from settings.tsx)
client/src/components/sources/  # Sources page tab components (e.g. watchlist-tab.tsx)
client/src/components/recommendations/  # Recommendations cards, hint banner, state menu, occurrences timeline
client/src/components/model-logos.tsx  # Inline SVG brand logos (OpenAiLogo, ClaudeLogo, etc.) + ModelLogo dispatcher
client/src/components/prompt-ranking-table.tsx  # Shared per-prompt list (used on /prompts and dashboard widget)
client/src/hooks/use-auth.ts # Auth context + hook (AuthProvider, useAuth)
docs/                       # Documentation markdown source files
scripts/build-docs.ts       # Builds docs/ → public/docs/ static HTML (markdown-it)
n8n-nodes-traceaio/         # n8n community node package (standalone npm package)
browser-actor/              # Apify actor for browser-based prompt execution (gitignored)
```

## API Routes (89 total)

```
AUTH (12)        server/routes/auth.ts
  GET/POST  /api/auth/session, /login, /logout, /needs-setup
  GET       /api/auth/google, /google/callback, /saml, /saml/callback, /saml/metadata
  POST      /api/initialize, /api/auth/providers (GET+POST)

USERS (7)       server/routes/users.ts
  GET/POST  /api/users
  PUT       /api/users/:id, /api/users/:id/password
  POST      /api/users/:id/roles, /api/users/:id/api-key
  DELETE    /api/users/:id

METRICS (5)     server/routes/metrics.ts
  GET       /api/metrics, /api/counts, /api/metrics/visibility-score,
            /api/metrics/trends, /api/metrics/by-model

TOPICS (5)      server/routes/topics.ts
  GET       /api/topics, /api/topics/with-prompts, /api/topics/analysis
  DELETE    /api/topics/:id, /api/prompts/:id

COMPETITORS (10) server/routes/competitors.ts
  GET       /api/competitors, /api/competitors/analysis,
            /api/competitors/merge-suggestions, /api/competitors/merge-history
  POST      /api/competitors, /api/competitors/merge, /api/competitors/unmerge,
            /api/competitors/block
  PATCH     /api/competitors/:id
  DELETE    /api/competitors/:id

SOURCES (6)     server/routes/sources.ts
  GET       /api/sources, /api/sources/analysis, /api/sources/:domain/responses,
            /api/sources/:domain/trends
  POST      /api/sources/reclassify, /api/sources/extract-sitemap

PAGES (3)       server/routes/pages.ts
  GET       /api/sources/pages/analysis, /api/sources/page/:pageId,
            /api/sources/page/responses

WATCHED URLS (6) server/routes/watched-urls.ts
  GET       /api/watched-urls, /api/watched-urls/new-citations,
            /api/watched-urls/:id/citations
  POST      /api/watched-urls
  PUT       /api/watched-urls/:id
  DELETE    /api/watched-urls/:id

EXPORT (1)      server/routes/export.ts
  GET       /api/export/bundle

RESPONSES (7)   server/routes/responses.ts
  GET       /api/prompts, /api/prompts/ranked, /api/prompts/:id/analytics,
            /api/responses, /api/responses/:id
  POST      /api/prompts/test, /api/data/clear

ANALYSIS (16)   server/routes/analysis.ts
  POST      /api/analyze-brand, /api/generate-prompts, /api/save-and-analyze,
            /api/analysis/start, /api/analysis/cancel, /api/test-analysis
  GET       /api/test, /api/analysis/runs, /api/analysis/failures,
            /api/analysis/jobs, /api/analysis/progress,
            /api/analysis/:sessionId/progress, /api/apify-usage, /api/usage,
            /api/export, /api/generate-topic-prompts
  DELETE    /api/analysis/runs/:id

SETTINGS (3)    server/routes/settings.ts
  GET       /api/settings/browser-status, /api/settings/:key
  PUT       /api/settings/:key

RECOMMENDATIONS (8) server/routes/recommendations.ts
  GET       /api/recommendations, /api/recommendations/counts,
            /api/recommendations/:id, /api/recommendations/detectors,
            /api/recommendations/by-detector
  POST      /api/recommendations/recompute
  PUT       /api/recommendations/:id/state
  DELETE    /api/recommendations
```

## Database Schema

All tables defined in `shared/schema.ts`. Key tables:

```
topics → prompts → responses (with model, brand_mentioned, competitors_mentioned[])
                 → competitor_mentions (junction: competitor × response × run)
competitors (name, name_key UNIQUE, domain, category, merged_into)
sources → source_urls (per-run, per-model)
watched_urls (url, normalized_url UNIQUE, title, notes, ignore_query_strings, source — 'manual' or 'sitemap'; content tracked for LLM citations)
analysis_runs (status, brand_name, total_prompts, completed_prompts)
job_queue (prompt_text, model, status, attempts, original_job_id for retry chains)
users (email, full_name, hashed_password, salt, google_id, api_key)
roles → user_roles (user × role mapping)
app_settings (key-value store for all config)
apify_usage (cost tracking per Apify run)
api_usage (OpenAI token tracking)
```

## Critical Design Decisions

### Multi-model analysis
- Prompts are sent to multiple LLM models across two transport types:
  - **Browser**: Perplexity, ChatGPT, Gemini, Google AI Mode — run via the Apify actor (local container or Apify Cloud)
  - **API**: `openai-api` (OpenAI Responses API + `web_search`), `anthropic-api` (Anthropic Messages API + `web_search_20250305`) — run directly from the main app process
- Model config stored in DB (`app_settings` key `modelsConfig`), manageable via Settings → Models. Each entry has `{ enabled, type: 'browser' | 'api', label }`.
- Each (prompt, model) pair is a separate job in the queue — the same worker pool processes both browser and API jobs; the branch happens inside `processJob` → `analyzePromptResponse` → `getModelResponse` (in `server/services/analysis.ts`) which dispatches on `API_MODELS`.
- **Model metadata** (labels, brand colors, emoji, descriptions) lives in `shared/models.ts` (`MODEL_META`). Used by server (labels) and client (chart colors, settings UI).

**When adding a new model provider, update all of these in lockstep:**
1. `shared/models.ts` → add a `MODEL_META` entry (label, color, icon fallback, description)
2. `server/routes/helpers.ts` → add to `DEFAULT_MODELS_CONFIG` with the correct `type`
3. `server/services/analyzer.ts` → add to the inline fallback config in `enqueueActiveModels` so first-run defaults work
4. For an API model: create `server/services/<name>-api.ts` mirroring `openai-api.ts` (export `ask<Name>Api` and `is<Name>ApiAvailable`), register it in `API_MODELS` in `server/services/analysis.ts` and in the dispatch switch inside `getModelResponse`, and add it to the per-model availability map in `analyzer.ts`
5. For a browser model: extend `BrowserModel` in `server/services/browser-actor.ts` and the actor's input schema
6. `client/src/components/model-logos.tsx` → add a `<BrandLogo>` component and map the model key in `MODEL_TO_LOGO` (see Brand logos below)
7. If the API model requires its own key, wire the key-presence gate into `/api/settings/models` GET and PUT (`server/routes/settings.ts`) — see the `openai-api` / `anthropic-api` pattern

### Brand logos
- **`client/src/components/model-logos.tsx`** — the single source of truth for every provider's SVG logo. Logos are embedded as inline JSX (no HTTP fetch, tree-shakeable).
- Two call shapes:
  - **Named**: `<OpenAiLogo size={28} />`, `<ChatGptLogo/>` (alias), `<AnthropicLogo/>`, `<ClaudeLogo/>`, `<PerplexityLogo/>`, `<GeminiLogo/>`, `<GoogleAiModeLogo/>` (alias) — use this when the brand is known at the call site.
  - **Dispatch by model key**: `<ModelLogo model="openai-api" size={28} fallback={...} />` — use this when iterating over `modelsConfig`.
- Props: `size?: number` (sets both width and height, default 24), `className?: string`, `title?: string` (for the `<title>` a11y element).
- OpenAI / Anthropic (A) / Perplexity SVGs use `fill="currentColor"` so they inherit text color via Tailwind (`text-gray-800`, `text-white`, etc). Claude and Gemini use their brand colors — don't try to re-theme them.
- When adding a new logo: convert all kebab-case SVG attrs to camelCase (`fill-rule` → `fillRule`, `stop-color` → `stopColor`, `stroke-linejoin` → `strokeLinejoin`), strip `<desc>` marketing text, keep `<title>` for a11y, and register the key in `MODEL_TO_LOGO` at the bottom of the file.

### Job queue
- PostgreSQL-based with `SELECT FOR UPDATE SKIP LOCKED` for dequeuing
- Jobs have status: pending → processing → completed/failed/cancelled
- Failed jobs create new retry jobs (preserving failure history via `original_job_id`)
- 429/busy errors don't count as real attempts
- Cloud mode: 30 concurrent workers. Local: 1 (browser singleton)
- Stall recovery runs every 2 minutes during analysis

### Brand detection
- Brand name matched via regex (`isBrandMentioned` in `server/services/analysis.ts`) — no LLM needed
- Metrics use unique prompt counting (not raw response count across models/runs)

### Unique prompt counting — CRITICAL
- Each prompt is sent to multiple models (Perplexity, ChatGPT, Gemini), producing multiple responses
- ALL metrics, percentages, and counts MUST use unique prompts (deduplicated by `prompt.text.toLowerCase().trim()`)
- NEVER show raw response counts to users — always deduplicate first
- **"X of Y prompts"**: Y = total unique prompts. X = unique prompts where the condition is true in ANY response (across all models). A prompt "mentions brand" if at least one model's response mentioned it.
- The server endpoints (`/api/metrics`, `/api/competitors/analysis`) already return unique prompt counts
- Client pages should use the server's numbers, NOT count `responses.length` directly

### Prompts must be brand-neutral
- Prompts must NEVER contain brand or competitor names
- The `generatePromptsForTopic` system prompt explicitly forbids brand names
- Mix generic ("Recommend a load balancer") with enterprise-qualified prompts

### Source Watchlist
- Separate `watched_urls` table — NOT a flag on `sources`. Reason: `sources` is per-*domain*; watched entries are per-*URL* (e.g. a specific blog post).
- **Matching is indexed with two columns**: `source_urls.normalized_url` (strict, keeps non-tracking query params) and `source_urls.normalized_url_stripped` (query-free). Both populated on write and backfilled at startup. Which column a watched URL matches against depends on its `ignore_query_strings` flag — strict matchers hit `normalized_url`, query-ignoring matchers hit `normalized_url_stripped`. Both are indexed b-tree lookups.
- **Canonicalization** lives in `normalizeUrl` (`server/services/analysis.ts`) and takes an `opts.stripAllQuery` flag. Base transformations: coerce scheme to `https`, strip `www.`, drop default ports, lowercase path, strip trailing slash, drop fragment, drop `utm_*` and a curated tracking-param list (gclid, fbclid, msclkid, etc.), sort remaining params. With `stripAllQuery`, ALL query params are dropped. Path lowercasing is a deliberate tradeoff — produces false positives on case-sensitive servers but matches typical content URLs.
- **Adding new URLs**: `POST /api/watched-urls` uses `parseHttpUrl` (same module) to reject non-http(s) schemes before normalization — this prevents a stored `javascript:` URL from ever reaching the `<a href>` sink in the UI. Accepts an `ignoreQueryStrings` boolean; stored on the row and applied at normalization time.
- **Auto-discovery from sitemap.xml**: controlled by the `autoWatchBrandUrls` setting (default true, editable in Settings → Brand). On `launchAnalysis`, `ingestBrandSitemap` fetches the brand sitemap (either `brandSitemapUrl` or `<brandUrl>/sitemap.xml`), normalizes each URL with `stripAllQuery: true`, and bulk-inserts as `source='sitemap', ignore_query_strings=true` via `ON CONFLICT DO NOTHING` — manual entries are never overwritten. Sitemap fetch failures log and continue; they never block an analysis run. The fetcher wraps `sitemapper` with a 20s timeout and a 50k URL cap.
- **UI lists are split by `source`**: manual and sitemap entries render as separate paginated sections (`?source=manual|sitemap&page=N&pageSize=20`) — sitemap lists can reach thousands of rows.
- **Routes live in their own module** (`server/routes/watched-urls.ts`), not in `sources.ts`. Each resource gets its own file per the route-module convention. The sitemap extractor is at `POST /api/sources/extract-sitemap` (read-only; does NOT persist).
- **Post-run polling**: `GET /api/watched-urls/new-citations?sinceRunId=X` returns watched URLs first cited in any run with id > X. Intended pairing: subscribe to the webhook that fires on run completion, then call this endpoint with the last-observed run ID to get fresh debut citations. The MCP `list-watched-urls` tool accepts the same `sinceRunId` argument for the same purpose.
- UI lives as a tab on the Sources page (`client/src/components/sources/watchlist-tab.tsx`), secondary to the Domains tab. Do NOT promote to a top-level menu unless it needs a dashboard widget.
- Never hard-delete a watched URL via DB — use `DELETE /api/watched-urls/:id`, which removes the row (no cascading effect, since no other table references `watched_urls`).

### Authentication & Route Protection

All API routes protected by PassportJS session auth. The guard in `server/routes/auth.ts` (`registerAuthGuard`) checks authentication on all `/api/*` routes.

- **Auth routes** (`/api/auth/*`, `/api/initialize`) registered BEFORE the guard — automatically exempt
- **Public API paths** in `server/config.ts` → `PUBLIC_API_PATHS`
- **`/mcp` endpoint** uses its own API key auth (not session-based) — exempt from guard since it's not under `/api`
- **Role-based access**: `requireRole('admin')` or `requireRole('analyst')` per-route
- Routes without `requireRole` are accessible to any authenticated user
- Admin always passes any role check

**IMPORTANT when adding routes or components:**
- Add new API routes to the appropriate module in `server/routes/`, NOT in `server/routes.ts` (which is just the orchestrator). If no existing module fits, create a new `server/routes/<name>.ts` and register it in `server/routes.ts`.
- ALWAYS add `requireRole('admin')` by default on new routes.
- **Update the API Routes table in this file** whenever you add, remove, or rename a route.
- **Update the Project Structure section** whenever you add new component directories or significant files.
- Large page components should be split: extract card/section components into `client/src/components/<page>/` (e.g. `components/settings/`). Keep page files as thin orchestrators.
- **Every route handler must include `// #swagger.tags = ['TagName']`** as its first line inside the handler body. This ensures the OpenAPI spec groups routes correctly. Run `npm run swagger` after adding routes. Then ask the user which role should actually have access. Roles: `admin` (full access), `analyst` (analysis/prompts), `user` (read-only dashboards).

### MCP Server

Integrated at `/mcp` inside the Express app (not a separate process). Uses `@modelcontextprotocol/sdk` with Streamable HTTP transport.

- 20 tools for querying brand data (see `server/mcp.ts`)
- Authenticated via per-user API key (`Authorization: Bearer <key>`)
- API keys auto-generated on user creation, stored in `users.api_key`
- Legacy users get keys backfilled at startup (`backfillApiKeys()`)
- Tools return structured JSON — the calling model analyzes the data
- Express `json()` middleware is skipped for `/mcp` (transport reads raw stream)

### n8n Community Node
Standalone npm package at `n8n-nodes-traceaio/` — published independently, NOT part of the main app build.

- **TraceAIO Trigger** (`nodes/TraceAioTrigger/`) — polling trigger that fires when analysis runs complete. Fetches `GET /api/analysis/runs?from=` and includes metrics in output.
- **TraceAIO Action** (`nodes/TraceAio/`) — single node with resource/operation pattern:
  - Metrics: Get, Get Visibility Score, Get By Model
  - Competitors: Get All
  - Sources: Get All
  - Analysis: Start
- **Credentials** (`credentials/TraceAioApi.credentials.ts`) — Instance URL + API Key (Bearer token)
- Build: `cd n8n-nodes-traceaio && npm install && npm run build`
- Test: `docker compose -f docker-compose.test.yml up --build -d` → n8n at `http://localhost:5678`
- Icon: `traceaio-favicon.png` copied next to each node's compiled output during build
- n8n auto-generates trigger labels as "On new {displayName} event" — cannot override

### Settings system
- `server/services/settings.ts` provides centralized access to config
- DB values (in `app_settings`) override environment variables
- `loadSettingsIntoEnv()` runs at startup, copies DB values to `process.env`
- `setSetting()` updates both DB and `process.env` immediately
- **API**: Unified `GET /api/settings/:key` and `PUT /api/settings/:key` with key-specific validation. When adding a new setting, add a case to the switch in `server/routes/settings.ts`. Frontend uses `PUT` (not POST) for writes.

### Drizzle migrations
- `drizzle.config.ts` has `tablesFilter: ["!session"]` to ignore the `connect-pg-simple` session table
- Without this, `drizzle-kit push` tries to delete the session table

### URL-driven UI state
- **All filter/selection interactions MUST reflect in the URL** (query params). Users must be able to share/bookmark a dashboard view.
- Dashboard uses `?runId=`, `?model=`, `?trendFrom=`, `?trendTo=` — all read from and written to the URL via `useSearch()`/`setLocation()`.
- When adding new filters or interactive state, persist to URL params, not React state alone.

## Common Pitfalls

- **Server bind**: Must be `0.0.0.0`, not `localhost`, for Docker
- **Express middleware order**: `app.use()` runs before route-level middleware. Can't use route middleware to override `app.use()` behavior.
- **FK constraints on delete**: Must delete in order: job_queue → competitor_mentions → apify_usage → api_usage → responses → prompts → competitors → sources → analysis_runs
- **`response_format: json_object`**: Always returns `{...}`, never bare array. Extract with `Object.values(parsed).find(v => Array.isArray(v))`
- **Duplicate routes**: Express uses first match. Never register the same path twice.
- **localStorage**: Fully removed. All state from DB. Don't reintroduce.
- **sed on macOS**: `sed -i ''` can corrupt files silently. Prefer the Edit tool.
- **Duplicated filter UI**: Response filter bars (search, run, topic, model dropdowns) appear on multiple pages. Use the shared `ResponseFilters` component from `client/src/components/response-filters.tsx` — don't clone filter code.

## Environment Variables

```
# Required
DATABASE_URL=postgresql://admin:password@db:5432/brand_tracker
OPENAI_API_KEY=sk-...

# Optional — browser analysis
APIFY_TOKEN=                           # Apify Cloud mode
BROWSER_ACTOR_URL=http://browser-actor:8888  # Local container

# Optional — auth
SESSION_SECRET=change-me-in-production
GOOGLE_CLIENT_ID=                      # Configurable via UI
GOOGLE_CLIENT_SECRET=                  # Configurable via UI
```
