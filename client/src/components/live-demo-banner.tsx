import { useQuery } from "@tanstack/react-query";

// Thin top-of-site banner shown only when the server reports LIVE_DEMO=1.
// Fetches the public, unauthenticated config so it renders on every page,
// including the login screen, before a session exists.
export default function LiveDemoBanner() {
  const { data } = useQuery<{ liveDemo: boolean }>({
    queryKey: ["/api/public-config"],
  });

  if (!data?.liveDemo) return null;

  return (
    <div className="w-full bg-indigo-600 text-white text-sm text-center px-4 py-2">
      This is a Live Demo of{" "}
      <a
        href="https://traceaio.org/#get-started"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold underline underline-offset-2 hover:text-indigo-100"
      >
        TraceAIO
      </a>
      . Deploy your own with Docker!
    </div>
  );
}
