import type { Sql } from "postgres";
import type { GroqQuotaState, GroqQuotaStateStore } from "@tally/reconciliation";

const EMPTY_STATE: GroqQuotaState = { minuteStartedAt: 0, requestsInMinute: 0, tokensInMinute: 0, blockedUntil: 0 };

/**
 * A Postgres transaction advisory lock makes each quota state transition atomic
 * for every Railway replica that shares this database.
 */
export class PostgresGroqQuotaStateStore implements GroqQuotaStateStore {
  constructor(private readonly sql: Sql) {}

  async update<T>(scope: string, operation: (state: GroqQuotaState) => { state: GroqQuotaState; result: T }): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${scope}))`;
      const rows = await tx<{ minuteStartedAt: Date; requestsInMinute: number; tokensInMinute: number; blockedUntil: Date | null }[]>`
        select minute_started_at as "minuteStartedAt", requests_in_minute as "requestsInMinute", tokens_in_minute as "tokensInMinute", blocked_until as "blockedUntil"
        from groq_quota_state where scope = ${scope}`;
      const row = rows[0];
      const state = row === undefined
        ? EMPTY_STATE
        : {
            minuteStartedAt: row.minuteStartedAt.getTime(),
            requestsInMinute: row.requestsInMinute,
            tokensInMinute: row.tokensInMinute,
            blockedUntil: row.blockedUntil?.getTime() ?? 0,
          };
      const outcome = operation(state);
      await tx`
        insert into groq_quota_state (scope, minute_started_at, requests_in_minute, tokens_in_minute, blocked_until, updated_at)
        values (${scope}, ${new Date(outcome.state.minuteStartedAt)}, ${outcome.state.requestsInMinute}, ${outcome.state.tokensInMinute}, ${outcome.state.blockedUntil === 0 ? null : new Date(outcome.state.blockedUntil)}, now())
        on conflict (scope) do update set
          minute_started_at = excluded.minute_started_at,
          requests_in_minute = excluded.requests_in_minute,
          tokens_in_minute = excluded.tokens_in_minute,
          blocked_until = excluded.blocked_until,
          updated_at = excluded.updated_at`;
      return outcome.result;
    }) as Promise<T>;
  }
}
