import {
  Topic, InsertTopic,
  Prompt, InsertPrompt, PromptWithTopic,
  Response, InsertResponse, ResponseWithPrompt,
  Competitor, InsertCompetitor,
  InsertCompetitorMention,
  Source, InsertSource,
  Analytics, InsertAnalytics,
  AnalysisRun, InsertAnalysisRun,
  TopicAnalysis, CompetitorAnalysis, SourceAnalysis,
  MergeSuggestion, MergeHistoryEntry,
  JobQueueItem, InsertJobQueueItem, JobQueueProgress,
  WatchedUrl, InsertWatchedUrl, WatchedUrlWithCitations, WatchedUrlCitation,
  Recommendation, RecommendationOccurrence, RecommendationState,
  topics, prompts, responses, competitors, competitorMentions, competitorMerges, sources, sourceUrls, sourceUniqueUrls, analytics, analysisRuns, appSettings, jobQueue, apiUsage, apifyUsage, watchedUrls,
  recommendations, recommendationOccurrences,
} from "@shared/schema";
import { normalizeUrl, stripTrackingParams, parseHttpUrl } from "./services/analysis";
import { extractUrlsFromText } from "./services/scraper";
import { db } from "./db";
import { eq, desc, count, sql, isNull, and, or, gte, lte, inArray } from "drizzle-orm";
import { IStorage, RecommendationDetectorOutput } from "./storage";

export class DatabaseStorage implements IStorage {
  constructor() {
    this.initializeBasicData();
  }

  private async initializeBasicData() {
    // Check if topics exist, if not initialize them
    const existingTopics = await this.getTopics();
    if (existingTopics.length === 0) {
      await this.initializeTopics();
      await this.initializeCompetitors();
      await this.initializeSources();
    }
    // Backfills run sequentially because later steps depend on earlier ones:
    //   1. normalize URLs (no deps)
    //   2. strip tracking params (clean URL form before dedup/lookup)
    //   3. populate source_unique_urls + FK on source_urls
    //   4. merge text-extracted URLs into responses.sources so the GC step
    //      doesn't delete citations that are about to become valid
    //   5. GC source_urls/source_unique_urls rows whose originating response
    //      no longer exists
    // Wrapped in an IIFE so a failure at any stage is logged but doesn't
    // crash startup or block the next-best-effort step.
    (async () => {
      try { await this.backfillNormalizedSourceUrls(); }
      catch (err) { console.error('[backfill] normalized_url backfill failed:', err); }
      try { await this.backfillStripTrackingParams(); }
      catch (err) { console.error('[backfill] tracking-param backfill failed:', err); }
      try { await this.backfillSourceUniqueUrls(); }
      catch (err) { console.error('[backfill] source_unique_urls backfill failed:', err); }
      try { await this.backfillResponseSourcesFromText(); }
      catch (err) { console.error('[backfill] response sources merge failed:', err); }
      try { await this.gcOrphanSourceUrls(); }
      catch (err) { console.error('[backfill] orphan source_urls GC failed:', err); }
    })();
  }

  /**
   * One-time backfill: computes normalized_url and normalized_url_stripped
   * for any source_urls rows that don't have them yet. Idempotent — safe to
   * call on every startup.
   */
  async backfillNormalizedSourceUrls(): Promise<void> {
    const BATCH = 500;
    let updated = 0;
    while (true) {
      const rows = await db
        .select({ id: sourceUrls.id, url: sourceUrls.url })
        .from(sourceUrls)
        .where(sql`${sourceUrls.normalizedUrl} IS NULL OR ${sourceUrls.normalizedUrlStripped} IS NULL`)
        .limit(BATCH);
      if (rows.length === 0) break;
      for (const row of rows) {
        await db
          .update(sourceUrls)
          .set({
            normalizedUrl: normalizeUrl(row.url),
            normalizedUrlStripped: normalizeUrl(row.url, { stripAllQuery: true }),
          })
          .where(eq(sourceUrls.id, row.id));
      }
      updated += rows.length;
      if (rows.length < BATCH) break;
    }
    if (updated > 0) {
      console.log(`[backfill] Normalized ${updated} source_urls rows.`);
    }
  }

  /**
   * One-time backfill: strips tracking params (utm_*, gclid, fbclid, ...) from
   * `source_urls.url` and `responses.sources` for rows written before the
   * stripTrackingParams write-time guard existed. Idempotent — rows already
   * clean produce a no-op match.
   */
  async backfillStripTrackingParams(): Promise<void> {
    const BATCH = 500;
    let urlUpdated = 0;
    // source_urls.url — match anything containing a known tracking key
    while (true) {
      const rows = await db
        .select({ id: sourceUrls.id, url: sourceUrls.url })
        .from(sourceUrls)
        .where(sql`${sourceUrls.url} ~* '[?&](utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|ttclid|yclid|epik|igshid|li_fat_id|mc_cid|mc_eid|mkt_tok|_hsenc|_hsmi|__hstc|__hssc|__hsfp|trackingid|gad_source|gclsrc|dclid|_gl|gad)='`)
        .limit(BATCH);
      if (rows.length === 0) break;
      for (const row of rows) {
        const cleaned = stripTrackingParams(row.url);
        if (cleaned !== row.url) {
          await db.update(sourceUrls).set({ url: cleaned }).where(eq(sourceUrls.id, row.id));
          urlUpdated++;
        }
      }
      if (rows.length < BATCH) break;
    }

    // responses.sources — array column, scan rows that have any element with a tracking param
    let respUpdated = 0;
    while (true) {
      const rows = await db
        .select({ id: responses.id, sources: responses.sources })
        .from(responses)
        .where(sql`EXISTS (SELECT 1 FROM unnest(${responses.sources}) AS s WHERE s ~* '[?&](utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|ttclid|yclid|epik|igshid|li_fat_id|mc_cid|mc_eid|mkt_tok|_hsenc|_hsmi|__hstc|__hssc|__hsfp|trackingid|gad_source|gclsrc|dclid|_gl|gad)=')`)
        .limit(BATCH);
      if (rows.length === 0) break;
      for (const row of rows) {
        if (!row.sources) continue;
        const cleaned = Array.from(new Set(row.sources.map(stripTrackingParams)));
        const same = cleaned.length === row.sources.length && cleaned.every((u, i) => u === row.sources![i]);
        if (!same) {
          await db.update(responses).set({ sources: cleaned }).where(eq(responses.id, row.id));
          respUpdated++;
        }
      }
      if (rows.length < BATCH) break;
    }

    if (urlUpdated > 0 || respUpdated > 0) {
      console.log(`[backfill] Stripped tracking params from ${urlUpdated} source_urls.url and ${respUpdated} responses.sources rows.`);
    }
  }

  /**
   * One-time backfill: ensures every distinct citation URL has a row in
   * source_unique_urls and that every source_urls row links to it via
   * source_unique_url_id. Idempotent — safe to call on every startup.
   */
  async backfillSourceUniqueUrls(): Promise<void> {
    // 1. Insert distinct URLs that don't yet have a source_unique_urls row.
    //    Done in a single SQL so it's fast on first run but cheap afterward
    //    (the NOT EXISTS prunes already-mapped URLs).
    const inserted = await db.execute(sql`
      INSERT INTO source_unique_urls (url, normalized_url, first_seen_at)
      SELECT su.url, MIN(su.normalized_url), MIN(su.first_seen_at)
      FROM source_urls su
      WHERE NOT EXISTS (
        SELECT 1 FROM source_unique_urls sou WHERE sou.url = su.url
      )
      GROUP BY su.url
      ON CONFLICT (url) DO NOTHING
      RETURNING id
    `);
    const insertedCount = (inserted as any).rowCount ?? (inserted as any).rows?.length ?? 0;

    // 2. Backfill source_urls.source_unique_url_id for any rows still NULL.
    const linked = await db.execute(sql`
      UPDATE source_urls su
      SET source_unique_url_id = sou.id
      FROM source_unique_urls sou
      WHERE su.source_unique_url_id IS NULL AND su.url = sou.url
    `);
    const linkedCount = (linked as any).rowCount ?? 0;

    if (insertedCount > 0 || linkedCount > 0) {
      console.log(`[backfill] source_unique_urls: inserted ${insertedCount}, linked ${linkedCount} source_urls rows.`);
    }
  }

  /**
   * One-time backfill: merges URLs extracted from `responses.text` into
   * `responses.sources`. Older rows only have the structured-citation subset
   * because the analyzer wrote `analysisSources` instead of the union of
   * structured + text-extracted URLs. Without this, the Source Pages tab
   * silently omits inline LLM citations. Idempotent — once a response's
   * sources match the union, the loop produces a no-op for it.
   */
  async backfillResponseSourcesFromText(): Promise<void> {
    const isHttp = (u: string) => parseHttpUrl(u) !== null;
    const BATCH = 500;
    let scanned = 0;
    let updated = 0;
    let lastId = 0;
    while (true) {
      const rows = await db
        .select({ id: responses.id, text: responses.text, sources: responses.sources })
        .from(responses)
        .where(sql`${responses.id} > ${lastId} AND ${responses.text} ~ 'https?://'`)
        .orderBy(responses.id)
        .limit(BATCH);
      if (rows.length === 0) break;
      for (const row of rows) {
        lastId = row.id;
        scanned++;
        const existing = row.sources || [];
        const fromText = extractUrlsFromText(row.text || '')
          .map(stripTrackingParams)
          .filter(isHttp);
        if (fromText.length === 0) continue;
        const merged = Array.from(new Set([...existing, ...fromText]));
        if (merged.length === existing.length) continue;
        await db.update(responses).set({ sources: merged }).where(eq(responses.id, row.id));
        updated++;
      }
      if (rows.length < BATCH) break;
    }
    if (updated > 0) {
      console.log(`[backfill] Merged text-extracted URLs into responses.sources for ${updated}/${scanned} rows.`);
    }
  }

  /**
   * Garbage-collects stale source_urls citation rows.
   *
   * source_urls has no FK to responses, so when a response is deleted (e.g.
   * a job-queue retry that replaced it) its citation rows linger forever.
   * The Source Pages view aggregates from responses.sources so the leftover
   * source_urls rows don't directly distort counts, but they break pageId
   * deep-linking — the URL gets a stable id from source_unique_urls but
   * can't be attributed back to any surviving response.
   *
   * Rule: a source_urls row is real iff some surviving response in the same
   * (analysis_run_id, model) has the URL in its sources array.
   *
   * source_unique_urls intentionally NOT garbage-collected — it's an
   * identity table, not citation data. Keeping URLs there means a re-cited
   * URL gets the same pageId across analyses (deep links stay stable).
   *
   * Idempotent — second run matches nothing.
   */
  async gcOrphanSourceUrls(): Promise<void> {
    const deleted = await db.execute(sql`
      DELETE FROM source_urls su
      WHERE NOT EXISTS (
        SELECT 1 FROM responses r
        WHERE r.analysis_run_id IS NOT DISTINCT FROM su.analysis_run_id
          AND r.model IS NOT DISTINCT FROM su.model
          AND su.url = ANY(r.sources)
      )
    `);
    const count = (deleted as any).rowCount ?? 0;
    if (count > 0) {
      console.log(`[gc] Deleted ${count} orphan source_urls rows.`);
    }
  }

  private async initializeTopics() {
    // Don't pre-populate topics - they will be created dynamically during analysis
    // This makes the system flexible and based on actual analysis needs
  }

  private async initializeCompetitors() {
    // Don't pre-populate competitors - they will be discovered during analysis
    // This makes the system dynamic and based on actual analysis results
  }

  private async initializeSources() {
    // Initialize with empty sources - they'll be populated during analysis
  }

  // Topics
  async getTopics(): Promise<Topic[]> {
    return await db.select().from(topics).where(sql`${topics.deleted} = false OR ${topics.deleted} IS NULL`);
  }

  async createTopic(topic: InsertTopic): Promise<Topic> {
    const [created] = await db.insert(topics).values(topic).returning();
    return created;
  }

  async getTopicById(id: number): Promise<Topic | undefined> {
    const [topic] = await db.select().from(topics).where(eq(topics.id, id));
    return topic || undefined;
  }

  async softDeleteTopic(id: number): Promise<void> {
    await db.update(topics).set({ deleted: true }).where(eq(topics.id, id));
    // Also soft-delete all prompts in this topic
    await db.update(prompts).set({ deleted: true }).where(eq(prompts.topicId, id));
  }

  // Prompts
  async getPrompts(): Promise<Prompt[]> {
    return await db.select().from(prompts).where(sql`${prompts.deleted} = false OR ${prompts.deleted} IS NULL`);
  }

  async softDeletePrompt(id: number): Promise<void> {
    await db.update(prompts).set({ deleted: true }).where(eq(prompts.id, id));
  }

  async updatePromptTopic(id: number, topicId: number): Promise<void> {
    await db.update(prompts).set({ topicId }).where(eq(prompts.id, id));
  }

  async updateCompetitorDomain(id: number, domain: string): Promise<void> {
    // Only set if not already set — first match wins
    const [comp] = await db.select().from(competitors).where(eq(competitors.id, id));
    if (comp && !comp.domain) {
      await db.update(competitors).set({ domain }).where(eq(competitors.id, id));
    }
  }

  async createPrompt(prompt: InsertPrompt): Promise<Prompt> {
    const [created] = await db.insert(prompts).values(prompt).returning();
    return created;
  }

  async getPromptById(id: number): Promise<Prompt | undefined> {
    const [prompt] = await db.select().from(prompts).where(eq(prompts.id, id));
    return prompt || undefined;
  }

  async getPromptsWithTopics(): Promise<PromptWithTopic[]> {
    const results = await db
      .select()
      .from(prompts)
      .leftJoin(topics, eq(prompts.topicId, topics.id));
    
    return results.map(result => ({
      ...result.prompts,
      topic: result.topics
    }));
  }

  async getPromptsByTopic(topicId: number): Promise<Prompt[]> {
    return await db.select().from(prompts).where(eq(prompts.topicId, topicId));
  }

  // Responses
  async getResponses(): Promise<Response[]> {
    return await db.select().from(responses);
  }

  async createResponse(response: InsertResponse): Promise<Response> {
    const [created] = await db.insert(responses).values(response).returning();
    return created;
  }

  async getResponseById(id: number): Promise<Response | undefined> {
    const [response] = await db.select().from(responses).where(eq(responses.id, id));
    return response || undefined;
  }

  async getResponsesWithPrompts(runId?: number, from?: Date, to?: Date): Promise<ResponseWithPrompt[]> {
    let query = db
      .select()
      .from(responses)
      .leftJoin(prompts, eq(responses.promptId, prompts.id))
      .leftJoin(topics, eq(prompts.topicId, topics.id));

    // Deterministic order (newest first) so callers that slice the result
    // (e.g. /api/responses with limit) keep the most recent rows. Without
    // ordering the DB returned rows in arbitrary order — when total exceeded
    // the slice cap, responses for newer prompts could silently drop out
    // (observed: prompt 206 had 4 responses but only 1 reached the UI).
    if (runId) {
      const results = await query
        .where(eq(responses.analysisRunId, runId))
        .orderBy(desc(responses.createdAt), desc(responses.id));
      return results.map(result => ({
        ...result.responses,
        prompt: { ...result.prompts!, topic: result.topics }
      }));
    }

    // All completed runs, optionally filtered by date range
    const conditions = [eq(analysisRuns.status, 'complete')];
    if (from) conditions.push(gte(analysisRuns.completedAt, from));
    if (to) conditions.push(lte(analysisRuns.completedAt, to));

    const results = await query
      .innerJoin(analysisRuns, eq(responses.analysisRunId, analysisRuns.id))
      .where(and(...conditions))
      .orderBy(desc(responses.createdAt), desc(responses.id));

    return results.map(result => ({
      ...result.responses,
      prompt: { ...result.prompts!, topic: result.topics }
    }));
  }

  async getRecentResponses(limit = 10, runId?: number, from?: Date, to?: Date): Promise<ResponseWithPrompt[]> {
    let query = db
      .select()
      .from(responses)
      .leftJoin(prompts, eq(responses.promptId, prompts.id))
      .leftJoin(topics, eq(prompts.topicId, topics.id))
      .orderBy(desc(responses.createdAt));

    let filtered;
    if (runId) {
      filtered = limit > 1000 ? query.where(eq(responses.analysisRunId, runId)) : query.where(eq(responses.analysisRunId, runId)).limit(limit);
    } else {
      const conditions = [eq(analysisRuns.status, 'complete')];
      if (from) conditions.push(gte(analysisRuns.completedAt, from));
      if (to) conditions.push(lte(analysisRuns.completedAt, to));
      const joined = query
        .innerJoin(analysisRuns, eq(responses.analysisRunId, analysisRuns.id))
        .where(and(...conditions));
      filtered = limit > 1000 ? joined : joined.limit(limit);
    }
    const results = await filtered;

    return results.map(result => ({
      ...result.responses,
      prompt: { ...result.prompts!, topic: result.topics }
    }));
  }

  // Competitors
  async getCompetitors(): Promise<Competitor[]> {
    // Active = not merged AND not soft-deleted. Both filters are needed:
    // soft-deleted is the new "remove from prompt-gen list" path; merged is
    // the existing "this is a duplicate of another competitor" path. NULL
    // and FALSE both count as not-deleted (default for legacy rows).
    // Ordered by id ascending so newly-added competitors append to the
    // bottom of the prompt-generator list (matches user expectation that
    // "Add" puts the new row where they're looking).
    return await db.select().from(competitors)
      .where(and(
        isNull(competitors.mergedInto),
        sql`${competitors.deleted} IS NOT TRUE`,
      ))
      .orderBy(competitors.id);
  }

  async getAllCompetitorsIncludingMerged(): Promise<Competitor[]> {
    return await db.select().from(competitors);
  }

  async createCompetitor(competitor: InsertCompetitor): Promise<Competitor> {
    const nameKey = competitor.name.toLowerCase().trim();
    try {
      const [created] = await db.insert(competitors)
        .values({ ...competitor, nameKey })
        .returning();
      return created;
    } catch (error: any) {
      // Unique constraint violation on name_key — return existing.
      // If the existing row is soft-deleted, undelete it AND apply any
      // newly-supplied domain/category from this re-add (the user typed
      // those expecting them to take effect). Only non-empty values
      // overwrite — null/empty input doesn't erase existing data.
      // For an active (non-deleted) duplicate, return as-is so we don't
      // surprise the user by mutating an unrelated row.
      if (error?.code === '23505') {
        const existing = await this.getCompetitorByNameIncludingDeleted(competitor.name);
        if (existing) {
          if (existing.deleted) {
            const update: any = { deleted: false };
            if (competitor.domain) update.domain = competitor.domain;
            if (competitor.category) update.category = competitor.category;
            const [revived] = await db.update(competitors)
              .set(update)
              .where(eq(competitors.id, existing.id))
              .returning();
            return revived;
          }
          return existing;
        }
      }
      throw error;
    }
  }

  async getCompetitorByName(name: string): Promise<Competitor | undefined> {
    const [competitor] = await db.select().from(competitors)
      .where(and(
        eq(competitors.nameKey, name.toLowerCase().trim()),
        sql`${competitors.deleted} IS NOT TRUE`,
      ));
    return competitor || undefined;
  }

  // Used by createCompetitor on unique-violation to find the existing row
  // (which may itself be soft-deleted — we revive it rather than failing).
  private async getCompetitorByNameIncludingDeleted(name: string): Promise<Competitor | undefined> {
    const [competitor] = await db.select().from(competitors)
      .where(eq(competitors.nameKey, name.toLowerCase().trim()));
    return competitor || undefined;
  }

  async softDeleteCompetitor(id: number): Promise<void> {
    await db.update(competitors).set({ deleted: true }).where(eq(competitors.id, id));
  }

  async updateCompetitor(id: number, patch: Partial<{ name: string; category: string | null; domain: string | null }>): Promise<Competitor | undefined> {
    const update: any = {};
    if (patch.name !== undefined) {
      update.name = patch.name;
      update.nameKey = patch.name.toLowerCase().trim();
    }
    if (patch.category !== undefined) update.category = patch.category;
    if (patch.domain !== undefined) update.domain = patch.domain;
    if (Object.keys(update).length === 0) {
      const [current] = await db.select().from(competitors).where(eq(competitors.id, id));
      return current;
    }
    try {
      const [updated] = await db.update(competitors).set(update).where(eq(competitors.id, id)).returning();
      return updated;
    } catch (error: any) {
      if (error?.code === '23505') {
        // Renaming would collide with another competitor — surface a clean
        // error rather than crashing the request.
        throw new Error('A competitor with that name already exists');
      }
      throw error;
    }
  }

  async updateCompetitorMentionCount(name: string, increment: number): Promise<void> {
    await db
      .update(competitors)
      .set({ mentionCount: sql`${competitors.mentionCount} + ${increment}` })
      .where(eq(competitors.nameKey, name.toLowerCase().trim()));
  }

  // Sources
  async getSources(): Promise<Source[]> {
    return await db.select().from(sources);
  }

  async createSource(source: InsertSource): Promise<Source> {
    const [created] = await db.insert(sources).values(source).returning();
    return created;
  }

  async getSourceByDomain(domain: string): Promise<Source | undefined> {
    const [source] = await db.select().from(sources).where(eq(sources.domain, domain));
    return source || undefined;
  }

  async updateSourceCitationCount(domain: string, increment: number): Promise<void> {
    await db
      .update(sources)
      .set({ citationCount: sql`${sources.citationCount} + ${increment}` })
      .where(eq(sources.domain, domain));
  }

  async addSourceUrls(domain: string, urls: string[], analysisRunId?: number, model?: string): Promise<void> {
    const source = await this.getSourceByDomain(domain);
    if (!source) return;
    for (const url of urls) {
      const normalized = normalizeUrl(url);
      // Upsert into source_unique_urls so every distinct citation URL has a
      // stable id. Insert returns the id when new; on conflict we have to
      // fetch (Postgres only returns RETURNING for affected rows).
      const [uniqueRow] = await db
        .insert(sourceUniqueUrls)
        .values({ url, normalizedUrl: normalized })
        .onConflictDoNothing()
        .returning({ id: sourceUniqueUrls.id });
      let sourceUniqueUrlId: number | null = uniqueRow?.id ?? null;
      if (sourceUniqueUrlId === null) {
        const [existing] = await db
          .select({ id: sourceUniqueUrls.id })
          .from(sourceUniqueUrls)
          .where(eq(sourceUniqueUrls.url, url));
        sourceUniqueUrlId = existing?.id ?? null;
      }
      await db.insert(sourceUrls).values({
        sourceId: source.id,
        sourceUniqueUrlId,
        url,
        normalizedUrl: normalized,
        normalizedUrlStripped: normalizeUrl(url, { stripAllQuery: true }),
        analysisRunId: analysisRunId || null,
        model: model || null,
      });
    }
  }

  async getSourceUrlsBySourceId(sourceId: number, analysisRunId?: number, model?: string): Promise<string[]> {
    let condition = analysisRunId
      ? sql`${sourceUrls.sourceId} = ${sourceId} AND ${sourceUrls.analysisRunId} = ${analysisRunId}`
      : sql`${sourceUrls.sourceId} = ${sourceId}`;
    if (model) {
      condition = analysisRunId
        ? sql`${sourceUrls.sourceId} = ${sourceId} AND ${sourceUrls.analysisRunId} = ${analysisRunId} AND ${sourceUrls.model} = ${model}`
        : sql`${sourceUrls.sourceId} = ${sourceId} AND ${sourceUrls.model} = ${model}`;
    }
    const rows = await db
      .select({ url: sourceUrls.url })
      .from(sourceUrls)
      .where(condition);
    // Deduplicate
    return [...new Set(rows.map(r => r.url))];
  }

  async getPageIdsForUrls(urls: string[]): Promise<Map<string, number>> {
    if (urls.length === 0) return new Map();
    const rows = await db
      .select({ id: sourceUniqueUrls.id, url: sourceUniqueUrls.url })
      .from(sourceUniqueUrls)
      .where(inArray(sourceUniqueUrls.url, urls));
    return new Map(rows.map(r => [r.url, r.id]));
  }


  // Competitor mentions
  async createCompetitorMention(mention: InsertCompetitorMention): Promise<void> {
    await db.insert(competitorMentions).values(mention);
  }

  async getCompetitorAnalysisByRun(runId: number) {
    const result = await db.execute(sql`
      SELECT
        COALESCE(c.merged_into, cm.competitor_id) as competitor_id,
        primary_c.name as name,
        primary_c.category as category,
        COUNT(*) as mention_count
      FROM competitor_mentions cm
      JOIN competitors c ON cm.competitor_id = c.id
      JOIN competitors primary_c ON primary_c.id = COALESCE(c.merged_into, cm.competitor_id)
      WHERE cm.analysis_run_id = ${runId}
      GROUP BY COALESCE(c.merged_into, cm.competitor_id), primary_c.name, primary_c.category
    `);

    const rows = (result as any).rows ?? result;
    return (rows as any[]).map(r => ({
      competitorId: Number(r.competitor_id),
      name: r.name as string,
      category: r.category as string | null,
      mentionCount: Number(r.mention_count),
    }));
  }

  async getCompetitorAnalysisAllRuns(from?: Date, to?: Date) {
    const dateFilter = from && to
      ? sql`AND ar.completed_at >= ${from} AND ar.completed_at <= ${to}`
      : from
        ? sql`AND ar.completed_at >= ${from}`
        : to
          ? sql`AND ar.completed_at <= ${to}`
          : sql``;

    const result = await db.execute(sql`
      SELECT
        COALESCE(c.merged_into, cm.competitor_id) as competitor_id,
        primary_c.name as name,
        primary_c.category as category,
        COUNT(*) as mention_count
      FROM competitor_mentions cm
      JOIN competitors c ON cm.competitor_id = c.id
      JOIN competitors primary_c ON primary_c.id = COALESCE(c.merged_into, cm.competitor_id)
      JOIN analysis_runs ar ON cm.analysis_run_id = ar.id
      WHERE ar.status = 'complete' ${dateFilter}
      GROUP BY COALESCE(c.merged_into, cm.competitor_id), primary_c.name, primary_c.category
    `);

    const rows = (result as any).rows ?? result;
    return (rows as any[]).map(r => ({
      competitorId: Number(r.competitor_id),
      name: r.name as string,
      category: r.category as string | null,
      mentionCount: Number(r.mention_count),
    }));
  }

  // Analysis runs
  async createAnalysisRun(run: InsertAnalysisRun): Promise<AnalysisRun> {
    const [record] = await db.insert(analysisRuns).values(run).returning();
    return record;
  }

  async completeAnalysisRun(id: number, status: string): Promise<void> {
    await db.update(analysisRuns).set({ status, completedAt: new Date() }).where(eq(analysisRuns.id, id));
  }

  async getAnalysisRuns(from?: Date, to?: Date): Promise<AnalysisRun[]> {
    if (from || to) {
      const conditions = [];
      if (from) conditions.push(gte(analysisRuns.completedAt, from));
      if (to) conditions.push(lte(analysisRuns.completedAt, to));
      return await db.select().from(analysisRuns).where(and(...conditions)).orderBy(desc(analysisRuns.startedAt));
    }
    return await db.select().from(analysisRuns).orderBy(desc(analysisRuns.startedAt));
  }

  async getLatestAnalysisRun(): Promise<AnalysisRun | undefined> {
    const [run] = await db.select().from(analysisRuns).orderBy(desc(analysisRuns.startedAt)).limit(1);
    return run || undefined;
  }

  async updateAnalysisRunProgress(id: number, completedPrompts: number): Promise<void> {
    await db.update(analysisRuns).set({ completedPrompts }).where(eq(analysisRuns.id, id));
  }

  // Delete a single run and ONLY the data scoped to it. Every table that
  // carries an analysis_run_id is pruned by that run id; rows belonging to
  // other runs are never touched. Runs all the way through in one transaction
  // so a failure leaves the run fully intact (no half-deleted state).
  //
  // Recommendations are cross-run aggregates that FK into analysis_runs via
  // first/last/state-changed run-id columns, so they can't just be deleted by
  // run id — they're repaired from their remaining per-run occurrences (or
  // dropped if this run was their only evidence).
  async deleteAnalysisRun(runId: number): Promise<void> {
    await db.transaction(async (tx) => {
      // Leaf rows scoped directly to the run. competitor_mentions reference
      // responses, so they go before responses.
      await tx.delete(competitorMentions).where(eq(competitorMentions.analysisRunId, runId));
      await tx.delete(jobQueue).where(eq(jobQueue.analysisRunId, runId));
      await tx.delete(sourceUrls).where(eq(sourceUrls.analysisRunId, runId));
      await tx.delete(apiUsage).where(eq(apiUsage.analysisRunId, runId));
      await tx.delete(apifyUsage).where(eq(apifyUsage.analysisRunId, runId));
      await tx.delete(responses).where(eq(responses.analysisRunId, runId));

      // Drop this run's recommendation occurrences, then repair any
      // recommendation whose denormalized run pointers referenced this run.
      await tx.delete(recommendationOccurrences).where(eq(recommendationOccurrences.analysisRunId, runId));

      const affected = await tx
        .select()
        .from(recommendations)
        .where(or(
          eq(recommendations.firstSeenRunId, runId),
          eq(recommendations.lastSeenRunId, runId),
          eq(recommendations.stateChangedAtRunId, runId),
        ));

      for (const rec of affected) {
        const occs = await tx
          .select()
          .from(recommendationOccurrences)
          .where(eq(recommendationOccurrences.recommendationId, rec.id))
          .orderBy(desc(recommendationOccurrences.analysisRunId));

        if (occs.length === 0) {
          // This run was the recommendation's only evidence — remove it.
          await tx.delete(recommendations).where(eq(recommendations.id, rec.id));
          continue;
        }

        const runIds = occs.map(o => o.analysisRunId);
        const latest = occs[0]; // ordered by run id desc
        await tx.update(recommendations).set({
          firstSeenRunId: Math.min(...runIds),
          lastSeenRunId: Math.max(...runIds),
          totalOccurrences: occs.length,
          // Re-denormalize the latest snapshot from the newest remaining run.
          severity: latest.severity,
          narrative: latest.narrative,
          evidenceJson: latest.evidenceJson,
          impactScore: latest.impactScore,
          // The user's decision anchor pointed at the deleted run — fall back
          // to the implicit first-seen anchor.
          stateChangedAtRunId: rec.stateChangedAtRunId === runId ? null : rec.stateChangedAtRunId,
          updatedAt: new Date(),
        }).where(eq(recommendations.id, rec.id));
      }

      await tx.delete(analysisRuns).where(eq(analysisRuns.id, runId));
    });
  }

  // Settings
  async getSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const existing = await this.getSetting(key);
    if (existing !== null) {
      await db.update(appSettings).set({ value }).where(eq(appSettings.key, key));
    } else {
      await db.insert(appSettings).values({ key, value });
    }
  }

  // Analytics
  async getLatestAnalytics(): Promise<Analytics | undefined> {
    const [latestAnalytics] = await db
      .select()
      .from(analytics)
      .orderBy(desc(analytics.date))
      .limit(1);
    return latestAnalytics || undefined;
  }

  async createAnalytics(analyticsData: InsertAnalytics): Promise<Analytics> {
    const [created] = await db.insert(analytics).values(analyticsData).returning();
    return created;
  }

  // Analysis methods
  async getTopicAnalysis(): Promise<TopicAnalysis[]> {
    const results = await db
      .select({
        topicId: topics.id,
        topicName: topics.name,
        totalPrompts: count(prompts.id),
        brandMentions: sql<number>`count(case when ${responses.brandMentioned} = true then 1 end)`,
      })
      .from(topics)
      .leftJoin(prompts, eq(topics.id, prompts.topicId))
      .leftJoin(responses, eq(prompts.id, responses.promptId))
      .groupBy(topics.id, topics.name);

    return results.map(result => ({
      topicId: result.topicId,
      topicName: result.topicName,
      totalPrompts: result.totalPrompts,
      brandMentions: result.brandMentions,
      mentionRate: result.totalPrompts > 0 ? (result.brandMentions / result.totalPrompts) * 100 : 0
    }));
  }

  async getCompetitorAnalysis(): Promise<CompetitorAnalysis[]> {
    const competitorList = await this.getCompetitors();
    const totalResponses = (await this.getResponses()).length;

    return competitorList.map(competitor => ({
      competitorId: competitor.id,
      name: competitor.name,
      category: competitor.category,
      mentionCount: competitor.mentionCount || 0,
      mentionRate: totalResponses > 0 ? ((competitor.mentionCount || 0) / totalResponses) * 100 : 0,
      changeRate: 0 // This would need historical data to calculate
    }));
  }

  async getSourceAnalysis(): Promise<SourceAnalysis[]> {
    const sourceList = await this.getSources();
    return await Promise.all(sourceList.map(async source => {
      const urls = await this.getSourceUrlsBySourceId(source.id);
      return {
        sourceId: source.id,
        domain: source.domain,
        citationCount: source.citationCount || 0,
        urls: urls.length > 0 ? urls : [source.url]
      };
    }));
  }

  // Latest analysis results only
  async getLatestResponses(): Promise<ResponseWithPrompt[]> {
    return await this.getRecentResponses(1000); // Increased from 50 to 1000
  }

  async getLatestPrompts(): Promise<Prompt[]> {
    return await db.select().from(prompts).orderBy(desc(prompts.createdAt));
  }

  // Competitor merging
  async mergeCompetitors(primaryId: number, absorbedIds: number[]): Promise<number> {
    // Validate primary exists and is not itself merged
    const [primary] = await db.select().from(competitors).where(eq(competitors.id, primaryId));
    if (!primary) throw new Error('Primary competitor not found');
    if (primary.mergedInto) throw new Error('Primary competitor is itself merged into another');

    let count = 0;
    for (const absorbedId of absorbedIds) {
      if (absorbedId === primaryId) continue;
      await db.update(competitors).set({ mergedInto: primaryId }).where(eq(competitors.id, absorbedId));
      // Also re-point anything merged into the absorbed competitor to the new primary
      await db.update(competitors).set({ mergedInto: primaryId }).where(eq(competitors.mergedInto, absorbedId));
      await db.insert(competitorMerges).values({
        primaryCompetitorId: primaryId,
        mergedCompetitorId: absorbedId,
      });
      count++;
    }
    return count;
  }

  async unmergeCompetitor(competitorId: number): Promise<void> {
    await db.update(competitors).set({ mergedInto: null }).where(eq(competitors.id, competitorId));
    await db.delete(competitorMerges).where(eq(competitorMerges.mergedCompetitorId, competitorId));
  }

  async getMergeSuggestions(): Promise<MergeSuggestion[]> {
    // Only consider competitors that have actual mentions — zero-mention competitors are noise
    const allCompsRaw = await db.select().from(competitors).where(isNull(competitors.mergedInto));
    const mentionRows = await db.execute(sql`
      SELECT competitor_id, COUNT(*) as cnt FROM competitor_mentions GROUP BY competitor_id
    `);
    const mentionCounts = new Map<number, number>();
    for (const r of ((mentionRows as any).rows ?? mentionRows) as any[]) {
      mentionCounts.set(Number(r.competitor_id), Number(r.cnt));
    }
    const allComps = allCompsRaw.filter(c => (mentionCounts.get(c.id) || 0) > 0);

    // Compute pairwise name similarity, group into clusters
    const clusters: Map<number, { ids: Set<number>; maxSim: number }> = new Map();
    const assigned = new Set<number>();

    for (let i = 0; i < allComps.length; i++) {
      for (let j = i + 1; j < allComps.length; j++) {
        const sim = this.nameSimilarity(allComps[i].name, allComps[j].name);
        if (sim >= 0.7) {
          const existingI = [...clusters.entries()].find(([, v]) => v.ids.has(allComps[i].id));
          const existingJ = [...clusters.entries()].find(([, v]) => v.ids.has(allComps[j].id));
          if (existingI && existingJ && existingI[0] !== existingJ[0]) {
            // Merge clusters
            for (const id of existingJ[1].ids) existingI[1].ids.add(id);
            existingI[1].maxSim = Math.max(existingI[1].maxSim, existingJ[1].maxSim, sim);
            clusters.delete(existingJ[0]);
          } else if (existingI) {
            existingI[1].ids.add(allComps[j].id);
            existingI[1].maxSim = Math.max(existingI[1].maxSim, sim);
          } else if (existingJ) {
            existingJ[1].ids.add(allComps[i].id);
            existingJ[1].maxSim = Math.max(existingJ[1].maxSim, sim);
          } else {
            const clusterKey = allComps[i].id;
            clusters.set(clusterKey, {
              ids: new Set([allComps[i].id, allComps[j].id]),
              maxSim: sim,
            });
          }
          assigned.add(allComps[i].id);
          assigned.add(allComps[j].id);
        }
      }
    }

    const compMap = new Map(allComps.map(c => [c.id, c]));
    const suggestions: MergeSuggestion[] = [];
    for (const [, cluster] of clusters) {
      const comps = [...cluster.ids]
        .filter(id => compMap.has(id)) // only competitors with mentions
        .map(id => {
          const c = compMap.get(id)!;
          return { id: c.id, name: c.name, mentionCount: mentionCounts.get(c.id) || 0 };
        });
      if (comps.length >= 2) {
        suggestions.push({ competitors: comps, similarity: cluster.maxSim });
      }
    }

    return suggestions.sort((a, b) => b.similarity - a.similarity);
  }

  private nameSimilarity(a: string, b: string): number {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    if (al === bl) return 1;

    // Substring check
    if (al.includes(bl) || bl.includes(al)) return 0.85;

    // Word overlap
    const wordsA = al.split(/[\s\-_]+/).filter(Boolean);
    const wordsB = bl.split(/[\s\-_]+/).filter(Boolean);
    const allWords = new Set([...wordsA, ...wordsB]);
    const shared = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb)));
    if (allWords.size > 0 && shared.length > 0) {
      return shared.length / allWords.size;
    }

    return 0;
  }

  async getMergeHistory(): Promise<MergeHistoryEntry[]> {
    const result = await db.execute(sql`
      SELECT
        cm.id,
        cm.primary_competitor_id,
        pc.name as primary_name,
        cm.merged_competitor_id,
        mc.name as merged_name,
        cm.performed_at
      FROM competitor_merges cm
      JOIN competitors pc ON pc.id = cm.primary_competitor_id
      JOIN competitors mc ON mc.id = cm.merged_competitor_id
      ORDER BY cm.performed_at DESC
    `);

    const rows = (result as any).rows ?? result;
    return (rows as any[]).map(r => ({
      id: Number(r.id),
      primaryCompetitorId: Number(r.primary_competitor_id),
      primaryName: r.primary_name as string,
      mergedCompetitorId: Number(r.merged_competitor_id),
      mergedName: r.merged_name as string,
      performedAt: r.performed_at ? new Date(r.performed_at) : null,
    }));
  }

  // Job queue methods
  async enqueueJobs(jobs: InsertJobQueueItem[]): Promise<void> {
    // Batch insert in chunks of 100
    for (let i = 0; i < jobs.length; i += 100) {
      const batch = jobs.slice(i, i + 100);
      await db.insert(jobQueue).values(batch);
    }
  }

  async dequeueJob(analysisRunId: number): Promise<JobQueueItem | null> {
    const result = await db.execute(sql`
      UPDATE job_queue
      SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM job_queue
        WHERE analysis_run_id = ${analysisRunId} AND status = 'pending'
        ORDER BY id LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    const rows = (result as any).rows ?? result;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      analysisRunId: r.analysis_run_id,
      promptId: r.prompt_id,
      promptText: r.prompt_text,
      promptTopicId: r.prompt_topic_id,
      promptIsExisting: r.prompt_is_existing,
      model: r.model,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastError: r.last_error,
      lockedAt: r.locked_at ? new Date(r.locked_at) : null,
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      createdAt: r.created_at ? new Date(r.created_at) : null,
    };
  }

  async completeJob(jobId: number): Promise<void> {
    await db.update(jobQueue)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(jobQueue.id, jobId));
  }

  async failJob(jobId: number, error: string, shouldRetry: boolean, wasBusy: boolean = false): Promise<void> {
    // Always mark the current job as failed with the error
    const [job] = await db.select().from(jobQueue).where(eq(jobQueue.id, jobId));
    await db.update(jobQueue)
      .set({ status: 'failed', lastError: error, completedAt: new Date() })
      .where(eq(jobQueue.id, jobId));

    if (!shouldRetry || !job) return;

    // Real-error cap: stop after maxAttempts dequeues that weren't busy/capacity-related.
    // (busy retries decrement `attempts`, so this counter only grows on real errors.)
    if (job.attempts >= (job.maxAttempts || 3)) return;

    // Hard chain cap: bound capacity/busy retry loops at 50 total entries in the chain.
    const originalId = job.originalJobId || job.id;
    const [chainCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobQueue)
      .where(sql`${jobQueue.id} = ${originalId} OR ${jobQueue.originalJobId} = ${originalId}`);
    if (Number(chainCount?.count ?? 0) >= 50) return;

    // 429/busy/capacity shouldn't count as a real attempt — dequeueJob already incremented,
    // so subtract 2 to net zero (one for dequeue increment, one for this retry)
    const retryAttempts = wasBusy ? Math.max(0, job.attempts - 2) : job.attempts;
    await db.insert(jobQueue).values({
      analysisRunId: job.analysisRunId,
      promptId: job.promptId,
      promptText: job.promptText,
      promptTopicId: job.promptTopicId,
      promptIsExisting: job.promptIsExisting,
      model: job.model,
      status: 'pending',
      attempts: retryAttempts,
      maxAttempts: job.maxAttempts,
      lastError: null,
      originalJobId: originalId,
    });
  }

  async getJobQueueProgress(analysisRunId: number): Promise<JobQueueProgress> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM job_queue
      WHERE analysis_run_id = ${analysisRunId}
    `);
    const rows = (result as any).rows ?? result;
    const r = rows[0];
    return {
      total: Number(r.total),
      pending: Number(r.pending),
      processing: Number(r.processing),
      completed: Number(r.completed),
      failed: Number(r.failed),
    };
  }

  async recoverStalledJobs(stallTimeoutMs: number = 300000): Promise<number> {
    // Find stalled jobs
    const stalledJobs = await db.select().from(jobQueue)
      .where(sql`${jobQueue.status} = 'processing' AND ${jobQueue.lockedAt} < NOW() - INTERVAL '1 millisecond' * ${stallTimeoutMs}`);

    for (const job of stalledJobs) {
      // Mark as failed with the stall reason
      await db.update(jobQueue)
        .set({ status: 'failed', lastError: 'Stalled — container crashed or timed out', completedAt: new Date() })
        .where(eq(jobQueue.id, job.id));

      // Create a retry job if under max attempts
      if (job.attempts < (job.maxAttempts || 3)) {
        const originalId = job.originalJobId || job.id;
        await db.insert(jobQueue).values({
          analysisRunId: job.analysisRunId,
          promptId: job.promptId,
          promptText: job.promptText,
          promptTopicId: job.promptTopicId,
          promptIsExisting: job.promptIsExisting,
          model: job.model,
          status: 'pending',
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          lastError: null,
          originalJobId: originalId,
        });
      }
    }

    return stalledJobs.length;
  }

  async getFailedJobs(analysisRunId: number): Promise<JobQueueItem[]> {
    // Only return terminal failures: failed jobs where no retry in the same chain succeeded.
    // A chain is linked by original_job_id. The last failed job in a chain with no
    // completed/pending sibling is a terminal failure.
    const result = await db.execute(sql`
      SELECT f.* FROM job_queue f
      WHERE f.analysis_run_id = ${analysisRunId}
        AND f.status = 'failed'
        -- No completed, pending, processing, or cancelled job shares this chain
        AND NOT EXISTS (
          SELECT 1 FROM job_queue s
          WHERE s.analysis_run_id = ${analysisRunId}
            AND s.status IN ('completed', 'pending', 'processing', 'cancelled')
            AND (
              -- same chain: both point to the same original, or one IS the original
              s.original_job_id = COALESCE(f.original_job_id, f.id)
              OR s.id = COALESCE(f.original_job_id, f.id)
              OR COALESCE(s.original_job_id, s.id) = COALESCE(f.original_job_id, f.id)
            )
        )
        -- Only show the latest failure per chain
        AND f.id = (
          SELECT MAX(f2.id) FROM job_queue f2
          WHERE f2.analysis_run_id = ${analysisRunId}
            AND f2.status = 'failed'
            AND COALESCE(f2.original_job_id, f2.id) = COALESCE(f.original_job_id, f.id)
        )
      ORDER BY f.id DESC
    `);
    const rows = (result as any).rows ?? result;
    return (rows as any[]).map(r => ({
      id: r.id,
      analysisRunId: r.analysis_run_id,
      promptId: r.prompt_id,
      promptText: r.prompt_text,
      promptTopicId: r.prompt_topic_id,
      promptIsExisting: r.prompt_is_existing,
      model: r.model,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastError: r.last_error,
      originalJobId: r.original_job_id,
      lockedAt: r.locked_at ? new Date(r.locked_at) : null,
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      createdAt: r.created_at ? new Date(r.created_at) : null,
    }));
  }

  async cancelJobsForRun(analysisRunId: number): Promise<void> {
    await db.update(jobQueue)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(sql`${jobQueue.analysisRunId} = ${analysisRunId} AND (${jobQueue.status} = 'pending' OR ${jobQueue.status} = 'processing')`);
  }

  // Data clearing methods
  async clearAllPrompts(): Promise<void> {
    await db.delete(responses); // Delete responses first due to foreign key
    await db.delete(prompts);
  }

  async clearAllResponses(): Promise<void> {
    await db.delete(responses);
  }

  async clearAllCompetitors(): Promise<void> {
    console.log(`[${new Date().toISOString()}] DatabaseStorage: Clearing all competitors...`);
    await db.delete(competitors);
    console.log(`[${new Date().toISOString()}] DatabaseStorage: All competitors cleared successfully`);
  }

  async clearResultsOnly(): Promise<void> {
    console.log(`[${new Date().toISOString()}] DatabaseStorage: Clearing results (keeping prompts/topics)...`);
    await db.delete(jobQueue);
    await db.delete(competitorMentions);
    await db.delete(competitorMerges);
    await db.delete(sourceUrls);
    await db.delete(responses);
    await db.delete(competitors);
    await db.delete(sources);
    await db.delete(analytics);
    await db.delete(apiUsage);
    await db.delete(apifyUsage);
    // recommendation_occurrences cascades on recommendation FK delete; both
    // tables FK to analysis_runs, so clear them before dropping runs.
    await db.delete(recommendationOccurrences);
    await db.delete(recommendations);
    await db.delete(analysisRuns);
    console.log(`[${new Date().toISOString()}] DatabaseStorage: Results cleared, prompts and topics preserved`);
  }

  // Watched URLs
  async getWatchedUrls(opts: { source?: 'manual' | 'sitemap'; limit?: number; offset?: number } = {}): Promise<WatchedUrl[]> {
    let q = db.select().from(watchedUrls).$dynamic();
    if (opts.source) q = q.where(eq(watchedUrls.source, opts.source));
    q = q.orderBy(desc(watchedUrls.addedAt));
    if (opts.limit !== undefined) q = q.limit(opts.limit);
    if (opts.offset !== undefined) q = q.offset(opts.offset);
    return await q;
  }

  async getWatchedUrlCount(source?: 'manual' | 'sitemap'): Promise<number> {
    const q = source
      ? db.select({ c: count() }).from(watchedUrls).where(eq(watchedUrls.source, source))
      : db.select({ c: count() }).from(watchedUrls);
    const [row] = await q;
    return Number(row?.c || 0);
  }

  async getWatchedUrlById(id: number): Promise<WatchedUrl | undefined> {
    const [row] = await db.select().from(watchedUrls).where(eq(watchedUrls.id, id));
    return row || undefined;
  }

  async getWatchedUrlByNormalized(normalized: string): Promise<WatchedUrl | undefined> {
    const [row] = await db.select().from(watchedUrls).where(eq(watchedUrls.normalizedUrl, normalized));
    return row || undefined;
  }

  async createWatchedUrl(watched: InsertWatchedUrl & { normalizedUrl: string; ignoreQueryStrings?: boolean; source?: 'manual' | 'sitemap' }): Promise<WatchedUrl> {
    const [row] = await db.insert(watchedUrls).values({
      ...watched,
      ignoreQueryStrings: watched.ignoreQueryStrings ?? false,
      source: watched.source ?? 'manual',
    }).returning();
    return row;
  }

  /**
   * Bulk import for auto-discovered URLs (from sitemap). Uses
   * ON CONFLICT (normalized_url) DO NOTHING so manual entries — added
   * through the UI with a different `source` value — are never overwritten.
   * Returns the number of rows actually inserted.
   */
  async bulkInsertWatchedUrls(rows: { url: string; normalizedUrl: string; ignoreQueryStrings: boolean; source: 'manual' | 'sitemap'; title?: string | null; addedByUserId?: number | null }[]): Promise<number> {
    if (rows.length === 0) return 0;
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map(r => ({
        url: r.url,
        normalizedUrl: r.normalizedUrl,
        ignoreQueryStrings: r.ignoreQueryStrings,
        source: r.source,
        title: r.title ?? null,
        addedByUserId: r.addedByUserId ?? null,
      }));
      const result = await db.insert(watchedUrls)
        .values(batch)
        .onConflictDoNothing({ target: watchedUrls.normalizedUrl })
        .returning({ id: watchedUrls.id });
      inserted += result.length;
    }
    return inserted;
  }

  async updateWatchedUrl(id: number, patch: Partial<Pick<WatchedUrl, 'title' | 'notes'>>): Promise<WatchedUrl | undefined> {
    const [row] = await db.update(watchedUrls).set(patch).where(eq(watchedUrls.id, id)).returning();
    return row || undefined;
  }

  async deleteWatchedUrl(id: number): Promise<void> {
    await db.delete(watchedUrls).where(eq(watchedUrls.id, id));
  }

  /**
   * Aggregate watched URLs with their citations. Accepts the same filters as
   * getWatchedUrls plus runId/model scoping on the citation side.
   */
  async getWatchedUrlsWithCitations(opts: { runId?: number; model?: string; source?: 'manual' | 'sitemap'; limit?: number; offset?: number } = {}): Promise<WatchedUrlWithCitations[]> {
    // Rank watched URLs by citation count (desc), newest-added as tiebreaker,
    // and paginate the RANKED set — so "most-cited first" holds across pages,
    // not just within one. The count must be computed in SQL (before
    // limit/offset); doing it after pagination would only reorder a single
    // date-ordered page. It uses the same per-row match column
    // (normalized_url vs normalized_url_stripped) and run/model scoping as
    // getWatchedUrlCitations, so the order agrees with the displayed counts.
    // count(distinct (resp.id, su.url)) FILTER (resp.id IS NOT NULL) mirrors
    // that method's selectDistinct over the response tuple (the other columns
    // are functionally dependent on resp.id); the FILTER drops source_urls
    // rows with no matching response, matching its INNER JOIN semantics.
    const runFilter = opts.runId ? sql` AND su.analysis_run_id = ${opts.runId}` : sql``;
    const modelFilter = opts.model ? sql` AND su.model = ${opts.model}` : sql``;
    const sourceFilter = opts.source ? sql` WHERE w.source = ${opts.source}` : sql``;
    const limitClause = opts.limit !== undefined ? sql` LIMIT ${opts.limit}` : sql``;
    const offsetClause = opts.offset !== undefined ? sql` OFFSET ${opts.offset}` : sql``;

    const result = await db.execute(sql`
      SELECT w.id AS id
      FROM watched_urls w
      LEFT JOIN source_urls su
        ON ((w.ignore_query_strings AND su.normalized_url_stripped = w.normalized_url)
         OR (NOT w.ignore_query_strings AND su.normalized_url = w.normalized_url))${runFilter}${modelFilter}
      LEFT JOIN responses resp
        ON resp.analysis_run_id = su.analysis_run_id
       AND resp.model = su.model
       AND su.url = ANY(resp.sources)${sourceFilter}
      GROUP BY w.id, w.added_at
      ORDER BY count(DISTINCT (resp.id, su.url)) FILTER (WHERE resp.id IS NOT NULL) DESC,
               w.added_at DESC, w.id DESC${limitClause}${offsetClause}
    `);
    const rows = (result as any).rows ?? result;
    if (!rows || rows.length === 0) return [];

    const results: WatchedUrlWithCitations[] = [];
    for (const r of rows as any[]) {
      const single = await this.getWatchedUrlCitations(Number(r.id), opts.runId, opts.model);
      if (single) results.push(single);
    }
    return results;
  }

  async getWatchedUrlCitations(id: number, runId?: number, model?: string): Promise<WatchedUrlWithCitations | undefined> {
    const watched = await this.getWatchedUrlById(id);
    if (!watched) return undefined;

    // Which source_urls column to match against depends on how the watched
    // URL was normalized: strict matchers (default) hit normalized_url;
    // query-ignoring matchers hit normalized_url_stripped (also indexed).
    // Both source_urls columns are populated on write and at startup-backfill.
    const matchColumn = watched.ignoreQueryStrings
      ? sourceUrls.normalizedUrlStripped
      : sourceUrls.normalizedUrl;

    // Responses are resolved via (analysis_run_id, model) — unique per-prompt
    // in each run — and the ANY(r.sources) filter disambiguates which
    // response in a run×model group actually cited this URL.
    const whereClauses: any[] = [eq(matchColumn, watched.normalizedUrl)];
    if (runId) whereClauses.push(eq(sourceUrls.analysisRunId, runId));
    if (model) whereClauses.push(eq(sourceUrls.model, model));

    const rows = await db
      .selectDistinct({
        responseId: responses.id,
        runId: responses.analysisRunId,
        model: responses.model,
        createdAt: responses.createdAt,
        brandMentioned: responses.brandMentioned,
        promptText: prompts.text,
        citedUrl: sourceUrls.url,
      })
      .from(sourceUrls)
      .innerJoin(
        responses,
        and(
          eq(responses.analysisRunId, sourceUrls.analysisRunId),
          eq(responses.model, sourceUrls.model),
          sql`${sourceUrls.url} = ANY(${responses.sources})`,
        ),
      )
      .leftJoin(prompts, eq(responses.promptId, prompts.id))
      .where(and(...whereClauses));

    const citations: WatchedUrlCitation[] = [];
    const citationsByModel: Record<string, number> = {};
    let firstCitedAt: Date | null = null;
    let firstCitedRunId: number | null = null;

    for (const r of rows) {
      citations.push({
        responseId: r.responseId,
        runId: r.runId,
        model: r.model,
        url: r.citedUrl,
        citedAt: r.createdAt,
        promptText: r.promptText || '',
        brandMentioned: !!r.brandMentioned,
      });
      const m = r.model || 'unknown';
      citationsByModel[m] = (citationsByModel[m] || 0) + 1;
      if (r.createdAt && (!firstCitedAt || r.createdAt < firstCitedAt)) {
        firstCitedAt = r.createdAt;
        firstCitedRunId = r.runId;
      }
    }

    citations.sort((a, b) => {
      const ta = a.citedAt ? a.citedAt.getTime() : 0;
      const tb = b.citedAt ? b.citedAt.getTime() : 0;
      return tb - ta;
    });

    return {
      ...watched,
      citationCount: citations.length,
      firstCitedAt,
      firstCitedRunId,
      citationsByModel,
      citations,
    };
  }

  async clearAllAnalysisData(): Promise<void> {
    console.log(`[${new Date().toISOString()}] DatabaseStorage: Clearing ALL analysis data...`);
    // Order matters — respect foreign key constraints
    await db.delete(jobQueue);
    await db.delete(competitorMentions);
    await db.delete(competitorMerges);
    await db.delete(sourceUrls);
    await db.delete(responses);
    await db.delete(prompts);
    await db.delete(competitors);
    await db.delete(sources);
    await db.delete(analytics);
    await db.delete(apiUsage);
    await db.delete(apifyUsage);
    await db.delete(recommendationOccurrences);
    await db.delete(recommendations);
    await db.delete(analysisRuns);
    await db.delete(topics);
    console.log(`[${new Date().toISOString()}] DatabaseStorage: All analysis data cleared`);
  }

  // ─── Recommendations ──────────────────────────────────────────────

  async upsertRecommendation(
    input: RecommendationDetectorOutput,
    runId: number,
  ): Promise<{ id: number; isNew: boolean }> {
    // ON CONFLICT (fingerprint) DO UPDATE — refreshes the latest snapshot but
    // preserves user-controlled fields (state, state_changed_*, first_seen,
    // total_occurrences increments instead of overwriting).
    const [row] = await db
      .insert(recommendations)
      .values({
        fingerprint: input.fingerprint,
        fingerprintVersion: input.fingerprintVersion,
        detectorKey: input.detectorKey,
        severity: input.severity,
        title: input.title,
        narrative: input.narrative,
        evidenceJson: input.evidenceJson,
        relatedEntities: input.relatedEntities,
        impactScore: input.impactScore,
        firstSeenRunId: runId,
        lastSeenRunId: runId,
        totalOccurrences: 1,
      })
      .onConflictDoUpdate({
        target: recommendations.fingerprint,
        set: {
          severity: input.severity,
          title: input.title,
          narrative: input.narrative,
          evidenceJson: input.evidenceJson,
          relatedEntities: input.relatedEntities,
          impactScore: input.impactScore,
          lastSeenRunId: runId,
          totalOccurrences: sql`${recommendations.totalOccurrences} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: recommendations.id, firstSeenRunId: recommendations.firstSeenRunId });
    // isNew is true iff first_seen_run_id == runId AND total_occurrences == 1
    // We can derive isNew from whether firstSeenRunId equals the current runId
    // — only true for fresh inserts.
    const isNew = row.firstSeenRunId === runId;
    // Note: when re-running detectors for the same run, isNew may be false
    // even on first detection; the orchestrator avoids that by checking the
    // occurrence row before incrementing.
    return { id: row.id, isNew };
  }

  async upsertRecommendationOccurrence(input: {
    recommendationId: number;
    analysisRunId: number;
    severity: string;
    narrative: any;
    evidenceJson: any;
    impactScore: number;
  }): Promise<void> {
    await db
      .insert(recommendationOccurrences)
      .values(input)
      .onConflictDoUpdate({
        target: [recommendationOccurrences.recommendationId, recommendationOccurrences.analysisRunId],
        set: {
          severity: input.severity,
          narrative: input.narrative,
          evidenceJson: input.evidenceJson,
          impactScore: input.impactScore,
        },
      });
  }

  async getRecommendations(opts: {
    state?: RecommendationState;
    severity?: 'red' | 'yellow' | 'info';
    detectorKey?: string;
  } = {}): Promise<Recommendation[]> {
    const conds = [];
    if (opts.state) conds.push(eq(recommendations.state, opts.state));
    if (opts.severity) conds.push(eq(recommendations.severity, opts.severity));
    if (opts.detectorKey) conds.push(eq(recommendations.detectorKey, opts.detectorKey));
    const q = db.select().from(recommendations);
    const results = conds.length > 0 ? await q.where(and(...conds)) : await q;
    // Order: severity (red > yellow > info), then impact_score desc.
    const sevRank: Record<string, number> = { red: 0, yellow: 1, info: 2 };
    return results.sort((a, b) => {
      const s = (sevRank[a.severity] ?? 99) - (sevRank[b.severity] ?? 99);
      if (s !== 0) return s;
      return b.impactScore - a.impactScore;
    });
  }

  async getRecommendationById(id: number): Promise<Recommendation | undefined> {
    const [rec] = await db.select().from(recommendations).where(eq(recommendations.id, id));
    return rec;
  }

  async getRecommendationOccurrences(recommendationId: number): Promise<RecommendationOccurrence[]> {
    return await db
      .select()
      .from(recommendationOccurrences)
      .where(eq(recommendationOccurrences.recommendationId, recommendationId))
      .orderBy(desc(recommendationOccurrences.createdAt));
  }

  async updateRecommendationState(
    id: number,
    state: RecommendationState,
    userId: number,
    latestRunId: number | null,
  ): Promise<void> {
    await db
      .update(recommendations)
      .set({
        state,
        stateChangedBy: userId,
        stateChangedAt: new Date(),
        // Anchors hint computation against the user's decision point. See
        // computeHint for the read-side logic.
        stateChangedAtRunId: latestRunId,
        updatedAt: new Date(),
      })
      .where(eq(recommendations.id, id));
  }

  async getRecommendationCounts(): Promise<{
    open: number;
    actioned: number;
    resolved: number;
    dismissed: number;
  }> {
    const rows = await db
      .select({ state: recommendations.state, n: count() })
      .from(recommendations)
      .groupBy(recommendations.state);
    const out = { open: 0, actioned: 0, resolved: 0, dismissed: 0 };
    for (const r of rows) {
      if (r.state in out) (out as any)[r.state] = Number(r.n);
    }
    return out;
  }

  async clearAllRecommendations(): Promise<{ deleted: number }> {
    // ON DELETE CASCADE on recommendation_occurrences.recommendation_id
    // takes care of history. Be explicit anyway so the order is obvious.
    await db.delete(recommendationOccurrences);
    const result = await db.delete(recommendations).returning({ id: recommendations.id });
    return { deleted: result.length };
  }
}