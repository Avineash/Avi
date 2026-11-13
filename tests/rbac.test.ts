import { describe, expect, it } from "vitest";
import { can, homeFor, PORTAL_PREFIX } from "@/lib/auth/rbac";

describe("role-based access control", () => {
  it("customers cannot reach partner or admin capabilities", () => {
    for (const p of ["partner:portal", "partner:buyback", "admin:portal", "admin:finance", "admin:config"] as const) expect(can("customer", p)).toBe(false);
  });
  it("partners cannot reach admin or customer-booking capabilities", () => {
    for (const p of ["admin:portal", "admin:partners", "admin:buyback_approval", "customer:book"] as const) expect(can("partner", p)).toBe(false);
  });
  it("only admins can approve exceptional buybacks and change configuration", () => {
    expect(can("admin", "admin:buyback_approval")).toBe(true);
    expect(can("admin", "admin:config")).toBe(true);
    expect(can("partner", "admin:config")).toBe(false);
  });
  it("portal prefixes and home routes line up with roles", () => {
    expect(PORTAL_PREFIX["/admin"]).toEqual(["admin"]);
    expect(PORTAL_PREFIX["/partner"]).toEqual(["partner"]);
    expect(homeFor("partner")).toBe("/partner");
  });
});
