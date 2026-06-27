import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { loadBrandName, launchAnalysis } from "./routes/helpers";
import { registerAuthRoutes, registerAuthGuard, registerAuthProviderRoutes } from "./routes/auth";
import { registerUserRoutes } from "./routes/users";
import { registerMetricsRoutes } from "./routes/metrics";
import { registerTopicRoutes } from "./routes/topics";
import { registerCompetitorRoutes } from "./routes/competitors";
import { registerSourceRoutes } from "./routes/sources";
import { registerPageRoutes } from "./routes/pages";
import { registerWatchedUrlRoutes } from "./routes/watched-urls";
import { registerResponseRoutes } from "./routes/responses";
import { registerAnalysisRoutes } from "./routes/analysis";
import { registerSettingsRoutes } from "./routes/settings";
import { registerDocsRoutes } from "./routes/docs";
import { registerExportRoutes } from "./routes/export";
import { registerRecommendationRoutes } from "./routes/recommendations";

// Re-export for scheduler
export { launchAnalysis } from "./routes/helpers";

// When LIVE_DEMO=1, block every data-mutating API request (POST/PUT/PATCH/
// DELETE) so the public demo is read-only. The auth lifecycle is allow-listed
// so visitors can still log in/out. Registered before all routes so it's
// deterministic regardless of route order; the client shows a "Deploy your
// own" modal, this is the hard server-side guarantee behind it.
const LIVE_DEMO_ALLOW: { method: string; path: RegExp }[] = [
  { method: "POST", path: /^\/api\/auth\/login$/ },
  { method: "POST", path: /^\/api\/auth\/logout$/ },
];
function registerLiveDemoGuard(app: Express) {
  app.use("/api", (req, res, next) => {
    if (process.env.LIVE_DEMO !== "1") return next();
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
    const path = req.originalUrl.split("?")[0];
    if (LIVE_DEMO_ALLOW.some(a => a.method === method && a.path.test(path))) return next();
    return res.status(403).json({
      error: "live_demo",
      message: "This is a live demo. Deploy your own to make changes.",
    });
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Load persisted brand name from DB
  await loadBrandName();

  // Load DB settings into env
  try {
    const { loadSettingsIntoEnv } = await import('./services/settings');
    await loadSettingsIntoEnv();
  } catch (error) {
    console.error('[STARTUP] Failed to load settings from DB:', error);
  }

  // --- Live demo guard (read-only mode) — before everything else ---
  registerLiveDemoGuard(app);

  // --- Public routes (before auth guard) ---
  registerAuthRoutes(app);

  // --- Auth guard (protects all subsequent /api/* routes) ---
  await registerAuthGuard(app);

  // --- Protected routes ---
  await registerDocsRoutes(app);
  registerUserRoutes(app);
  registerAuthProviderRoutes(app);
  registerMetricsRoutes(app);
  registerTopicRoutes(app);
  registerCompetitorRoutes(app);
  registerSourceRoutes(app);
  registerPageRoutes(app);
  registerWatchedUrlRoutes(app);
  registerResponseRoutes(app);
  registerAnalysisRoutes(app);
  registerSettingsRoutes(app);
  registerExportRoutes(app);
  registerRecommendationRoutes(app);

  // --- Startup: crash recovery + scheduler ---
  try {
    const { isAnalysisRunningInDB } = await import('./services/analyzer');
    const isRunning = await isAnalysisRunningInDB();
    if (isRunning) {
      console.log('[STARTUP] Found a stalled analysis run — recovering...');
      const latestRun = await storage.getLatestAnalysisRun();
      if (latestRun && latestRun.status === 'running') {
        const { BrandAnalyzer } = await import('./services/analyzer');
        const worker = new BrandAnalyzer();
        const brandName = latestRun.brandName || '';
        worker.setBrandName(brandName);
        worker.setAnalysisRunId(latestRun.id);
        if (latestRun.brandUrl) worker.setBrandUrl(latestRun.brandUrl);
        worker.runFullAnalysis(true).then(async () => {
          await storage.completeAnalysisRun(latestRun.id, 'complete');
          console.log(`[STARTUP] Recovered analysis run #${latestRun.id} completed`);
          const { fireWebhook } = await import('./services/webhook');
          fireWebhook(latestRun.id, 'complete');
        }).catch(async (error) => {
          await storage.completeAnalysisRun(latestRun.id, 'error');
          console.error('[STARTUP] Recovered analysis run failed:', error);
          const { fireWebhook } = await import('./services/webhook');
          fireWebhook(latestRun.id, 'error');
        });
      }
    }
  } catch (error) {
    console.error('[STARTUP] Crash recovery failed:', error);
  }

  // Initialize scheduler
  try {
    const { initScheduler, setLauncher } = await import('./services/scheduler');
    setLauncher(launchAnalysis);
    await initScheduler();
  } catch (error) {
    console.error('[STARTUP] Scheduler init failed:', error);
  }

  // Check browser availability
  try {
    const browserUrl = process.env.BROWSER_ACTOR_URL || 'http://browser-actor:8888';
    const res = await fetch(`${browserUrl}/`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (res?.ok) {
      console.log(`[STARTUP] Browser actor available at ${browserUrl}`);
    } else {
      console.log(`[STARTUP] Browser actor not available at ${browserUrl} — using Apify Cloud if configured`);
    }
  } catch {}

  const httpServer = createServer(app);
  return httpServer;
}
