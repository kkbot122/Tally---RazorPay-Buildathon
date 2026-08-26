# Bug Report — NVIDIA benchmark runs do not return results to the browser

**Status:** Implemented locally; production verification pending  
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

## Implementation boundary

This report intentionally does not change application code. The next phase is:

```text
TDD regression tests
→ implementation
→ code review
→ local full benchmark verification
→ Railway production verification
```
