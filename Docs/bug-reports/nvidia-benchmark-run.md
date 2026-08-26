# Bug Report — NVIDIA benchmark runs do not return results to the browser

**Status:** Bounded-latency fix implemented locally; production verification pending
**Date:** 2026-08-26  
**Area:** API run execution, NVIDIA inference, Railway networking, dashboard submission flow  
**Severity:** High — the primary benchmark workflow is not usable in production

## Summary

Uploading the benchmark CSVs starts a reconciliation run and the API begins
model inference, but the browser eventually reports:

```text
Failed to load resource: net::ERR_FAILED
```

The API does not return a completed response before the browser/Railway
connection closes. Railway permits a long-running HTTP request only while it
continues transferring data; a silent request is closed after approximately
five minutes. The current `POST /api/runs` endpoint sends no response until
the entire reconciliation batch, including all model calls and persistence,
has completed.

The backend is not entirely idle during this period. Production logs show
that NVIDIA returns proposals and that the deterministic verifier rejects
unsafe proposals. The frontend simply has no usable result until the final
batch response arrives.

## User-visible symptom

1. User uploads the bank and ledger benchmark CSVs.
2. The dashboard submits `POST /api/runs`.
3. The API logs the incoming request.
4. Model proposals and verifier rejection logs appear over several minutes.
5. The browser reports `net::ERR_FAILED` instead of receiving a run ID or
   results.

## Evidence

### Production request lifecycle

The API logged an incoming `POST /api/runs` request at approximately
`2026-08-26T14:51:01Z`.

No response was visible in the browser after nearly four minutes.

### Production model/verifier activity

The API later logged verifier activity, proving that inference was returning
proposals and the pipeline was progressing:

```text
caseId: BANK:B3337
proposedBankRecordIds: []
proposedLedgerRecordIds: ["B3337"]
failureCodes: ["UNKNOWN_RECORD", "PRIMARY_NOT_INCLUDED", "INVALID_RELATIONSHIP_SHAPE"]
```

```text
caseId: BANK:B3872
proposedBankRecordIds: ["B3872"]
proposedLedgerRecordIds: ["L2303", "L9886"]
failureCodes: ["AMOUNT_MISMATCH"]
```

Additional cases at the same time were rejected for `AMOUNT_MISMATCH`.

These are safe verifier rejections, not accepted financial matches.

### Local workload measurement

Using the real reconciliation pipeline with a fake model adapter:

```text
dev fixture:       24 results, 26 model calls, concurrency 5
benchmark fixture: 125 results, 140 model calls, concurrency 5
```

The benchmark is therefore substantially more expensive than the dev
fixture, and malformed proposals can trigger an additional repair call.

## Confirmed causes

### A. Synchronous batch execution exceeds the HTTP connection budget

The browser waits for `POST /api/runs` to finish. The API only returns after
the complete pipeline and database persistence finish:

```text
POST /api/runs
  → parse and normalize all records
  → deterministic reconciliation
  → many NVIDIA inference calls
  → verifier and finalization
  → database persistence
  → HTTP response
```

This makes a multi-minute batch dependent on a single silent HTTP connection.

### B. NVIDIA proposals are frequently invalid or financially unsafe

The model sometimes:

- places a bank ID in `ledgerRecordIds`;
- omits the primary record from the proposed relationship;
- proposes unsupported relationship shapes;
- proposes matches whose amounts do not balance.

The verifier correctly rejects these proposals and finalizes them as safe
unresolved outcomes. This protects financial correctness, but the rejection
rate and latency are not currently surfaced clearly to the user.

### C. Provider timing and retry behavior are not bounded explicitly

The NVIDIA adapter constructs the OpenAI-compatible client without explicit
timeout or retry settings. The SDK therefore supplies long default request
limits and retries. With approximately 140 calls and concurrency 5, one slow
or retrying request can keep the whole synchronous batch open for too long.

## Rejected or secondary hypotheses

### CORS is not the primary cause

The API received the `POST /api/runs` request and progressed into model
processing. A CORS preflight failure would normally prevent the browser from
issuing the request.

### The NVIDIA API key is not wholly invalid

The API received model proposals and verifier logs. A completely invalid key
would fail before proposal verification.

### The verifier is not incorrectly rejecting valid arithmetic

`AMOUNT_MISMATCH`, unknown-record, and relationship-shape failures are the
intended safety checks. The problem is that the model proposes unsafe
relationships often enough to hurt quality and latency.

## Fix plan

### Phase 1 — Make inference bounded and observable

- Configure an explicit NVIDIA request timeout.
- Configure explicit SDK retry behavior.
- Use the NVIDIA-supported structured-output mode and keep thinking disabled
  for concise JSON proposals.
- Make reasoning concurrency configurable; start production validation at
  concurrency 1 or 2.
- Log only safe operational metadata: run ID, case ID, model, attempt,
  duration, outcome, and sanitized error code.
- Never log API keys, authorization headers, prompts, or transaction data.

### Phase 2 — Improve model proposal reliability

- Add regression cases for cross-side ID confusion.
- Add regression cases for missing primary IDs.
- Add regression cases for invalid grouping and amount-mismatched matches.
- Make verifier feedback unambiguous and bounded.
- Track proposal rejection rate separately from final unresolved rate.

### Phase 3 — Decouple the batch from the browser request

Change the run lifecycle to:

```text
POST /api/runs
  → create PENDING run
  → return 202 + runId immediately

background execution
  → process deterministic and AI stages
  → persist progress/results
  → mark COMPLETED or FAILED

dashboard
  → poll GET /api/runs/:runId
  → load results when complete
```

This removes Railway's silent HTTP request limit from the critical path and
allows the UI to show `PENDING`, `PROCESSING`, `COMPLETED`, or `FAILED` with
useful progress information.

Streaming heartbeats could keep the current request alive, but an asynchronous
run is the preferred design for a batch operation and remains compatible with
the existing persisted run model.

## Regression-test plan

Tests must be written before implementation changes.

### Inference adapter tests

- request uses the supported NVIDIA JSON response format;
- thinking is disabled for structured proposals;
- timeout and retry configuration are explicit;
- provider failures become sanitized `AI_REQUEST_ERROR` values;
- malformed JSON is bounded by the repair attempt and becomes
  `AI_SCHEMA_ERROR`.

### Pipeline tests

- invalid IDs become `UNRESOLVED / VERIFICATION_FAILED`;
- missing primary records become `UNRESOLVED / VERIFICATION_FAILED`;
- amount-mismatched proposals become `UNRESOLVED / VERIFICATION_FAILED`;
- one rejected proposal does not discard other finalized cases;
- trace records the verifier failure and final case outcome.

### API lifecycle tests

- run creation returns a run ID without waiting for model completion;
- run status transitions are persisted;
- completed runs expose results and trace;
- failed runs expose an operational error without fabricating finance outcomes.

### Browser acceptance tests

- submitting benchmark data immediately shows a processing state;
- the browser does not hold one request open for the full inference duration;
- the dashboard eventually shows completed results;
- a failed run shows a retryable operational error;
- verifier-rejected cases remain inspectable as unresolved exceptions.

## Acceptance criteria

The bug is fixed when:

- the benchmark upload no longer produces `net::ERR_FAILED`;
- the initial API response returns a run ID promptly;
- the benchmark completes asynchronously and persists its final state;
- all model calls have bounded timeout/retry behavior;
- verifier rejection logs are correlated to persisted unresolved results;
- the full benchmark can be inspected from the dashboard after completion;
- no secrets or financial input contents appear in logs;
- production verification passes on Railway.

## Implementation status

The local implementation now returns `202 Accepted` with a run ID, executes
the batch in the background, persists `PROCESSING`/`COMPLETED`/`FAILED`
states, and has the dashboard poll for completion. NVIDIA and OpenAI-compatible
clients use explicit timeout and retry settings. NVIDIA uses JSON mode directly
and production reasoning concurrency is configurable, defaulting to two.

The remaining verification step is deploying this change to Railway and
running the benchmark while checking that the browser receives the initial run
ID promptly and that the persisted status reaches `COMPLETED` or a visible
`FAILED` state.

## Follow-up incident: asynchronous runs fail silently after the AI deadline

### Production evidence

For run `run_41873010-a204-4818-a6b0-1d9aabcf0aec`:

- `15:29:12Z`: `POST /api/runs` returned `202` in approximately 164 ms.
- `15:29:12Z` through `15:30:15Z`: status polling returned `200` while the
  run remained in progress.
- `15:30:17Z`: status polling returned `500 RUN_FAILED` from
  `RunService.getSummary`.
- The run therefore failed about 65 seconds after submission, matching the
  deployed 60-second AI request timeout plus orchestration overhead.
- The exported logs contain no provider failure, run-failure, or failure-
  persistence event for this run.

### Confirmed failure modes

1. A provider timeout or request error rejects an entire inference wave. The
   pipeline only converts schema errors into safe unresolved cases; an
   `AI_REQUEST_ERROR` rejects `Promise.allSettled` and fails the whole run.
2. `getSummary()` throws `RunFailedError` for a persisted failed run. The API
   turns that into HTTP 500, so the dashboard retains its previous
   `PROCESSING` summary instead of rendering `FAILED`.
3. Background failure persistence errors are swallowed. If the failure trace
   insert fails, the run can remain `PROCESSING` and the trace endpoint returns
   `TRACE_NOT_FOUND` without an explanatory server log.
4. The current production logs do not record run ID, failure code, provider
   attempt, duration, or failure-persistence outcome for background work.

### Fix acceptance criteria

- One AI timeout produces an `UNRESOLVED` case and does not discard other
  finalized cases in the same run.
- A run that cannot continue is persisted as `FAILED` and its status endpoint
  returns a normal `FAILED` summary, not a generic 500.
- Every failed run has at least a minimal persisted failure trace.
- Failure-persistence errors are logged with run ID and sanitized codes.
- A dashboard poll transitions visibly from `PROCESSING` to `FAILED`.

## Follow-up incident: bounded inference latency

### User report

After the failure-state fix was deployed, a benchmark run was stopped from
the browser after more than ten minutes without output. A second run using the
development fixture remained in `PROCESSING` for more than five minutes. The
required product limit is one to two minutes for a terminal result.

### New production evidence

- Railway migrations completed successfully before the API started; the
  database is not the current bottleneck.
- Run `run_3052c561-5532-48d3-83c8-ee63cfe0a16b` was submitted at approximately
  `15:55:05Z`. Its first `AI_REQUEST_ERROR` appeared at `15:57:29Z`, with
  additional model failures and verifier rejections continuing for several
  minutes. No terminal completion was visible in the captured logs.
- Run `run_92602423-036d-4afd-83e1-e80a85cb2729` was submitted at approximately
  `16:07:30Z` and was still being polled at `16:09:38Z`.
- Status GET requests completed in approximately 3–12 ms, so database reads,
  polling, and the API health path are not causing the multi-minute delay.
- Stopping the first browser run did not cancel its background execution. The
  server continued processing its model queue.

### Root cause

The API currently processes reasoning cases in serialized waves. Railway is
configured with `AI_REASONING_CONCURRENCY=2` and `AI_REQUEST_TIMEOUT_MS=60000`.
The pipeline waits for each wave before starting the next one, and verifier
repair can add another model request for a rejected proposal.

The resulting worst-case shape is:

```text
number of reasoning cases ÷ 2 × 60 seconds
```

Twenty reasoning cases can therefore take approximately ten minutes before
repair attempts or normal provider latency are included. A 100-case benchmark
can take substantially longer. This is why increasing the browser polling
frequency or changing the database will not solve the latency target.

### Ranked hypotheses

1. **Serialized inference waves are the primary cause.** If concurrency is
   increased and the request deadline is reduced, the same fixture should
   reach a terminal result within the target window.
2. **NVIDIA request stalls are the second cause.** If a request is bounded to a
   10–15 second timeout, one stalled provider call should produce an unresolved
   case instead of blocking a wave for 60 seconds.
3. **Verifier repair increases tail latency.** If repair attempts are counted
   and capped, rejected proposals should no longer multiply the slowest-case
   duration.
4. **The lack of cancellation causes resource contention.** If stopping a run
   cancels its server-side work, a subsequent run should not compete with the
   abandoned run for provider capacity.

### Planned change

#### Immediate production configuration

- Set `AI_REASONING_CONCURRENCY` to `8` initially, then tune against NVIDIA
  rate limits and observed latency.
- Set `AI_REQUEST_TIMEOUT_MS` to `10000`–`15000`.
- Keep `AI_MAX_RETRIES=0` while meeting the buildathon latency target.

These values are a bounded first configuration, not a guarantee that every
provider call will succeed. A timed-out or unavailable case must safely become
`UNRESOLVED`.

#### Code-level deadline and cancellation

- Add a run-level inference budget of approximately 90 seconds.
- Propagate cancellation through the run service and model adapter so queued
  and in-flight work can stop when the run is cancelled or its deadline is
  reached.
- Enforce the run budget and persist a terminal `FAILED` result with the
  sanitized code `RUN_DEADLINE_EXCEEDED` when the budget expires. This is an
  operational failure, so no partial finance result is exposed as complete.
  A later iteration can add partial-result persistence without weakening this
  safety boundary.
- Add a cancellation endpoint and a dashboard stop action that cancel server
  work rather than only stopping browser polling.
- Record per-request duration, attempt, model, outcome, and sanitized failure
  code so latency budgets can be verified from Railway logs.

#### Output and architecture

The run remains asynchronous. The dashboard continues polling the run status,
but the backend is no longer allowed to wait indefinitely for the full AI
queue. Incremental result persistence can be added after the bounded terminal
path is working; it is not required to enforce the one-to-two-minute limit.

### Latency acceptance criteria

- Dev fixtures reach a terminal `COMPLETED` or `FAILED` state within 60
  seconds under normal provider conditions.
- The benchmark reaches a terminal `FAILED` state within 120 seconds when the
  provider budget is exhausted; it must never remain `PROCESSING` indefinitely
  or expose partial finance results as complete.
- No single model request blocks longer than the configured request timeout.
- A stopped run does not continue consuming model capacity.
- The UI receives visible progress and a terminal outcome even when NVIDIA is
  slow or unavailable; the terminal error clearly distinguishes an operational
  timeout from a finance decision.

## Implementation boundary

The failure-state fix is deployed. The bounded-latency fix is implemented
locally; the remaining verification step is to apply the
database migration in Railway, deploy the API and web services, and run a real
benchmark upload while checking that the browser receives the initial run ID
promptly and that the persisted status reaches `COMPLETED` or a visible
`FAILED` state.

```text
TDD regression tests
→ implementation
→ code review
→ local full benchmark verification
→ Railway production verification
```
