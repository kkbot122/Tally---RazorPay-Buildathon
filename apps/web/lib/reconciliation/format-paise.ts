export function formatPaise(amountDeltaPaise: string): string {
  const value = amountDeltaPaise.trim();
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "").replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(unsigned)) return `${amountDeltaPaise} paise`;

  const grouped = unsigned.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped} paise`;
}
