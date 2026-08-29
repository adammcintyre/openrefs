import { X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "./button";
import type { ButtonVariant } from "./button";
import { cn } from "./cn";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export type DialogSize = "sm" | "md" | "lg";

const SIZES: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

/**
 * Modal dialog.
 *
 * Implemented over a plain portal rather than <dialog>: showModal() puts the
 * element in the top layer, where the ::backdrop cannot be tinted from our
 * token variables without a second stylesheet, and Safari's focus restoration
 * on close is still inconsistent. Doing it by hand keeps both under control.
 *
 * Contract: focus moves in on open and returns to the trigger on close, Tab
 * and Shift+Tab cycle inside, Esc closes, the background is inert to scroll.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  /** When false, only an explicit action closes it — no Esc, no backdrop. */
  dismissible?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;

  useEffect(() => {
    if (!open) return;

    restoreTo.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Focus the first control, falling back to the panel itself so the
    // reading position starts inside the dialog even when it is text-only.
    const node = panel.current;
    if (node) {
      const first = focusableWithin(node)[0];
      (first ?? node).focus();
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      restoreTo.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && dismissible) {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const node = panel.current;
    if (!node) return;
    const items = focusableWithin(node);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;

    // Wrap at both ends so focus can never reach the inert page behind.
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={onKeyDown}
    >
      {/* Backdrop. aria-hidden + no role: the dialog below is the only thing
          the accessibility tree should see. */}
      <div
        aria-hidden="true"
        onClick={dismissible ? onClose : undefined}
        className="absolute inset-0 bg-[#0b120e]/60 backdrop-blur-[2px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-app border border-border bg-surface shadow-xl",
          SIZES[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-0">
          <div className="flex flex-col gap-1">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-foreground"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descId}
                className="text-sm leading-relaxed text-muted-foreground"
              >
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mt-1 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-app text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {children ? (
          <div className="overflow-y-auto p-5 text-sm text-foreground">
            {children}
          </div>
        ) : (
          <div className="h-2" />
        )}

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-muted p-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Yes/no dialog for destructive or irreversible actions. `confirmVariant`
 * defaults to danger because that is what this is nearly always guarding.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      // Closing mid-request would strand the caller's pending state.
      dismissible={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
