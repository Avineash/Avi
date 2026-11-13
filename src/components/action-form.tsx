"use client";
import { useActionState, useEffect, useRef } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { Result } from "@/app/actions/_util";

type Action = (prev: Result, fd: FormData) => Promise<Result>;

/** A form bound to a server action with inline success / error feedback and a pending state. */
export function ActionForm({
  action, children, submit, variant, size, className, resetOnSuccess, confirm, submitClassName, hideSubmit,
}: {
  action: Action; children?: React.ReactNode; submit?: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"];
  className?: string; resetOnSuccess?: boolean; confirm?: string; submitClassName?: string; hideSubmit?: boolean;
}) {
  const [state, formAction, pending] = useActionState<Result, FormData>(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}>
      {children}
      {!hideSubmit && <Button type="submit" variant={variant} size={size} disabled={pending} className={submitClassName} aria-busy={pending}>{pending ? "Working…" : submit ?? "Save"}</Button>}
      <div aria-live="polite" className="empty:hidden">
        {state?.error && <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{state.ok}</p>}
      </div>
    </form>
  );
}
