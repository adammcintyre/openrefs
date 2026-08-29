import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "./cn";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds on screen. Pass 0 to require a manual dismiss. */
  duration?: number;
}

interface Toast extends ToastOptions {
  id: number;
}

interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONES: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  error: { icon: CircleAlert, className: "text-danger" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  info: { icon: Info, className: "text-info" },
};

const DEFAULT_DURATION = 5000;

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used inside a <ToastProvider>");
  }
  return api;
}

/**
 * Toast host. Mount once, above the router.
 *
 * The viewport is a single aria-live region rather than one per toast, so a
 * burst of notifications is announced in order instead of interrupting itself.
 * Errors go to role="alert" (assertive) and everything else to role="status"
 * (polite), which is the difference between "your export failed" cutting in
 * and "copied" waiting its turn.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...options, id }]);

      const duration = options.duration ?? DEFAULT_DURATION;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  // Timers outlive the component only if we let them; clear on unmount so a
  // hot reload or route teardown cannot call setState on a dead tree.
  const timersRef = timers;
  useEffect(() => {
    const map = timersRef.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, [timersRef]);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document === "undefined"
        ? null
        : createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
              <div role="status" aria-live="polite" className="contents">
                {toasts
                  .filter((item) => item.tone !== "error")
                  .map((item) => (
                    <ToastCard key={item.id} toast={item} onDismiss={dismiss} />
                  ))}
              </div>
              <div role="alert" aria-live="assertive" className="contents">
                {toasts
                  .filter((item) => item.tone === "error")
                  .map((item) => (
                    <ToastCard key={item.id} toast={item} onDismiss={dismiss} />
                  ))}
              </div>
            </div>,
            document.body,
          )}
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const tone = TONES[toast.tone ?? "info"];
  const Icon = tone.icon;

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-app border border-border bg-surface p-3 shadow-lg",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone.className)} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{toast.title}</p>
        {toast.description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {toast.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss: ${toast.title}`}
        className="-mt-0.5 -mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-app text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
