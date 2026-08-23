import { createRandomSource } from "./random.js";

export function createIdFactory(seed: number) {
  const bankRandom = createRandomSource(seed ^ 0x13579bdf);
  const ledgerRandom = createRandomSource(seed ^ 0x2468ace0);
  const bankIds = new Set<number>();
  const ledgerIds = new Set<number>();

  function next(random: ReturnType<typeof createRandomSource>, used: Set<number>, prefix: string): string {
    let value = random.integer(1000, 9999);
    while (used.has(value)) value = random.integer(1000, 9999);
    used.add(value);
    return `${prefix}${String(value).padStart(4, "0")}`;
  }

  return {
    nextBankId() {
      return next(bankRandom, bankIds, "B");
    },
    nextLedgerId() {
      return next(ledgerRandom, ledgerIds, "L");
    },
  };
}
