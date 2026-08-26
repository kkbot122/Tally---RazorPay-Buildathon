# Specification — Gemini reasoning provider for reconciliation

**Status:** Implemented locally; production verification pending
**Date:** 2026-08-26
**Scope:** Replace the failing NVIDIA reasoning integration for ambiguous bank-to-books cases

## Problem Statement

The reconciliation application correctly resolves many cases with deterministic
rules, but ambiguous cases are delegated to NVIDIA inference. In production,
those requests have produced repeated `AI_REQUEST_ERROR` failures. The run can
now finish quickly, but the ambiguous cases become unresolved fallbacks instead
of receiving an AI proposal.

The project needs a provider that is fast enough for the buildathon workflow,
supports reliable structured output, and fits the existing architecture:
deterministic rules identify cases needing reasoning, an AI agent proposes an
outcome, and the deterministic verifier remains authoritative.

## Solution

Add Google Gemini as the reasoning provider, using Gemini 2.5 Flash-Lite for
ambiguous reconciliation cases. The provider will return a proposal conforming
to the existing agent contract through structured JSON output. The existing
deterministic pipeline, candidate generation, verifier, trace model, metrics,
run deadline, and safe unresolved fallback remain in place.

The application will select Gemini through provider configuration. Provider
errors will remain operational errors and will be observable with sanitized
diagnostics. No AI proposal will bypass verification, and no AI call will be
made for cases already resolved deterministically.

## User Stories

1. As a finance operator, I want obvious bank-to-books matches resolved without an AI call, so that runs remain fast and predictable.
2. As a finance operator, I want ambiguous cases sent to Gemini, so that weak references, counterparties, descriptions, and timing evidence can be interpreted.
3. As a finance operator, I want Gemini to receive only the primary record, bounded candidates, deterministic facts, and run context, so that it cannot invent hidden records.
4. As a finance operator, I want Gemini to return a fixed structured proposal, so that downstream code can validate it consistently.
5. As a finance operator, I want the verifier to approve or reject every Gemini proposal, so that a plausible-sounding model response cannot create an unsafe reconciliation.
6. As a finance operator, I want rejected or malformed Gemini output represented as unresolved, so that uncertain cases are visible rather than silently matched.
7. As a finance operator, I want timing differences and discrepancies preserved as distinct outcomes, so that legitimate outstanding items are not confused with financial errors.
8. As a finance operator, I want AI reasoning disabled or minimized for this structured extraction task, so that the provider spends its budget producing a concise proposal.
9. As a finance operator, I want each AI request bounded by a timeout, so that one slow provider call cannot stall the entire run.
10. As a finance operator, I want a run-level deadline, so that a large benchmark always reaches a terminal state.
11. As a finance operator, I want a stopped run to cancel in-flight Gemini work, so that abandoned runs do not consume provider capacity.
12. As a finance operator, I want provider failures classified as timeout, rate limit, validation, authentication, or server errors, so that I know what action to take.
13. As a finance operator, I want request duration and outcome visible in sanitized logs, so that latency can be measured without exposing keys or transaction contents.
14. As a finance operator, I want a trace showing when a case entered Gemini reasoning, what proposal was produced, and how the verifier decided, so that the result is auditable.
15. As a finance operator, I want deterministic matches to retain their existing evidence and precision, so that changing providers does not alter trusted finance logic.
16. As a finance operator, I want ambiguous cases evaluated against the frozen benchmark truth, so that provider quality is measured rather than assumed.
17. As a buildathon operator, I want the 100-case benchmark to finish within two minutes under normal provider conditions, so that the demo is usable.
18. As a buildathon operator, I want the system to degrade safely when the free tier is unavailable or rate-limited, so that the UI receives a clear terminal outcome.
19. As a developer, I want provider selection behind the existing model-adapter interface, so that provider-specific code does not leak into reconciliation rules.
20. As a developer, I want provider configuration validated at startup, so that an invalid model or missing credential fails clearly before a run is submitted.
21. As a developer, I want the Gemini adapter tested at its public proposal boundary, so that request and response contract regressions are caught without depending on live network access.
22. As a developer, I want the existing NVIDIA path retained until Gemini passes the benchmark comparison, so that rollback is straightforward.

## Implementation Decisions

- Add a Gemini reasoning adapter implementing the existing `ReasoningModelAdapter` interface.
- Prefer the native Google GenAI SDK for structured output and schema control rather than relying on an OpenAI compatibility layer for provider-specific features.
- Use Gemini 2.5 Flash-Lite as the initial model. The model name remains configurable.
- Request one concise JSON proposal using the existing agent proposal schema. The provider schema must represent the allowed outcomes, record ID arrays, confidence, evidence, conflicting evidence, and reason.
- Configure structured output with JSON Schema and validate the returned object again with the existing runtime schema.
- Disable extended thinking for the initial implementation. The task is bounded evidence classification, not open-ended investigation.
- Preserve the existing prompt rules: the model may interpret semantic evidence but may not perform authoritative arithmetic, date calculations, grouped totals, currency checks, or uniqueness checks.
- Preserve the existing candidate cap and candidate metadata. Gemini receives no ground truth and no dataset-wide hidden context.
- Pass cancellation through the SDK request options, never as a field in the provider request body.
- Normalize provider exceptions into the existing typed adapter error boundary while retaining sanitized diagnostic metadata: provider, HTTP status when available, provider error category, model, attempt, and duration.
- Keep retries disabled initially. A schema-repair attempt may be retained only if it fits inside the run deadline and is counted as another provider request.
- Keep the run-level deadline and per-request timeout. A deadline or cancellation must stop new provider calls and cancel in-flight calls.
- Preserve the deterministic verifier as the sole authority for final finance outcomes.
- Keep the current safe fallback behavior: a provider failure becomes an unresolved case with an operational reason, never a fabricated match.
- Add provider configuration validation for the Gemini API credential, provider name, model, timeout, concurrency, and run deadline.
- Keep NVIDIA configuration available for rollback during the comparison period.
- Do not change database entities or migrations for the provider switch. Existing run, result, and trace persistence is sufficient.
- Do not change the public dashboard result taxonomy. The dashboard may expose a clearer provider failure reason through existing operational error presentation.
- Use a conservative initial Gemini concurrency and tune it using measured latency and rate-limit responses rather than assuming the free tier can sustain benchmark-wide parallelism.

## Testing Decisions

- The primary seam is the public reasoning-adapter `generateProposal` boundary. Tests provide a known ambiguous input and assert a schema-valid proposal, request configuration, cancellation propagation, and typed error normalization.
- A provider adapter test must not call the live Gemini service. It uses a fake transport or SDK client and verifies externally observable request and response behavior.
- Add a pipeline-level test showing that deterministic cases do not call the adapter and ambiguous cases do call it exactly once unless a bounded repair is explicitly required.
- Add a verifier integration test showing that a valid Gemini proposal is still rejected when it violates candidate membership, relationship shape, or amount rules.
- Add a failure-path test showing that Gemini request failure yields an unresolved case and a visible operational trace event without crashing the whole batch.
- Add cancellation and deadline tests showing that the adapter receives an abort signal and no new model calls begin after cancellation.
- Add configuration tests for the Gemini provider defaults, invalid credentials/configuration, model override, timeout, and concurrency.
- Add a benchmark comparison using the frozen ground truth. Compare deterministic outcomes separately from AI-dependent outcomes, measuring precision, unresolved rate, latency, and provider failures.
- Retain all existing parsing, deterministic, verifier, trace, API, and dashboard tests. The provider migration must not weaken their contracts.
- Run typechecking after each implementation slice, focused adapter tests during development, and the complete workspace suite plus production build before commit.

## Out of Scope

- Redesigning the reconciliation algorithm or deterministic rules.
- Replacing the verifier with Gemini or any other model.
- Sending the complete CSV or hidden ground truth to Gemini.
- Adding autonomous finance actions, journal posting, payment initiation, or database mutation based solely on model output.
- Building a general-purpose multi-agent framework.
- Supporting streaming model output in the dashboard.
- Guaranteeing unlimited free-tier throughput or a provider SLA.
- Treating a provider timeout as a finance conclusion.
- Frontend visual overhaul beyond displaying existing run progress and operational errors.
- Production-scale queue infrastructure, worker autoscaling, or incremental result persistence in this iteration.

## Further Notes

Gemini's free tier is suitable for buildathon validation but may have quotas,
rate limits, and data-use terms that are not appropriate for sensitive financial
production data. The initial deployment should use synthetic benchmark data only.

The migration is successful only when a production-like run demonstrates that
AI-dependent cases produce actual Gemini proposals, those proposals appear in
the trace, the verifier determines the final outcome, and the benchmark remains
within the latency budget. A fast run containing only unresolved fallbacks does
not count as a successful provider migration.

The comparison must distinguish three outcomes: deterministic correctness,
successful AI-assisted resolution, and safe unresolved fallback. This prevents
latency improvements from being mistaken for improved reconciliation quality.
