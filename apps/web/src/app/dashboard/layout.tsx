import type { ReactNode } from 'react';
import { DashShell } from '@/components/shell';
export default function L({ children }: { children: ReactNode }) { return <DashShell>{children}</DashShell>; }
