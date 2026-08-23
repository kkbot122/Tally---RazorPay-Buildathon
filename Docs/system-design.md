# System Design — Finance Reconciliation Agent

## 1. Problem Statement

Finance teams reconcile bank transactions against accounting records to verify that both systems describe the same movement of money.

Straightforward transactions can usually be matched using exact references, amounts, dates, and predefined rules. A remaining set cannot be safely cleared automatically because the evidence is messy, incomplete, grouped, delayed, conflicting, or ambiguous.

The system solves one finance-ops loop:

> Process a batch of bank and ledger records, safely reconcile what can be proven, explain legitimate outstanding items, flag genuine discrepancies, and refuse to resolve cases where available evidence is insufficient.

The goal is **safe resolution**, not maximum coverage.

---

# 2. Functional Requirements

## FR1 — Accept reconciliation data

Input:

* `bank_transactions.csv`
* `ledger_transactions.csv`

One execution represents one reconciliation run.

## FR2 — Parse, validate, and normalize records

The system must:

* validate required CSV headers
* validate dates and monetary values
* reject duplicate IDs
* normalize dates
* normalize currency
* normalize references mechanically
* convert amounts to integer paise

Safe normalization includes casing, whitespace, and punctuation cleanup.

Semantic rewriting is not part of normalization.

## FR3 — Auto-match deterministic cases

Run rules in fixed order:

1. exact reference + exact amount
2. normalized reference + exact amount + date tolerance
3. exact amount + exact normalized counterparty + date tolerance + unique candidate
4. one bank record → many ledger records
5. many bank records → one ledger record

Anything that cannot be safely auto-matched becomes `NEEDS_REASONING`.

## FR4 — Generate candidates for difficult cases

For unresolved cases, generate a bounded set of plausible candidate records using deterministic signals such as:

* currency
* amount
* date proximity
* reference similarity
* counterparty similarity

Candidate generation does not produce a final match.

## FR5 — Use AI for semantic evidence reasoning

The agent may reason about:

* reference equivalence
* counterparty/entity equivalence
* transaction-description meaning
* multiple weak pieces of evidence
* contradictory semantic evidence

The agent may propose only:

* `MATCH`
* `TIMING_DIFFERENCE`
* `DISCREPANCY`
* `INSUFFICIENT_EVIDENCE`

## FR6 — Verify every AI proposal deterministically

AI never has final authority.

The verifier checks:

* record existence
* candidate membership
* amount equality / grouped totals
* currency compatibility
* transaction-direction compatibility
* date facts
* supported grouping cardinality
* maximum group size
* record uniqueness / reuse
* hard contradictions

## FR7 — Produce one final outcome per case

Every case must end in exactly one of:

### `RECONCILED`

The available evidence safely establishes the records belong together.

### `EXPLAINED_OUTSTANDING`

The record is currently unmatched but available evidence explains why this is legitimate, such as a supported timing difference.

### `DISCREPANCY`

The records appear related but contain a genuine difference that requires finance attention.

### `UNRESOLVED`

The available evidence is insufficient for a safe decision.

## FR8 — Produce batch-level metrics

The system must report:

* total cases processed
* reconciled count
* explained outstanding count
* discrepancy count
* unresolved count
* match rate
* resolution rate
* match precision
* false reconciliation count/rate
* exception accuracy
* abstention / unresolved rate
* case-type breakdown

## FR9 — Preserve evidence and execution history

For each case retain:

* original bank records
* original ledger records
* normalization details
* deterministic rule evaluations
* candidate-generation result
* agent proposal
* supporting evidence
* conflicting evidence
* verifier checks
* final outcome
* trace events

## FR10 — Evaluate against hidden ground truth

The benchmark evaluator may read `ground_truth.csv` only after reconciliation is complete.

Runtime reconciliation code must never access ground truth.

---

# 3. Non-Functional Requirements

## NFR1 — Correctness over coverage

A confidently incorrect reconciliation is worse than an honest unresolved case.

The system should prefer lower coverage with very high precision over higher match rate with unsafe matches.

## NFR2 — Explainability

Every final decision must answer:

> Why did the system reach this conclusion?

Evidence must be visible to the evaluator.

## NFR3 — Deterministic financial verification

The LLM must not be authoritative for:

* arithmetic
* date calculations
* currency checks
* amount equality
* grouped totals
* record uniqueness
* evaluation metrics

## NFR4 — Safe abstention

`UNRESOLVED` is a valid finance outcome, not a system failure.

## NFR5 — Batch throughput

The full frozen 100-case benchmark must run end-to-end without manual reconciliation.

Enterprise-scale throughput is not required for this buildathon scope.

## NFR6 — Auditability

Each result must preserve enough structured evidence to reconstruct how the final decision was reached.

## NFR7 — Reproducibility

* deterministic rules must behave identically across runs
* benchmark generation must be deterministic for a given seed
* evaluation metrics must be deterministic

## NFR8 — Ground-truth isolation

Ground truth must be physically and logically separated from runtime reconciliation.

## NFR9 — Simplicity

Do not introduce infrastructure or agent frameworks unless required by an actual system constraint.

## NFR10 — Failure separation

System failures such as OpenAI request errors, schema errors, DB errors, and invalid input must not be converted into `UNRESOLVED` finance outcomes.

---

# 4. Entities

## BankTransaction

Represents one bank-statement record.

Fields:

* `bankTxnId`
* `bookingDate`
* `valueDate`
* `amount`
* `currency`
* `direction`
* `reference`
* `counterparty`
* `description`
* `batchId`

Internally, money is stored as integer paise.

## LedgerTransaction

Represents one accounting/ledger record.

Fields:

* `ledgerTxnId`
* `accountingDate`
* `maturityDate`
* `amount`
* `currency`
* `direction`
* `reference`
* `counterparty`
* `description`
* `source`
* `batchId`

## ReconciliationRun

Represents one complete batch execution.

Fields:

* `runId`
* `status`
* `startedAt`
* `completedAt`
* `totalBankRecords`
* `totalLedgerRecords`
* run configuration / model metadata

Statuses:

* `PENDING`
* `PROCESSING`
* `COMPLETED`
* `FAILED`

## AgentProposal

Represents the AI's structured hypothesis.

Fields:

* proposed outcome
* bank record IDs
* ledger record IDs
* confidence (`HIGH | MEDIUM | LOW`)
* supporting evidence
* conflicting evidence
* concise reason

An `AgentProposal` is never the final financial result.

## VerificationResult

Represents the deterministic checks applied to an agent proposal.

May include:

* amount valid
* currency valid
* direction valid
* grouping valid
* uniqueness valid
* candidate exists
* hard conflicts
* verifier decision

## ReconciliationResult

Represents the final verified result for a case.

Fields:

* `caseId`
* bank record IDs
* ledger record IDs
* final outcome
* reason code
* evidence
* verification result

## TraceEvent

Represents something that actually happened during execution.

Examples:

* `RUN_STARTED`
* `CASE_STARTED`
* `TRANSACTION_NORMALIZED`
* `RULE_EVALUATED`
* `RULE_PASSED`
* `RULE_FAILED`
* `AUTO_RECONCILED`
* `CANDIDATES_GENERATED`
* `AGENT_STARTED`
* `AGENT_PROPOSED`
* `VERIFICATION_CHECKED`
* `CASE_FINALIZED`
* `RUN_COMPLETED`

## BenchmarkEvaluation

Stores metrics for a benchmark run.

Possible fields:

* run ID
* model
* prompt version
* reasoning configuration
* match precision
* resolution rate
* false reconciliation rate
* exception accuracy
* abstention rate
* latency
* token usage
* estimated cost
* git commit
* created timestamp

## GroundTruth

Benchmark-only evaluation entity.

Fields:

* case ID
* true bank record IDs
* true ledger record IDs
* expected outcome
* reason code
* notes

Runtime application code must never consume it.

---

# 5. API Design

## `GET /health`

Basic API health check.

Response:

```json
{
  "status": "ok"
}
```

## `GET /health/db`

Database health check.

Response:

```json
{
  "db": "ok"
}
```

## `POST /api/runs`

Creates and starts one reconciliation run.

Input:

* bank CSV
* ledger CSV

Returns:

```json
{
  "runId": "run_123",
  "status": "PROCESSING"
}
```

## `GET /api/runs/:runId`

Returns run status and batch summary.

Example:

```json
{
  "status": "COMPLETED",
  "totalCases": 100,
  "reconciled": 68,
  "explainedOutstanding": 10,
  "discrepancies": 12,
  "unresolved": 10
}
```

## `GET /api/runs/:runId/results`

Returns all final reconciliation results and supporting evidence.

## `GET /api/runs/:runId/exceptions`

Returns only:

* `DISCREPANCY`
* `UNRESOLVED`

## `GET /api/runs/:runId/events`

Returns persisted execution trace events for the run/cases.

## `POST /api/runs/:runId/evaluate`

Benchmark-only evaluation endpoint.

Compares completed results against hidden ground truth and persists metrics.

---

# 6. High-Level Design

```text
bank_transactions.csv          ledger_transactions.csv
          │                              │
          └──────────────┬───────────────┘
                         ▼
                Parser + Validator
                         │
                         ▼
                    Normalizer
                         │
                         ▼
              Deterministic Matcher
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
      AUTO_RECONCILED         NEEDS_REASONING
                                    │
                                    ▼
                            Candidate Generator
                                    │
                                    ▼
                               AI Agent
                                    │
                              proposal only
                                    │
                                    ▼
                            Deterministic Verifier
                                    │
                  ┌─────────────────┼──────────────────┐
                  ▼                 ▼                  ▼
             RECONCILED      EXPLAINED           DISCREPANCY
                              OUTSTANDING              │
                                                      ▼
                                                 UNRESOLVED
                                    │
                                    ▼
                            Results + Exceptions
                                    │
                                    ▼
                       Benchmark Evaluator (optional)
```

Persistence records:

* runs
* inputs
* agent proposals
* verification results
* final outcomes
* trace events
* benchmark evaluations

---

# 7. Deep Dive — Deterministic Rules

Rules run strongest to weakest.

## Rule 1 — Exact strong-reference match

Require:

* same currency
* exact amount
* exact reference
* compatible transaction direction
* unique candidate

## Rule 2 — Normalized-reference match

Require:

* same currency
* exact amount
* normalized reference equality
* compatible direction
* bank date within `-1/+3` days of ledger date
* unique candidate

## Rule 3 — Strong contextual match

Require:

* exact amount
* same currency
* exact normalized counterparty
* compatible direction
* date within `-1/+3`
* exactly one candidate

Semantic company-name equivalence is not allowed here.

## Rule 4 — One bank → many ledger

Support groups of 2 or 3 ledger records.

Require:

* exact sum
* same currency
* compatible direction
* valid date relationship
* strong grouping evidence such as batch/reference/counterparty

## Rule 5 — Many bank → one ledger

Inverse of Rule 4.

## Frozen deterministic constraints

* amount tolerance: none
* many↔many: out of scope
* maximum many-side group size: 3
* ambiguous matches: never auto-match
* semantic evidence: never enough for deterministic auto-match

Deterministic output:

* `AUTO_RECONCILED`
* `NEEDS_REASONING`

---

# 8. Deep Dive — Candidate Generation

The LLM must not receive the entire ledger for every unresolved bank record.

Candidate generation first narrows the search space using deterministic signals such as:

* currency compatibility
* amount proximity / equality
* date window
* lexical/reference similarity
* counterparty similarity

Requirements:

* deterministic
* bounded candidate count
* stable ordering
* reason each candidate was included

It never returns a final finance outcome.

---

# 9. Deep Dive — Agent Contract

The agent receives:

* primary transaction(s)
* candidate transaction(s)
* deterministic facts already computed

It may interpret:

* messy references
* entity-name equivalence
* transaction descriptions
* multiple weak pieces of evidence
* contradictions

Structured output:

* proposed outcome
* bank IDs
* ledger IDs
* `HIGH | MEDIUM | LOW` confidence
* evidence
* conflicting evidence
* reason

No numerical pseudo-confidence percentages.

The agent must use supplied evidence only.

---

# 10. Deep Dive — Verifier Contract

The verifier has final authority.

For proposed `MATCH`, verify:

* IDs exist
* IDs were supplied as candidates
* currency compatible
* direction compatible
* exact amount/group total
* supported cardinality
* group size ≤ 3
* records not already consumed
* no hard contradiction
* semantic difficult match has evidence beyond amount alone

For `TIMING_DIFFERENCE`:

* require real supplied date evidence
* speculation is insufficient

For `DISCREPANCY`:

* calculate amount difference deterministically
* surface unresolved financial variance

For `INSUFFICIENT_EVIDENCE`:

* preserve ambiguity rather than forcing a match

AI confidence never overrides verifier failure.

---

# 11. Deep Dive — Benchmark Design

Final benchmark:

* 100 reconciliation cases
* INR only
* ground truth generated first
* bank and ledger rows independently shuffled
* repeated amounts intentionally included
* IDs do not reveal matching pairs

Frozen distribution:

| Case Type                    |   Count |
| ---------------------------- | ------: |
| Exact matches                |      20 |
| Normalized-reference matches |      10 |
| Strong contextual matches    |      10 |
| Semantic/fuzzy matches       |      15 |
| Timing differences           |      10 |
| Grouped matches              |      15 |
| Genuine discrepancies        |      10 |
| Ambiguous / missing evidence |      10 |
| **Total**                    | **100** |

Grouped split:

* 8 one-bank → many-ledger
* 7 many-bank → one-ledger

Development fixture:

* 20 cases
* at least one of every supported category

Benchmark must not be edited simply because system performance is poor.

---

# 12. Deep Dive — Evaluation

Primary metrics:

## Match rate

How much of the batch was reconciled.

## Resolution rate

How many cases reached a defensible non-unresolved conclusion.

## Match precision

Of all records declared `RECONCILED`, how many were actually correct.

## False reconciliation rate

How often the system confidently reconciled the wrong records.

This is one of the most important safety metrics.

## Exception accuracy

How accurately the system identified genuine discrepancies and unresolved cases.

## Abstention rate

How often the system deliberately refused to make an unsafe decision.

The benchmark evaluator compares final results against hidden ground truth after the run completes.

---

# 13. Product Surfaces

## `/` — Reconciliation Dashboard

The evaluator sees:

* load benchmark / upload files
* run reconciliation
* batch status
* headline metrics
* results table
* filters by final outcome
* exception list
* case-level evidence

This page answers:

> What happened?

## `/trace` — Reconciliation Trace

Displays real execution history for a selected case.

Possible stages:

* normalization
* deterministic rule evaluations
* candidates
* agent proposal
* verifier checks
* final outcome

If a deterministic rule ends the case, later stages must not be shown.

No fake AI-thinking animation.

This page answers:

> How did the system reach this result?

## `/docs` — Engineering / Research Documentation

Contains:

* problem
* problem narrowing
* real workflow research
* frozen scope
* benchmark
* deterministic rules
* agent + verifier
* architecture
* experiments
* failures
* final results

This page answers:

> Why was the system built this way, and how do we know it works?

---

# 14. Persistence Model

PostgreSQL tables:

* `reconciliation_runs`
* `bank_transactions`
* `ledger_transactions`
* `reconciliation_results`
* `agent_proposals`
* `verification_results`
* `trace_events`
* `benchmark_evaluations`

No:

* users
* organizations
* sessions
* RBAC

---

# 15. Tech Stack

## Monorepo

* pnpm workspaces
* TypeScript

## Frontend

* Next.js
* React
* Tailwind CSS
* shadcn/ui
* Phosphor Icons
* React Flow (`@xyflow/react`)
* Motion
* Recharts
* MDX

## Backend

* Fastify
* TypeScript
* Zod
* `csv-parse`
* `p-limit`

## Data

* PostgreSQL
* Drizzle ORM
* postgres.js

## AI

* official OpenAI Node SDK
* Responses API
* GPT-5.6 Terra default model
* Structured Outputs
* Zod-backed contracts

## Testing

* Vitest
* React Testing Library
* Playwright

## Deployment

Railway:

* Next.js service
* Fastify service
* PostgreSQL

---

# 16. Explicitly Out of Scope

Do not build:

* authentication
* user accounts
* organizations
* RBAC
* real bank integrations
* Razorpay production integrations
* ERP integrations
* payment processing
* payment ↔ settlement reconciliation
* settlement Q&A
* cash forecasting
* tax matching
* invoice generation
* full accounting close
* reviewer/approval workflows
* journal-entry posting
* automatic modifications to books
* many-to-many matching
* external email/document evidence retrieval
* Redis
* Kafka
* GraphQL
* vector databases
* LangChain
* LangGraph
* CrewAI
* AutoGen
* Kubernetes

---

# 17. System Invariants

The following must always remain true:

1. currency mismatch can never reconcile
2. amount mismatch can never auto-reconcile
3. ambiguous deterministic candidates never auto-reconcile
4. reused records cannot silently participate in multiple final matches
5. group size greater than 3 is unsupported
6. many↔many is unsupported
7. AI cannot bypass the verifier
8. hallucinated record IDs cannot reconcile
9. amount-only semantic evidence is insufficient
10. ground truth is inaccessible to runtime reconciliation
11. system/API failure is not equivalent to `UNRESOLVED`
12. trace events must reflect real execution only

---

# 18. Final Design Principle

This project is not an LLM wrapper for CSV matching.

It is a **verification-first reconciliation system**:

> deterministic logic clears what can be proven, AI interprets messy evidence, and deterministic verification prevents unsafe financial conclusions.
