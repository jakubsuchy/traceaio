import type { Express } from "express";
import { parseDateRange, getCurrentBrandName, getSourceBlacklist, requireRole } from "./helpers";
import { storage } from "../storage";
import { fetchSitemap } from "../services/sitemap-fetch";
import { parseHttpUrl } from "../services/analysis";
import { getRegistrableDomain } from "../services/domain";

// Build a once-per-request classifier that maps a domain to its source type.
// Centralizes the lookup tables (brand domains, blocklist, competitor names)
// so both `/sources/analysis` (per-domain) and `/sources/pages/analysis`
// (per-URL) classify identically.
//
// Subdomain handling now uses the Public Suffix List via tldts. Any
// `*.f5.com` cited domain resolves to registrable `f5.com` and matches a
// stored competitor with `domain = 'f5.com'`. The legacy
// `competitorSubdomains` setting (which let users register specific
// subdomain prefixes for stripping) is preserved as a fallback for
// domains tldts can't resolve, but typically isn't needed anymore.
export async function buildSourceClassifier() {
  const brandName = (getCurrentBrandName() || (await storage.getSetting('brandName')) || '').toLowerCase();

  const blocklistRaw = await storage.getSetting('competitorBlocklist');
  const blocklist = new Set(
    blocklistRaw
      ? blocklistRaw.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      : ['g2.com', 'reddit.com', 'facebook.com', 'gartner.com', 'idc.com']
  );
  // Pre-compute registrable forms of blocklist entries so a cited
  // `forums.reddit.com` registers as blocked (registrable `reddit.com`).
  // Skips public-suffix-only entries (none in defaults, but defensive).
  const blocklistRegistrable = new Set<string>();
  for (const entry of blocklist) {
    const reg = getRegistrableDomain(entry);
    if (reg) blocklistRegistrable.add(reg);
  }

  const brandDomainsRaw = await storage.getSetting('brandDomains');
  const brandDomains = new Set(
    brandDomainsRaw ? brandDomainsRaw.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean) : []
  );
  const brandDomainsRegistrable = new Set<string>();
  for (const entry of brandDomains) {
    const reg = getRegistrableDomain(entry);
    if (reg) brandDomainsRegistrable.add(reg);
  }

  const allCompetitors = (await storage.getAllCompetitorsIncludingMerged())
    .filter(c => c.mergedInto !== c.id);
  const competitorDomainsRegistrable = new Set<string>();
  const competitorNameWords: string[][] = [];
  for (const c of allCompetitors) {
    if (c.domain) {
      const reg = getRegistrableDomain(c.domain);
      if (reg) competitorDomainsRegistrable.add(reg);
    }
    competitorNameWords.push(c.name.toLowerCase().split(/\s+/));
  }

  const classifyDomain = (domain: string): 'brand' | 'competitor' | 'neutral' => {
    const domainLower = domain.toLowerCase();
    // Registrable form via PSL: `docs.reprise.com` → `reprise.com`,
    // `co.uk` → null, an IP → null. Falls back to domainLower for
    // weird inputs the PSL can't classify.
    const registrable = getRegistrableDomain(domainLower) || domainLower;
    const domainBase = registrable.split('.')[0];

    if (brandDomainsRegistrable.has(registrable)) return 'brand';
    // Explicit competitor-domain bindings (set by "Mark as Competitor" or
    // auto-populated when a source URL matches a competitor by name) must
    // win over the blocklist. The blocklist mixes full domains with generic
    // terms like "loadbalancer" that exist to filter name extraction —
    // without this precedence, those generic terms shadow the user's
    // explicit designation when they happen to equal the domain's base word.
    if (competitorDomainsRegistrable.has(registrable)) return 'competitor';
    if (blocklistRegistrable.has(registrable) || blocklist.has(domainBase)) return 'neutral';
    if (brandName && (registrable.includes(brandName) || brandName.includes(domainBase))) return 'brand';
    if (
      competitorNameWords.some(words => words.some(w => domainBase.includes(w) || w.includes(domainBase)))
    ) return 'competitor';
    return 'neutral';
  };

  return { classifyDomain };
}

export function registerSourceRoutes(app: Express) {
  app.get("/api/sources", async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const sources = await storage.getSources();
      const blacklist = await getSourceBlacklist();
      res.json(sources.filter(s => !blacklist.has(s.domain.toLowerCase())));
    } catch (error) {
      console.error("Error fetching sources:", error);
      res.status(500).json({ error: "Failed to fetch sources" });
    }
  });

  // Fetch a sitemap and return the URLs it lists. Read-only — does NOT persist
  // anything to watched_urls. Use the watchlist endpoints to save.
  app.post("/api/sources/extract-sitemap", requireRole('analyst'), async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const { url } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: "url is required" });
      }
      if (!parseHttpUrl(url)) {
        return res.status(400).json({ error: "url must be a valid http(s) URL" });
      }
      const result = await fetchSitemap(url);
      res.json(result);
    } catch (error: any) {
      console.error("Error extracting sitemap:", error);
      res.status(500).json({ error: error?.message || "Failed to extract sitemap" });
    }
  });

  // Reclassify a source domain as competitor or neutral
  app.post("/api/sources/reclassify", requireRole('analyst'), async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const { domain, sourceType } = req.body;
      if (!domain || !sourceType) {
        return res.status(400).json({ error: "domain and sourceType are required" });
      }

      if (sourceType === 'competitor') {
        // Check if it's a subdomain (3+ parts like techdocs.f5.com)
        const parts = domain.split('.');
        if (parts.length >= 3) {
          // Add to subdomain recognition setting
          const value = await storage.getSetting('competitorSubdomains');
          const entries = value ? value.split(',').map((s: string) => s.trim()).filter(Boolean) : ['docs'];
          if (!entries.includes(domain.toLowerCase())) {
            entries.push(domain.toLowerCase());
            await storage.setSetting('competitorSubdomains', entries.join(','));
          }
        } else {
          // Root domain — create/find a competitor record with this domain
          const domainBase = parts[0]; // "radware" from "radware.com"
          const name = domainBase.charAt(0).toUpperCase() + domainBase.slice(1); // "Radware"
          let competitor = await storage.getCompetitorByName(name);
          if (!competitor) {
            competitor = await storage.createCompetitor({
              name,
              category: null,
              mentionCount: 0,
            });
          }
          // Force-set the domain on the competitor record
          const { db: database } = await import("../db");
          const { competitors: competitorsTable } = await import("@shared/schema");
          const { eq: eqOp } = await import("drizzle-orm");
          await database.update(competitorsTable).set({ domain: domain.toLowerCase() }).where(eqOp(competitorsTable.id, competitor.id));
        }
        // Remove from blocklist and brand domains if present
        for (const settingKey of ['competitorBlocklist', 'brandDomains']) {
          const raw = await storage.getSetting(settingKey);
          if (raw) {
            const list = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
            const updated = list.filter((e: string) => e !== domain.toLowerCase());
            if (updated.length !== list.length) {
              await storage.setSetting(settingKey, updated.join(','));
            }
          }
        }
        res.json({ success: true, message: `${domain} classified as competitor` });
      } else if (sourceType === 'neutral') {
        // Remove from subdomain recognition if present
        const value = await storage.getSetting('competitorSubdomains');
        if (value) {
          const entries = value.split(',').map((s: string) => s.trim()).filter(Boolean);
          const updated = entries.filter((e: string) => e !== domain.toLowerCase());
          if (updated.length !== entries.length) {
            await storage.setSetting('competitorSubdomains', updated.join(','));
          }
        }
        // Add to "Not Competitors" blocklist so it stays neutral
        const blockRaw = await storage.getSetting('competitorBlocklist');
        const blockList = blockRaw ? blockRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : ['g2.com', 'reddit.com', 'facebook.com', 'gartner.com', 'idc.com'];
        if (!blockList.includes(domain.toLowerCase())) {
          blockList.push(domain.toLowerCase());
          await storage.setSetting('competitorBlocklist', blockList.join(','));
        }
        // Remove from brand domains if present
        const brandRaw = await storage.getSetting('brandDomains');
        if (brandRaw) {
          const brandList = brandRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
          const updated = brandList.filter((e: string) => e !== domain.toLowerCase());
          if (updated.length !== brandList.length) {
            await storage.setSetting('brandDomains', updated.join(','));
          }
        }
        // Clear any competitor-domain binding for this domain — without
        // this the classifier's "explicit competitor domain" check (which
        // intentionally wins over the blocklist) re-classifies the source
        // as a competitor on the very next request.
        {
          const { db: database } = await import("../db");
          const { competitors: competitorsTable } = await import("@shared/schema");
          const { sql: sqlOp } = await import("drizzle-orm");
          await database
            .update(competitorsTable)
            .set({ domain: null })
            .where(sqlOp`LOWER(${competitorsTable.domain}) = ${domain.toLowerCase()}`);
        }
        res.json({ success: true, message: `${domain} classified as neutral` });
      } else if (sourceType === 'brand') {
        const domainLower = domain.toLowerCase();
        // Add to brand domains
        const brandRaw = await storage.getSetting('brandDomains');
        const brandList = brandRaw ? brandRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
        if (!brandList.includes(domainLower)) {
          brandList.push(domainLower);
          await storage.setSetting('brandDomains', brandList.join(','));
        }
        // Remove from blocklist and competitor subdomains if present
        const blockRaw = await storage.getSetting('competitorBlocklist');
        if (blockRaw) {
          const blockList = blockRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
          const updated = blockList.filter((e: string) => e !== domainLower);
          if (updated.length !== blockList.length) {
            await storage.setSetting('competitorBlocklist', updated.join(','));
          }
        }
        const subRaw = await storage.getSetting('competitorSubdomains');
        if (subRaw) {
          const subList = subRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
          const updated = subList.filter((e: string) => e !== domainLower);
          if (updated.length !== subList.length) {
            await storage.setSetting('competitorSubdomains', updated.join(','));
          }
        }
        // Clear any competitor-domain binding for this domain — same
        // hygiene rule as the neutral path. Without this, stale bindings
        // linger in the DB and the analyzer's auto-stamping treats
        // "domain currently NULL" as license to bind it again.
        {
          const { db: database } = await import("../db");
          const { competitors: competitorsTable } = await import("@shared/schema");
          const { sql: sqlOp } = await import("drizzle-orm");
          await database
            .update(competitorsTable)
            .set({ domain: null })
            .where(sqlOp`LOWER(${competitorsTable.domain}) = ${domainLower}`);
        }
        res.json({ success: true, message: `${domain} classified as brand` });
      } else {
        res.status(400).json({ error: "sourceType must be 'competitor', 'neutral', or 'brand'" });
      }
    } catch (error) {
      console.error("Error reclassifying source:", error);
      res.status(500).json({ error: "Failed to reclassify source" });
    }
  });

  app.get("/api/sources/analysis", async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const topicId = req.query.topicId ? parseInt(req.query.topicId as string) : undefined;
      const { from, to } = parseDateRange(req);
      const allSources = await storage.getSources();

      // If topic filter is set, find which domains are cited in responses for that topic
      let topicDomains: Set<string> | null = null;
      if (topicId) {
        let responses = await storage.getResponsesWithPrompts(runId, from, to);
        if (model) responses = responses.filter(r => r.model === model);
        responses = responses.filter(r => r.prompt?.topicId === topicId);
        topicDomains = new Set<string>();
        for (const r of responses) {
          if (r.sources) {
            for (const s of r.sources) {
              try { topicDomains.add(new URL(s).hostname.replace(/^www\./, '')); } catch {}
            }
          }
          // Also check text for domain mentions
          for (const src of allSources) {
            if (r.text.toLowerCase().includes(src.domain.toLowerCase())) {
              topicDomains.add(src.domain.toLowerCase());
            }
          }
        }
      }

      const { classifyDomain } = await buildSourceClassifier();
      const blacklist = await getSourceBlacklist();

      const results = await Promise.all(allSources.map(async source => {
        if (blacklist.has(source.domain.toLowerCase())) return null;
        if (topicDomains && !topicDomains.has(source.domain.toLowerCase())) return null;
        const urls = await storage.getSourceUrlsBySourceId(source.id, runId, model);
        if (urls.length === 0) return null;
        const pageIdMap = await storage.getPageIdsForUrls(urls);
        return {
          sourceId: source.id,
          domain: source.domain,
          sourceType: classifyDomain(source.domain),
          citationCount: urls.length,
          urls: urls.map(url => ({ url, pageId: pageIdMap.get(url) ?? null })),
        };
      }));
      res.json(results.filter(Boolean));
    } catch (error) {
      console.error("Error fetching source analysis:", error);
      res.status(500).json({ error: "Failed to fetch source analysis" });
    }
  });

  // Trend: how often this domain is cited per analysis run (overall + by model)
  app.get("/api/sources/:domain/trends", async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const domain = req.params.domain;
      const { from, to } = parseDateRange(req);
      const model = req.query.model as string | undefined;

      const source = await storage.getSourceByDomain(domain);
      if (!source) {
        return res.json({ runs: [], modelLabels: {} });
      }

      const allRuns = await storage.getAnalysisRuns(from, to);
      const completedRuns = allRuns.filter(r => r.status === 'complete');
      if (completedRuns.length === 0) {
        return res.json({ runs: [], modelLabels: {} });
      }

      const { MODEL_META } = await import('@shared/models');
      const defaultLabels: Record<string, string> = Object.fromEntries(Object.entries(MODEL_META).map(([k, v]) => [k, v.label]));
      const modelsConfigRaw = await storage.getSetting('modelsConfig');
      const modelsConfig = modelsConfigRaw ? JSON.parse(modelsConfigRaw) : {};

      const { db: database } = await import("../db");
      const { sourceUrls: sourceUrlsTable } = await import("@shared/schema");
      const { and, inArray, eq: eqOp } = await import("drizzle-orm");

      const runIds = completedRuns.map(r => r.id);
      const where = model
        ? and(eqOp(sourceUrlsTable.sourceId, source.id), inArray(sourceUrlsTable.analysisRunId, runIds), eqOp(sourceUrlsTable.model, model))
        : and(eqOp(sourceUrlsTable.sourceId, source.id), inArray(sourceUrlsTable.analysisRunId, runIds));
      const rows = await database
        .select({ analysisRunId: sourceUrlsTable.analysisRunId, model: sourceUrlsTable.model, url: sourceUrlsTable.url })
        .from(sourceUrlsTable)
        .where(where);

      // Group by run, then by model. Dedupe URLs to match the unique-URL
      // semantics used in /api/sources/analysis (urls.length there is deduped).
      const perRun = new Map<number, { total: Set<string>; byModel: Map<string, Set<string>> }>();
      for (const r of rows) {
        if (r.analysisRunId == null) continue;
        let bucket = perRun.get(r.analysisRunId);
        if (!bucket) { bucket = { total: new Set(), byModel: new Map() }; perRun.set(r.analysisRunId, bucket); }
        bucket.total.add(r.url);
        const m = r.model || 'unknown';
        if (!bucket.byModel.has(m)) bucket.byModel.set(m, new Set());
        bucket.byModel.get(m)!.add(r.url);
      }

      const runs = completedRuns.map(run => {
        const bucket = perRun.get(run.id);
        const modelCitations: Record<string, number> = {};
        if (bucket) {
          for (const [m, urls] of bucket.byModel.entries()) modelCitations[m] = urls.size;
        }
        return {
          runId: run.id,
          date: run.completedAt || run.startedAt,
          totalCitations: bucket ? bucket.total.size : 0,
          modelCitations,
        };
      });

      // Oldest first for charting (getAnalysisRuns returns newest first)
      runs.reverse();

      const modelLabels: Record<string, string> = {};
      for (const r of runs) {
        for (const m of Object.keys(r.modelCitations)) {
          if (!modelLabels[m]) {
            modelLabels[m] = modelsConfig[m]?.label || defaultLabels[m] || m;
          }
        }
      }

      res.json({ runs, modelLabels });
    } catch (error) {
      console.error("Error fetching domain trends:", error);
      res.status(500).json({ error: "Failed to fetch domain trends" });
    }
  });

  // Get responses that cite a specific domain
  app.get("/api/sources/:domain/responses", async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const domain = req.params.domain;
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      let allResponses = await storage.getResponsesWithPrompts(runId);
      if (model) allResponses = allResponses.filter(r => r.model === model);
      // Filter responses that cite this domain (in text body OR sources array)
      const domainLower = domain.toLowerCase();
      const matching = allResponses.filter(r =>
        r.text.toLowerCase().includes(domainLower) ||
        (r.sources && r.sources.some(s => s.toLowerCase().includes(domainLower)))
      );
      res.json(matching);
    } catch (error) {
      console.error("Error fetching responses for domain:", error);
      res.status(500).json({ error: "Failed to fetch responses" });
    }
  });
}
