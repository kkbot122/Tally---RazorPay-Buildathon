import { createIdFactory } from "./ids.js";
import { CASE_BUILDERS } from "./cases.js";
import { createRandomSource } from "./random.js";
import { validateBenchmarkCase } from "./validate-case.js";
import type { BenchmarkGenerator, GenerateCaseInput } from "./types.js";

export function createBenchmarkGenerator(options: { seed: number }): BenchmarkGenerator {
  const context = { random: createRandomSource(options.seed), ids: createIdFactory(options.seed) };
  const generatedCaseIds = new Set<string>();

  return {
    generateCase(input: GenerateCaseInput) {
      if (generatedCaseIds.has(input.caseId)) {
        throw new Error(`Duplicate benchmark case ID "${input.caseId}"`);
      }
      generatedCaseIds.add(input.caseId);
      const builder = CASE_BUILDERS[input.category];
      return validateBenchmarkCase(builder(context, input.caseId));
    },
  };
}

export function generateBenchmarkCase(options: { seed: number } & GenerateCaseInput) {
  return createBenchmarkGenerator({ seed: options.seed }).generateCase({ caseId: options.caseId, category: options.category });
}

export { validateBenchmarkCase } from "./validate-case.js";
export type {
  BenchmarkCase,
  BenchmarkCaseCategory,
  BenchmarkGenerator,
  BenchmarkTruth,
  GenerateCaseInput,
  TrueFinancialEvent,
} from "./types.js";
export { BENCHMARK_AS_OF_DATE } from "./types.js";
