import { normalizeCurrency } from "../normalization/index.js";

export function areCurrenciesCompatible(bankCurrency: string, ledgerCurrency: string): boolean {
  return normalizeCurrency(bankCurrency) === normalizeCurrency(ledgerCurrency);
}
