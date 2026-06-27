import { pgTable, text, serial, integer, boolean, timestamp, real, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const topics = pgTable("topics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  deleted: boolean("deleted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const prompts = pgTable("prompts", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  topicId: integer("topic_id").references(() => topics.id),
  deleted: boolean("deleted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const responses = pgTable("responses", {
  id: serial("id").primaryKey(),
  promptId: integer("prompt_id").references(() => prompts.id).notNull(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id),
  model: text("model"),
  text: text("text").notNull(),
  brandMentioned: boolean("brand_mentioned").default(false),
  competitorsMentioned: text("competitors_mentioned").array(),
  sources: text("sources").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const competitors = pgTable("competitors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  domain: text("domain"),
  category: text("category"),
  mentionCount: integer("mention_count").default(0),
  lastMentioned: timestamp("last_mentioned"),
  mergedInto: integer("merged_into"),
  // Soft-delete flag set by the prompt-generator's "remove competitor" UI.
  // Hides the competitor from the active list AND prevents the analyzer
  // (in dynamic mode) from re-discovering it as a "new" competitor.
  // Historical competitor_mentions are preserved.
  deleted: boolean("deleted").default(false),
});

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  url: text("url").notNull(),
  citationCount: integer("citation_count").default(0),
  lastCited: timestamp("last_cited"),
});

// One row per distinct citation URL — gives each URL a stable integer id used
// as the page id in the Source Pages UI. source_urls remains the per-(run,
// model) citation event log; this table is the deduped lookup. Every
// addSourceUrls insert upserts here too so the two stay in sync.
export const sourceUniqueUrls = pgTable("source_unique_urls", {
  id: serial("id").primaryKey(),
  // Representative/display URL for the page. No longer unique — many raw URLs
  // (casing, trailing slash, tracking params) collapse onto one row. Identity
  // is `normalized_url`, the canonical form from normalizeUrl().
  url: text("url").notNull(),
  // Kept nullable + non-unique HERE on purpose. The real uniqueness guard is
  // the index `source_unique_urls_normalized_url_key`, created by the startup
  // merge backfill (backfillSourceUniqueUrls) AFTER it dedups legacy rows.
  // If this were declared NOT NULL/unique, `drizzle-kit push` (which runs
  // before the app boots in the Docker CMD) would try to enforce it on dirty
  // data and fail, blocking startup before the backfill could clean it.
  normalizedUrl: text("normalized_url"),
  firstSeenAt: timestamp("first_seen_at").defaultNow(),
});

export const sourceUrls = pgTable("source_urls", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").references(() => sources.id).notNull(),
  // FK to source_unique_urls. The page id used in the Source Pages UI is
  // this column's value — stable per URL, no MIN aggregation needed.
  sourceUniqueUrlId: integer("source_unique_url_id").references(() => sourceUniqueUrls.id),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id),
  model: text("model"),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url"),
  // Same as normalizedUrl but with ALL query params stripped. Populated on
  // write + backfilled at startup. Enables watchlist entries with
  // `ignoreQueryStrings = true` to match citations that differ only by
  // query string, without forcing that behavior on strict watchers.
  normalizedUrlStripped: text("normalized_url_stripped"),
  firstSeenAt: timestamp("first_seen_at").defaultNow(),
}, (t) => ({
  normalizedUrlIdx: index("source_urls_normalized_url_idx").on(t.normalizedUrl),
  normalizedUrlStrippedIdx: index("source_urls_normalized_url_stripped_idx").on(t.normalizedUrlStripped),
  sourceUniqueUrlIdIdx: index("source_urls_source_unique_url_id_idx").on(t.sourceUniqueUrlId),
}));

export const watchedUrls = pgTable("watched_urls", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url").notNull().unique(),
  title: text("title"),
  notes: text("notes"),
  // If true, normalization strips ALL query params (matched against
  // source_urls.normalized_url_stripped). Default false preserves existing
  // behavior — matches use source_urls.normalized_url (utm/tracking
  // params already dropped, the rest kept).
  ignoreQueryStrings: boolean("ignore_query_strings").default(false).notNull(),
  // Origin: 'manual' (user added via UI/API) or 'sitemap' (auto-discovered
  // from brand sitemap.xml on analysis start). Used to split the UI list
  // and decide whether to overwrite on re-import.
  source: text("source").default('manual').notNull(),
  addedByUserId: integer("added_by_user_id"),
  addedAt: timestamp("added_at").defaultNow(),
});

export const analytics = pgTable("analytics", {
  id: serial("id").primaryKey(),
  date: timestamp("date").defaultNow(),
  totalPrompts: integer("total_prompts").default(0),
  brandMentionRate: real("brand_mention_rate").default(0),
  topCompetitor: text("top_competitor"),
  totalSources: integer("total_sources").default(0),
  totalDomains: integer("total_domains").default(0),
});

export const analysisRuns = pgTable("analysis_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default('running'),
  brandName: text("brand_name"),
  brandUrl: text("brand_url"),
  totalPrompts: integer("total_prompts").default(0),
  completedPrompts: integer("completed_prompts").default(0),
});

export const competitorMentions = pgTable("competitor_mentions", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").references(() => competitors.id).notNull(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id).notNull(),
  responseId: integer("response_id").references(() => responses.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const apiUsage = pgTable("api_usage", {
  id: serial("id").primaryKey(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  calledAt: timestamp("called_at").defaultNow(),
});

export const apifyUsage = pgTable("apify_usage", {
  id: serial("id").primaryKey(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id),
  jobId: integer("job_id"),
  apifyRunId: text("apify_run_id").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(),
  costUsd: real("cost_usd"),
  durationMs: integer("duration_ms"),
  computeUnits: real("compute_units"),
  proxyGbytes: real("proxy_gbytes"),
  memMaxBytes: real("mem_max_bytes"),
  datasetId: text("dataset_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const competitorMerges = pgTable("competitor_merges", {
  id: serial("id").primaryKey(),
  primaryCompetitorId: integer("primary_competitor_id").references(() => competitors.id).notNull(),
  mergedCompetitorId: integer("merged_competitor_id").references(() => competitors.id).notNull(),
  performedAt: timestamp("performed_at").defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  hashedPassword: text("hashed_password"),
  salt: text("salt"),
  googleId: text("google_id"),
  apiKey: text("api_key"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  roleId: integer("role_id").references(() => roles.id).notNull(),
});

// Persistent recommendations keyed by a stable fingerprint that survives
// across runs. The latest run's snapshot is denormalized onto this row for
// fast list queries; per-run history lives in `recommendationOccurrences`.
// State transitions are user-only — the detector pipeline never touches
// `state`. UI hints surface mismatch between user state and latest firing.
export const recommendations = pgTable("recommendations", {
  id: serial("id").primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  // Bump when the fingerprint hashing logic changes. Old fingerprints orphan
  // (no longer match any new ones) — fine, recommendations age out.
  fingerprintVersion: integer("fingerprint_version").notNull().default(1),
  detectorKey: text("detector_key").notNull(),                 // 'dead_topic', ...
  severity: text("severity").notNull(),                        // 'red' | 'yellow' | 'info'
  title: text("title").notNull(),
  narrative: jsonb("narrative").notNull().default({}),               // structured: { analysis, metrics?, groups?, suggestedAction }
  evidenceJson: jsonb("evidence_json").notNull(),              // {numbers: {...}, ...}
  relatedEntities: jsonb("related_entities").notNull(),        // {topicId?, competitorId?, ...}
  impactScore: real("impact_score").notNull(),
  state: text("state").notNull().default('open'),              // open | dismissed | actioned | resolved
  stateChangedBy: integer("state_changed_by").references(() => users.id),
  stateChangedAt: timestamp("state_changed_at"),
  // Snapshot of the latest complete run at the moment the user changed
  // state. Anchors the "is there NEW evidence since the user's decision?"
  // check that drives the UI hint. NULL when state was never user-changed
  // (system-default 'open') — `firstSeenRunId` is the implicit anchor then.
  stateChangedAtRunId: integer("state_changed_at_run_id").references(() => analysisRuns.id),
  firstSeenRunId: integer("first_seen_run_id").references(() => analysisRuns.id).notNull(),
  lastSeenRunId: integer("last_seen_run_id").references(() => analysisRuns.id).notNull(),
  totalOccurrences: integer("total_occurrences").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  stateLastSeenIdx: index("recommendations_state_last_seen_idx").on(t.state, t.lastSeenRunId),
  severityImpactIdx: index("recommendations_severity_impact_idx").on(t.severity, t.impactScore),
  detectorKeyIdx: index("recommendations_detector_key_idx").on(t.detectorKey),
}));

export const recommendationOccurrences = pgTable("recommendation_occurrences", {
  id: serial("id").primaryKey(),
  recommendationId: integer("recommendation_id").references(() => recommendations.id, { onDelete: 'cascade' }).notNull(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id).notNull(),
  severity: text("severity").notNull(),
  evidenceJson: jsonb("evidence_json").notNull(),
  narrative: jsonb("narrative").notNull().default({}),
  impactScore: real("impact_score").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // One row per (recommendation, run) — re-running detectors for the same
  // run upserts cleanly via ON CONFLICT against this unique index.
  recRunUq: uniqueIndex("recommendation_occurrences_rec_run_uq").on(t.recommendationId, t.analysisRunId),
  runIdx: index("recommendation_occurrences_run_idx").on(t.analysisRunId),
}));

export const jobQueue = pgTable("job_queue", {
  id: serial("id").primaryKey(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id).notNull(),
  promptId: integer("prompt_id").references(() => prompts.id),
  promptText: text("prompt_text").notNull(),
  promptTopicId: integer("prompt_topic_id"),
  promptIsExisting: boolean("prompt_is_existing").default(false),
  model: text("model").notNull(),
  status: text("status").notNull().default('pending'),
  attempts: integer("attempts").default(0),
  maxAttempts: integer("max_attempts").default(3),
  lastError: text("last_error"),
  originalJobId: integer("original_job_id"),  // links retries back to the first job in the chain
  lockedAt: timestamp("locked_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertTopicSchema = createInsertSchema(topics).omit({
  id: true,
  createdAt: true,
});

export const insertPromptSchema = createInsertSchema(prompts).omit({
  id: true,
  createdAt: true,
});

export const insertResponseSchema = createInsertSchema(responses).omit({
  id: true,
  createdAt: true,
});

export const insertCompetitorSchema = createInsertSchema(competitors).omit({
  id: true,
  lastMentioned: true,
});

export const insertSourceSchema = createInsertSchema(sources).omit({
  id: true,
  lastCited: true,
});

export const insertSourceUrlSchema = createInsertSchema(sourceUrls).omit({
  id: true,
  firstSeenAt: true,
});

export const insertCompetitorMentionSchema = createInsertSchema(competitorMentions).omit({
  id: true,
  createdAt: true,
});

export const insertAnalysisRunSchema = createInsertSchema(analysisRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export const insertAnalyticsSchema = createInsertSchema(analytics).omit({
  id: true,
  date: true,
});

export const insertJobQueueSchema = createInsertSchema(jobQueue).omit({
  id: true,
  createdAt: true,
  lockedAt: true,
  completedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
});

export const insertUserRoleSchema = createInsertSchema(userRoles).omit({
  id: true,
});

export const insertWatchedUrlSchema = createInsertSchema(watchedUrls).omit({
  id: true,
  addedAt: true,
  normalizedUrl: true,
  ignoreQueryStrings: true,
  source: true,
});

// Types
export type Topic = typeof topics.$inferSelect;
export type InsertTopic = z.infer<typeof insertTopicSchema>;

export type Prompt = typeof prompts.$inferSelect;
export type InsertPrompt = z.infer<typeof insertPromptSchema>;

export type Response = typeof responses.$inferSelect;
export type InsertResponse = z.infer<typeof insertResponseSchema>;

export type Competitor = typeof competitors.$inferSelect;
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;

export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;

export type SourceUrl = typeof sourceUrls.$inferSelect;
export type InsertSourceUrl = z.infer<typeof insertSourceUrlSchema>;

export type CompetitorMention = typeof competitorMentions.$inferSelect;
export type InsertCompetitorMention = z.infer<typeof insertCompetitorMentionSchema>;

export type AnalysisRun = typeof analysisRuns.$inferSelect;
export type InsertAnalysisRun = z.infer<typeof insertAnalysisRunSchema>;

export type Analytics = typeof analytics.$inferSelect;
export type InsertAnalytics = z.infer<typeof insertAnalyticsSchema>;

export type CompetitorMerge = typeof competitorMerges.$inferSelect;

export type JobQueueItem = typeof jobQueue.$inferSelect;
export type InsertJobQueueItem = z.infer<typeof insertJobQueueSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;

export type UserRole = typeof userRoles.$inferSelect;
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;

export type UserWithRoles = User & { roles: string[] };

export type WatchedUrl = typeof watchedUrls.$inferSelect;
export type InsertWatchedUrl = z.infer<typeof insertWatchedUrlSchema>;

export type RecommendationState = 'open' | 'dismissed' | 'actioned' | 'resolved';
export type RecommendationSeverity = 'red' | 'yellow' | 'info';

// Structured narrative — one shape per recommendation, rendered as proper
// sections in the UI rather than a markdown blob. Detectors fill this in
// directly so APIs and the UI both consume the same structured data.
export type RecommendationMetric = { label: string; value: string };
export type RecommendationGroup = { label: string; items: RecommendationMetric[] };
export type RecommendationNarrative = {
  // 1–2 sentence prose summarizing what's happening.
  analysis: string;
  // Top-level metric grid. Use for plain key/value facts.
  metrics?: RecommendationMetric[];
  // Sub-grouped tables (per-model rates, top competitors, etc.). Each group
  // renders with its own header and a 2-column key/value grid.
  groups?: RecommendationGroup[];
  // 1–2 sentence prose headline for what to do. Shown prominently.
  suggestedAction: string;
  // Optional concrete numbered steps below the headline. Use when a single
  // action isn't enough (e.g., dead topics need both hub-page content AND
  // earned-media placement AND community presence — these compound).
  suggestedSteps?: string[];
};

export type Recommendation = typeof recommendations.$inferSelect;
export type RecommendationOccurrence = typeof recommendationOccurrences.$inferSelect;

// What the read-time API returns: the latest snapshot plus the UI hint
// computed against the latest complete run.
export type RecommendationHint = 'resolved' | 'back' | null;
export type RecommendationWithHint = Recommendation & {
  hint: RecommendationHint;
  // True iff last_seen_run_id equals the latest complete run's id.
  firingInLatest: boolean;
};

export type WatchedUrlCitation = {
  responseId: number;
  runId: number | null;
  model: string | null;
  url: string;
  citedAt: Date | null;
  promptText: string;
  brandMentioned: boolean;
};

export type WatchedUrlWithCitations = WatchedUrl & {
  citationCount: number;
  firstCitedAt: Date | null;
  firstCitedRunId: number | null;
  citationsByModel: Record<string, number>;
  citations: WatchedUrlCitation[];
};

// Extended types for API responses
export type PromptWithTopic = Prompt & { topic: Topic | null };
export type ResponseWithPrompt = Response & { prompt: PromptWithTopic };

export type TopicAnalysis = {
  topicId: number;
  topicName: string;
  mentionRate: number;
  totalPrompts: number;
  brandMentions: number;
};

export type CompetitorAnalysis = {
  competitorId: number;
  name: string;
  category: string | null;
  mentionCount: number;
  mentionRate: number;
  changeRate: number;
};

export type SourceAnalysis = {
  sourceId: number;
  domain: string;
  sourceType: string;
  citationCount: number;
  urls: { url: string; pageId: number | null }[];
};

export type PageAnalysis = {
  // pageId = MIN(source_urls.id) for this URL — stable integer used in deep
  // links and selection state. Avoids the previous URL-as-query-param scheme
  // where %-encoding round-tripped via URLSearchParams produced %2520-style
  // double-encoding and broke equality checks.
  pageId: number | null;
  url: string;
  domain: string;
  sourceType: string;
  citationCount: number;
};

export type MergeSuggestion = {
  competitors: { id: number; name: string; mentionCount: number }[];
  similarity: number;
};

export type JobQueueProgress = {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
};

export type MergeHistoryEntry = {
  id: number;
  primaryCompetitorId: number;
  primaryName: string;
  mergedCompetitorId: number;
  mergedName: string;
  performedAt: Date | null;
};
