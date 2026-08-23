export type ParsedBankTransaction = {
  bankTxnId: string;
  bookingDate: string;
  valueDate: string;
  amount: string;
  currency: string;
  direction: "CREDIT" | "DEBIT";
  reference: string | null;
  counterparty: string | null;
  description: string | null;
  batchId: string | null;
};

export type ParsedLedgerTransaction = {
  ledgerTxnId: string;
  accountingDate: string;
  maturityDate: string | null;
  amount: string;
  currency: string;
  direction: "CREDIT" | "DEBIT";
  reference: string | null;
  counterparty: string | null;
  description: string | null;
  source: string;
  batchId: string | null;
};
