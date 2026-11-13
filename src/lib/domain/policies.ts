export type CancellationPolicy = "flexible" | "moderate" | "strict" | "non_refundable";

export const POLICY_LABEL: Record<CancellationPolicy, string> = {
  flexible: "Free cancellation",
  moderate: "Partial refund",
  strict: "Limited refund",
  non_refundable: "Non-refundable",
};

/**
 * Refund (in basis points of the amount paid) if the customer cancels `hoursBeforeStart` hours before the start.
 * These are the contractual *change-of-mind* terms. They never limit rights under the Australian Consumer Law
 * consumer guarantees (e.g. a major failure by the supplier) — those are handled through the dispute/refund-request flow.
 */
export function refundBps(policy: CancellationPolicy, hoursBeforeStart: number): number {
  switch (policy) {
    case "flexible": return hoursBeforeStart >= 4 ? 10_000 : 0;
    case "moderate": return hoursBeforeStart >= 24 ? 10_000 : hoursBeforeStart >= 4 ? 5_000 : 0;
    case "strict": return hoursBeforeStart >= 24 ? 5_000 : 0;
    case "non_refundable": return 0;
  }
}

export function policyText(policy: CancellationPolicy): string {
  switch (policy) {
    case "flexible": return "Full refund (including the service fee) if you cancel at least 4 hours before the start. No refund after that.";
    case "moderate": return "Full refund if you cancel at least 24 hours before the start; 50% refund from 24 to 4 hours before; no refund after that.";
    case "strict": return "50% refund if you cancel at least 24 hours before the start; no refund after that.";
    case "non_refundable": return "Non-refundable for change of mind. Your rights under the Australian Consumer Law are not affected.";
  }
}

export function hoursUntil(start: Date | string, now = new Date()): number {
  return (new Date(start).getTime() - now.getTime()) / 3_600_000;
}
