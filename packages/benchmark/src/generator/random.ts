export type RandomSource = {
  next(): number;
  integer(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
};

export function createRandomSource(seed: number): RandomSource {
  let state = (seed | 0) || 1;

  return {
    next() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4_294_967_296;
    },
    integer(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error("Cannot pick from an empty collection");
      }
      return items[this.integer(0, items.length - 1)] as T;
    },
  };
}
