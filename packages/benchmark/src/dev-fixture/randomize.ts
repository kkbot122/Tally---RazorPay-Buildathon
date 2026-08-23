import { createRandomSource } from "../generator/random.js";

export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const random = createRandomSource(seed);
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = random.integer(0, index);
    [output[index], output[swapIndex]] = [output[swapIndex]!, output[index]!];
  }
  return output;
}
