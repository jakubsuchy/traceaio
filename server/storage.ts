import {
  topics,
  prompts,
  responses,
  competitors,
  sources,
  analytics,
  type Topic,
  type Prompt,
  type Response,
  type Competitor,
  type Source,
  type Analytics,
  type InsertTopic,
  type InsertPrompt,
  type InsertResponse,
  type InsertCompetitor,
  type InsertSource,
  type InsertAnalytics,
  type InsertCompetitorMention,
  type AnalysisRun,
  type InsertAnalysisRun,
  type PromptWithTopic,
  type ResponseWithPrompt,
  type TopicAnalysis,
  type CompetitorAnalysis,
  type SourceAnalysis,
  type MergeSuggestion,
  type MergeHistoryEntry,
  type JobQueueItem,
  type InsertJobQueueItem,
  type JobQueueProgress,
  type WatchedUrl,
  type InsertWatchedUrl,
  type WatchedUrlWithCitations,
  type Recommendation,
  type RecommendationOccurrence,
  type RecommendationState,
} from "@shared/schema";

// Detector-side write payload — tighter than InsertRecommendation because
// state/timestamps/run pointers are managed by the orchestrator, not the
// detector.
export type RecommendationDetectorOutput = {
  fingerprint: string;
  fingerprintVersion: number;
  detectorKey: string;
  severity: 'red' | 'yellow' | 'info';
  title: string;
  narrative: any;
  evidenceJson: any;
  relatedEntities: any;
  impactScore: number;
};

export interface IStorage {
  // Topics
  getTopics(): Promise<Topic[]>;
  createTopic(topic: InsertTopic): Promise<Topic>;
  getTopicById(id: number): Promise<Topic | undefined>;
  softDeleteTopic(id: number): Promise<void>;

  // Prompts
  getPrompts(): Promise<Prompt[]>;
  createPrompt(prompt: InsertPrompt): Promise<Prompt>;
  getPromptById(id: number): Promise<Prompt | undefined>;
  getPromptsWithTopics(): Promise<PromptWithTopic[]>;
  getPromptsByTopic(topicId: number): Promise<Prompt[]>;
  softDeletePrompt(id: number): Promise<void>;
  updatePromptTopic(id: number, topicId: number): Promise<void>;
  updateCompetitorDomain(id: number, domain: string): Promise<void>;

  // Responses
  getResponses(): Promise<Response[]>;
  createResponse(response: InsertResponse): Promise<Response>;
  getResponseById(id: number): Promise<Response | undefined>;
  getResponsesWithPrompts(runId?: number, from?: Date, to?: Date): Promise<ResponseWithPrompt[]>;
  getRecentResponses(limit?: number, runId?: number, from?: Date, to?: Date): Promise<ResponseWithPrompt[]>;

  // Competitors
  getCompetitors(): Promise<Competitor[]>;
  createCompetitor(competitor: InsertCompetitor): Promise<Competitor>;
  getCompetitorByName(name: string): Promise<Competitor | undefined>;
  updateCompetitorMentionCount(name: string, increment: number): Promise<void>;
  softDeleteCompetitor(id: number): Promise<void>;
  updateCompetitor(id: number, patch: Partial<{ name: string; category: string | null; domain: string | null }>): Promise<Competitor | undefined>;

  // Sources
  getSources(): Promise<Source[]>;
  createSource(source: InsertSource): Promise<Source>;
  getSourceByDomain(domain: string): Promise<Source | undefined>;
  updateSourceCitationCount(domain: string, increment: number): Promise<void>;
  addSourceUrls(domain: string, urls: string[], analysisRunId?: number, model?: string): Promise<void>;
  getSourceUrlsBySourceId(sourceId: number, analysisRunId?: number, model?: string): Promise<string[]>;
  // Returns Map<url, source_unique_urls.id> for the given URL list. Used by
  // the Source Pages routes to attach a stable pageId to each row/URL.
  getPageIdsForUrls(urls: string[]): Promise<Map<string, number>>;

  // Competitor mentions
  createCompetitorMention(mention: InsertCompetitorMention): Promise<void>;
  getCompetitorAnalysisByRun(runId: number): Promise<{ competitorId: number; name: string; category: string | null; mentionCount: number }[]>;
  getCompetitorAnalysisAllRuns(from?: Date, to?: Date): Promise<{ competitorId: number; name: string; category: string | null; mentionCount: number }[]>;

  // Analysis runs
  createAnalysisRun(run: InsertAnalysisRun): Promise<AnalysisRun>;
  completeAnalysisRun(id: number, status: string): Promise<void>;
  getAnalysisRuns(from?: Date, to?: Date): Promise<AnalysisRun[]>;
  getLatestAnalysisRun(): Promise<AnalysisRun | undefined>;
  updateAnalysisRunProgress(id: number, completedPrompts: number): Promise<void>;
  deleteAnalysisRun(runId: number): Promise<void>;

  // Settings
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  // Analytics
  getLatestAnalytics(): Promise<Analytics | undefined>;
  createAnalytics(analytics: InsertAnalytics): Promise<Analytics>;

  // Analysis methods
  getTopicAnalysis(): Promise<TopicAnalysis[]>;
  getCompetitorAnalysis(): Promise<CompetitorAnalysis[]>;
  getSourceAnalysis(): Promise<SourceAnalysis[]>;
  
  // Latest analysis results only
  getLatestResponses(): Promise<ResponseWithPrompt[]>;
  getLatestPrompts(): Promise<Prompt[]>;

  // Competitor merging
  mergeCompetitors(primaryId: number, absorbedIds: number[]): Promise<number>;
  unmergeCompetitor(competitorId: number): Promise<void>;
  getMergeSuggestions(): Promise<MergeSuggestion[]>;
  getMergeHistory(): Promise<MergeHistoryEntry[]>;
  getAllCompetitorsIncludingMerged(): Promise<Competitor[]>;

  // Job queue
  enqueueJobs(jobs: InsertJobQueueItem[]): Promise<void>;
  dequeueJob(analysisRunId: number): Promise<JobQueueItem | null>;
  completeJob(jobId: number): Promise<void>;
  failJob(jobId: number, error: string, shouldRetry: boolean, wasBusy?: boolean): Promise<void>;
  getJobQueueProgress(analysisRunId: number): Promise<JobQueueProgress>;
  recoverStalledJobs(stallTimeoutMs?: number): Promise<number>;
  getFailedJobs(analysisRunId: number): Promise<JobQueueItem[]>;
  cancelJobsForRun(analysisRunId: number): Promise<void>;

  // Watched URLs
  getWatchedUrls(opts?: { source?: 'manual' | 'sitemap'; limit?: number; offset?: number }): Promise<WatchedUrl[]>;
  getWatchedUrlCount(source?: 'manual' | 'sitemap'): Promise<number>;
  getWatchedUrlById(id: number): Promise<WatchedUrl | undefined>;
  getWatchedUrlByNormalized(normalizedUrl: string): Promise<WatchedUrl | undefined>;
  createWatchedUrl(watched: InsertWatchedUrl & { normalizedUrl: string; ignoreQueryStrings?: boolean; source?: 'manual' | 'sitemap' }): Promise<WatchedUrl>;
  bulkInsertWatchedUrls(rows: { url: string; normalizedUrl: string; ignoreQueryStrings: boolean; source: 'manual' | 'sitemap'; title?: string | null; addedByUserId?: number | null }[]): Promise<number>;
  updateWatchedUrl(id: number, patch: Partial<Pick<WatchedUrl, 'title' | 'notes'>>): Promise<WatchedUrl | undefined>;
  deleteWatchedUrl(id: number): Promise<void>;
  getWatchedUrlsWithCitations(opts?: { runId?: number; model?: string; source?: 'manual' | 'sitemap'; limit?: number; offset?: number }): Promise<WatchedUrlWithCitations[]>;
  getWatchedUrlCitations(id: number, runId?: number, model?: string): Promise<WatchedUrlWithCitations | undefined>;

  // Data clearing methods
  clearAllPrompts(): Promise<void>;
  clearAllResponses(): Promise<void>;
  clearAllCompetitors(): Promise<void>;
  clearResultsOnly(): Promise<void>;
  clearAllAnalysisData(): Promise<void>;

  // Recommendations
  upsertRecommendation(input: RecommendationDetectorOutput, runId: number): Promise<{ id: number; isNew: boolean }>;
  upsertRecommendationOccurrence(input: {
    recommendationId: number;
    analysisRunId: number;
    severity: string;
    narrative: any;
    evidenceJson: any;
    impactScore: number;
  }): Promise<void>;
  getRecommendations(opts?: {
    state?: RecommendationState;
    severity?: 'red' | 'yellow' | 'info';
    detectorKey?: string;
  }): Promise<Recommendation[]>;
  getRecommendationById(id: number): Promise<Recommendation | undefined>;
  getRecommendationOccurrences(recommendationId: number): Promise<RecommendationOccurrence[]>;
  // `latestRunId` is the run id we anchor the user's decision to, so future
  // hint computations can ask "has anything fired SINCE this point?". Pass
  // null when no complete run exists yet (won't happen in normal flow).
  updateRecommendationState(id: number, state: RecommendationState, userId: number, latestRunId: number | null): Promise<void>;
  getRecommendationCounts(): Promise<{
    open: number;
    actioned: number;
    resolved: number;
    dismissed: number;
  }>;
  clearAllRecommendations(): Promise<{ deleted: number }>;
}

export class MemStorage implements IStorage {
  private topics: Map<number, Topic> = new Map();
  private prompts: Map<number, Prompt> = new Map();
  private responses: Map<number, Response> = new Map();
  private competitors: Map<number, Competitor> = new Map();
  private sources: Map<number, Source> = new Map();
  private analytics: Map<number, Analytics> = new Map();
  
  private currentTopicId = 1;
  private currentPromptId = 1;
  private currentResponseId = 1;
  private currentCompetitorId = 1;
  private currentSourceId = 1;
  private currentAnalyticsId = 1;

  constructor() {
    // Initialize only basic reference data - no sample prompts/responses
    this.initializeBasicData();
  }

  private initializeBasicData() {
    this.initializeTopics();
    this.initializeCompetitors();
    this.initializeSources();
  }

  private initializeTopics() {
    // Don't pre-populate topics - they will be created dynamically during analysis
    // This makes the system flexible and based on actual analysis needs
  }

  private initializeCompetitors() {
    // Don't pre-populate competitors - they will be discovered during analysis
    // This makes the system dynamic and based on actual analysis results
  }

  private initializeSources() {
    // Start with empty sources - they will be populated from actual analysis
  }

  async getTopics(): Promise<Topic[]> {
    return Array.from(this.topics.values());
  }

  async createTopic(topic: InsertTopic): Promise<Topic> {
    const newTopic: Topic = {
      id: this.currentTopicId++,
      name: topic.name,
      description: topic.description ?? null,
      createdAt: new Date(),
    };
    this.topics.set(newTopic.id, newTopic);
    return newTopic;
  }

  async getTopicById(id: number): Promise<Topic | undefined> {
    return this.topics.get(id);
  }

  async softDeleteTopic(id: number): Promise<void> {
    const topic = this.topics.get(id);
    if (topic) topic.deleted = true;
    for (const p of this.prompts.values()) {
      if (p.topicId === id) p.deleted = true;
    }
  }

  async getPrompts(): Promise<Prompt[]> {
    return Array.from(this.prompts.values()).filter(p => !p.deleted);
  }

  async softDeletePrompt(id: number): Promise<void> {
    const prompt = this.prompts.get(id);
    if (prompt) prompt.deleted = true;
  }

  async updatePromptTopic(id: number, topicId: number): Promise<void> {
    const prompt = this.prompts.get(id);
    if (prompt) prompt.topicId = topicId;
  }

  async updateCompetitorDomain(id: number, domain: string): Promise<void> {
    const comp = this.competitors.get(id);
    if (comp && !comp.domain) comp.domain = domain;
  }

  async createPrompt(prompt: InsertPrompt): Promise<Prompt> {
    const newPrompt: Prompt = {
      id: this.currentPromptId++,
      text: prompt.text,
      topicId: prompt.topicId ?? null,
      createdAt: new Date(),
    };
    this.prompts.set(newPrompt.id, newPrompt);
    return newPrompt;
  }

  async getPromptById(id: number): Promise<Prompt | undefined> {
    return this.prompts.get(id);
  }

  async getPromptsWithTopics(): Promise<PromptWithTopic[]> {
    const prompts = Array.from(this.prompts.values());
    return prompts.map(prompt => ({
      ...prompt,
      topic: prompt.topicId ? this.topics.get(prompt.topicId) || null : null
    }));
  }

  async getPromptsByTopic(topicId: number): Promise<Prompt[]> {
    return Array.from(this.prompts.values()).filter(p => p.topicId === topicId);
  }

  async getResponses(): Promise<Response[]> {
    return Array.from(this.responses.values());
  }

  async createResponse(response: InsertResponse): Promise<Response> {
    const newResponse: Response = {
      id: this.currentResponseId++,
      promptId: response.promptId,
      text: response.text,
              brandMentioned: response.brandMentioned ?? null,
      competitorsMentioned: response.competitorsMentioned ?? null,
      sources: response.sources ?? null,
      createdAt: new Date(),
    };
    this.responses.set(newResponse.id, newResponse);
    return newResponse;
  }

  async getResponseById(id: number): Promise<Response | undefined> {
    return this.responses.get(id);
  }

  async getResponsesWithPrompts(): Promise<ResponseWithPrompt[]> {
    const responses = Array.from(this.responses.values());
    return responses.map(response => {
      const prompt = this.prompts.get(response.promptId);
      const topic = prompt ? this.topics.get(prompt.topicId || 0) : null;
      return {
        ...response,
        prompt: {
          ...prompt!,
          topic: topic || null
        }
      };
    });
  }

  async getRecentResponses(limit = 10): Promise<ResponseWithPrompt[]> {
    const responses = await this.getResponsesWithPrompts();
    return responses
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      .slice(0, limit);
  }

  async getCompetitors(): Promise<Competitor[]> {
    return Array.from(this.competitors.values())
      .filter(c => !c.mergedInto && !c.deleted)
      .sort((a, b) => a.id - b.id);
  }

  async createCompetitor(competitor: InsertCompetitor): Promise<Competitor> {
    const nameKey = competitor.name.toLowerCase().trim();
    const existing = Array.from(this.competitors.values()).find(c => c.nameKey === nameKey);
    if (existing) {
      if (existing.deleted) {
        existing.deleted = false;
        // Patch in the newly-supplied domain/category from this re-add.
        // Empty/null input doesn't erase existing data.
        if (competitor.domain) existing.domain = competitor.domain;
        if (competitor.category) existing.category = competitor.category;
        return existing;
      }
      return existing;
    }
    const newCompetitor: Competitor = {
      id: this.currentCompetitorId++,
      name: competitor.name,
      nameKey,
      category: competitor.category || null,
      mentionCount: competitor.mentionCount || null,
      lastMentioned: null,
      mergedInto: null,
      domain: competitor.domain || null,
      deleted: false,
    };
    this.competitors.set(newCompetitor.id, newCompetitor);
    return newCompetitor;
  }

  async softDeleteCompetitor(id: number): Promise<void> {
    const c = this.competitors.get(id);
    if (c) c.deleted = true;
  }

  async updateCompetitor(id: number, patch: Partial<{ name: string; category: string | null; domain: string | null }>): Promise<Competitor | undefined> {
    const c = this.competitors.get(id);
    if (!c) return undefined;
    if (patch.name !== undefined) {
      c.name = patch.name;
      c.nameKey = patch.name.toLowerCase().trim();
    }
    if (patch.category !== undefined) c.category = patch.category;
    if (patch.domain !== undefined) c.domain = patch.domain;
    return c;
  }

  async getCompetitorByName(name: string): Promise<Competitor | undefined> {
    const key = name.toLowerCase().trim();
    return Array.from(this.competitors.values()).find(c => c.nameKey === key);
  }

  async updateCompetitorMentionCount(name: string, increment: number): Promise<void> {
    const competitor = await this.getCompetitorByName(name);
    if (competitor && competitor.mentionCount !== null) {
      competitor.mentionCount += increment;
      competitor.lastMentioned = new Date();
      this.competitors.set(competitor.id, competitor);
    }
  }

  async getSources(): Promise<Source[]> {
    return Array.from(this.sources.values());
  }

  async createSource(source: InsertSource): Promise<Source> {
    const newSource: Source = {
      id: this.currentSourceId++,
      domain: source.domain,
      url: source.url,
      title: source.title || null,
      citationCount: source.citationCount || null,
      lastCited: new Date(),
    };
    this.sources.set(newSource.id, newSource);
    return newSource;
  }

  async getSourceByDomain(domain: string): Promise<Source | undefined> {
    return Array.from(this.sources.values()).find(s => s.domain === domain);
  }

  async updateSourceCitationCount(domain: string, increment: number): Promise<void> {
    const source = await this.getSourceByDomain(domain);
    if (source && source.citationCount !== null) {
      source.citationCount += increment;
      source.lastCited = new Date();
      this.sources.set(source.id, source);
    }
  }

  private sourceUrlsMap = new Map<number, Set<string>>();

  async addSourceUrls(domain: string, urls: string[], _analysisRunId?: number, _model?: string): Promise<void> {
    const source = await this.getSourceByDomain(domain);
    if (!source) return;
    if (!this.sourceUrlsMap.has(source.id)) {
      this.sourceUrlsMap.set(source.id, new Set([source.url]));
    }
    const set = this.sourceUrlsMap.get(source.id)!;
    for (const url of urls) set.add(url);
  }

  async getSourceUrlsBySourceId(sourceId: number, _analysisRunId?: number, _model?: string): Promise<string[]> {
    return Array.from(this.sourceUrlsMap.get(sourceId) || []);
  }

  async getPageIdsForUrls(_urls: string[]): Promise<Map<string, number>> {
    // In-memory storage doesn't track source_unique_urls — return empty map.
    // Production uses DatabaseStorage; this is exercised only in dev/tests.
    return new Map();
  }

  private competitorMentionsList: InsertCompetitorMention[] = [];

  async createCompetitorMention(mention: InsertCompetitorMention): Promise<void> {
    this.competitorMentionsList.push(mention);
  }

  async getCompetitorAnalysisByRun(runId: number) {
    const mentions = this.competitorMentionsList.filter(m => m.analysisRunId === runId);
    const counts = new Map<number, number>();
    for (const m of mentions) counts.set(m.competitorId, (counts.get(m.competitorId) || 0) + 1);
    return [...counts.entries()].map(([competitorId, count]) => {
      const comp = [...this.competitors.values()].find(c => c.id === competitorId);
      return { competitorId, name: comp?.name || 'Unknown', category: comp?.category || null, mentionCount: count };
    });
  }

  async getCompetitorAnalysisAllRuns() {
    const counts = new Map<number, number>();
    for (const m of this.competitorMentionsList) counts.set(m.competitorId, (counts.get(m.competitorId) || 0) + 1);
    return [...counts.entries()].map(([competitorId, count]) => {
      const comp = [...this.competitors.values()].find(c => c.id === competitorId);
      return { competitorId, name: comp?.name || 'Unknown', category: comp?.category || null, mentionCount: count };
    });
  }

  private analysisRunsMap = new Map<number, AnalysisRun>();
  private analysisRunIdCounter = 0;

  async createAnalysisRun(run: InsertAnalysisRun): Promise<AnalysisRun> {
    const id = ++this.analysisRunIdCounter;
    const record: AnalysisRun = { id, startedAt: new Date(), completedAt: null, status: run.status || 'running', brandName: run.brandName || null, brandUrl: run.brandUrl || null, totalPrompts: run.totalPrompts || 0, completedPrompts: 0 };
    this.analysisRunsMap.set(id, record);
    return record;
  }

  async completeAnalysisRun(id: number, status: string): Promise<void> {
    const run = this.analysisRunsMap.get(id);
    if (run) { run.status = status; run.completedAt = new Date(); }
  }

  async getAnalysisRuns(): Promise<AnalysisRun[]> {
    return Array.from(this.analysisRunsMap.values()).sort((a, b) => new Date(b.startedAt!).getTime() - new Date(a.startedAt!).getTime());
  }

  async getLatestAnalysisRun(): Promise<AnalysisRun | undefined> {
    return (await this.getAnalysisRuns())[0];
  }

  async updateAnalysisRunProgress(id: number, completedPrompts: number): Promise<void> {
    const run = this.analysisRunsMap.get(id);
    if (run) run.completedPrompts = completedPrompts;
  }

  async deleteAnalysisRun(runId: number): Promise<void> {
    // Remove only the data scoped to this run; leave other runs untouched.
    for (const [id, resp] of Array.from(this.responses.entries())) {
      if (resp.analysisRunId === runId) this.responses.delete(id);
    }
    this.competitorMentionsList = this.competitorMentionsList.filter(m => m.analysisRunId !== runId);
    this.analysisRunsMap.delete(runId);
  }

  private settingsMap = new Map<string, string>();

  async getSetting(key: string): Promise<string | null> {
    return this.settingsMap.get(key) ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settingsMap.set(key, value);
  }

  async getLatestAnalytics(): Promise<Analytics | undefined> {
    const analytics = Array.from(this.analytics.values());
    return analytics.sort((a, b) => 
      new Date(b.date!).getTime() - new Date(a.date!).getTime()
    )[0];
  }

  async createAnalytics(analytics: InsertAnalytics): Promise<Analytics> {
    const newAnalytics: Analytics = {
      id: this.currentAnalyticsId++,
      date: new Date(),
      totalPrompts: analytics.totalPrompts || null,
              brandMentionRate: analytics.brandMentionRate || null,
      topCompetitor: analytics.topCompetitor || null,
      totalSources: analytics.totalSources || null,
      totalDomains: analytics.totalDomains || null,
    };
    this.analytics.set(newAnalytics.id, newAnalytics);
    return newAnalytics;
  }

  async getTopicAnalysis(): Promise<TopicAnalysis[]> {
    const topics = await this.getTopics();
    const responses = await this.getResponsesWithPrompts();
    
    return topics.map(topic => {
      const topicResponses = responses.filter(r => r.prompt.topicId === topic.id);
              const brandMentions = topicResponses.filter(r => r.brandMentioned).length;
      const mentionRate = topicResponses.length > 0 ? (brandMentions / topicResponses.length) * 100 : 0;
      
      return {
        topicId: topic.id,
        topicName: topic.name,
        mentionRate,
        totalPrompts: topicResponses.length,
        brandMentions
      };
    });
  }

  async getCompetitorAnalysis(): Promise<CompetitorAnalysis[]> {
    const competitors = await this.getCompetitors();
    const responses = await this.getResponses();
    const totalResponses = responses.length;
    
    return competitors.map(competitor => {
      const mentions = responses.filter(r => 
        r.competitorsMentioned?.includes(competitor.name)
      ).length;
      
      const mentionRate = totalResponses > 0 ? (mentions / totalResponses) * 100 : 0;
      
      return {
        competitorId: competitor.id,
        name: competitor.name,
        category: competitor.category,
        mentionCount: mentions,
        mentionRate,
        changeRate: 0 // Calculate based on historical data if needed
      };
    });
  }

  async getSourceAnalysis(): Promise<SourceAnalysis[]> {
    const sources = await this.getSources();
    const sourceAnalysis = new Map<string, SourceAnalysis>();

    sources.forEach(source => {
      const key = source.domain;
      if (sourceAnalysis.has(key)) {
        const existing = sourceAnalysis.get(key)!;
        existing.citationCount += source.citationCount || 0;
        existing.urls.push({ url: source.url, pageId: null });
      } else {
        sourceAnalysis.set(key, {
          sourceId: source.id,
          domain: source.domain,
          sourceType: 'neutral',
          citationCount: source.citationCount || 0,
          urls: [{ url: source.url, pageId: null }],
        });
      }
    });

    return Array.from(sourceAnalysis.values())
      .sort((a, b) => b.citationCount - a.citationCount);
  }

  async mergeCompetitors(primaryId: number, absorbedIds: number[]): Promise<number> {
    let count = 0;
    for (const id of absorbedIds) {
      const comp = this.competitors.get(id);
      if (comp) {
        comp.mergedInto = primaryId;
        count++;
      }
    }
    return count;
  }

  async unmergeCompetitor(competitorId: number): Promise<void> {
    const comp = this.competitors.get(competitorId);
    if (comp) comp.mergedInto = null;
  }

  async getMergeSuggestions(): Promise<MergeSuggestion[]> {
    return [];
  }

  async getMergeHistory(): Promise<MergeHistoryEntry[]> {
    return [];
  }

  async getAllCompetitorsIncludingMerged(): Promise<Competitor[]> {
    return Array.from(this.competitors.values());
  }

  // Job queue stubs (MemStorage doesn't support the queue — use DatabaseStorage)
  async enqueueJobs(_jobs: InsertJobQueueItem[]): Promise<void> {}
  async dequeueJob(_analysisRunId: number): Promise<JobQueueItem | null> { return null; }
  async completeJob(_jobId: number): Promise<void> {}
  async failJob(_jobId: number, _error: string, _shouldRetry: boolean, _wasBusy?: boolean): Promise<void> {}
  async getJobQueueProgress(_analysisRunId: number): Promise<JobQueueProgress> { return { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 }; }
  async recoverStalledJobs(_stallTimeoutMs?: number): Promise<number> { return 0; }
  async getFailedJobs(_analysisRunId: number): Promise<JobQueueItem[]> { return []; }
  async cancelJobsForRun(_analysisRunId: number): Promise<void> {}

  async clearAllPrompts(): Promise<void> {
    this.prompts.clear();
    this.currentPromptId = 1;
  }

  async clearAllResponses(): Promise<void> {
    this.responses.clear();
    this.currentResponseId = 1;
  }

  async clearAllCompetitors(): Promise<void> {
    console.log(`[${new Date().toISOString()}] MemStorage: Clearing all competitors...`);
    this.competitors.clear();
    this.currentCompetitorId = 1;
    console.log(`[${new Date().toISOString()}] MemStorage: All competitors cleared successfully`);
  }

  async clearResultsOnly(): Promise<void> {
    this.responses.clear();
    this.competitors.clear();
    this.sources.clear();
    this.analytics.clear();
    this.competitorMentionsList = [];
    this.analysisRunsMap.clear();
    this.sourceUrlsMap.clear();
  }

  async clearAllAnalysisData(): Promise<void> {
    this.prompts.clear();
    this.responses.clear();
    this.competitors.clear();
    this.sources.clear();
    this.analytics.clear();
    this.competitorMentionsList = [];
    this.analysisRunsMap.clear();
    this.sourceUrlsMap.clear();
  }

  async getLatestResponses(): Promise<ResponseWithPrompt[]> {
    const allResponses = Array.from(this.responses.values());
    if (allResponses.length === 0) return [];
    
    const sortedResponses = allResponses.sort((a, b) => b.id - a.id);
    
    return sortedResponses.map(response => {
      const prompt = this.prompts.get(response.promptId);
      const topic = prompt ? this.topics.get(prompt.topicId || 0) : null;
      return {
        ...response,
        prompt: {
          ...prompt!,
          topic: topic || null
        }
      };
    });
  }

  async getLatestPrompts(): Promise<Prompt[]> {
    const allPrompts = Array.from(this.prompts.values());
    return allPrompts.sort((a, b) => a.id - b.id);
  }

  // Watched URLs stubs (MemStorage does not persist the watchlist — use DatabaseStorage)
  async getWatchedUrls(): Promise<WatchedUrl[]> { return []; }
  async getWatchedUrlCount(): Promise<number> { return 0; }
  async getWatchedUrlById(_id: number): Promise<WatchedUrl | undefined> { return undefined; }
  async getWatchedUrlByNormalized(_n: string): Promise<WatchedUrl | undefined> { return undefined; }
  async createWatchedUrl(w: InsertWatchedUrl & { normalizedUrl: string; ignoreQueryStrings?: boolean; source?: 'manual' | 'sitemap' }): Promise<WatchedUrl> {
    return {
      id: 1,
      url: w.url,
      normalizedUrl: w.normalizedUrl,
      title: w.title ?? null,
      notes: w.notes ?? null,
      addedByUserId: w.addedByUserId ?? null,
      addedAt: new Date(),
      ignoreQueryStrings: !!w.ignoreQueryStrings,
      source: w.source ?? 'manual',
    };
  }
  async bulkInsertWatchedUrls(_rows: any[]): Promise<number> { return 0; }
  async updateWatchedUrl(_id: number): Promise<WatchedUrl | undefined> { return undefined; }
  async deleteWatchedUrl(_id: number): Promise<void> {}
  async getWatchedUrlsWithCitations(): Promise<WatchedUrlWithCitations[]> { return []; }
  async getWatchedUrlCitations(): Promise<WatchedUrlWithCitations | undefined> { return undefined; }

  // Recommendations stubs (MemStorage does not persist them — use DatabaseStorage)
  async upsertRecommendation(_input: RecommendationDetectorOutput, _runId: number): Promise<{ id: number; isNew: boolean }> {
    return { id: 1, isNew: true };
  }
  async upsertRecommendationOccurrence(_input: any): Promise<void> {}
  async getRecommendations(_opts?: any): Promise<Recommendation[]> { return []; }
  async getRecommendationById(_id: number): Promise<Recommendation | undefined> { return undefined; }
  async getRecommendationOccurrences(_id: number): Promise<RecommendationOccurrence[]> { return []; }
  async updateRecommendationState(_id: number, _state: RecommendationState, _userId: number, _latestRunId: number | null): Promise<void> {}
  async getRecommendationCounts(): Promise<{ open: number; actioned: number; resolved: number; dismissed: number }> {
    return { open: 0, actioned: 0, resolved: 0, dismissed: 0 };
  }
  async clearAllRecommendations(): Promise<{ deleted: number }> { return { deleted: 0 }; }
}

import { DatabaseStorage } from './database-storage';

export const storage = new DatabaseStorage();