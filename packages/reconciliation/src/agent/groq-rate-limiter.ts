export type GroqQuotaDimension = "RPM" | "TPM" | "RPD" | "TPD";

export type GroqQuotaState = {
  minuteStartedAt: number;
  requestsInMinute: number;
  tokensInMinute: number;
  blockedUntil: number;
};

export interface GroqQuotaStateStore {
  update<T>(scope: string, operation: (state: GroqQuotaState) => { state: GroqQuotaState; result: T }): Promise<T>;
}

export type GroqRateLimit = {
  requestsPerMinute: number;
  tokensPerMinute: number;
};

export const DEFAULT_GROQ_RATE_LIMIT: GroqRateLimit = {
  requestsPerMinute: 30,
  tokensPerMinute: 8_000,
};
export const DEFAULT_GROQ_QUOTA_SCOPE = "groq:organization";

export type GroqReservation = {
  tokens: number;
  waitedMs: number;
};

const MINUTE_MS = 60_000;

/**
 * A token-aware limiter whose store operation must be atomic across replicas.
 * The API supplies a Postgres-backed store; the in-memory store is test-only.
 */
export class GroqRateLimiter {
  constructor(
    private readonly store: GroqQuotaStateStore,
    private readonly limits: GroqRateLimit,
    private readonly scope = DEFAULT_GROQ_QUOTA_SCOPE,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number, signal?: AbortSignal) => Promise<void> = delay,
  ) {}

  async reserve(tokens: number, signal?: AbortSignal): Promise<GroqReservation> {
    if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error("Groq token reservation must be a positive integer");
    if (tokens > this.limits.tokensPerMinute) throw new Error("A Groq request exceeds the configured per-minute token budget");

    let waitedMs = 0;
    for (;;) {
      throwIfAborted(signal);
      const now = this.now();
      const outcome = await this.store.update(this.scope, (stored) => {
        const state = normalize(stored, now);
        const blockedUntil = Math.max(state.blockedUntil, now);
        if (blockedUntil > now) return { state, result: { waitMs: blockedUntil - now } };
        if (state.requestsInMinute >= this.limits.requestsPerMinute || state.tokensInMinute + tokens > this.limits.tokensPerMinute) {
          return { state, result: { waitMs: Math.max(1, state.minuteStartedAt + MINUTE_MS - now) } };
        }
        return {
          state: { ...state, requestsInMinute: state.requestsInMinute + 1, tokensInMinute: state.tokensInMinute + tokens },
          result: { waitMs: 0 },
        };
      });
      if (outcome.waitMs === 0) return { tokens, waitedMs };
      waitedMs += outcome.waitMs;
      await this.wait(outcome.waitMs, signal);
    }
  }

  async blockFor(waitMs: number): Promise<void> {
    if (!Number.isFinite(waitMs) || waitMs <= 0) return;
    const now = this.now();
    await this.store.update(this.scope, (state) => ({
      state: { ...normalize(state, now), blockedUntil: Math.max(state.blockedUntil, now + waitMs) },
      result: undefined,
    }));
  }
}

export class InMemoryGroqQuotaStateStore implements GroqQuotaStateStore {
  private readonly states = new Map<string, GroqQuotaState>();

  async update<T>(scope: string, operation: (state: GroqQuotaState) => { state: GroqQuotaState; result: T }): Promise<T> {
    const outcome = operation(this.states.get(scope) ?? emptyState());
    this.states.set(scope, outcome.state);
    return outcome.result;
  }
}

function normalize(state: GroqQuotaState, now: number): GroqQuotaState {
  if (state.minuteStartedAt !== 0 && now < state.minuteStartedAt + MINUTE_MS) return state;
  return { minuteStartedAt: now, requestsInMinute: 0, tokensInMinute: 0, blockedUntil: state.blockedUntil };
}

function emptyState(): GroqQuotaState {
  return { minuteStartedAt: 0, requestsInMinute: 0, tokensInMinute: 0, blockedUntil: 0 };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}
