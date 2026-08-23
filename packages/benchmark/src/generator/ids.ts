export function createIdFactory() {
  let bankCounter = 1000;
  let ledgerCounter = 5000;

  return {
    nextBankId() {
      bankCounter += 1;
      return `B${String(bankCounter).padStart(4, "0")}`;
    },
    nextLedgerId() {
      ledgerCounter += 1;
      return `L${String(ledgerCounter).padStart(4, "0")}`;
    },
  };
}
