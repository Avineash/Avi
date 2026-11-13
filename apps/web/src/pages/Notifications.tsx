import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, NotificationItem } from '@staffhub/ui';
import { api } from '../api.ts';
import { timeAgo } from '../format.ts';
import type { Notification } from '../types.ts';

export function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const load = () => api.get<{ notifications: Notification[] }>('/api/notifications').then((r) => setItems(r.notifications));
  useEffect(() => { void load(); }, []);
  return (
    <Card title="Notifications" actions={<Button size="sm" variant="secondary" icon="check" onClick={async () => { await api.post('/api/notifications/read-all'); await load(); }}>Mark all read</Button>} flush>
      {items === null ? <p className="ds-muted" style={{ padding: 20 }} role="status">Loading…</p> : items.length === 0 ? <EmptyState title="All caught up" /> : (
        <ul className="ds-notes">{items.map((n) => <NotificationItem key={n.id} status={n.status} title={n.title} body={n.body} time={timeAgo(n.createdAt)} unread={!n.read} />)}</ul>
      )}
    </Card>
  );
}
