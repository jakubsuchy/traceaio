import { ReactNode, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  installLiveDemoFetchGuard,
  registerDeployModalOpener,
  setLiveDemoEnabled,
} from "@/lib/live-demo";
import DeployModal from "@/components/deploy-modal";

// Bridges the server's LIVE_DEMO flag to the fetch guard and owns the
// "Deploy your own" modal. The guard (window.fetch override) opens the modal
// whenever a blocked mutation is attempted, from anywhere in the app.
export default function LiveDemoProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ liveDemo: boolean }>({
    queryKey: ["/api/public-config"],
  });
  const liveDemo = !!data?.liveDemo;

  // Install the fetch override as early as possible (idempotent).
  useEffect(() => {
    installLiveDemoFetchGuard();
  }, []);

  // Keep the guard's enabled flag in sync with the server config.
  useEffect(() => {
    setLiveDemoEnabled(liveDemo);
  }, [liveDemo]);

  // Let the guard open this provider's modal.
  useEffect(() => {
    registerDeployModalOpener(() => setOpen(true));
    return () => registerDeployModalOpener(null);
  }, []);

  return (
    <>
      {children}
      <DeployModal open={open} onOpenChange={setOpen} />
    </>
  );
}
