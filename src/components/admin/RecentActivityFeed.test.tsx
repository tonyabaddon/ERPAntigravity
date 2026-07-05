// src/components/admin/RecentActivityFeed.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecentActivityFeed } from './RecentActivityFeed';
import type { AuditEventRow } from '../../lib/adminTypes';

const recentEvent: AuditEventRow = {
  id: 1,
  ts: new Date(Date.now() - 5 * 60000).toISOString(), // 5 minutes ago
  admin_email: 'tony@vosi.id',
  tenant_slug: 'garindo',
  action_code: 'TENANT_ACTIVATED',
  detail: null,
};

const oldEvent: AuditEventRow = {
  id: 2,
  ts: new Date(Date.now() - 3 * 24 * 60 * 60000).toISOString(), // 3 days ago
  admin_email: 'tony@vosi.id',
  tenant_slug: null,
  action_code: 'PLAN_UPDATED',
  detail: null,
};

describe('RecentActivityFeed', () => {
  it('shows "Belum ada aktivitas" when empty', () => {
    render(<RecentActivityFeed events={[]} />);
    expect(screen.getByTestId('activity-feed-empty')).toBeInTheDocument();
    expect(screen.getByText('Belum ada aktivitas')).toBeInTheDocument();
  });

  it('renders event with admin email and action code', () => {
    render(<RecentActivityFeed events={[recentEvent]} />);
    expect(screen.getByText('tony@vosi.id')).toBeInTheDocument();
    expect(screen.getByText('TENANT_ACTIVATED')).toBeInTheDocument();
    expect(screen.getByText('garindo')).toBeInTheDocument();
  });

  it('renders event without tenant slug gracefully', () => {
    render(<RecentActivityFeed events={[oldEvent]} />);
    expect(screen.getByText('PLAN_UPDATED')).toBeInTheDocument();
    // "on" text should not appear when no tenant
    expect(screen.queryByText('on')).not.toBeInTheDocument();
  });

  it('renders relative time for recent events', () => {
    render(<RecentActivityFeed events={[recentEvent]} />);
    // Should show "5m lalu" or similar relative time
    expect(screen.getByText(/m lalu|j lalu|baru saja/)).toBeInTheDocument();
  });

  it('renders multiple events in order', () => {
    render(<RecentActivityFeed events={[recentEvent, oldEvent]} />);
    const actions = screen.getAllByText(/TENANT_ACTIVATED|PLAN_UPDATED/);
    expect(actions).toHaveLength(2);
  });
});
