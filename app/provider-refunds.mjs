// Provider-confirmed terminal failures are free, per Higgsfield's billing policy.
// Never call this with a local processing status in place of the provider state.
export function releaseProviderFailure(state, record, provider, holdRecord = record) {
 if (!['failed', 'nsfw', 'canceled'].includes(provider?.status)) return false;
 if (record.reconciliation || holdRecord.reservationReleased) return false;
 const hold = holdRecord.reservedUsd ?? record.quote?.reservedUsd ?? record.hold ?? 0;
 if (!Number.isFinite(hold) || hold < 0 || !Number.isFinite(state.spend.reserved) || state.spend.reserved + 1e-8 < hold) throw new Error('Billing reservation mismatch; no funds released');
 state.spend.reserved = Math.max(0, Math.round((state.spend.reserved - hold) * 1e8) / 1e8);
 holdRecord.reservationReleased = true;
 if ('hold' in record) record.hold = 0;
 record.reconciliation = {actualUsd: 0, outcome: provider.status, requestId: provider.requestId,
  releasedUsd: hold, at: new Date().toISOString(), evidence: 'Provider terminal outcome; https://docs.higgsfield.ai/docs/concepts/billing-and-retention'};
 record.billing = 'Provider confirmed no charge; budget reservation released';
 return true;
}
