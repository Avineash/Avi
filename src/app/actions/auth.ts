"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, clientIp } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/rbac";
import { registerCustomer, registerPartner, verifyLogin } from "@/lib/domain/accounts";
import { DomainError } from "@/lib/errors";
import { checked, parse, run, type Result } from "./_util";

const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") ? n : null);

export async function loginAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const d = parse(z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Enter your password"), next: z.string().optional() }), fd);
    const u = await verifyLogin(d.email, d.password, await clientIp());
    await createSession(u.id, u.role);
    redirect(safeNext(d.next) ?? homeFor(u.role));
  });
}

export async function registerAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const d = parse(z.object({ name: z.string().min(2, "Enter your name"), email: z.string().email("Enter a valid email"), password: z.string(), phone: z.string().optional(), next: z.string().optional() }), fd);
    if (!checked(fd, "terms")) throw new DomainError("INVALID", "Please accept the Terms and Privacy Policy to continue");
    const u = await registerCustomer({ ...d, marketing: checked(fd, "marketing"), ip: await clientIp() });
    await createSession(u.id, "customer");
    redirect(safeNext(d.next) ?? "/account");
  });
}

export async function registerPartnerAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const d = parse(z.object({
      name: z.string().min(2, "Enter your name"), email: z.string().email(), password: z.string(), businessName: z.string().min(2, "Enter your business name"),
      abn: z.string().min(11, "Enter your 11-digit ABN"), category: z.enum(["hotel", "restaurant", "event"]), contactPhone: z.string().optional(), website: z.string().optional(), description: z.string().optional(),
      docType: z.enum(["abn_certificate", "business_licence", "liquor_licence", "insurance", "id_document", "other"]),
    }), fd);
    if (!checked(fd, "terms")) throw new DomainError("INVALID", "Please accept the Partner Agreement");
    const files = fd.getAll("docs").filter((f): f is File => f instanceof File && f.size > 0);
    const docs = await Promise.all(files.map(async (f) => ({ docType: d.docType, fileName: f.name.slice(0, 120), mimeType: f.type, content: Buffer.from(await f.arrayBuffer()) })));
    const r = await registerPartner({ ...d, gstRegistered: checked(fd, "gst"), docs, ip: await clientIp() });
    await createSession(r.userId, "partner");
    redirect("/partner");
  });
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
