// M04 CSV Export.
// Three exports (Overview / Acquisition / Search Terms) reconciled against
// the SAME rollups the dashboard reads from. Never emits raw events or
// private identifiers.
import type { Actor, Channel } from '@/lib/types';
import { analyticsService } from './analyticsService';
import { channelRepo } from '../repositories/channelRepo';
import { HttpError } from '../auth/rbac';

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const head = headers.join(',');
  const body = rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

export function safeSlug(input: string): string {
  return String(input || 'channel').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'channel';
}

async function requireChannel(actor: Actor | null, channelId: string): Promise<Channel> {
  return analyticsService.requireChannelOwnerOrAdmin(actor, channelId);
}

export type ExportKind = 'overview' | 'acquisition' | 'search-terms';

export const analyticsCsvService = {
  async build(actor: Actor | null, channelId: string, kind: ExportKind, input: { window?: string; from?: string; to?: string } = {}) {
    const channel = await requireChannel(actor, channelId);
    if (kind === 'overview') {
      const t = await analyticsService.timeseries(actor, channelId, input);
      const headers = [
        'date','discovery_impressions','search_impressions','profile_views','unique_profile_views',
        'follow_clicks','unique_follow_intents','discovery_profile_ctr','profile_follow_ctr',
      ];
      const rows = t.series.map((r) => ({
        ...r,
        discovery_profile_ctr: r.discovery_profile_ctr ?? '',
        profile_follow_ctr: r.profile_follow_ctr ?? '',
      }));
      return {
        filename: `wavelead-${safeSlug(channel.slug)}-overview-${t.window.fromKey}-to-${t.window.toKey}.csv`,
        csv: toCsv(rows, headers),
      };
    }
    if (kind === 'acquisition') {
      const s = await analyticsService.sources(actor, channelId, input);
      const headers = [
        'source','label','impressions','profile_views','unique_profile_views',
        'follow_clicks','unique_follow_intents','profile_follow_ctr',
      ];
      const rows = s.items.map((r) => ({
        ...r,
        profile_follow_ctr: r.profile_follow_ctr ?? '',
      }));
      return {
        filename: `wavelead-${safeSlug(channel.slug)}-acquisition-${s.window.fromKey}-to-${s.window.toKey}.csv`,
        csv: toCsv(rows, headers),
      };
    }
    if (kind === 'search-terms') {
      const d = await analyticsService.discovery(actor, channelId, input);
      const headers = [
        'search_query','impressions','profile_views','unique_profile_views',
        'follow_clicks','unique_follow_intents','profile_follow_ctr',
      ];
      const rows = d.items.map((r) => ({
        ...r,
        profile_follow_ctr: r.profile_follow_ctr ?? '',
      }));
      return {
        filename: `wavelead-${safeSlug(channel.slug)}-search-terms-${d.window.fromKey}-to-${d.window.toKey}.csv`,
        csv: toCsv(rows, headers),
      };
    }
    throw new HttpError(400, 'Unknown export kind');
  },
};
