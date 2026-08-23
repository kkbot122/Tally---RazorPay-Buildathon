# TASKS.md — Finance Reconciliation Agent

Implement tasks **strictly in order**.

Work on one task at a time.

After each task:

1. run its pass criteria;
2. provide the mandatory AGENTS.md completion debrief;
3. stop;
4. wait for explicit instruction before starting the next task.

Do not implement future tasks early.

---

# Phase A — Repository Foundation

## T001 — Bootstrap the monorepo

### Goal

Create the repository structure and shared TypeScript workspace.

### Create

```text
apps/
  web/
  api/

packages/
  contracts/
  reconciliation/
  benchmark/

data/
  dev/
  benchmark/

docs/
```

Configure:

* pnpm workspaces
* root TypeScript configuration
* shared package scripts
* Next.js app
* Fastify package skeleton
* empty TypeScript package exports

### Expected files

Primarily:

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
apps/web/*
apps/api/package.json
packages/contracts/package.json
packages/reconciliation/package.json
packages/benchmark/package.json
```

### Context7

Required:

* Next.js project setup
* Fastify TypeScript setup
* pnpm workspaces if needed

Use versions compatible with the frozen stack.

### Do not implement

* database
* API routes beyond framework bootstrap
* reconciliation logic
* OpenAI
* frontend design

### Pass criteria

```bash
pnpm install
pnpm -r typecheck
```

must succeed.

Next.js must boot.

Fastify must boot without application routes.

### Manual test

Run both development services and confirm neither crashes.

---

## T002 — Define shared domain contracts

### Goal

Create the canonical TypeScript/Zod contracts used across the system.

### Implement

Schemas/types for:

```text
BankTransaction
LedgerTransaction

FinalOutcome
ReasonCode

AgentProposedOutcome
AgentConfidence
AgentEvidence
AgentProposal

VerificationResult
ReconciliationResult

TraceEventType
TraceEvent
```

Final outcomes:

```text
RECONCILED
EXPLAINED_OUTSTANDING
DISCREPANCY
UNRESOLVED
```

Agent proposals:

```text
MATCH
TIMING_DIFFERENCE
DISCREPANCY
INSUFFICIENT_EVIDENCE
```

### Expected files

Only:

```text
packages/contracts/src/*
packages/contracts/index.ts
```

plus focused tests.

### Context7

Required:

* Zod current APIs

### Do not implement

* business logic
* database schemas
* OpenAI calls

### Pass criteria

Tests prove:

* valid objects parse;
* invalid enums fail;
* malformed transactions fail;
* agent output requires evidence/conflicting evidence fields;
* exports compile from another workspace package.

---

## T003 — Fastify health and environment configuration

### Goal

Create a minimal, reliable API process.

### Implement

```http
GET /health
```

returns:

```json
{
  "status": "ok"
}
```

Add validated environment configuration.

Expected variables should include placeholders for:

```text
PORT
DATABASE_URL
OPENAI_API_KEY
OPENAI_MODEL
WEB_ORIGIN
```

Create `.env.example`.

### Expected files

Primarily:

```text
apps/api/src/server.ts
apps/api/src/app.ts
apps/api/src/config/*
apps/api/.env.example
```

### Context7

Required:

* Fastify server/plugin patterns
* Zod environment validation

### Do not implement

* PostgreSQL connection
* reconciliation routes
* OpenAI calls

### Pass criteria

Automated API test:

```text
GET /health → 200
```

with:

```json
{"status":"ok"}
```

Invalid required production configuration must fail clearly.

### Manual test

Start API and call:

```bash
curl http://localhost:<port>/health
```

---

## T004 — PostgreSQL + Drizzle connection

### Goal

Connect the Fastify API to PostgreSQL without creating application tables yet.

### Implement

* postgres.js connection
* Drizzle client
* migration configuration
* DB lifecycle handling

Add:

```http
GET /health/db
```

Expected:

```json
{
  "db": "ok"
}
```

### Context7

Required:

* Drizzle PostgreSQL setup
* postgres.js connection usage
* Fastify shutdown hooks

### Do not implement

* reconciliation tables
* repositories
* business logic

### Pass criteria

With PostgreSQL running:

```text
GET /health/db → 200 {"db":"ok"}
```

With an invalid DB connection:

* request fails cleanly;
* API does not fake success.

---

## T005 — Create persistence schema

### Goal

Create only the tables required by the frozen system.

### Tables

```text
reconciliation_runs

bank_transactions

ledger_transactions

reconciliation_results

agent_proposals

verification_results

trace_events

benchmark_evaluations
```

Do not add:

```text
users
organizations
roles
sessions
```

### Required behavior

Use explicit IDs and foreign keys.

Preserve enough data to reconstruct:

```text
input
→ agent proposal
→ verification
→ final result
→ trace
```

### Context7

Required:

* Drizzle schema APIs
* PostgreSQL JSON/JSONB guidance where used
* migrations

### Pass criteria

* migration applies to empty DB;
* migration is reversible or cleanly reproducible in development;
* FK relationships work;
* TypeScript schema compiles;
* no ground-truth table is accessible to runtime code.

---

# Phase B — Benchmark Foundation

## T006 — Implement CSV parsing and validation

### Goal

Convert uploaded/raw CSV text into validated domain records.

### Implement

Bank CSV columns:

```text
bank_txn_id
booking_date
value_date
amount
currency
direction
reference
counterparty
description
batch_id
```

Ledger CSV columns:

```text
ledger_txn_id
accounting_date
maturity_date
amount
currency
direction
reference
counterparty
description
source
batch_id
```

### Requirements

* reject malformed headers;
* reject invalid dates;
* reject invalid monetary values;
* reject duplicate IDs inside one file;
* produce useful row-level errors.

### Context7

Required:

* `csv-parse`
* Zod parsing patterns if needed

### Pass criteria

Tests cover:

* valid bank CSV;
* valid ledger CSV;
* missing header;
* invalid amount;
* invalid date;
* duplicate IDs;
* blank optional fields.

No reconciliation logic yet.

---

## T007 — Build truth-first benchmark case model

### Goal

Define the generator's internal representation of a reconciliation case.

### Implement

A benchmark case must first describe the true financial relationship:

```text
case ID
true bank record IDs
true ledger record IDs
expected outcome
reason code
```

Then generate bank/ledger representations from that truth.

### Supported benchmark categories

```text
EXACT
NORMALIZED_REFERENCE
STRONG_CONTEXT
SEMANTIC
TIMING
GROUPED_ONE_TO_MANY
GROUPED_MANY_TO_ONE
DISCREPANCY
AMBIGUOUS
NO_CANDIDATE
```

### Expected files

Only:

```text
packages/benchmark/src/generator/*
```

plus tests.

### Context7

Not required.

### Pass criteria

Tests prove:

* truth exists before derived records;
* generated IDs are unique;
* many-side group size never exceeds 3;
* generated cases have deterministic output when supplied the same seed.

---

## T008 — Generate the 20-case development fixture

### Goal

Create a small human-readable dataset for engine development.

### Produce

```text
data/dev/bank_transactions.csv
data/dev/ledger_transactions.csv
data/dev/ground_truth.csv
```

Exactly:

```text
20 reconciliation cases
```

Include at least one example of every supported category.

### Requirements

* independently shuffle bank rows;
* independently shuffle ledger rows;
* IDs must not reveal matches;
* repeated amounts must exist;
* no real customer data;
* INR only.

### Context7

Not required.

### Pass criteria

Automated benchmark validation proves:

* 20 truth cases;
* every referenced record exists when expected;
* no invalid grouping;
* no duplicate IDs;
* all final outcomes represented;
* parser from T006 accepts both input CSVs.

### Manual test

Inspect the three CSVs manually and verify that matches are not trivially aligned by row or ID.

---

# Phase C — Deterministic Reconciliation Engine

## T009 — Implement normalization

### Goal

Implement safe mechanical normalization only.

### Implement

```text
normalizeReference()
normalizeCounterpartyForExactComparison()
parseMoneyToPaise()
normalizeCurrency()
normalizeDate()
```

Reference normalization may handle:

* casing
* whitespace
* common separators/punctuation

It must not perform semantic interpretation.

### Context7

Not required.

### Pass criteria

Tests cover:

```text
INV-881 → INV881
INV_881 → INV881
" inv 881 " → INV881
inr → INR
12450.00 → 1245000n
```

and edge cases.

No fuzzy matching.

---

## T010 — Implement hard compatibility checks

### Goal

Prevent impossible pairs from becoming candidates for deterministic matching.

### Implement checks for:

* currency compatibility
* transaction direction compatibility
* record reuse
* record existence

### Context7

Not required.

### Pass criteria

Tests prove:

* INR cannot match USD;
* incompatible directions fail;
* already-used records cannot be reused;
* compatible records continue to matching.

---

## T011 — Implement Rule 1: exact reference match

### Goal

Auto-reconcile the strongest 1:1 case.

### Require

```text
same currency
exact amount
exact reference
compatible direction
unique candidate
```

### Output

```text
AUTO_RECONCILED
```

or no match.

### Context7

Not required.

### Pass criteria

Tests cover:

* valid exact match;
* amount mismatch;
* currency mismatch;
* duplicate valid candidates;
* reused record.

Ambiguity must never select the first row.

---

## T012 — Implement Rule 2: normalized reference match

### Goal

Match mechanical reference-format differences.

### Require

```text
same currency
exact amount
normalized reference equality
compatible direction
date tolerance -1/+3
unique candidate
```

### Context7

Not required.

### Pass criteria

Tests cover:

```text
INV-881 ↔ INV881
```

within tolerance and failures:

* outside tolerance;
* multiple valid candidates;
* different amount.

---

## T013 — Implement Rule 3: strong contextual match

### Goal

Handle unique objective matches without a usable reference.

### Require

```text
exact amount
same currency
exact normalized counterparty
compatible direction
date tolerance -1/+3
exactly one candidate
```

### Context7

Not required.

### Pass criteria

Tests prove:

* one valid contextual candidate auto-reconciles;
* two equivalent candidates produce no auto-match;
* semantically similar but non-identical counterparties do not auto-match.

---

## T014 — Implement one-bank → many-ledger matching

### Goal

Support groups of 2 or 3 ledger records explaining one bank record.

### Require

* exact total amount;
* same currency;
* compatible directions;
* maximum 3 ledger records;
* strong grouping evidence;
* valid dates.

Useful grouping fields:

```text
batch_id
reference
counterparty
```

### Context7

Not required.

### Pass criteria

Tests cover:

```text
10000 ↔ 4000 + 3000 + 3000
```

and failures:

* accidental equal sum with no grouping evidence;
* four-record group;
* currency mismatch;
* ambiguous valid groups.

---

## T015 — Implement many-bank → one-ledger matching

### Goal

Implement the inverse supported grouping.

### Requirements

Same invariants as T014.

### Context7

Not required.

### Pass criteria

Tests cover:

* valid 2→1;
* valid 3→1;
* invalid >3 group;
* ambiguous group;
* exact total required.

---

## T016 — Deterministic matcher orchestration

### Goal

Run deterministic rules in frozen priority order.

### Order

```text
R1
→ R2
→ R3
→ R4
→ R5
```

### Output per case

Either:

```text
AUTO_RECONCILED
```

or:

```text
NEEDS_REASONING
```

with reason metadata.

### Trace

Emit actual events:

```text
RULE_EVALUATED
RULE_PASSED
RULE_FAILED
AUTO_RECONCILED
```

### Context7

Not required.

### Pass criteria

Run the 20-case fixture.

Verify:

* deterministic cases are resolved;
* semantic/ambiguous/discrepancy cases remain;
* no AI is involved;
* emitted rule order matches frozen order.

---

# Phase D — Candidate Generation + AI

## T017 — Implement candidate generation

### Goal

Reduce unresolved cases to a small relevant ledger/bank candidate set before AI.

### Candidate signals

May use broad filters around:

* currency
* amount
* date
* reference similarity
* counterparty similarity

Candidate generation must not produce a final match.

### Requirements

* deterministic;
* bounded candidate count;
* stable ordering;
* explain why each candidate was admitted.

### Context7

Not required unless introducing a new similarity library.

Do not add embeddings/vector DB.

### Pass criteria

Tests prove:

* true semantic match survives candidate filtering;
* unrelated records are largely excluded;
* ambiguous equal candidates remain;
* zero-candidate situations remain valid;
* deterministic ordering.

---

## T018 — Implement OpenAI agent adapter

### Goal

Create the external AI boundary without yet wiring the full reconciliation pipeline.

### Implement

Input:

```text
primary transaction
candidate records
deterministic facts
```

Structured output:

```text
proposedOutcome
bankRecordIds
ledgerRecordIds
confidence
evidence
conflictingEvidence
reason
```

Use:

* official OpenAI Node SDK
* Responses API
* Structured Outputs
* Zod validation
* model configured via environment

### Context7

Required.

First attempt current OpenAI SDK docs through Context7.

If unavailable, use official OpenAI developer docs and state the fallback in the debrief.

Do not use LangChain/LangGraph.

### Pass criteria

Using a mocked OpenAI client:

* valid response parses;
* malformed output fails safely;
* unknown record IDs remain detectable downstream;
* API failure is surfaced as `AI_REQUEST_ERROR`;
* schema failure is surfaced as `AI_SCHEMA_ERROR`.

No verifier yet.

---

## T019 — Implement the reconciliation reasoning prompt

### Goal

Define the precise agent behavior for difficult cases.

### Agent may propose

```text
MATCH
TIMING_DIFFERENCE
DISCREPANCY
INSUFFICIENT_EVIDENCE
```

### Prompt requirements

Explicitly instruct the model:

* use supplied evidence only;
* do not invent records;
* do not perform authoritative arithmetic;
* consider conflicting evidence;
* amount equality alone is insufficient;
* ambiguity should produce insufficient evidence;
* confidence is HIGH/MEDIUM/LOW only.

### Context7

Required for current Structured Outputs invocation only if T018 did not already establish it.

### Pass criteria

Using a fixed mocked/replayable set of agent responses:

* semantic match proposal validates;
* timing proposal validates;
* discrepancy proposal validates;
* abstention validates;
* evidence and conflicting evidence are always present.

Keep actual live-model tests separate from unit tests.

---

# Phase E — Deterministic Verification

## T020 — Implement match verifier

### Goal

Independently verify AI `MATCH` proposals.

### Verify

* records exist;
* candidate IDs were actually supplied;
* currency compatible;
* direction compatible;
* exact amount/group total;
* supported cardinality;
* maximum group size;
* records unused;
* no hard contradiction;
* semantic difficult match has additional non-amount evidence.

### Context7

Not required.

### Pass criteria

Tests prove:

* valid semantic proposal passes;
* hallucinated ID fails;
* wrong amount fails;
* reused record fails;
* unsupported many↔many fails;
* amount-only proposal fails;
* `HIGH` AI confidence cannot override failure.

---

## T021 — Implement non-match outcome verification

### Goal

Verify:

```text
TIMING_DIFFERENCE
DISCREPANCY
INSUFFICIENT_EVIDENCE
```

### Timing

Require actual supplied date evidence.

### Discrepancy

Calculate differences deterministically.

### Insufficient evidence

Allow legitimate ambiguity/absence without forcing a result.

### Context7

Not required.

### Pass criteria

Tests cover:

* supported timing → `EXPLAINED_OUTSTANDING`;
* speculative timing → `UNRESOLVED`;
* confirmed amount difference → `DISCREPANCY`;
* equally plausible candidates → `UNRESOLVED`;
* no candidate → `UNRESOLVED`.

---

# Phase F — Full Engine

## T022 — Implement trace recorder

### Goal

Provide one shared trace mechanism used by every pipeline stage.

### Events

Support at least:

```text
RUN_STARTED
CASE_STARTED
TRANSACTION_NORMALIZED
RULE_EVALUATED
RULE_PASSED
RULE_FAILED
CANDIDATES_GENERATED
AGENT_STARTED
AGENT_PROPOSED
VERIFICATION_CHECKED
CASE_FINALIZED
RUN_COMPLETED
```

### Requirements

Each event includes:

```text
runId
caseId when applicable
event type
timestamp/order
structured payload
```

### Context7

Not required.

### Pass criteria

Unit test a known case and assert the exact emitted execution sequence.

No frontend yet.

---

## T023 — Implement end-to-end reconciliation pipeline

### Goal

Connect:

```text
parse
→ normalize
→ deterministic matcher
→ candidates
→ agent
→ verifier
→ final outcome
```

### Requirements

* deterministic cases must never call AI;
* AI cases must always pass through verifier;
* errors must not become finance outcomes;
* trace every real stage;
* each case ends in exactly one final outcome.

### Context7

Not required.

### Pass criteria

Run the 20-case fixture through a mocked AI adapter.

Assert:

* all 20 cases terminate;
* no duplicate record consumption;
* deterministic cases use zero AI calls;
* AI proposals cannot bypass verifier;
* results match fixture expectations for configured mock responses.

---

## T024 — Add controlled AI concurrency

### Goal

Allow multiple reasoning cases without uncontrolled parallel API calls.

### Implement

Use:

```text
p-limit
```

Default concurrency:

```text
5
```

Make configurable.

### Capture

Per AI request where available:

```text
latency
model
token usage
```

### Context7

Required:

* `p-limit`
* OpenAI response usage fields if needed

### Pass criteria

Mock 20 AI cases.

Verify:

* no more than configured concurrency executes simultaneously;
* one failed request does not corrupt unrelated cases;
* metrics are collected consistently.

---

# Phase G — Persistence + API

## T025 — Implement reconciliation run persistence

### Goal

Persist one complete run.

### Persist

* uploaded/input records
* run state
* final results
* agent proposals
* verification results
* trace events

### Run status

At minimum:

```text
PENDING
PROCESSING
COMPLETED
FAILED
```

### Context7

Required:

* Drizzle transaction/query APIs as needed

### Pass criteria

Integration test:

1. create run;
2. process fixture;
3. reload from PostgreSQL;
4. reconstruct results and trace;
5. confirm agent/verifier information remains available.

---

## T026 — Implement run API

### Goal

Expose the frozen API surface.

### Implement

```http
POST /api/runs
GET  /api/runs/:runId
GET  /api/runs/:runId/results
GET  /api/runs/:runId/exceptions
GET  /api/runs/:runId/events
```

`POST /api/runs` accepts the two CSV inputs.

Exceptions endpoint returns only:

```text
DISCREPANCY
UNRESOLVED
```

### Context7

Required:

* Fastify multipart/file upload
* response schema APIs where used

### Pass criteria

API integration tests cover:

* valid run;
* malformed CSV;
* unknown run;
* completed run summary;
* results retrieval;
* exception filtering;
* trace retrieval.

---

# Phase H — Benchmark + Evaluation

## T027 — Generate the frozen 100-case benchmark

### Goal

Produce the final benchmark exactly once from the generator.

### Case distribution

```text
20 Exact
10 Normalized reference
10 Strong contextual
15 Semantic/fuzzy
10 Timing
15 Grouped
10 Genuine discrepancy
10 Ambiguous/missing
-------------------------
100 cases
```

Grouped split:

```text
8 one-bank → many-ledger
7 many-bank → one-ledger
```

### Requirements

* INR only;
* no real customer data;
* independent row shuffling;
* repeated amounts;
* IDs do not reveal matches;
* ground truth generated first.

### Context7

Not required.

### Pass criteria

Benchmark validation proves every frozen constraint.

Once validated, treat the benchmark as immutable.

Do not edit cases merely because model performance is poor.

---

## T028 — Implement benchmark evaluator

### Goal

Compare finished results against hidden truth.

### Metrics

Implement:

```text
match rate
resolution rate
match precision
false reconciliation count
false reconciliation rate
exception accuracy
unresolved count
abstention rate
case-type breakdown
```

### Isolation

Only:

```text
packages/benchmark
```

may read benchmark ground truth during evaluation.

The reconciliation engine must not receive it.

### Context7

Not required.

### Pass criteria

Use handcrafted result sets where metrics are known mathematically.

Assert exact expected values.

---

## T029 — Add evaluation endpoint and experiment persistence

### Goal

Persist benchmark run comparisons.

### Implement

```http
POST /api/runs/:runId/evaluate
```

Benchmark evaluation record should capture:

```text
runId
model
promptVersion
reasoningEffort/config
matchPrecision
resolutionRate
falseMatchRate
exceptionAccuracy
latency
token usage
estimatedCost if implemented
git commit/hash if available
createdAt
```

### Context7

Required only for any version-sensitive OpenAI usage metadata fields.

### Pass criteria

A benchmark run can be:

```text
processed
→ evaluated
→ persisted
→ retrieved
```

without exposing ground truth to the reconciliation pipeline.

---

# Phase I — Frontend

> **DESIGN GATE**
>
> Do not begin T030–T033 until `design.md` exists.
>
> At the beginning of every frontend task, read `design.md` fully.
>
> Its visual requirements are authoritative.

---

## T030 — Build reconciliation dashboard shell

### Goal

Implement `/` according to `design.md`.

### UI responsibilities

* load benchmark or upload CSVs;
* start run;
* show processing/completed state;
* display headline metrics;
* no fake metrics.

### Data

Wire to real API.

Do not hardcode reconciliation results.

### Context7

Required:

* Next.js App Router patterns
* shadcn/ui components actually used
* Tailwind APIs as needed

Read `design.md` first.

### Pass criteria

From browser:

1. load benchmark/upload files;
2. start reconciliation;
3. see real run status;
4. completed metrics render from API.

---

## T031 — Build results and evidence inspection

### Goal

Complete the main dashboard workflow.

### Implement

Results table with filtering:

```text
All
Reconciled
Explained Outstanding
Discrepancies
Unresolved
```

Case detail shows:

* bank records;
* ledger records;
* final outcome;
* reason;
* evidence;
* conflicting evidence;
* verifier checks.

### Context7

Required for UI component APIs.

Read `design.md`.

### Pass criteria

Manual browser test:

* filters work;
* selecting a row shows correct evidence;
* difficult and unresolved cases display meaningfully;
* no chain-of-thought is displayed.

---

## T032 — Build `/trace`

### Goal

Visualize actual execution for a selected case.

### Use

* React Flow
* Motion only where useful

### Visualize

```text
Normalize
Rules
Candidates
Agent
Verifier
Outcome
```

but only stages actually present in persisted trace events.

### Requirements

An exact Rule 1 match must not display fake agent/verifier activity.

An agent case must show:

* failed/passed rule history;
* generated candidates;
* agent proposal;
* verifier checks;
* final outcome.

### Context7

Required:

* current `@xyflow/react`
* Motion APIs used

Read `design.md`.

### Pass criteria

Test three real cases:

1. deterministic match;
2. agent-assisted match;
3. unresolved ambiguity.

Each trace must differ according to actual execution.

---

## T033 — Build `/docs`

### Goal

Create the documentation experience defined by the product scope.

### Content sections

At minimum:

```text
Problem
Problem Narrowing
Real Workflow Research
Frozen Scope
Benchmark
Deterministic Rules
Agent + Verifier
Architecture
Experiments
Failures
Final Results
```

Use MDX/content files rather than hardcoding giant page components.

### Important

Do not invent experiment results.

If an experiment has not been run, mark it accordingly.

Research claims should preserve their source links.

### Context7

Required:

* Next.js MDX integration
* any documentation component library only if already approved

Do not introduce a large docs framework unless necessary.

Read `design.md`.

### Pass criteria

Every frozen design decision is represented accurately.

Experiment/failure sections support adding real results later without redesigning the page.

---

# Phase J — Testing and Final Validation

## T034 — Core engine invariant test suite

### Goal

Strengthen tests around the project's most important safety properties.

### Required invariants

```text
currency mismatch never reconciles

amount mismatch never auto-reconciles

ambiguous deterministic candidates never auto-reconcile

record reuse never succeeds

group size >3 never succeeds

many↔many never succeeds

AI proposal cannot bypass verifier

hallucinated IDs cannot reconcile

amount-only semantic evidence cannot reconcile

ground truth is inaccessible to runtime
```

### Context7

Not required.

### Pass criteria

All invariants have explicit tests and pass.

---

## T035 — Browser E2E tests

### Goal

Test the evaluator-facing workflow.

### Required Playwright flows

#### Flow 1

```text
load benchmark
→ run reconciliation
→ results appear
```

#### Flow 2

```text
open difficult reconciled case
→ evidence visible
→ verifier visible
```

#### Flow 3

```text
open unresolved case
→ abstention reason visible
```

#### Flow 4

```text
open /trace
→ trace reflects actual execution
```

### Context7

Required:

* Playwright current test APIs

### Pass criteria

All four flows pass against local web + API + PostgreSQL.

---

## T036 — Error and resilience pass

### Goal

Ensure operational failures never masquerade as finance conclusions.

### Test

* malformed CSV;
* database failure;
* OpenAI request failure;
* malformed AI structured output;
* run failure;
* missing trace;
* unknown case/run.

### Requirement

Differentiate system errors from:

```text
UNRESOLVED
```

### Context7

Use only for framework-specific error handling where needed.

### Pass criteria

Every failure path has:

* correct HTTP/status behavior;
* useful error message;
* no fake reconciliation outcome;
* no leaked secret.

---

# Phase K — Deployment

## T037 — Railway deployment configuration

### Goal

Deploy the actual system.

### Services

```text
web
api
postgresql
```

Configure:

* environment variables;
* migrations;
* CORS/origin;
* production build commands;
* health checks.

### Context7

Required if Railway documentation is available through configured documentation tooling; otherwise use official Railway documentation.

### Pass criteria

Public deployment allows:

```text
open web
→ run benchmark
→ receive completed reconciliation
→ inspect result
→ inspect trace
→ open docs
```

No localhost dependencies.

---

# Phase L — Final Benchmark + Documentation

## T038 — Run and record deterministic baseline

### Goal

Measure the system **without AI reasoning**.

Record:

```text
match rate
resolution rate
match precision
false matches
case-type breakdown
```

### Requirement

Do not alter benchmark afterward based on the result.

### Pass criteria

Baseline evaluation is persisted and available for documentation.

---

## T039 — Run final agent + verifier benchmark

### Goal

Run the complete production pipeline against the frozen benchmark.

Record:

```text
match rate
resolution rate
match precision
false reconciliation rate
exception accuracy
abstention rate
latency
token usage
```

### Requirement

Do not manually correct individual outputs.

This must be a genuine full-batch run.

### Pass criteria

All 100 cases receive terminal results or explicit system failures.

Evaluation persists successfully.

---

## T040 — Document experiments and failures

### Goal

Populate `/docs` with what actually happened during development.

Include real cases such as:

* rule approaches that were too loose;
* false reconciliations;
* prompt failures;
* verifier catches;
* grouping problems;
* model failures;
* benchmark regressions;
* changes made because of those failures.

Do not manufacture failures for storytelling.

### Pass criteria

Every documented experiment/failure can be traced to:

* code/version;
* benchmark run;
* test;
* or recorded development observation.

---

## T041 — Final submission audit

### Goal

Verify the project matches the original Buildathon problem and frozen scope.

### Audit

Confirm:

```text
100-case batch works

match rate reported

measured accuracy reported

honest exceptions shown

ground truth remains hidden

AI proposals are verified

trace uses real events

/docs reflects real experiments

no out-of-scope product surface exists
```

Check:

```text
/
 /trace
 /docs
```

and nothing unnecessary.

### Pass criteria

Run:

```bash
pnpm -r typecheck
pnpm -r test
```

plus Playwright suite.

Perform one fresh end-to-end benchmark run.

No critical failures.

---

# Definition of Done

The project is finished when an evaluator can:

```text
1. Open the application.

2. Run the frozen 100-case reconciliation benchmark.

3. See how many records were safely reconciled.

4. See measured accuracy against hidden truth.

5. Inspect discrepancies and unresolved exceptions.

6. Open a difficult result and understand its evidence.

7. Open /trace and see the real execution path.

8. Open /docs and understand:
   - why this problem was chosen;
   - how the solution was narrowed;
   - how the benchmark was designed;
   - what failed;
   - how the final system improved.
```

The project should demonstrate one principle clearly:

> **The system does not maximize how often AI makes a decision. It maximizes how often a financial decision can be safely verified.**
