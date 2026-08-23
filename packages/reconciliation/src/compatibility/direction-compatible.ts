type CashFlowDirection = "CREDIT" | "DEBIT";

// The synthetic benchmark uses CREDIT for inflows and DEBIT for outflows on both sides.
// These are cash-flow labels, not double-entry accounting transformations.
export function areDirectionsCompatible(
  bankDirection: CashFlowDirection,
  ledgerDirection: CashFlowDirection,
): boolean {
  return bankDirection === ledgerDirection;
}
