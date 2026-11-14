import type { StatusKey, ThemeConfig } from '@staffhub/theme-core';

export type Role = 'employee' | 'manager' | 'property_admin' | 'company_admin';
export interface PublishedTheme { config: ThemeConfig; fingerprint: string; companyVersion: number | null; propertyVersion: number | null }
export interface Me {
  user: { id: string; name: string; email: string; role: Role; appearancePref: 'light' | 'dark' | 'system' | null };
  company: { id: string; name: string; slug: string };
  property: { id: string; name: string; slug: string } | null;
  department: { id: string; name: string } | null;
  permissions: { manageBrand: boolean; approveLeave: boolean; nightAudit: boolean; nightAuditRole: 'auditor' | 'manager' | 'both' | null };
  theme: PublishedTheme;
}
export interface Leave {
  id: string; employeeId: string; employeeName: string; department: string; property: string; type: string;
  startDate: string; endDate: string; days: number; status: StatusKey; reason: string | null; decidedBy: string | null;
  canDecide: boolean; canCancel: boolean;
}
export interface Notification { id: string; kind: string; status: StatusKey | null; title: string; body: string; createdAt: string; read: boolean }
export interface Summary {
  byStatus: Record<StatusKey, number>;
  months: Array<{ month: string; approved: number; pending: number }>;
  upcoming: Array<{ id: string; employeeName: string; type: string; startDate: string; endDate: string; status: StatusKey; days: number }>;
  onLeaveToday: number; headcount: number; unreadNotifications: number;
}
export interface RosterData {
  weekStart: string; weekEnd: string; totalHours: number;
  people: Array<{ id: string; name: string; department: string; property: string }>;
  shifts: Array<{ id: string; employeeId: string; date: string; start: string; end: string; label: string; hours: number }>;
  leave: Array<{ employeeId: string; startDate: string; endDate: string; status: StatusKey }>;
}
