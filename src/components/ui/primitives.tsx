import * as React from "react";
import { cn } from "@/lib/util";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("card", className)} {...p} />; }
export function CardHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...p} />; }
export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) { return <h3 className={cn("font-serif text-lg font-semibold", className)} {...p} />; }
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("p-5 pt-2", className)} {...p} />; }

const tones = {
  neutral: "bg-navy-900/8 text-navy-800 ring-navy-900/10",
  gold: "bg-gold-300/40 text-gold-700 ring-gold-500/30",
  success: "bg-success/10 text-success ring-success/25",
  danger: "bg-danger/10 text-danger ring-danger/25",
  navy: "bg-navy-900 text-ivory ring-navy-900",
  goldSolid: "bg-gold-500 text-navy-950 ring-gold-300 font-semibold",
  warn: "bg-amber-100 text-amber-800 ring-amber-300/50",
};
export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)} {...p} />;
}

const STATUS_TONE: Record<string, keyof typeof tones> = {
  confirmed: "success", completed: "success", approved: "success", paid: "success", captured: "success", succeeded: "success", published: "success", available: "success", active: "success", won: "success", sent: "success",
  pending: "warn", pending_payment: "warn", pending_admin: "warn", pending_customer: "warn", processing: "warn", resale_pending: "warn", held: "warn", submitted: "warn", open: "warn", investigating: "warn", requires_payment: "warn", authorized: "warn", offered: "warn", buyback_requested: "warn", buyback_pending: "warn", waitlisted: "warn", draft: "neutral",
  cancelled: "danger", rejected: "danger", failed: "danger", suspended: "danger", expired: "neutral", declined: "neutral", lost: "danger", refunded: "neutral", partially_refunded: "warn", paused: "neutral", closed: "neutral", completed_unsold: "neutral", released: "neutral", booked: "navy", fulfilled: "success",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

const field = "w-full rounded-xl border border-navy-900/20 bg-white px-3.5 py-2.5 text-ink placeholder:text-navy-900/40 focus:border-gold-500 disabled:bg-navy-900/5";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, "h-11", className)} {...p} />);
Input.displayName = "Input";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, "min-h-24", className)} {...p} />);
Textarea.displayName = "Textarea";
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, "h-11 pr-8", className)} {...p} />);
Select.displayName = "Select";
export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) { return <label className={cn("mb-1.5 block text-sm font-medium text-navy-900", className)} {...p} />; }

/** Label + control + optional hint, wired for accessibility. */
export function Field({ label, hint, htmlFor, children, className }: { label: string; hint?: React.ReactNode; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p id={`${htmlFor}-hint`} className="mt-1 text-xs text-navy-900/60">{hint}</p>}
    </div>
  );
}

export function Table({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) {
  return <div className="overflow-x-auto"><table className={cn("w-full text-left text-sm", className)} {...p} /></div>;
}
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th scope="col" className={cn("whitespace-nowrap border-b border-navy-900/10 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-navy-900/60", className)} {...p} />;
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("border-b border-navy-900/5 px-3 py-3 align-top", className)} {...p} />;

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-navy-900/20 bg-white/60 p-10 text-center">
      <p className="font-serif text-lg text-navy-900">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-navy-900/70">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
