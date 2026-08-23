export function normalizeReference(reference: string | null): string | null {
  if (reference === null) return null;

  const normalized = reference.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length > 0 ? normalized : null;
}
