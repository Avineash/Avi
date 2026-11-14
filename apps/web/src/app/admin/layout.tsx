import type { ReactNode } from 'react';
import { AdminShell } from '@/components/shell';
export default function L({ children }: { children: ReactNode }) { return <AdminShell>{children}</AdminShell>; }
