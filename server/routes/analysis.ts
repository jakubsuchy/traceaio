import type { Express } from "express";
import { requireRole, parseDateRange, getLlmModule, launchAnalysis, saveBrandName } from "./helpers";
import { storage } from "../storage";
import { cancelAnalysisRun, getAnalysisProgressFromDB, isAnalysisRunningInDB } from "../services/analyzer";

export function registerAnalysisRoutes(app: Express) {
  // Test analysis endpoint - process just one prompt
  app.post("/api/test-analysis", async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const { prompt } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log(`[${new Date().toISOString()}] Testing analysis with prompt: ${prompt}`);

      const { analyzePromptResponse } = await getLlmModule();
      const result = await analyzePromptResponse(prompt);

      console.log(`[${new Date().toISOString()}] Test analysis completed successfully`);

      res.json({
        success: true,
        result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Test analysis failed:`, error);
      res.status(500).json({
        error: "Test analysis failed",
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Test endpoint for debugging
  app.get("/api/test", async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      res.json({
        success: true,
        message: "Server is running",
        timestamp: new Date().toISOString(),
        env: {
          hasOpenAIKey: !!(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR),
          nodeEnv: process.env.NODE_ENV
        }
      });
    } catch (error) {
      console.error("Error in test endpoint:", error);
      res.status(500).json({ error: "Test endpoint failed" });
    }
  });

  // New prompt generator endpoints
  app.post("/api/analyze-brand", requireRole("analyst"), async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      console.log(`[${new Date().toISOString()}] Analyzing brand URL: ${url}`);

      // Persist brand name from URL
      const { extractDomainFromUrl } = await import("../services/scraper");
      const domain = extractDomainFromUrl(url);
      await saveBrandName(domain.split('.')[0].replace(/[^a-zA-Z]/g, ''));
      await storage.setSetting('brandUrl', url);
      console.log(`[${new Date().toISOString()}] Brand name set`);

      // Use OpenAI to analyze the brand and find competitors
      const { analyzeBrandAndFindCompetitors } = await getLlmModule();
      const competitors = await analyzeBrandAndFindCompetitors(url);

      console.log(`[${new Date().toISOString()}] Found ${competitors.length} competitors for ${url}`);

      res.json({ competitors });
    } catch (error) {
      console.error("Error analyzing brand:", error);
      res.status(500).json({ error: "Failed to analyze brand" });
    }
  });

  app.post("/api/generate-prompts", requireRole("analyst"), async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const { brandUrl, competitors, settings } = req.body;

      if (!brandUrl || !competitors || !settings) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Generate diverse topics and prompts using OpenAI
      const { generatePromptsForTopic } = await getLlmModule();

      const customTopics: string[] = settings.customTopics || [];

      // Start with user-specified custom topics
      let topics: Array<{name: string, description: string}> = customTopics.map((name: string) => ({
        name,
        description: `Analysis of ${name.toLowerCase()} in the competitive landscape`
      }));

      // Fill remaining slots with AI-generated topics if needed
      const targetCount = Math.max(settings.numberOfTopics, customTopics.length);
      if (topics.length < targetCount) {
        const remaining = targetCount - topics.length;

        // Check existing DB topics first
        const existingTopics = await storage.getTopics();
        const existingMapped = existingTopics
          .filter(t => !customTopics.some(ct => ct.toLowerCase() === t.name.toLowerCase()))
          .map(topic => ({
            name: topic.name,
            description: topic.description || `Questions about ${topic.name.toLowerCase()}`
          }));

        if (existingMapped.length >= remaining) {
          topics = [...topics, ...existingMapped.slice(0, remaining)];
        } else {
          topics = [...topics, ...existingMapped];
          const stillNeeded = remaining - existingMapped.length;
          if (stillNeeded > 0) {
            const { generateDynamicTopics } = await getLlmModule();
            const newTopics = await generateDynamicTopics(
              brandUrl,
              stillNeeded,
              competitors.map((c: any) => c.name)
            );
            topics = [...topics, ...newTopics];
          }
        }
      }

      // Generate prompts for all topics in parallel
      const competitorNames = competitors.map((c: any) => c.name);
      const topicsWithPrompts = await Promise.all(
        topics.map(async (topic) => {
          console.log(`[${new Date().toISOString()}] Generating prompts for topic: ${topic.name}`);
          try {
            const prompts = await generatePromptsForTopic(
              topic.name,
              topic.description,
              settings.promptsPerTopic,
              competitorNames
            );
            console.log(`[${new Date().toISOString()}] Generated ${prompts.length} prompts for topic: ${topic.name}`);
            return { name: topic.name, description: topic.description, prompts };
          } catch (error) {
            console.error(`[${new Date().toISOString()}] Error generating prompts for topic ${topic.name}:`, error);
            return { name: topic.name, description: topic.description, prompts: [] };
          }
        })
      );

      // Persist immediately so the UI never holds unsaved topics/prompts in
      // React state. Topics are find-or-create by name (case-insensitive,
      // non-deleted) — re-running generate reuses existing rows. Prompts
      // are deduped by text within each topic so re-generating only adds
      // genuinely new prompts the AI produced this time around.
      const allTopicsBefore = await storage.getTopics();
      const persisted: Array<{
        id: number;
        name: string;
        description: string | null;
        prompts: Array<{ id: number; text: string }>;
      }> = [];
      for (const t of topicsWithPrompts) {
        const nameLower = t.name.toLowerCase();
        let topicRow = allTopicsBefore.find(x => !x.deleted && x.name.toLowerCase() === nameLower);
        if (!topicRow) {
          topicRow = await storage.createTopic({ name: t.name, description: t.description || null });
          allTopicsBefore.push(topicRow);
        }
        const existingPrompts = (await storage.getPromptsByTopic(topicRow.id))
          .filter(p => !p.deleted);
        const byText = new Map(existingPrompts.map(p => [p.text.toLowerCase().trim(), p]));
        const persistedPrompts: Array<{ id: number; text: string }> = [];
        for (const promptText of (t.prompts as string[])) {
          const trimmed = (promptText || '').trim();
          if (!trimmed) continue;
          const existing = byText.get(trimmed.toLowerCase());
          if (existing) {
            persistedPrompts.push({ id: existing.id, text: existing.text });
            continue;
          }
          const created = await storage.createPrompt({ text: trimmed, topicId: topicRow.id });
          persistedPrompts.push({ id: created.id, text: created.text });
        }
        persisted.push({
          id: topicRow.id,
          name: topicRow.name,
          description: topicRow.description,
          prompts: persistedPrompts,
        });
      }

      res.json({ topics: persisted });
    } catch (error) {
      console.error("Error generating prompts:", error);
      res.status(500).json({ error: "Failed to generate prompts" });
    }
  });

  app.post("/api/save-and-analyze", requireRole("analyst"), async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const { topics, brandUrl } = req.body;

      if (!topics || !Array.isArray(topics)) {
        return res.status(400).json({ error: "Topics array is required" });
      }

      // Build a set of incoming prompt texts for comparison
      const incomingPrompts = new Set<string>();
      for (const topic of topics) {
        for (const promptText of topic.prompts) {
          incomingPrompts.add(promptText.toLowerCase().trim());
        }
      }

      // Check existing prompts — deduplicate by text (keep first/lowest id)
      const rawExistingPrompts = await storage.getPrompts();
      const existingByText = new Map<string, typeof rawExistingPrompts[0]>();
      for (const p of rawExistingPrompts) {
        const key = p.text.toLowerCase().trim();
        if (!existingByText.has(key)) existingByText.set(key, p);
      }

      // Determine if prompts changed
      const promptsChanged = incomingPrompts.size !== existingByText.size ||
        [...incomingPrompts].some(p => !existingByText.has(p));

      let allPrompts;

      if (promptsChanged) {
        // Prompts differ — create new topic/prompt records for any that don't exist
        console.log(`[${new Date().toISOString()}] Prompts changed, syncing ${incomingPrompts.size} prompts`);
        const newPrompts = [];
        for (const topic of topics) {
          let topicRecord = await storage.getTopics().then(t =>
            t.find(existing => existing.name === topic.name)
          );
          if (!topicRecord) {
            topicRecord = await storage.createTopic({
              name: topic.name,
              description: topic.description
            });
          }
          for (const promptText of topic.prompts) {
            const key = promptText.toLowerCase().trim();
            const existing = existingByText.get(key);
            if (existing) {
              newPrompts.push(existing);
            } else {
              const prompt = await storage.createPrompt({
                text: promptText,
                topicId: topicRecord.id
              });
              newPrompts.push(prompt);
              existingByText.set(key, prompt); // prevent creating again in same batch
            }
          }
        }
        allPrompts = newPrompts;
      } else {
        // Same prompts — reuse existing deduplicated records
        console.log(`[${new Date().toISOString()}] Prompts unchanged, reusing ${existingByText.size} existing prompts`);
        allPrompts = [...existingByText.values()];
      }

      const sessionId = await launchAnalysis(brandUrl, allPrompts);

      res.json({
        success: true,
        message: promptsChanged
          ? `Prompts updated and analysis started (${allPrompts.length} prompts)`
          : `Analysis started with existing prompts (${allPrompts.length} prompts)`,
        promptCount: allPrompts.length,
        sessionId
      });
    } catch (error) {
      console.error("Error saving prompts and starting analysis:", error);
      res.status(500).json({ error: "Failed to save prompts and start analysis" });
    }
  });

  // Re-run analysis on existing prompts
  app.post("/api/analysis/start", requireRole("analyst"), async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const { brandUrl } = req.body || {};

      const existingPrompts = await storage.getPrompts();
      if (existingPrompts.length === 0) {
        return res.status(400).json({ error: "No prompts found. Use the Prompt Generator first." });
      }

      // brandUrl from client localStorage, or launchAnalysis will recover from DB
      const sessionId = await launchAnalysis(brandUrl || undefined, undefined);

      res.json({
        success: true,
        sessionId,
        message: `Analysis started with ${existingPrompts.length} existing prompts`
      });
    } catch (error) {
      console.error("Error starting analysis:", error);
      res.status(500).json({ error: "Failed to start analysis" });
    }
  });

  // List all analysis runs
  app.get("/api/analysis/runs", async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const { from, to } = parseDateRange(req);
      const runs = await storage.getAnalysisRuns(from, to);
      // Include response count per run, filter to completed runs with responses
      const runsWithCounts = await Promise.all(
        runs
          .filter(r => r.status === 'complete')
          .map(async (run) => {
            const responses = await storage.getResponsesWithPrompts(run.id);
            return { ...run, responseCount: responses.length };
          })
      );
      res.json(runsWithCounts.filter(r => r.responseCount > 0));
    } catch (error) {
      console.error("Error fetching analysis runs:", error);
      res.status(500).json({ error: "Failed to fetch analysis runs" });
    }
  });

  // Delete a single analysis run and all data scoped to it (admin only).
  // Other runs are untouched — see storage.deleteAnalysisRun.
  app.delete("/api/analysis/runs/:id", requireRole("admin"), async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const runId = parseInt(req.params.id, 10);
      if (!Number.isInteger(runId)) {
        return res.status(400).json({ error: "Invalid run id" });
      }

      const runs = await storage.getAnalysisRuns();
      const run = runs.find(r => r.id === runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      // Refuse to delete a run that is still in progress — cancel it first.
      if (run.status !== 'complete' && run.status !== 'error' && run.status !== 'cancelled') {
        return res.status(409).json({ error: "Cannot delete a run that is still running. Cancel it first." });
      }

      await storage.deleteAnalysisRun(runId);
      res.json({ success: true, deletedRunId: runId });
    } catch (error) {
      console.error("Error deleting analysis run:", error);
      res.status(500).json({ error: "Failed to delete analysis run" });
    }
  });

  // Get failed jobs for the latest (or specific) analysis run
  app.get("/api/analysis/failures", requireRole("analyst"), async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      let targetRunId = runId;
      if (!targetRunId) {
        const latestRun = await storage.getLatestAnalysisRun();
        targetRunId = latestRun?.id;
      }
      if (!targetRunId) {
        return res.json([]);
      }
      const failures = await storage.getFailedJobs(targetRunId);
      res.json(failures.map(j => ({
        id: j.id,
        model: j.model,
        promptText: j.promptText,
        error: j.lastError,
        attempts: j.attempts,
        failedAt: j.completedAt,
      })));
    } catch (error) {
      console.error("Error fetching failures:", error);
      res.status(500).json({ error: "Failed to fetch failures" });
    }
  });

  // Get all jobs for the latest (or specific) analysis run — compact view
  app.get("/api/analysis/jobs", requireRole("analyst"), async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      let targetRunId = runId;
      if (!targetRunId) {
        const latestRun = await storage.getLatestAnalysisRun();
        targetRunId = latestRun?.id;
      }
      if (!targetRunId) return res.json([]);

      const { jobQueue } = await import("@shared/schema");
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");

      const jobs = await db.select({
        id: jobQueue.id,
        model: jobQueue.model,
        promptText: jobQueue.promptText,
        status: jobQueue.status,
        attempts: jobQueue.attempts,
        maxAttempts: jobQueue.maxAttempts,
        lastError: jobQueue.lastError,
        originalJobId: jobQueue.originalJobId,
        lockedAt: jobQueue.lockedAt,
        completedAt: jobQueue.completedAt,
        createdAt: jobQueue.createdAt,
      }).from(jobQueue)
        .where(sql`${jobQueue.analysisRunId} = ${targetRunId}`)
        .orderBy(sql`${jobQueue.id} DESC`);

      res.json(jobs);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  // Get analysis progress for a specific session (reads from job_queue)
  app.get("/api/analysis/:sessionId/progress", async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      // sessionId format: "analysis_<runId>"
      const progress = await getAnalysisProgressFromDB();
      res.json(progress);
    } catch (error) {
      console.error("Error fetching analysis progress:", error);
      res.status(500).json({ error: "Failed to fetch analysis progress" });
    }
  });

  // Analysis Progress - Get current progress (reads from job_queue table)
  app.get("/api/analysis/progress", requireRole("analyst"), async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const progress = await getAnalysisProgressFromDB();
      res.json(progress);
    } catch (error) {
      console.error("Error fetching analysis progress:", error);
      res.status(500).json({ error: "Failed to fetch analysis progress" });
    }
  });

  // Cancel analysis (DB-based)
  app.post("/api/analysis/cancel", requireRole("analyst"), async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      await cancelAnalysisRun();
      res.json({
        success: true,
        message: "Analysis cancelled successfully"
      });
    } catch (error) {
      console.error("Error cancelling analysis:", error);
      res.status(500).json({ error: "Failed to cancel analysis" });
    }
  });

  // Apify usage statistics
  app.get("/api/apify-usage", async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const { apifyUsage } = await import("@shared/schema");
      const { db } = await import("../db");
      const { sql, desc } = await import("drizzle-orm");

      // Totals
      const [totals] = await db
        .select({
          totalCost: sql<number>`coalesce(sum(cost_usd), 0)`,
          totalRuns: sql<number>`count(*)`,
          totalDurationMs: sql<number>`coalesce(sum(duration_ms), 0)`,
          totalComputeUnits: sql<number>`coalesce(sum(compute_units), 0)`,
        })
        .from(apifyUsage);

      // Per-run breakdown (last 50)
      const runs = await db
        .select()
        .from(apifyUsage)
        .orderBy(desc(apifyUsage.createdAt))
        .limit(50);

      res.json({
        totals: {
          costUsd: Number(totals.totalCost),
          runs: Number(totals.totalRuns),
          durationMs: Number(totals.totalDurationMs),
          computeUnits: Number(totals.totalComputeUnits),
        },
        runs: runs.map(r => ({
          ...r,
          costUsd: Number(r.costUsd),
          durationMs: Number(r.durationMs),
          computeUnits: Number(r.computeUnits),
        })),
      });
    } catch (error) {
      console.error("Error fetching apify usage:", error);
      res.status(500).json({ error: "Failed to fetch apify usage" });
    }
  });

  // API usage statistics
  app.get("/api/usage", async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const { apiUsage, analysisRuns } = await import("@shared/schema");
      const { db } = await import("../db");
      const { sql, eq, desc } = await import("drizzle-orm");

      // Get last 10 runs that have usage data
      const recentRunIds = await db
        .select({ id: analysisRuns.id })
        .from(analysisRuns)
        .orderBy(desc(analysisRuns.startedAt))
        .limit(10);
      const runIds = recentRunIds.map(r => r.id);

      // Per-run totals (only recent runs + null for outside-run calls)
      const allPerRun = await db
        .select({
          analysisRunId: apiUsage.analysisRunId,
          model: apiUsage.model,
          inputTokens: sql<number>`sum(${apiUsage.inputTokens})`,
          outputTokens: sql<number>`sum(${apiUsage.outputTokens})`,
          calls: sql<number>`count(*)`,
        })
        .from(apiUsage)
        .groupBy(apiUsage.analysisRunId, apiUsage.model);

      const perRun = allPerRun.filter(row =>
        row.analysisRunId === null || runIds.includes(row.analysisRunId)
      );

      // Grand totals
      const [totals] = await db
        .select({
          inputTokens: sql<number>`coalesce(sum(${apiUsage.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${apiUsage.outputTokens}), 0)`,
          calls: sql<number>`count(*)`,
        })
        .from(apiUsage);

      // Get run info for display
      const runs = await db.select().from(analysisRuns).orderBy(desc(analysisRuns.startedAt));
      const runMap = new Map(runs.map(r => [r.id, r]));

      const perRunWithInfo = perRun.map(row => ({
        ...row,
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
        calls: Number(row.calls),
        run: row.analysisRunId ? runMap.get(row.analysisRunId) : null,
      }));

      res.json({
        totals: {
          inputTokens: Number(totals.inputTokens),
          outputTokens: Number(totals.outputTokens),
          totalTokens: Number(totals.inputTokens) + Number(totals.outputTokens),
          calls: Number(totals.calls),
        },
        perRun: perRunWithInfo,
      });
    } catch (error) {
      console.error("Error fetching usage:", error);
      res.status(500).json({ error: "Failed to fetch usage data" });
    }
  });

  // Export data
  app.get("/api/export", async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const topics = await storage.getTopics();
      const prompts = await storage.getPrompts();
      const responses = await storage.getResponses();
      const competitors = await storage.getCompetitors();
      const sources = await storage.getSources();
      const analytics = await storage.getLatestAnalytics();

      const exportData = {
        timestamp: new Date().toISOString(),
        analytics, topics, prompts, responses, competitors, sources
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="my-brand-analysis-${Date.now()}.json"`);
      res.json(exportData);
    } catch (error) {
      console.error("Error exporting data:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  // Generate prompts for a single custom topic
  app.post('/api/generate-topic-prompts', async (req, res) => {
    // #swagger.tags = ['Analysis']
    try {
      const { topicName, topicDescription, competitors, promptCount } = req.body;
      if (!topicName || !topicDescription) {
        return res.status(400).json({ error: 'Topic name and description are required' });
      }
      const competitorNames = competitors?.map((c: any) => c.name) || [];
      const { generatePromptsForTopic } = await getLlmModule();
      const prompts = await generatePromptsForTopic(topicName, topicDescription, promptCount || 5, competitorNames);
      res.json({ prompts });
    } catch (error) {
      console.error('Error generating topic prompts:', error);
      res.status(500).json({ error: 'Failed to generate topic prompts' });
    }
  });
}
