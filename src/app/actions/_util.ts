import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { ZodError, type ZodType } from "zod";
import { isDomainError } from "@/lib/errors";

export type Result = { ok?: string; error?: string } | null;

/** Wraps a server action body: domain errors become inline messages, redirects pass through, anything else is logged. */
export async function run(fn: () => Promise<string | void>): Promise<Result> {
  try {
    const msg = await fn();
    revalidatePath("/", "layout");
    return { ok: msg || "Saved." };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (isDomainError(e)) return { error: e.message };
    if (e instanceof ZodError) return { error: e.issues[0]?.message ?? "Please check the form and try again." };
    console.error("[action error]", e);
    return { error: "Something went wrong on our side. Please try again." };
  }
}

export function parse<T>(schema: ZodType<T>, fd: FormData): T {
  return schema.parse(Object.fromEntries(fd.entries()));
}
/** "123.45" → 12345. Empty → null. */
export function dollarsToCents(v: unknown): number | null {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
export const checked = (fd: FormData, name: string) => fd.get(name) === "on" || fd.get(name) === "true";
