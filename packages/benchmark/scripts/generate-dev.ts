import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildDevFixture } from "../src/dev-fixture/index.js";

const outputDirectory = resolve(process.cwd(), "../../data/dev");
const fixture = buildDevFixture();
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "bank_transactions.csv"), fixture.bankCsv);
writeFileSync(resolve(outputDirectory, "ledger_transactions.csv"), fixture.ledgerCsv);
writeFileSync(resolve(outputDirectory, "ground_truth.csv"), fixture.groundTruthCsv);
console.log(`Generated 20-case development fixture in ${outputDirectory}`);
