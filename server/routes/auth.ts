import passport from "passport";
import type { Express } from "express";
import { requireRole } from "./helpers";

// Allowlist of user fields safe to return to clients
function safeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles,
    hasApiKey: !!user.apiKey,
    createdAt: user.createdAt,
  };
}

export function registerAuthRoutes(app: Express) {
  // --- Public auth routes (no auth required) ---
  app.get("/api/auth/needs-setup", async (req, res) => {
    // #swagger.tags = ['Auth']
    const { getUserCount, getAuthProviderConfig } = await import('../services/auth');
    const count = await getUserCount();
    const config = await getAuthProviderConfig();
    res.json({
      needsSetup: count === 0,
      googleEnabled: !!config.google?.enabled,
      samlEnabled: !!config.saml?.enabled,
    });
  });

  // Public, unauthenticated client config. Exposes only non-sensitive flags
  // the UI needs before (and without) a session — e.g. the Live Demo banner.
  app.get("/api/public-config", async (_req, res) => {
    // #swagger.tags = ['Auth']
    res.json({
      liveDemo: process.env.LIVE_DEMO === '1',
    });
  });

  app.get("/api/auth/session", async (req, res) => {
    // #swagger.tags = ['Auth']
    if (req.isAuthenticated()) {
      const { getAuthProviderConfig } = await import('../services/auth');
      const config = await getAuthProviderConfig();
      res.json({
        user: safeUser(req.user),
        googleEnabled: !!config.google?.enabled,
        samlEnabled: !!config.saml?.enabled,
      });
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    // #swagger.tags = ['Auth']
    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || 'Invalid credentials' });
      req.logIn(user, (err) => {
        if (err) return next(err);
        res.json({ user: safeUser(user) });
      });
    })(req, res, next);
  });

  // Google OAuth routes (dynamic — check if strategy is registered)
  app.get("/api/auth/google", (req, res, next) => {
    // #swagger.tags = ['Auth']
    if (!(passport as any)._strategy('google')) return res.status(404).json({ message: "Google auth not configured" });
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  app.get("/api/auth/google/callback",
    (req, res, next) => {
    // #swagger.tags = ['Auth']
      if (!(passport as any)._strategy('google')) return res.redirect('/login?error=google');
      passport.authenticate('google', { failureRedirect: '/login?error=google' })(req, res, next);
    },
    (req, res) => { res.redirect('/'); }
  );

  // SAML routes (dynamic — check if strategy is registered)
  app.get("/api/auth/saml", (req, res, next) => {
    // #swagger.tags = ['Auth']
    if (!(passport as any)._strategy('saml')) return res.status(404).json({ message: "SAML auth not configured" });
    passport.authenticate('saml')(req, res, next);
  });

  app.post("/api/auth/saml/callback",
    (req, res, next) => {
    // #swagger.tags = ['Auth']
      if (!(passport as any)._strategy('saml')) return res.redirect('/login?error=saml');
      passport.authenticate('saml', { failureRedirect: '/login?error=saml' })(req, res, next);
    },
    (req, res) => { res.redirect('/'); }
  );

  // SAML metadata endpoint
  app.get("/api/auth/saml/metadata", (req, res) => {
    // #swagger.tags = ['Auth']
    const strategy = (passport as any)._strategy('saml') as any;
    if (!strategy) return res.status(404).json({ message: "SAML not configured" });
    res.type('application/xml').send(strategy.generateServiceProviderMetadata());
  });

  app.post("/api/auth/logout", (req, res) => {
    // #swagger.tags = ['Auth']
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.json({ success: true });
    });
  });

  app.post("/api/initialize", async (req, res) => {
    // #swagger.tags = ['Auth']
    try {
      const { getUserCount, createUser, assignRole } = await import('../services/auth');
      if (await getUserCount() > 0) return res.status(403).json({ message: "Already initialized" });
      const { email, fullName, password } = req.body;
      if (!email || !fullName || !password) return res.status(400).json({ message: "All fields required" });
      const user = await createUser(email, fullName, password);
      await assignRole(user.id, 'admin');
      await assignRole(user.id, 'analyst');
      await assignRole(user.id, 'user');
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: "Email already exists" });
      res.status(500).json({ message: err.message });
    }
  });
}

// --- Auth guard: protect all subsequent API routes ---
// Supports session cookies (browser UI) and Bearer token (API keys).
// Role checks are done per-route via requireRole().
export async function registerAuthGuard(app: Express) {
  const { PUBLIC_API_PATHS } = await import('../config');
  const { findUserByApiKey } = await import('../services/auth');
  app.use("/api", async (req, res, next) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (req.isAuthenticated()) return next();

    // Bearer token fallback — use the same API keys as MCP
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const user = await findUserByApiKey(authHeader.slice(7));
      if (user) {
        (req as any).user = user;
        return next();
      }
    }

    return res.status(401).json({ message: "Not authenticated" });
  });
}

// --- Auth provider configuration (admin only) ---
export function registerAuthProviderRoutes(app: Express) {
  app.get("/api/auth/providers", requireRole('admin'), async (req, res) => {
    // #swagger.tags = ['Auth']
    const { getAuthProviderConfig } = await import('../services/auth');
    const config = await getAuthProviderConfig();
    // Mask secrets: show only whether they're set
    res.json({
      google: config.google
        ? { ...config.google, clientSecret: config.google.clientSecret ? '••••••••' : '' }
        : { enabled: false, clientId: '', clientSecret: '' },
      saml: config.saml
        ? { ...config.saml, cert: config.saml.cert ? '(configured)' : '' }
        : { enabled: false, entryPoint: '', issuer: '', cert: '' },
    });
  });

  app.post("/api/auth/providers", requireRole('admin'), async (req, res) => {
    // #swagger.tags = ['Auth']
    const { saveAuthProviderConfig, configureAuthProviders } = await import('../services/auth');
    await saveAuthProviderConfig(req.body);
    await configureAuthProviders();
    res.json({ success: true });
  });
}
