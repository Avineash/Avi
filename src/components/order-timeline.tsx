import { Check } from "lucide-react";
import { cn } from "@/lib/util";

const STEPS = [["paid", "Paid · held in escrow"], ["delivered", "Seller delivered"], ["completed", "Confirmed · seller paid"]] as const;
const ORDER: Record<string, number> = { pending_payment: -1, paid: 0, delivered: 1, disputed: 1, completed: 2, refunding: 0, refunded: 0, cancelled: 0, expired: -1 };

/** Where the money is, in three plain steps. Used on both the buyer's and the seller's order pages. */
export function OrderTimeline({ status }: { status: string }) {
  const at = ORDER[status] ?? 0;
  const dead = ["refunded", "cancelled", "refunding", "expired"].includes(status);
  return (
    <ol className="grid gap-3 sm:grid-cols-3" aria-label="Order progress">
      {STEPS.map(([k, label], i) => {
        const done = !dead && i <= at && !(status === "disputed" && i === 2);
        return (
          <li key={k} className={cn("flex items-center gap-3 rounded-2xl border p-3.5 text-sm", done ? "border-success/30 bg-success/5" : "border-navy-900/10 bg-white")} aria-current={!dead && i === at ? "step" : undefined}>
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", done ? "bg-success text-white" : "bg-navy-900/10 text-navy-900/60")}>{done ? <Check className="size-4" /> : i + 1}</span>
            <span className={done ? "font-medium text-navy-900" : "text-navy-900/60"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
