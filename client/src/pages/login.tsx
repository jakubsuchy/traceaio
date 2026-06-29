import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { LogIn, Shield } from "lucide-react";
import logoUrl from "@/logo.png";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const auth = useAuth();

  const { data: setupData } = useQuery<{ needsSetup: boolean; googleEnabled: boolean; samlEnabled: boolean }>({
    queryKey: ['/api/auth/needs-setup'],
    queryFn: async () => {
      const res = await fetch('/api/auth/needs-setup', { credentials: 'include' });
      if (!res.ok) return { needsSetup: false, googleEnabled: false, samlEnabled: false };
      return res.json();
    },
    retry: false,
  });

  const { data: publicConfig } = useQuery<{ liveDemo: boolean }>({
    queryKey: ['/api/public-config'],
  });
  const liveDemo = !!publicConfig?.liveDemo;

  // In demo mode, pre-fill the demo credentials so visitors can sign in in one
  // click. Runs once when the flag resolves; the user can still edit the fields.
  useEffect(() => {
    if (liveDemo) {
      setEmail("admin@example.com");
      setPassword("adminadmin");
    }
  }, [liveDemo]);

  useEffect(() => {
    if (setupData?.needsSetup) {
      setLocation("/initialize");
    }
  }, [setupData, setLocation]);

  useEffect(() => {
    if (auth.isAuthenticated) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") || "/";
      setLocation(redirect);
    }
  }, [auth.isAuthenticated, setLocation]);

  const googleEnabled = setupData?.googleEnabled || auth.googleEnabled;
  const samlEnabled = setupData?.samlEnabled || false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setIsSubmitting(true);
    try {
      await auth.login(email, password);
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") || "/";
      setLocation(redirect);
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error?.message?.includes("401")
          ? "Invalid email or password"
          : "An error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-full h-full bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src={logoUrl} alt="TraceAIO" className="h-12" />
          </div>
          <CardTitle className="text-2xl">Sign in to TraceAIO</CardTitle>
          <p className="text-sm text-gray-600 mt-1">Enter your credentials to continue</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {liveDemo && (
            <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm text-indigo-900">
              Welcome to the live demo of TraceAIO. Please login with username{" "}
              <span className="font-semibold">admin@example.com</span>, password{" "}
              <span className="font-semibold">adminadmin</span>.
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type={liveDemo ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              <LogIn className="h-4 w-4 mr-2" />
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          {(googleEnabled || samlEnabled) && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-gray-500">Or continue with</span>
                </div>
              </div>
              {googleEnabled && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => { window.location.href = "/api/auth/google"; }}
                >
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Sign in with Google
                </Button>
              )}
              {samlEnabled && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => { window.location.href = "/api/auth/saml"; }}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Sign in with SAML
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
