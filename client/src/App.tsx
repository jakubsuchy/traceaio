import { ReactNode } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import Layout from "@/components/layout";
import LiveDemoBanner from "@/components/live-demo-banner";
import LiveDemoProvider from "@/components/live-demo-provider";
import Dashboard from "@/pages/dashboard";
import PromptGeneratorPage from "@/pages/prompt-generator";
import ResponsesPage from "@/pages/responses";
import PromptsListPage from "@/pages/prompts-list";
import PromptAnalyticsPage from "@/pages/prompt-analytics";
import HistogramsPage from "@/pages/histograms";
import RecommendationsPage from "@/pages/recommendations";
import RecommendationDetailPage from "@/pages/recommendation-detail";
import CompetitorsPage from "@/pages/competitors";
import ComparePage from "@/pages/compare";
import SourcesPage from "@/pages/sources";
import SettingsPage from "@/pages/settings";
import AnalysisProgressPage from "@/pages/analysis-progress";
import LoginPage from "@/pages/login";
import InitializePage from "@/pages/initialize";
import UsersPage from "@/pages/users";
import NotFound from "@/pages/not-found";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, hasRole } = useAuth();
  const [location] = useLocation();

  const { data: brandData, isLoading: brandLoading } = useQuery<{ brandName: string | null }>({
    queryKey: ['/api/settings/brand'],
    enabled: isAuthenticated,
  });
  const { data: promptsData, isLoading: promptsLoading } = useQuery<any[]>({
    queryKey: ['/api/prompts'],
    enabled: isAuthenticated,
  });

  if (isLoading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!isAuthenticated) return <Redirect to={`/login?redirect=${encodeURIComponent(location)}`} />;

  // Wait for data before deciding on setup redirect
  if (brandLoading || promptsLoading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  // Redirect to setup wizard if brand is empty and no prompts (admin/analyst only)
  const needsSetup = !brandData?.brandName && (!promptsData || promptsData.length === 0);
  if (needsSetup && location !== '/setup' && (hasRole('admin') || hasRole('analyst'))) {
    return <Redirect to="/setup" />;
  }

  return <>{children}</>;
}

function RequireRole({ role, children }: { role: string; children: ReactNode }) {
  const { hasRole } = useAuth();
  // Admin can access everything
  if (hasRole('admin') || hasRole(role)) return <>{children}</>;
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
        <p className="text-gray-500 mt-2">You need the "{role}" role to access this page.</p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/initialize" component={InitializePage} />
      <Route>
        <ProtectedRoute>
          <Layout>
            <Switch>
              <Route path="/prompt-generator">{() => <RequireRole role="analyst"><PromptGeneratorPage /></RequireRole>}</Route>
              <Route path="/" component={Dashboard} />
              <Route path="/recommendations" component={RecommendationsPage} />
              <Route path="/recommendations/:id" component={RecommendationDetailPage} />
              <Route path="/prompts" component={PromptsListPage} />
              <Route path="/prompts/:id" component={PromptAnalyticsPage} />
              <Route path="/histograms">{() => <RequireRole role="analyst"><HistogramsPage /></RequireRole>}</Route>
              <Route path="/responses" component={ResponsesPage} />
              <Route path="/competitors" component={CompetitorsPage} />
              <Route path="/compare" component={ComparePage} />
              <Route path="/sources" component={SourcesPage} />
              <Route path="/analysis-progress">{() => <RequireRole role="analyst"><AnalysisProgressPage /></RequireRole>}</Route>
              <Route path="/setup">{() => <SettingsPage wizardMode />}</Route>
              <Route path="/settings">{() => <RequireRole role="admin"><SettingsPage /></RequireRole>}</Route>
              <Route path="/users">{() => <RequireRole role="admin"><UsersPage /></RequireRole>}</Route>
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <LiveDemoProvider>
            <Toaster />
            <div className="flex flex-col h-screen">
              <LiveDemoBanner />
              <div className="flex-1 min-h-0">
                <Router />
              </div>
            </div>
          </LiveDemoProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
