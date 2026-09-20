// M18 — Provider FX transparency panel for /admin/fx-rates.
//
// Hard rule enforced here: a manual value is labelled "Manual Admin Reference
// Rate" and is NEVER shown as a PayPal rate. A provider settlement rate is
// labelled as the actual rate PayPal applied. Nothing is ever fabricated — if
// no value exists we say so.
import { providerFxService } from '@/lib/services/fx/providerFxService';
import { detectQuoteCapability } from '@/lib/services/payments/paypalFx';
import { FX_UNAVAILABLE_LABEL } from '@/lib/services/fx/manualRate';
import { SectionCard, StatCard, StatusBadge, DataTable, InfoBanner, EmptyState, type Tone } from '@/components/appkit';

const STATUS_TONE: Record<string, Tone> = {
  fresh: 'success', expired: 'warning', manual_fallback: 'info', provider_unavailable: 'warning',
  unavailable: 'danger',
};
const CAP_TONE: Record<string, Tone> = {
  available: 'success', provider_limitation: 'warning', provider_unavailable: 'warning', not_configured: 'neutral',
};

export default async function FxProviderPanel() {
  const [reference, snapshots, capability] = await Promise.all([
    providerFxService.currentReference('USD', 'IDR'),
    providerFxService.listSnapshots(25),
    detectQuoteCapability('USD', 'IDR').catch(() => null),
  ]);

  // M18.1 — a non-finite/non-positive value is NEVER rendered (this is where
  // "1 USD = ∞ IDR" used to surface). It degrades to the unavailable label.
  const rateNum = reference.rate_value === null ? NaN : Number(reference.rate_value);
  const usable = Number.isFinite(rateNum) && rateNum > 0;
  const display = usable
    ? `1 ${reference.base_currency} = ${rateNum.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${reference.quote_currency}`
    : FX_UNAVAILABLE_LABEL;

  return (
    <div className="mb-8 space-y-4" data-testid="fx-provider-panel">
      <SectionCard title="Current FX reference" description="Provider data is preferred when it genuinely exists; otherwise the manual admin rate is used and labelled as such.">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Reference" value={<span className="text-lg" data-testid="fx-current-display">{display}</span>} />
          <StatCard label="Source" value={<span className="text-base" data-testid="fx-source-label">{reference.source_label}</span>} hint={`source key: ${reference.source}`} />
          <StatCard
            label="Status"
            value={<StatusBadge tone={STATUS_TONE[reference.status] || 'neutral'} testId="fx-status">{reference.status_label}</StatusBadge>}
            hint={reference.provider_environment ? `environment: ${reference.provider_environment}` : undefined}
          />
        </div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Quoted / effective at</dt><dd className="font-medium">{reference.effective_at ? new Date(reference.effective_at).toLocaleString() : '—'}</dd></div>
          <div><dt className="text-muted-foreground">Expires at</dt><dd className="font-medium">{reference.expires_at ? new Date(reference.expires_at).toLocaleString() : 'n/a'}</dd></div>
          <div><dt className="text-muted-foreground">Provider</dt><dd className="font-medium">{reference.provider || '—'}</dd></div>
          <div><dt className="text-muted-foreground">Provider FX reference</dt><dd className="font-medium" data-testid="fx-provider-ref">{reference.provider_reference_masked || '—'}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground" data-testid="fx-reference-note">{reference.note}</p>
      </SectionCard>

      <SectionCard title="PayPal pre-transaction quote capability" description="Read-only probe. WaveLead never invents an FX value when the provider does not supply one.">
        {capability ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={CAP_TONE[capability.status] || 'neutral'} testId="fx-capability-status">
                {capability.status === 'available' ? 'AVAILABLE' : capability.status === 'provider_limitation' ? 'PROVIDER LIMITATION' : capability.status.replace(/_/g, ' ').toUpperCase()}
              </StatusBadge>
              <span className="text-xs text-muted-foreground">
                {capability.provider_environment ? `PayPal ${capability.provider_environment}` : 'environment unknown'}
                {capability.http_status ? ` · HTTP ${capability.http_status}` : ''}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{capability.reason}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Capability could not be probed. No rate was derived.</p>
        )}
        <div className="mt-3">
          <InfoBanner>
            PayPal&rsquo;s quote-exchange-rates API requires an approved FX-as-a-Service contract. Until PayPal enables it for this
            merchant account, pre-transaction quoting stays unavailable and the manual admin reference rate is the explicit fallback.
            Actual settlement rates below are still captured from real transactions.
          </InfoBanner>
        </div>
      </SectionCard>

      <SectionCard title="Actual provider FX snapshots" description="Append-only audit facts taken from real provider payloads. Historical records are never rewritten by a later rate.">
        {snapshots.length === 0 ? (
          <EmptyState title="No provider FX observed yet" description="A settlement rate is stored automatically whenever PayPal returns one on a real capture, refund or payout (absent for same-currency transactions)." />
        ) : (
          <DataTable head={['Rate', 'Source', 'Pair', 'Observed', 'Environment', 'Provider reference', 'Payload path']} testId="fx-snapshot-table">
            {snapshots.map((s) => (
              <tr key={s.id} className="hover:bg-muted/40">
                <td className="px-3 py-2.5 tabular-nums">{s.rate_value}</td>
                <td className="px-3 py-2.5"><StatusBadge tone={s.source === 'provider_settlement' ? 'success' : 'info'}>{providerFxService.FX_SOURCE_LABELS[s.source]}</StatusBadge></td>
                <td className="px-3 py-2.5 text-xs">{s.source_currency} → {s.target_currency}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.observed_at ? new Date(s.observed_at).toLocaleString() : '—'}</td>
                <td className="px-3 py-2.5 text-xs">{s.provider_environment || '—'}</td>
                <td className="px-3 py-2.5 text-xs">{s.provider_object_id ? `${String(s.provider_object_id).slice(0, 4)}***` : '—'}</td>
                <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{s.provider_payload_path}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}
