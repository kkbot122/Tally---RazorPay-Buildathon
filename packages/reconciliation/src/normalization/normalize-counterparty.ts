export function normalizeCounterpartyForExactComparison(counterparty: string | null): string | null {
  if (counterparty === null) return null;

  const normalized = counterparty.trim().replace(/\s+/g, " ").toUpperCase();
  return normalized.length > 0 ? normalized : null;
}
