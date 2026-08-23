# Decisions — Finance Reconciliation Agent

This document records the project decisions, reasoning, tradeoffs, scope boundaries, and frozen implementation assumptions made before coding.

Its purpose is to prevent scope drift and preserve the thought process behind the system.

---

# 1. Buildathon Track Selection

Chosen track:

> **AI Finance Controller — Run the books and the cash position**

The track asks for an agent that closes one finance-ops loop over a 50+ record synthetic batch, reports match rate, and surfaces exceptions it could not resolve.

The track examples include:

* multi-source reconciliation
* settlement Q&A
* forward cash forecasting
* tax-line matching

The judging bar emphasizes:

* throughput
* measured accuracy
* honest exceptions
* verification rather than generation alone

## Decision

Choose **multi-source reconciliation**.

## Why

Compared with the other directions, reconciliation gives the strongest combination of:

* real operational pain
* clear ROI
* measurable correctness
* technical depth
* explainability
* natural exception handling

It also aligns strongly with the track's emphasis on verification.

---

# 2. What “finance task” Means

A finance task in this context is a repetitive operational job performed over financial records.

Examples:

* checking whether records from two systems match
* understanding whether settlement money arrived
* forecasting future cash
* assigning transactions to tax lines

The chosen task is reconciliation.

---

# 3. Reconciliation Definition

Working definition:

> Reconciliation means checking whether different systems that recorded the same movement of money tell the same story.

A record is reconciled when sufficient evidence establishes that the records correspond correctly.

An unreconciled record does not automatically mean something is wrong. It means the relationship has not yet been safely established.

---

# 4. Reconciliation Layers Considered

The full payment-to-books chain was decomposed into four conceptual layers:

1. business order ↔ payment-provider payment
2. payment transactions ↔ settlement
3. settlement ↔ bank deposit
4. bank activity ↔ accounting books

These are not necessarily four named departments or formal stages in every company. They are a useful decomposition of the reconciliation problem.

---

# 5. Layer 1 — Order ↔ Payment

Typical relationship:

* business order
* payment-provider order/payment

Strong shared IDs often exist.

## Decision

Do not make this the core project.

## Reason

This relationship is important but structurally simpler when integrations preserve explicit order/payment identifiers.

---

# 6. Layer 2 — Payments ↔ Settlement

Typical workflow:

* gather payment/refund/chargeback/fee/tax events
* identify which settlement they belong to
* reconstruct expected payout
* compare with actual settlement

This layer has many-to-one financial relationships and real complexity.

## Important finding

A lot of straightforward payment/settlement reconciliation is already supported by payment-provider settlement reports and products.

## Decision

Do not make Layer 2 the final project boundary.

## Reason

A simple “upload payment CSV + settlement CSV and reconcile” project risks recreating an already mature product category.

---

# 7. Layer 3 — Settlement ↔ Bank

Typical workflow:

* provider emits settlement
* settlement has a trace/reference such as UTR
* bank receives corresponding credit
* finance verifies the reference and amount

## Decision

Do not make this the core project.

## Reason

The normal happy path often has a strong common identifier and relatively direct matching.

---

# 8. Layer 4 — Bank ↔ Books

Typical workflow:

* load bank and ledger records
* run automatic matching rules
* easy matches disappear
* finance works on remaining suggested/unmatched items
* remaining items may become:

  * confirmed matches
  * legitimate supported/outstanding items
  * discrepancies/adjustments
  * unresolved items

## Decision

Choose **Bank ↔ Books** as the reconciliation boundary.

## Why

This layer has the richest documented human workflow and the strongest need for evidence-based exception resolution.

---

# 9. Core Problem Narrowing

The project was deliberately narrowed through this chain:

```text
AI Finance Controller
        ↓
Finance operations
        ↓
Reconciliation
        ↓
Bank ↔ Books
        ↓
Easy matches vs exception queue
        ↓
Evidence-based exception resolution
```

The project is not simply “match CSV rows.”

The real problem is:

> Given a batch of bank transactions and accounting records, determine which records can be safely reconciled using available evidence, classify explainable exceptions, and refuse to resolve records where evidence is insufficient.

---

# 10. What Remains After First-Pass Matching

Five important unresolved categories were identified:

## 10.1 Probable match

Records look strongly related but deterministic rules cannot safely clear them.

Example:

* same amount
* similar reference
* equivalent counterparty name
* close date

## 10.2 Timing difference

One side exists now while the corresponding record is expected later.

The key question is whether available dates actually support that explanation.

## 10.3 Complex grouping

Valid relationships may be:

* 1 ↔ many
* many ↔ 1

Arithmetic equality alone is not enough; contextual grouping evidence is also needed.

## 10.4 Amount discrepancy

Records appear related but amounts differ.

The system must distinguish an explainable difference from a genuine issue.

## 10.5 Insufficient evidence

Multiple candidates may remain equally plausible or a counterpart may be missing entirely.

The correct result may be to abstain.

---

# 11. Human Work Identified

The important human work after auto-match is not mostly arithmetic.

It is:

* gathering evidence
* comparing weak/dirty identifiers
* interpreting transaction descriptions
* deciding whether records are economically the same event
* determining whether a difference is legitimate
* identifying when evidence is insufficient
* documenting the conclusion

## Decision

Target the **evidence interpretation + safe resolution** part of the workflow.

---

# 12. Key Product Insight

The project should optimize for:

> **safe resolution**, not raw match rate.

A system that claims 100% match rate while making incorrect financial decisions is worse than one that resolves fewer cases with very high precision and honestly escalates the remainder.

This becomes the core philosophy of the project.

---

# 13. Frozen Scope

## In scope

* bank ↔ books reconciliation
* 50+ synthetic records
* final benchmark of 100 reconciliation cases
* exact matches
* normalized-reference matches
* strong contextual matches
* semantic/fuzzy matches
* timing differences
* 1→many grouping
* many→1 grouping
* amount discrepancies
* conflicting records
* ambiguity / missing evidence
* measurable metrics
* explicit exception list
* evidence trail

## Out of scope

* payment ↔ settlement reconciliation
* settlement Q&A
* forward cash forecasting
* tax-line matching
* real bank integrations
* Razorpay production APIs
* ERP integrations
* authentication
* organizations / users / RBAC
* complete accounting software
* month-end close automation
* journal-entry posting
* reviewer approval workflows
* real financial-data modification
* many↔many matching
* external evidence search through emails/contracts/documents

---

# 14. Final Outcomes

Every case must terminate in exactly one state.

## `RECONCILED`

Enough evidence establishes the records belong together.

## `EXPLAINED_OUTSTANDING`

The case is currently unmatched but evidence explains why that is legitimate, such as a supported timing difference.

## `DISCREPANCY`

Records appear related but contain a real unexplained difference requiring attention.

## `UNRESOLVED`

Available evidence is insufficient for a safe conclusion.

---

# 15. Intermediate Status vs Final Outcome

“Suggested match” is an intermediate workflow state, not a final outcome.

## Decision

Do not expose `SUGGESTED_MATCH` as a final finance result.

The agent must eventually propose a real resolution category, and the verifier must decide whether it is safe.

---

# 16. Reason Codes

Reason codes are separate from top-level outcomes.

Examples:

## Match-related

* `EXACT_MATCH`
* `NORMALIZED_REFERENCE_MATCH`
* `SEMANTIC_REFERENCE_MATCH`
* `COUNTERPARTY_MATCH`
* `GROUPED_MATCH`
* `MULTI_EVIDENCE_MATCH`

## Explained

* `TIMING_DIFFERENCE`

## Discrepancy

* `AMOUNT_DISCREPANCY`
* `CONFLICTING_RECORDS`
* `DUPLICATE_USAGE`

## Unresolved

* `NO_CANDIDATE`
* `MULTIPLE_PLAUSIBLE_CANDIDATES`
* `INSUFFICIENT_EVIDENCE`
* `VERIFICATION_FAILED`

Reason codes may grow only if a genuinely new benchmark case requires it.

---

# 17. Benchmark Philosophy

## Decision

Build a controlled synthetic benchmark rather than random dirty CSVs.

The benchmark must represent realistic reconciliation situations, not arbitrary corruption.

## Important rule

Generate the financial truth first, then derive bank and ledger representations from it.

Do not generate random rows and decide afterward what they mean.

---

# 18. Benchmark Files

Development fixture:

```text
data/dev/
  bank_transactions.csv
  ledger_transactions.csv
  ground_truth.csv
```

Final benchmark:

```text
data/benchmark/
  bank_transactions.csv
  ledger_transactions.csv
  ground_truth.csv
```

Runtime sees only bank + ledger inputs.

Ground truth is evaluator-only.

---

# 19. Benchmark Size

## Development fixture

20 reconciliation cases.

Purpose:

* easy manual inspection
* deterministic debugging
* at least one example of every supported category

## Final benchmark

100 reconciliation cases.

This exceeds the buildathon's 50+ requirement and gives enough data for meaningful metrics.

---

# 20. Frozen Benchmark Distribution

| Case                         |   Count |
| ---------------------------- | ------: |
| Exact matches                |      20 |
| Normalized-reference matches |      10 |
| Strong contextual matches    |      10 |
| Semantic/fuzzy matches       |      15 |
| Timing differences           |      10 |
| Grouped matches              |      15 |
| Genuine discrepancies        |      10 |
| Ambiguous/missing evidence   |      10 |
| **Total**                    | **100** |

Grouped split:

* 8 one-bank → many-ledger
* 7 many-bank → one-ledger

This distribution is a benchmark design choice, not an industry-frequency claim.

---

# 21. Benchmark Data Schema

## Bank fields

* `bank_txn_id`
* `booking_date`
* `value_date`
* `amount`
* `currency`
* `direction`
* `reference`
* `counterparty`
* `description`
* `batch_id`

## Ledger fields

* `ledger_txn_id`
* `accounting_date`
* `maturity_date`
* `amount`
* `currency`
* `direction`
* `reference`
* `counterparty`
* `description`
* `source`
* `batch_id`

## Ground truth fields

* `case_id`
* `bank_record_ids`
* `ledger_record_ids`
* `expected_outcome`
* `reason_code`
* `notes`

---

# 22. Currency Decision

Use INR only in the benchmark.

Keep the currency field so compatibility validation remains part of the system.

FX reconciliation is explicitly out of scope.

---

# 23. Money Representation

CSV values use decimal strings such as:

```text
12450.00
```

Internally convert to integer paise:

```text
1245000n
```

## Decision

Never use floating-point JavaScript arithmetic for financial comparison.

---

# 24. Benchmark Noise

Allowed realistic variation:

* casing changes
* punctuation changes
* whitespace
* abbreviations
* counterparty-name variants
* date lag
* description variation
* missing optional references
* grouping/batching

Not allowed:

* meaningless random corruption
* arbitrary gibberish
* hidden clues inserted only for the model
* cases where even the benchmark creator cannot define the truth

---

# 25. Preventing Benchmark Shortcuts

The benchmark must prevent trivial matching by construction.

Decisions:

* bank IDs and ledger IDs are independent
* row order is independently shuffled
* matching records are not adjacent by design
* repeated common amounts are intentional
* case types are mixed
* ground-truth ordering is separate

The system should need evidence beyond amount alone.

---

# 26. Benchmark Immutability

Once the final 100-case benchmark is validated:

> Do not edit cases merely because the system performs poorly.

If an actual dataset bug exists, fix it explicitly and version/regenerate the benchmark.

Poor model performance is not a valid reason to modify ground truth.

---

# 27. Deterministic Matching Philosophy

## Decision

The deterministic engine should be conservative.

Its job is to clear only what can be objectively proven.

Rules run strongest → weakest.

---

# 28. Frozen Deterministic Rule Order

## Rule 1 — Exact reference + exact amount

Require:

* same currency
* exact amount
* exact reference
* compatible direction
* unique candidate

## Rule 2 — Normalized reference

Require:

* same currency
* exact amount
* normalized reference equality
* compatible direction
* date within frozen tolerance
* unique candidate

## Rule 3 — Strong contextual match

Require:

* exact amount
* same currency
* exact normalized counterparty
* compatible direction
* date within frozen tolerance
* exactly one valid candidate

## Rule 4 — One bank → many ledger

Require:

* group of 2 or 3 ledger records
* exact total
* same currency
* compatible direction
* valid date relation
* strong grouping evidence

## Rule 5 — Many bank → one ledger

Inverse of Rule 4.

---

# 29. Date Tolerance

Frozen benchmark tolerance:

```text
-1 day ≤ bank_date - ledger_date ≤ +3 days
```

This is deliberately asymmetric because accounting activity may precede bank posting.

It is a project benchmark configuration, not an industry standard.

---

# 30. Amount Tolerance

Automatic amount tolerance:

> **None**

Amounts must balance exactly for deterministic auto-match.

A ₹50 difference is not auto-cleared just because it looks small.

This preserves the verification-first story.

---

# 31. Grouping Scope

Supported:

* 1 ↔ 1
* 1 ↔ many
* many ↔ 1

Excluded:

* many ↔ many

Maximum many-side group size:

> 3

Reason:

Avoid combinatorial scope while still demonstrating realistic grouped reconciliation.

---

# 32. Ambiguity Rule

If multiple candidates satisfy the same deterministic rule:

> Reconcile none of them.

Do not use “first row wins.”

Return the case for reasoning instead.

---

# 33. Deterministic Stage Output

The deterministic matcher has exactly two stage outputs:

* `AUTO_RECONCILED`
* `NEEDS_REASONING`

Final finance outcomes are assigned only after the full pipeline.

---

# 34. AI Role

## Decision

AI is a semantic evidence reasoner, not the reconciliation authority.

AI may reason about:

* semantic reference similarity
* counterparty/entity equivalence
* description meaning
* multiple weak signals
* contradictory semantic evidence

AI may propose:

* `MATCH`
* `TIMING_DIFFERENCE`
* `DISCREPANCY`
* `INSUFFICIENT_EVIDENCE`

---

# 35. What AI Must Not Do

The LLM must not be authoritative for:

* arithmetic
* amount equality
* grouped totals
* currency equality
* date calculations
* transaction uniqueness
* duplicate usage
* record existence
* evaluation metrics

If normal code can answer a question exactly, normal code should answer it.

---

# 36. Agent Input

The agent receives:

* primary record(s)
* bounded candidate record(s)
* deterministic facts already calculated

The agent should not recalculate facts that the system can provide reliably.

---

# 37. Agent Output

Structured output only.

Fields:

* proposed outcome
* bank IDs
* ledger IDs
* confidence
* evidence
* conflicting evidence
* concise reason

Confidence values:

* `HIGH`
* `MEDIUM`
* `LOW`

## Decision

Do not use fake numeric confidence such as 93.7% unless a future statistically calibrated model genuinely supports it.

---

# 38. Candidate Generation

## Decision

Do not send the entire ledger to the LLM for each case.

Generate a small plausible set first.

Signals may include:

* currency
* amount
* date proximity
* reference similarity
* counterparty similarity

Candidate generation is deterministic and does not produce a final match.

---

# 39. Verifier Role

## Decision

The verifier is the trust boundary and has final authority.

The agent proposes.

The verifier decides whether the proposal is financially safe.

---

# 40. Match Verification

For a proposed match, verify:

* records exist
* IDs came from supplied candidates
* currency compatible
* transaction directions compatible
* exact amount/group total
* grouping is supported
* many side ≤ 3
* records are not reused
* no hard contradiction exists
* amount-only evidence is insufficient for difficult semantic matches

AI confidence cannot override verifier failure.

---

# 41. Timing Verification

A timing explanation is accepted only if supplied records contain evidence such as:

* accounting date
* maturity date
* booking date
* value date
* known benchmark timing information

“Maybe it is delayed” is not enough.

Without actual evidence:

* final outcome should become `UNRESOLVED`

---

# 42. Discrepancy Verification

The verifier calculates differences deterministically.

If records appear related but the amount difference is not justified by supplied evidence:

* final outcome is `DISCREPANCY`

The system does not automatically post accounting adjustments.

---

# 43. Insufficient Evidence

If multiple candidates remain equally plausible or no candidate exists:

* final outcome may be `UNRESOLVED`

This is a successful safe decision, not a model failure.

---

# 44. Core Agent/Verifier Invariant

> The agent may be clever. The verifier must be boring.

The verifier must remain deterministic, explicit, and easy to test.

---

# 45. Evaluation Metrics

Frozen metrics:

## Match rate

How much of the batch was actually reconciled.

## Resolution rate

How many cases reached a defensible non-unresolved conclusion.

## Match precision

Of all cases called `RECONCILED`, how many were truly correct.

## False reconciliation count/rate

How often the system confidently cleared the wrong records.

This is a critical safety metric.

## Exception accuracy

How accurately discrepancy/unresolved cases were identified.

## Abstention rate

How often the system deliberately refused to make an unsafe decision.

---

# 46. Evaluation Philosophy

The goal is not to maximize match rate.

Example preference:

```text
82% safe resolution
99% match precision
18% honest escalation
```

is preferable to:

```text
100% claimed matching
90% correctness
```

A false confident match is considered worse than abstention.

---

# 47. Product Form

## Decision

Build a small web application with a backend-heavy reconciliation engine.

It is not:

* only a backend
* only a chatbot
* only an AI agent demo

The evaluator must be able to see and understand the finance loop.

---

# 48. Product Surface 1 — `/`

Purpose:

> Show what happened.

The dashboard displays:

* load benchmark / upload files
* start reconciliation
* run status
* metrics
* results table
* outcome filters
* exceptions
* individual evidence

Keep this page focused on finance-user outcomes, not implementation internals.

---

# 49. Product Surface 2 — `/trace`

Purpose:

> Show how the system reached the decision.

Visualize actual execution stages such as:

* normalization
* deterministic rules
* candidate generation
* agent proposal
* verifier checks
* final outcome

## Important decision

This must use real recorded execution events.

Do not create fake “AI is thinking” theatre.

If AI was never called, AI must not appear in the trace.

---

# 50. Product Surface 3 — `/docs`

Purpose:

> Show why the system was built this way and how well it actually works.

Include:

* problem
* problem narrowing
* real workflow research
* frozen scope
* benchmark design
* deterministic rules
* agent/verifier contract
* system architecture
* experiments
* failures
* lessons learned
* final benchmark results

---

# 51. Documentation Philosophy

## Decision

Document failures honestly rather than presenting the final system as if it worked perfectly from version one.

Useful experiment stories may include:

* loose matching increased coverage but created false matches
* semantic reasoning became too aggressive
* verifier caught contradictions
* grouping search needed stronger filtering
* model changes altered precision/cost/latency

Only real failures should be documented.

Do not manufacture failures for storytelling.

---

# 52. Trace Philosophy

Explainability means:

* evidence considered
* facts calculated
* rules evaluated
* candidates generated
* agent proposal
* contradictory evidence
* verifier checks
* final result

It does not mean exposing a hidden model chain-of-thought.

---

# 53. Tech Stack Decision

Use a TypeScript-first monorepo.

## Monorepo

* pnpm workspaces
* TypeScript

## Frontend

* Next.js
* React
* Tailwind CSS
* shadcn/ui
* Phosphor Icons
* React Flow
* Motion
* Recharts
* MDX

## Backend

* Fastify
* TypeScript
* Zod
* `csv-parse`
* `p-limit`

## Database

* PostgreSQL
* Drizzle ORM
* postgres.js

## AI

* official OpenAI Node SDK
* Responses API
* GPT-5.6 Terra as default configured model
* Structured Outputs
* Zod-backed schema validation

## Testing

* Vitest
* React Testing Library
* Playwright

## Deployment

* Railway web service
* Railway API service
* Railway PostgreSQL

---

# 54. Why TypeScript End-to-End

Decision:

> Do not introduce a separate Python service.

Reasons:

* reconciliation logic is mostly deterministic application logic, not model training
* one language keeps contracts shared
* easier end-to-end testing
* simpler deployment
* easier line-by-line explanation

---

# 55. Why Fastify Separate from Next.js

Next.js is used for presentation.

Fastify owns the long-running reconciliation API.

This creates a simple boundary:

```text
Next.js = presentation
Fastify = reconciliation API
```

The core reconciliation package remains framework-independent.

---

# 56. Core Package Boundary

Core finance logic lives in:

```text
packages/reconciliation
```

It must not depend on:

* React
* Next.js
* Fastify
* PostgreSQL
* Drizzle

Expected subareas:

* normalization
* matching
* candidates
* agent
* verification
* pipeline
* trace
* metrics

This keeps the important logic independently testable.

---

# 57. Why No Agent Framework

Do not use:

* LangChain
* LangGraph
* CrewAI
* AutoGen

Reason:

The system has one controlled AI reasoning step, not a complex orchestration graph requiring an agent framework.

Direct OpenAI SDK usage is simpler and easier to explain.

---

# 58. Why No Vector Database

Do not add embeddings/vector search.

Reason:

Candidate generation can be done with bounded deterministic filters over a 100-case benchmark.

A vector database adds complexity without solving a demonstrated requirement.

---

# 59. Why No Redis / Queue Initially

Do not add Redis or BullMQ initially.

Reason:

The buildathon workload is a controlled 100-case batch.

Use bounded AI concurrency with `p-limit` inside the API process.

A durable production queue may be future work, but is not necessary for current scope.

---

# 60. AI Concurrency

Default AI concurrency:

> 5

Make it configurable.

Reason:

Avoid uncontrolled bursts of API calls while still processing difficult cases in parallel.

Capture request latency and model/token metadata when available.

---

# 61. Persistence Decision

PostgreSQL is justified because the product must retain:

* runs
* input records
* results
* agent proposals
* verification results
* trace events
* benchmark evaluations

No user/auth tables.

---

# 62. Persistence Tables

Frozen table set:

* `reconciliation_runs`
* `bank_transactions`
* `ledger_transactions`
* `reconciliation_results`
* `agent_proposals`
* `verification_results`
* `trace_events`
* `benchmark_evaluations`

Do not add users, organizations, or sessions.

---

# 63. API Surface

Frozen application API:

* `GET /health`
* `GET /health/db`
* `POST /api/runs`
* `GET /api/runs/:runId`
* `GET /api/runs/:runId/results`
* `GET /api/runs/:runId/exceptions`
* `GET /api/runs/:runId/events`
* `POST /api/runs/:runId/evaluate`

Keep the API small.

---

# 64. Error Model

Differentiate:

* `INVALID_INPUT`
* `INTERNAL_PROCESSING_ERROR`
* `AI_REQUEST_ERROR`
* `AI_SCHEMA_ERROR`
* `VERIFICATION_FAILED`

These are system/processing errors.

They must never silently become `UNRESOLVED`.

---

# 65. Trace Event Decision

Trace events are first-class execution records.

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

The frontend renders these events; it does not invent them.

---

# 66. Experiment Tracking

Do not add MLflow or Weights & Biases initially.

Persist benchmark evaluations in PostgreSQL.

Useful run metadata:

* model
* prompt version
* reasoning configuration
* match precision
* resolution rate
* false match rate
* exception accuracy
* latency
* token usage
* estimated cost
* git commit

This supports the documentation page directly.

---

# 67. Testing Strategy

## Unit / integration

Use Vitest for:

* normalization
* deterministic rules
* grouping
* candidate generation
* verifier
* metrics
* API integration where appropriate

## UI

Use React Testing Library only for important component behavior.

## End-to-end

Use Playwright for evaluator-facing flows.

Important invariant tests:

* currency mismatch never reconciles
* amount mismatch never auto-reconciles
* ambiguity never auto-clears
* record reuse never succeeds
* group size >3 never succeeds
* many↔many never succeeds
* AI cannot bypass verifier
* hallucinated IDs cannot reconcile
* amount-only semantic evidence cannot reconcile
* ground truth is inaccessible to runtime

---

# 68. Frontend Design Decision

A separate `design.md` will define frontend presentation.

## Decision

Frontend implementation tasks must read `design.md` before visual work.

Do not invent temporary styling before it exists.

UI concerns governed by `design.md` include:

* layout
* typography
* spacing
* color
* tables
* cards
* charts
* trace presentation
* responsive behavior
* animation

---

# 69. Documentation Lookup Decision

Use Context7 MCP for version-sensitive library/framework work.

Typical lookup targets:

* Next.js
* Fastify
* Drizzle
* React Flow
* Tailwind
* shadcn/ui
* Motion
* Zod
* csv-parse
* Playwright

If Context7 cannot resolve a required library, use official primary documentation and record the fallback in the implementation debrief.

Do not invent unfamiliar library APIs.

---

# 70. Coding-Agent Workflow Decision

Codex should work one task at a time.

For each task:

1. read `AGENTS.md`
2. read the current task
3. inspect only necessary files
4. perform required Context7 lookup
5. implement only that task
6. run pass criteria
7. give a debrief
8. stop

Do not pre-implement future tasks.

---

# 71. Required Task Debrief

After every task, Codex should report:

## What changed

Concise implementation summary.

## How it works

Short execution explanation.

## Files changed

Only materially changed files.

## Tests

Commands run and results.

## Manual test

Exact steps when applicable.

## Expected behavior

What should be observed.

## Documentation consulted

Context7/official docs used.

## Scope check

Confirm no future-task functionality was added.

---

# 72. Deployment Decision

Use Railway for:

* Next.js service
* Fastify API
* PostgreSQL

Reason:

Keep deployment simple and avoid infrastructure becoming part of the project.

---

# 73. Final Evaluator Journey

The intended evaluator experience is:

1. open `/`
2. load the benchmark / upload CSVs
3. run reconciliation
4. see 100-case batch metrics
5. inspect one difficult reconciled case
6. inspect one unresolved case
7. open `/trace` to see real execution
8. open `/docs` to understand research, decisions, experiments, failures, and final results

This lets the evaluator understand:

* the finance problem
* the system behavior
* the verification boundary
* the measurable outcome
* the engineering reasoning

---

# 74. What the Project Is Not

This project is not:

* a chatbot
* a generic finance assistant
* a CSV fuzzy matcher
* a full accounting system
* a payment platform
* a fake multi-agent demo
* an infrastructure showcase

---

# 75. Final Project Definition

This project is:

> **A backend-heavy bank-to-books reconciliation system with a thin web dashboard, a real execution trace, and a documentation surface that demonstrates how deterministic rules, AI reasoning, and deterministic verification work together to maximize safe financial resolution.**

The core invariant remains:

> **An honest unresolved case is better than a confidently wrong financial match.**

---

# 76. Research Grounding Preserved for `/docs`

The problem definition and workflow decisions were intentionally grounded in real product/accounting documentation rather than anecdotal workflows.

Primary research areas used during problem narrowing:

## Razorpay

Used to understand:

* settlement composition
* settlement reconciliation reports
* UTR-based settlement tracing
* multi-gateway reconciliation
* what Razorpay already automates

Useful references:

* https://razorpay.com/docs/payments/settlements/faqs/
* https://razorpay.com/docs/payments/settlements/dashboard/
* https://razorpay.com/docs/payments/optimizer/reconciliation/
* https://razorpay.com/blog/single-view-recon/

## Adyen

Used to understand real transaction-level payment → settlement reconciliation, including credits, debits, fees, refunds, chargebacks, and payout-batch reconstruction.

Useful reference:

* https://docs.adyen.com/reporting/settlement-reconciliation/transaction-level/

## Oracle Account Reconciliation / Cash Management

Used heavily to understand mature bank ↔ books workflows, including:

* Auto Match
* Suggested Matches
* Unmatched Transactions
* manual matching
* Supported Transactions
* timing differences
* Adjustments
* 1:1 / 1:many / many:1 / many:many matching capabilities
* preparer/reviewer workflows
* transaction matching assistance
* bank ↔ general-ledger reconciliation

Useful references:

* https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/raarc/transaction_matching_about.html
* https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/raarc/reconcile_trans_match_manual_match_example.html
* https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/raarc/reconcile_trans_match_supported_transactions_about.html
* https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/raarc/reconcile_transaction_matching_assistance_predicting.html
* https://docs.oracle.com/en/cloud/saas/financials/26a/fairp/reconciliation-matching-rules.html

## Important documentation rule

The final `/docs` page should preserve links to the primary sources behind workflow claims.

Do not present benchmark configuration choices such as the `-1/+3 day` tolerance, 100-case distribution, or maximum group size of 3 as industry standards. Those are explicitly project-specific decisions.
