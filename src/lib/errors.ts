export type ErrorCode =
  | "NOT_FOUND" | "FORBIDDEN" | "UNAUTHENTICATED" | "INVALID" | "CONFLICT"
  | "SOLD_OUT" | "EXPIRED" | "PAYMENT_FAILED" | "NOT_ELIGIBLE" | "RATE_LIMITED"
  | "FEATURE_DISABLED" | "CONFIG" | "PROVIDER";

/** Errors safe to show to the end user. Anything else is logged and shown as a generic failure. */
export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = "DomainError";
  }
}
export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
