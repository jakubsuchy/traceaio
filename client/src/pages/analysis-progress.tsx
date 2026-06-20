import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Play,
  RefreshCw,
  DollarSign,
  BarChart3,
  Search,
  ChevronLeft,
  ChevronRight,
  Monitor,
  Maximize2,
  Trash2,
  History,
} from "lucide-react";

interface AnalysisProgress {
  status: 'idle' | 'initializing' | 'scraping' | 'generating_prompts' | 'testing_prompts' | 'analyzing' | 'complete' | 'error';
  message: string;
  progress: number;
  totalPrompts?: number;
  completedPrompts?: number;
  failedCount?: number;
  runningCount?: number;
}

interface FailedJob {
  id: number;
  provider: string;
  promptText: string;
  error: string;
  attempts: number;
  failedAt: string;
}

interface JobItem {
  id: number;
  provider: string;
  promptText: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  originalJobId: number | null;
  lockedAt: string | null;
  completedAt: string | null;
}

export default function AnalysisProgressPage() {
  const [isRunning, setIsRunning] = useState(false);

  const { data: progress, refetch, isLoading } = useQuery<AnalysisProgress>({
    queryKey: ['/api/analysis/progress'],
    refetchInterval: isRunning ? 2000 : false,
    enabled: true,
  });

  const { data: failures } = useQuery<FailedJob[]>({
    queryKey: ['/api/analysis/failures'],
    refetchInterval: isRunning ? 5000 : false,
    enabled: true,
  });

  const { data: allJobs } = useQuery<JobItem[]>({
    queryKey: ['/api/analysis/jobs'],
    refetchInterval: isRunning ? 2000 : false,
    enabled: true,
  });

  const startAnalysis = async () => {
    try {
      setIsRunning(true);
      const response = await fetch('/api/analysis/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      if (response.ok) {
        refetch();
      }
    } catch (error) {
      console.error('Failed to start analysis:', error);
      setIsRunning(false);
    }
  };

  const cancelAnalysis = async () => {
    try {
      const response = await fetch('/api/analysis/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        setIsRunning(false);
        refetch();
      }
    } catch (error) {
      console.error('Failed to cancel analysis:', error);
    }
  };

  useEffect(() => {
    if (!progress?.status || progress.status === 'idle' || progress.status === 'complete' || progress.status === 'error') {
      setIsRunning(false);
    } else {
      setIsRunning(true);
    }
  }, [progress]);

  const getStatusIcon = () => {
    if (isLoading) return <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />;
    
    switch (progress?.status) {
      case 'complete':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'initializing':
      case 'scraping':
      case 'generating_prompts':
      case 'testing_prompts':
      case 'analyzing':
        return <Activity className="h-5 w-5 text-blue-600 animate-pulse" />;
      default:
        return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusBadge = () => {
    switch (progress?.status) {
      case 'complete':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Complete</Badge>;
      case 'error':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Error</Badge>;
      case 'initializing':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Initializing</Badge>;
      case 'scraping':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Scraping Content</Badge>;
      case 'generating_prompts':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Generating Prompts</Badge>;
      case 'testing_prompts':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Testing Prompts</Badge>;
      case 'analyzing':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Analyzing Results</Badge>;
      case 'idle':
      default:
        return <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">Ready</Badge>;
    }
  };

  const getStageDetails = () => {
    const stages = [
      { 
        key: 'initializing', 
        title: 'Initialization', 
        description: 'Setting up analysis environment',
        completed: ['scraping', 'generating_prompts', 'testing_prompts', 'analyzing', 'complete'].includes(progress?.status || '')
      },
      { 
        key: 'scraping', 
        title: 'Content Scraping', 
        description: 'Analyzing brand content and features',
        completed: ['generating_prompts', 'testing_prompts', 'analyzing', 'complete'].includes(progress?.status || '')
      },
      { 
        key: 'generating_prompts', 
        title: 'Prompt Generation', 
        description: 'Creating test prompts for each topic',
        completed: ['testing_prompts', 'analyzing', 'complete'].includes(progress?.status || '')
      },
      { 
        key: 'testing_prompts', 
        title: 'Response Testing', 
        description: 'Getting AI responses to generated prompts',
        completed: ['analyzing', 'complete'].includes(progress?.status || '')
      },
      { 
        key: 'analyzing', 
        title: 'Analysis & Storage', 
        description: 'Analyzing mentions and storing results',
        completed: ['complete'].includes(progress?.status || '')
      }
    ];

    return stages;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">Analysis Progress</h1>
          <p className="text-gray-600">Monitor the current brand tracking analysis</p>
        </div>
      </div>

      <div className="grid gap-6 max-w-4xl">
        {/* Current Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getStatusIcon()}
                Current Status
              </div>
              {getStatusBadge()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar + stats */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Overall Progress</span>
                <span>{progress?.progress || 0}%</span>
              </div>
              <Progress value={progress?.progress || 0} className="h-2" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 p-2 rounded text-center">
                <div className="text-lg font-bold">{progress?.totalPrompts || 0}</div>
                <div className="text-xs text-gray-500">Total</div>
              </div>
              <div className="bg-blue-50 p-2 rounded text-center">
                <div className="text-lg font-bold text-blue-700">{progress?.runningCount || 0}</div>
                <div className="text-xs text-blue-600">Running</div>
              </div>
              <div className="bg-green-50 p-2 rounded text-center">
                <div className="text-lg font-bold text-green-700">{progress?.completedPrompts || 0}</div>
                <div className="text-xs text-green-600">Done</div>
              </div>
              <div className="bg-red-50 p-2 rounded text-center">
                <div className="text-lg font-bold text-red-700">{progress?.failedCount || 0}</div>
                <div className="text-xs text-red-600">Failed</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button onClick={startAnalysis} disabled={isRunning || isLoading} className="flex-1">
                <Play className="h-4 w-4 mr-2" />
                {isRunning ? 'Running...' : 'Start Analysis'}
              </Button>
              {isRunning && (
                <Button onClick={cancelAnalysis} variant="destructive" className="px-6">
                  <XCircle className="h-4 w-4 mr-2" /> Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* VNC viewer for local browser mode */}
        <BrowserPreview />

        {/* Job list */}
        {allJobs && allJobs.length > 0 && (
          <JobsTable jobs={allJobs} />
        )}

        {/* Cost Overview */}
        <CostSummaryCard />

        {/* Past runs */}
        <RunsList />

      </div>
    </div>
  );
}

interface AnalysisRunItem {
  id: number;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
  brandName: string | null;
  brandUrl: string | null;
  totalPrompts: number | null;
  completedPrompts: number | null;
  responseCount: number;
}

function RunsList() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = hasRole('admin');

  const { data: runs, isLoading } = useQuery<AnalysisRunItem[]>({
    queryKey: ['/api/analysis/runs'],
  });

  const deleteRun = useMutation({
    mutationFn: async (runId: number) => {
      await apiRequest('DELETE', `/api/analysis/runs/${runId}`);
    },
    onSuccess: (_data, runId) => {
      toast({ title: "Run deleted", description: `Run #${runId} and all of its data were removed.` });
      // Refresh everything that derives from run data.
      queryClient.invalidateQueries();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete run. Please try again.", variant: "destructive" });
    },
  });

  if (isLoading) return null;
  if (!runs || runs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Runs ({runs.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="w-12">#</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead className="text-right">Prompts</TableHead>
              <TableHead className="text-right">Responses</TableHead>
              {isAdmin && <TableHead className="w-16 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map(run => (
              <TableRow key={run.id} className="text-sm">
                <TableCell className="font-mono text-gray-400">{run.id}</TableCell>
                <TableCell>
                  {run.completedAt
                    ? new Date(run.completedAt).toLocaleString()
                    : run.startedAt
                      ? new Date(run.startedAt).toLocaleString()
                      : '-'}
                </TableCell>
                <TableCell className="text-gray-700">{run.brandName || '-'}</TableCell>
                <TableCell className="text-right text-gray-600">{run.totalPrompts ?? '-'}</TableCell>
                <TableCell className="text-right text-gray-600">{run.responseCount}</TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                          disabled={deleteRun.isPending}
                          title="Delete run"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete run #{run.id}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes all data from this run — its {run.responseCount} responses,
                            competitor mentions, cited sources, cost logs, and job history.
                            Other runs are not affected. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteRun.mutate(run.id)}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            Yes, delete this run
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BrowserPreview() {
  const { data: browserStatus } = useQuery<{ mode: string; localContainerUp: boolean }>({
    queryKey: ['/api/settings/browser-status'],
    refetchInterval: 10000,
  });
  const [showVnc, setShowVnc] = useState(false);

  if (browserStatus?.mode !== 'local' || !browserStatus?.localContainerUp) return null;

  const vncUrl = `${window.location.protocol}//${window.location.hostname}:6080/vnc_lite.html?resize=scale&autoconnect=true`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            Browser Preview
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowVnc(!showVnc)}>
              {showVnc ? 'Hide' : 'Show'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open(vncUrl, '_blank')}>
              <Maximize2 className="h-3 w-3 mr-1" /> Expand
            </Button>
          </div>
        </div>
      </CardHeader>
      {showVnc && (
        <CardContent className="p-0">
          <iframe
            src={vncUrl}
            className="w-full h-[400px] sm:h-[500px] border-t rounded-b-lg"
            title="Browser VNC"
          />
        </CardContent>
      )}
    </Card>
  );
}

const STATUS_ORDER: Record<string, number> = { processing: 0, pending: 1, failed: 2, completed: 3, cancelled: 4 };
const PAGE_SIZE = 50;

function JobsTable({ jobs }: { jobs: JobItem[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [expandedJob, setExpandedJob] = useState<number | null>(null);

  // Filter
  const filtered = jobs.filter(job => {
    if (statusFilter !== 'all' && job.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (q.startsWith('#')) {
        return job.id.toString() === q.slice(1);
      }
      return job.promptText.toLowerCase().includes(q) || job.model.toLowerCase().includes(q) || job.id.toString().includes(q);
    }
    return true;
  });

  // Sort: running > pending > failed > completed > cancelled
  const sorted = [...filtered].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 5;
    const sb = STATUS_ORDER[b.status] ?? 5;
    if (sa !== sb) return sa - sb;
    return b.id - a.id;
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [search, statusFilter]);

  // Status counts
  const counts: Record<string, number> = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <CardTitle className="text-base">Jobs ({filtered.length})</CardTitle>
          <div className="flex flex-wrap gap-2">
            {['all', 'processing', 'pending', 'completed', 'failed', 'cancelled'].map(s => {
              const count = s === 'all' ? jobs.length : (counts[s] || 0);
              if (count === 0 && s !== 'all') return null;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    statusFilter === s
                      ? s === 'processing' ? 'bg-blue-100 text-blue-700'
                        : s === 'completed' ? 'bg-green-100 text-green-700'
                        : s === 'failed' ? 'bg-red-100 text-red-700'
                        : s === 'pending' ? 'bg-gray-200 text-gray-700'
                        : 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)} ({count})
                </button>
              );
            })}
          </div>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-gray-400" />
          <Input
            placeholder="Search by ID (#123), prompt, or model..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-7 h-8 text-sm"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Mobile card view */}
        <div className="md:hidden p-3 space-y-2">
          {paged.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-4">No jobs match</div>
          ) : (
            paged.map(job => {
              const hasRetry = job.status === 'failed' && jobs.some(j => j.originalJobId === job.id || (job.originalJobId && j.originalJobId === job.originalJobId && j.id > job.id));
              const isExpanded = expandedJob === job.id;
              return (
                <div
                  key={job.id}
                  className={`p-2.5 border rounded-lg cursor-pointer ${job.status === 'processing' ? 'bg-blue-50 border-blue-200' : 'bg-white'} ${isExpanded ? 'ring-2 ring-blue-200' : ''}`}
                  onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {job.status === 'completed' && (
                      <Badge className="bg-green-100 text-green-700 text-[10px]"><CheckCircle className="h-3 w-3 mr-0.5" /> Done</Badge>
                    )}
                    {job.status === 'processing' && (
                      <Badge className="bg-blue-100 text-blue-700 text-[10px]"><Activity className="h-3 w-3 mr-0.5 animate-pulse" /> Running</Badge>
                    )}
                    {job.status === 'pending' && (
                      <Badge variant="outline" className="text-[10px] text-gray-500">Pending</Badge>
                    )}
                    {job.status === 'failed' && hasRetry && (
                      <Badge className="bg-amber-100 text-amber-700 text-[10px]"><RefreshCw className="h-3 w-3 mr-0.5" /> Retried</Badge>
                    )}
                    {job.status === 'failed' && !hasRetry && (
                      <Badge className="bg-red-100 text-red-700 text-[10px]"><XCircle className="h-3 w-3 mr-0.5" /> Failed</Badge>
                    )}
                    {job.status === 'cancelled' && (
                      <Badge variant="outline" className="text-[10px] text-gray-400">Cancelled</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] px-1.5">{job.model}</Badge>
                    <span className="text-[10px] text-gray-400 font-mono ml-auto">#{job.id}</span>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed mb-1">
                    {job.promptText.substring(0, 100)}{job.promptText.length > 100 ? '...' : ''}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span>Try {job.attempts}/{job.maxAttempts}</span>
                    {job.lastError && (
                      <span className="text-red-600 font-mono truncate">{job.lastError.substring(0, 40)}...</span>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="mt-2 pt-2 border-t space-y-1.5 text-xs">
                      <div><span className="text-gray-500 font-medium">Prompt:</span> <span className="text-gray-700">{job.promptText}</span></div>
                      {job.lastError && (
                        <div><span className="text-gray-500 font-medium">Error:</span> <span className="text-red-600 font-mono whitespace-pre-wrap break-all">{job.lastError}</span></div>
                      )}
                      {job.originalJobId && (
                        <div><span className="text-gray-500 font-medium">Retry of:</span> <span className="font-mono">#{job.originalJobId}</span></div>
                      )}
                      {job.lockedAt && (
                        <div><span className="text-gray-500 font-medium">Started:</span> {new Date(job.lockedAt).toLocaleString()}</div>
                      )}
                      {job.completedAt && (
                        <div><span className="text-gray-500 font-medium">Finished:</span> {new Date(job.completedAt).toLocaleString()}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table view */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-20">Model</TableHead>
                <TableHead>Prompt</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-16 text-center">Try</TableHead>
                <TableHead className="w-48">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map(job => {
                const hasRetry = job.status === 'failed' && jobs.some(j => j.originalJobId === job.id || (job.originalJobId && j.originalJobId === job.originalJobId && j.id > job.id));

                const isExpanded = expandedJob === job.id;
                return (
                  <React.Fragment key={job.id}>
                    <TableRow
                      className={`text-xs cursor-pointer hover:bg-gray-50 ${job.status === 'processing' ? 'bg-blue-50' : ''}`}
                      onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                    >
                      <TableCell className="font-mono text-gray-400">{job.id}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] px-1.5">{job.model}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate text-gray-700" title={job.promptText}>
                        {job.promptText.substring(0, 60)}{job.promptText.length > 60 ? '...' : ''}
                      </TableCell>
                      <TableCell>
                        {job.status === 'completed' && (
                          <Badge className="bg-green-100 text-green-700 text-[10px]"><CheckCircle className="h-3 w-3 mr-0.5" /> Done</Badge>
                        )}
                        {job.status === 'processing' && (
                          <Badge className="bg-blue-100 text-blue-700 text-[10px]"><Activity className="h-3 w-3 mr-0.5 animate-pulse" /> Running</Badge>
                        )}
                        {job.status === 'pending' && (
                          <Badge variant="outline" className="text-[10px] text-gray-500">Pending</Badge>
                        )}
                        {job.status === 'failed' && hasRetry && (
                          <Badge className="bg-amber-100 text-amber-700 text-[10px]"><RefreshCw className="h-3 w-3 mr-0.5" /> Retried</Badge>
                        )}
                        {job.status === 'failed' && !hasRetry && (
                          <Badge className="bg-red-100 text-red-700 text-[10px]"><XCircle className="h-3 w-3 mr-0.5" /> Failed</Badge>
                        )}
                        {job.status === 'cancelled' && (
                          <Badge variant="outline" className="text-[10px] text-gray-400">Cancelled</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-gray-500">{job.attempts}/{job.maxAttempts}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-[10px] text-red-600 font-mono">
                        {job.lastError ? job.lastError.substring(0, 50) + (job.lastError.length > 50 ? '...' : '') : ''}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-gray-50">
                        <TableCell colSpan={6} className="p-3">
                          <div className="space-y-2 text-xs">
                            <div><span className="text-gray-500 font-medium">Prompt:</span> <span className="text-gray-700">{job.promptText}</span></div>
                            {job.lastError && (
                              <div><span className="text-gray-500 font-medium">Error:</span> <span className="text-red-600 font-mono whitespace-pre-wrap break-all">{job.lastError}</span></div>
                            )}
                            {job.originalJobId && (
                              <div><span className="text-gray-500 font-medium">Retry of:</span> <span className="font-mono">#{job.originalJobId}</span></div>
                            )}
                            {job.lockedAt && (
                              <div><span className="text-gray-500 font-medium">Started:</span> {new Date(job.lockedAt).toLocaleString()}</div>
                            )}
                            {job.completedAt && (
                              <div><span className="text-gray-500 font-medium">Finished:</span> {new Date(job.completedAt).toLocaleString()}</div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
              {paged.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-gray-400 py-4">No jobs match</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-gray-500">
            <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface UsageData {
  totals: { inputTokens: number; outputTokens: number; totalTokens: number; calls: number };
  perRun: Array<{ analysisRunId: number | null; model: string; inputTokens: number; outputTokens: number; calls: number; run: { id: number; startedAt: string; brandName: string | null } | null }>;
}

interface ApifyUsageData {
  totals: { costUsd: number; runs: number; durationMs: number; computeUnits: number };
  runs: Array<{ id: number; apifyRunId: string; provider: string; status: string; costUsd: number; durationMs: number; createdAt: string }>;
}

function CostSummaryCard() {
  const { data: apiUsage } = useQuery<UsageData>({ queryKey: ['/api/usage'] });
  const { data: apifyUsage } = useQuery<ApifyUsageData>({ queryKey: ['/api/apify-usage'] });

  const hasApify = (apifyUsage?.totals?.runs || 0) > 0;
  const hasApi = (apiUsage?.totals?.calls || 0) > 0;
  if (!hasApify && !hasApi) return null;

  const formatCost = (n: number) => n < 0.01 ? '< $0.01' : `$${n.toFixed(2)}`;
  const formatNumber = (n: number) => n.toLocaleString();
  const apiEstCost = apiUsage ? (apiUsage.totals.inputTokens / 1_000_000) * 2.50 + (apiUsage.totals.outputTokens / 1_000_000) * 10 : 0;
  const apifyCost = apifyUsage?.totals?.costUsd || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Cost Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-amber-50 p-3 rounded-lg text-center">
            <div className="text-xl font-bold text-amber-700">{formatCost(apiEstCost + apifyCost)}</div>
            <div className="text-xs text-amber-600">Total Cost</div>
          </div>
          {hasApi && (
            <div className="bg-blue-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-blue-700">{formatCost(apiEstCost)}</div>
              <div className="text-xs text-blue-600">OpenAI (est.)</div>
            </div>
          )}
          {hasApify && (
            <div className="bg-green-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-green-700">{formatCost(apifyCost)}</div>
              <div className="text-xs text-green-600">Apify</div>
            </div>
          )}
        </div>

        <Tabs defaultValue={hasApify ? "apify" : "api"}>
          <TabsList>
            {hasApi && <TabsTrigger value="api">OpenAI API</TabsTrigger>}
            {hasApify && <TabsTrigger value="apify">Apify Runs</TabsTrigger>}
          </TabsList>

          {hasApi && (
            <TabsContent value="api" className="mt-3">
              <div className="text-xs text-gray-500 mb-2">{formatNumber(apiUsage!.totals.totalTokens)} tokens, {formatNumber(apiUsage!.totals.calls)} calls</div>
              {apiUsage!.perRun.length > 0 && (
                <div className="bg-white rounded-lg border overflow-hidden max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Run</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apiUsage!.perRun.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">
                            {row.run ? new Date(row.run.startedAt).toLocaleDateString() : <span className="text-gray-400">Outside run</span>}
                          </TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{row.model}</Badge></TableCell>
                          <TableCell className="text-right text-sm">{formatNumber(row.inputTokens + row.outputTokens)}</TableCell>
                          <TableCell className="text-right text-sm text-amber-600">{formatCost((row.inputTokens / 1_000_000) * 2.50 + (row.outputTokens / 1_000_000) * 10)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          )}

          {hasApify && (
            <TabsContent value="apify" className="mt-3">
              <div className="text-xs text-gray-500 mb-2">{apifyUsage!.totals.runs} runs, {Math.round(apifyUsage!.totals.durationMs / 1000)}s total</div>
              {apifyUsage!.runs.length > 0 && (
                <div className="bg-white rounded-lg border overflow-hidden max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apifyUsage!.runs.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="text-sm">{new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{run.model}</Badge></TableCell>
                          <TableCell>
                            <Badge className={`text-xs ${run.status === 'SUCCEEDED' ? 'bg-green-100 text-green-700' : run.status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                              {run.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm">{run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : '-'}</TableCell>
                          <TableCell className="text-right text-sm text-green-600">{run.costUsd ? formatCost(run.costUsd) : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}