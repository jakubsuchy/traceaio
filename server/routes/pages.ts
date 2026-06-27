import type { Express } from "express";
import { parseDateRange, getSourceBlacklist, requireRole } from "./helpers";
import { storage } from "../storage";
import { parseHttpUrl, normalizeUrl } from "../services/analysis";
import { buildSourceClassifier } from "./sources";

// Page-level routes (per-URL view of citation data). Distinct from the
// domain-level routes in sources.ts — the Source Pages tab in the UI
// browses individual cited URLs, identified by source_unique_urls.id.
// List + focused detail + per-URL citing-responses live here together.
export function registerPageRoutes(app: Express) {
  // Aggregate citation counts per individual page URL (the "By Page" tab).
  // One row per unique cited URL; citationCount = number of responses that
  // referenced it. Filters mirror /api/sources/analysis so the same UI
  // controls work on both tabs. Always paginated to bound payload size.
  // Response: { rows, page, pageSize, total }.
  app.get("/api/sources/pages/analysis", requireRole('user'), async (req, res) => {
    // #swagger.tags = ['Pages']
    // #swagger.parameters['page'] = { in: 'query', type: 'integer', description: '1-based page number (default 1)' }
    // #swagger.parameters['pageSize'] = { in: 'query', type: 'integer', description: 'Page size (default 50, max 200)' }
    // #swagger.parameters['runId'] = { in: 'query', type: 'integer' }
    // #swagger.parameters['model'] = { in: 'query', type: 'string' }
    // #swagger.parameters['topicId'] = { in: 'query', type: 'integer' }
    // #swagger.parameters['q'] = { in: 'query', type: 'string', description: 'Case-insensitive substring filter on the page URL. Applied before sorting/pagination so search spans all pages.' }
    // #swagger.parameters['types'] = { in: 'query', type: 'string', description: 'Comma-separated subset of brand,competitor,neutral. Omit to return all types; empty string returns none.' }
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const topicId = req.query.topicId ? parseInt(req.query.topicId as string) : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const typesRaw = typeof req.query.types === 'string' ? req.query.types : null;
      const allowedTypes = typesRaw === null
        ? null
        : new Set(typesRaw.split(',').map(s => s.trim().toLowerCase()).filter(s => s === 'brand' || s === 'competitor' || s === 'neutral'));
      const { from, to } = parseDateRange(req);

      const explicitPage = req.query.page !== undefined;
      const page = Math.max(1, explicitPage ? parseInt(req.query.page as string) || 1 : 1);
      const pageSize = Math.min(200, Math.max(1, req.query.pageSize ? parseInt(req.query.pageSize as string) || 50 : 50));

      let responses = await storage.getResponsesWithPrompts(runId, from, to);
      if (model) responses = responses.filter(r => r.model === model);
      if (topicId) responses = responses.filter(r => r.prompt?.topicId === topicId);

      // Aggregate by the *normalized* URL so variants that differ only by
      // casing, trailing slash, or tracking params collapse onto one page row
      // (e.g. `https://Monday.com`, `https://monday.com/`, `https://monday.com`).
      // The normalized form is also the display URL and the key the page-id
      // lookup uses, keeping list/detail/deep-link consistent.
      const counts = new Map<string, { url: string; domain: string; count: number }>();
      for (const r of responses) {
        if (!r.sources || r.sources.length === 0) continue;
        // Dedupe within a single response so one response can't double-count a URL
        const seen = new Set<string>();
        for (const raw of r.sources) {
          if (typeof raw !== 'string') continue;
          const parsed = parseHttpUrl(raw);
          if (!parsed) continue;
          const url = normalizeUrl(raw);
          if (seen.has(url)) continue;
          seen.add(url);
          const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
          const existing = counts.get(url);
          if (existing) existing.count++;
          else counts.set(url, { url, domain, count: 1 });
        }
      }

      const { classifyDomain } = await buildSourceClassifier();
      const blacklist = await getSourceBlacklist();
      // Bulk-fetch pageId per URL. Done once for the full filtered set so
      // pagination boundaries don't affect the lookup. URLs without a
      // source_unique_urls row (shouldn't happen post-backfill, but defensive)
      // get pageId=null and the client falls back to URL-based deep-linking.
      const candidateUrls = Array.from(counts.keys());
      const pageIdMap = await storage.getPageIdsForUrls(candidateUrls);
      const all = Array.from(counts.values())
        .filter(p => !blacklist.has(p.domain))
        .filter(p => !q || p.url.toLowerCase().includes(q))
        .map(p => ({
          pageId: pageIdMap.get(p.url) ?? null,
          url: p.url,
          domain: p.domain,
          sourceType: classifyDomain(p.domain),
          citationCount: p.count,
        }))
        .filter(p => !allowedTypes || allowedTypes.has(p.sourceType))
        .sort((a, b) => b.citationCount - a.citationCount);
      const total = all.length;
      const start = (page - 1) * pageSize;
      const rows = all.slice(start, start + pageSize);
      res.json({ rows, page, pageSize, total });
    } catch (error) {
      console.error("Error fetching page analysis:", error);
      res.status(500).json({ error: "Failed to fetch page analysis" });
    }
  });

  // Focused detail view for a single page (used by /sources?expand=ID).
  // Returns the page metadata + citation count. Distinct from the list
  // endpoint so deep-links render a stable single-page view without
  // depending on pagination position (which shifts as new citations come in).
  app.get("/api/sources/page/:pageId", requireRole('user'), async (req, res) => {
    // #swagger.tags = ['Pages']
    // #swagger.parameters['pageId'] = { in: 'path', required: true, type: 'integer', description: 'source_unique_urls.id' }
    // #swagger.parameters['runId'] = { in: 'query', type: 'integer' }
    // #swagger.parameters['model'] = { in: 'query', type: 'string' }
    try {
      const pageId = parseInt(req.params.pageId);
      if (!pageId || isNaN(pageId)) return res.status(400).json({ error: "pageId must be a positive integer" });

      const { db } = await import("../db");
      const { sourceUniqueUrls } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [row] = await db
        .select({ id: sourceUniqueUrls.id, url: sourceUniqueUrls.url, normalizedUrl: sourceUniqueUrls.normalizedUrl })
        .from(sourceUniqueUrls)
        .where(eq(sourceUniqueUrls.id, pageId));
      if (!row) return res.status(404).json({ error: "Page not found" });

      const parsed = parseHttpUrl(row.url);
      if (!parsed) return res.status(404).json({ error: "Invalid URL on record" });
      const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
      // Fall back to computing it if a legacy row somehow lacks normalized_url.
      const targetNorm = row.normalizedUrl || normalizeUrl(row.url);

      const blacklist = await getSourceBlacklist();
      if (blacklist.has(domain)) return res.status(404).json({ error: "Page is on the source blacklist" });

      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      let allResponses = await storage.getResponsesWithPrompts(runId);
      if (model) allResponses = allResponses.filter(r => r.model === model);
      // Match by normalized URL so all citation variants of this page count.
      const citationCount = allResponses.reduce(
        (acc, r) => acc + (r.sources && r.sources.some(s => typeof s === 'string' && normalizeUrl(s) === targetNorm) ? 1 : 0),
        0,
      );

      const { classifyDomain } = await buildSourceClassifier();
      res.json({
        pageId: row.id,
        url: targetNorm,
        domain,
        sourceType: classifyDomain(domain),
        citationCount,
      });
    } catch (error) {
      console.error("Error fetching page detail:", error);
      res.status(500).json({ error: "Failed to fetch page detail" });
    }
  });

  // Get responses that cite a specific page URL.
  // URL is passed as a query param (path segments hate slashes).
  app.get("/api/sources/page/responses", requireRole('user'), async (req, res) => {
    // #swagger.tags = ['Pages']
    // #swagger.parameters['url'] = { in: 'query', required: true, type: 'string', description: 'http(s) URL to find citing responses for' }
    // #swagger.parameters['runId'] = { in: 'query', type: 'integer' }
    // #swagger.parameters['model'] = { in: 'query', type: 'string' }
    try {
      const rawUrl = req.query.url as string | undefined;
      if (!rawUrl) return res.status(400).json({ error: "url query parameter is required" });
      // Reject non-http(s) at the boundary — even though we only string-compare
      // here, a stored attacker URL should never round-trip through the API.
      if (!parseHttpUrl(rawUrl)) {
        return res.status(400).json({ error: "url must be a valid http(s) URL" });
      }
      const targetNorm = normalizeUrl(rawUrl);
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      let allResponses = await storage.getResponsesWithPrompts(runId);
      if (model) allResponses = allResponses.filter(r => r.model === model);
      // Match by normalized URL so all citation variants of this page are found.
      const matching = allResponses.filter(r =>
        r.sources && r.sources.some(s => typeof s === 'string' && normalizeUrl(s) === targetNorm)
      );
      res.json(matching);
    } catch (error) {
      console.error("Error fetching responses for page:", error);
      res.status(500).json({ error: "Failed to fetch responses" });
    }
  });
}
