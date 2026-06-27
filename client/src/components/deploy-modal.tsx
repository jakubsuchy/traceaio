import { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// The prompt a user pastes to Claude to spin up their own instance.
const CLAUDE_PROMPT = `Download docker-compose.yml from
https://raw.githubusercontent.com/jakubsuchy/traceaio/main/docker-compose.yml
and run docker compose up -d
Then open http://localhost:3000`;

// Equivalent manual steps for users running Docker Compose themselves.
const COMPOSE_STEPS = `# Download and start
curl -O https://raw.githubusercontent.com/jakubsuchy/traceaio/main/docker-compose.yml
docker compose up -d

# Open http://localhost:3000`;

// A labelled code block with a copy button. min-w-0 on the wrapper and pre is
// what keeps a long unbreakable URL from blowing out the dialog width.
function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can select the text manually */
    }
  };

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          className="h-7 shrink-0 gap-1.5 text-xs text-gray-500 hover:text-gray-700"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Copy
            </>
          )}
        </Button>
      </div>
      <pre className="min-w-0 whitespace-pre-wrap break-words rounded-md bg-gray-900 px-3 py-2.5 text-xs leading-relaxed text-gray-100">
        {code}
      </pre>
    </div>
  );
}

// Shown when a visitor tries a data-mutating action in Live Demo mode.
export default function DeployModal({ open, onOpenChange }: DeployModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Deploy your own</DialogTitle>
          <DialogDescription>
            This is a read-only live demo, so changes are disabled. Deploy your
            own instance:
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <CodeBlock label="Tell Claude:" code={CLAUDE_PROMPT} />
          <CodeBlock label="Docker Compose:" code={COMPOSE_STEPS} />
        </div>

        <div className="flex items-center gap-4 text-sm">
          <a
            href="https://traceaio.org"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-500"
          >
            traceaio.org
          </a>
          <a
            href="https://github.com/jakubsuchy/traceaio"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-500"
          >
            GitHub
          </a>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
