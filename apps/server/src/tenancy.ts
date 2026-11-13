import type { Ctx } from './auth.ts';

/**
 * Row-visibility predicates. Each returns a SQL fragment + params that ALWAYS begins with the caller's
 * company, so a query built from these can never return another tenant's rows, whatever the role.
 *
 *   company_admin   → whole company
 *   property_admin  → their property
 *   manager         → their department (plus themselves)
 *   employee        → themselves
 */
export interface Scope { sql: string; params: unknown[] }

export function leaveScope(ctx: Ctx, a = 'l'): Scope {
  switch (ctx.role) {
    case 'company_admin': return { sql: `${a}.company_id = ?`, params: [ctx.companyId] };
    case 'property_admin': return { sql: `${a}.company_id = ? AND ${a}.property_id = ?`, params: [ctx.companyId, ctx.propertyId] };
    case 'manager': return { sql: `${a}.company_id = ? AND (${a}.department_id = ? OR ${a}.employee_id = ?)`, params: [ctx.companyId, ctx.departmentId, ctx.userId] };
    default: return { sql: `${a}.company_id = ? AND ${a}.employee_id = ?`, params: [ctx.companyId, ctx.userId] };
  }
}

export function employeeScope(ctx: Ctx, a = 'u'): Scope {
  switch (ctx.role) {
    case 'company_admin': return { sql: `${a}.company_id = ?`, params: [ctx.companyId] };
    case 'property_admin': return { sql: `${a}.company_id = ? AND ${a}.property_id = ?`, params: [ctx.companyId, ctx.propertyId] };
    case 'manager': return { sql: `${a}.company_id = ? AND ${a}.department_id = ?`, params: [ctx.companyId, ctx.departmentId] };
    default: return { sql: `${a}.company_id = ? AND ${a}.id = ?`, params: [ctx.companyId, ctx.userId] };
  }
}

/** Roster is a shared document: staff see their own department's rota so they can swap shifts. */
export function rosterScope(ctx: Ctx, a = 's'): Scope {
  switch (ctx.role) {
    case 'company_admin': return { sql: `${a}.company_id = ?`, params: [ctx.companyId] };
    case 'property_admin': return { sql: `${a}.company_id = ? AND ${a}.property_id = ?`, params: [ctx.companyId, ctx.propertyId] };
    default: return { sql: `${a}.company_id = ? AND ${a}.department_id = ?`, params: [ctx.companyId, ctx.departmentId] };
  }
}

export const isAdmin = (ctx: Ctx) => ctx.role === 'company_admin' || ctx.role === 'property_admin';
export const canApprove = (ctx: Ctx) => ctx.role !== 'employee';
