# AGENTS.md — Finance Reconciliation Agent

Guidance for AI coding agents working on this repository.

Read this file fully before modifying code.

This is a **Razorpay AI Buildathon project**. The goal is not feature breadth. The priority is a correct, measurable, explainable implementation of one finance-ops loop:

> **Bank ↔ Books reconciliation with evidence-based exception resolution.**

The system processes a batch of bank and ledger records, safely reconciles what it can, explains legitimate outstanding items, flags genuine discrepancies, and refuses to resolve cases when evidence is insufficient.

---

# 1. Product Surfaces

There are exactly three user-facing surfaces.

## `/` — Reconciliation Dashboard

Shows:

* reconciliation batch input/run
* run status
* total cases processed
* reconciled count
* explained outstanding count
* discrepancy count
* unresolved count
* match rate
* resolution rate
* match precision
* false reconciliation rate
* results table
* exception list
* evidence for individual decisions

This page answers:

> **What happened?**

---

## `/trace` — Reconciliation Trace

Visualizes the **real execution events** for a selected reconciliation case.

Possible stages:

```text
Normalize
→ Deterministic Rules
→ Candidate Generation
→ Agent
→ Verifier
→ Final Outcome
```

Important:

The trace must replay actual events emitted by the reconciliation engine.

Do not create fake:

```text
AI is thinking...
AI is analysing...
AI is reflecting...
```

animations.

If a case was reconciled by Rule 1 and never reached the agent, the trace must end after Rule 1.

This page answers:

> **How did the system reach this result?**

---

## `/docs` — Engineering / Research Documentation

Contains:

* problem statement
* problem narrowing
* real reconciliation workflow research
* frozen project scope
* benchmark design
* deterministic rule design
* agent/verifier contract
* system architecture
* experiments
* benchmark runs
* failures
* lessons learned
* final results

This page answers:

> **Why was the system built this way, and how do we know it works?**

---

# 2. Frozen Scope

Do not expand this scope without explicit user approval.

## Input

Two synthetic datasets:

```text
bank_transactions.csv
ledger_transactions.csv
```

Final benchmark:

```text
100 reconciliation cases
```

A hidden:

```text
ground_truth.csv
```

exists only for evaluation.

The reconciliation runtime must never read ground truth.

---

# 3. Supported Reconciliation Cases

The system supports:

1. exact matches
2. normalized-reference matches
3. strong contextual matches
4. semantic/fuzzy matches
5. timing differences
6. one-bank → many-ledger grouping
7. many-bank → one-ledger grouping
8. amount discrepancies
9. conflicting records
10. genuine ambiguity / missing evidence

Explicitly excluded:

```text
many ↔ many grouping
```

Maximum group size on the many side:

```text
3
```

---

# 4. Final Outcomes

Every case must terminate in exactly one state.

## `RECONCILED`

Available evidence safely establishes that the records represent the same financial event.

## `EXPLAINED_OUTSTANDING`

The records are not currently matched, but available evidence explains why the difference is legitimate, for example a supported timing difference.

## `DISCREPANCY`

The records appear related but contain a genuine difference requiring finance attention.

## `UNRESOLVED`

Available evidence is insufficient for a safe decision.

Never force a match merely to increase match rate.

---

# 5. Core Product Principle

The system optimizes for:

> **safe resolution, not maximum coverage.**

A confidently incorrect reconciliation is worse than an honest unresolved case.

The system must be comfortable returning:

```text
UNRESOLVED
```

when evidence is insufficient.

---

# 6. Architecture Boundary

The reconciliation pipeline is:

```text
CSV Input
    ↓
Parse + Validate
    ↓
Normalize
    ↓
Deterministic Auto Match
    ↓
Unresolved cases
    ↓
Candidate Generation
    ↓
AI Evidence Reasoning
    ↓
Agent Proposal
    ↓
Deterministic Verifier
    ↓
Final Outcome
    ↓
Metrics + Exceptions
```

Keep these responsibilities separate.

---

# 7. Technology Stack

Do not substitute major libraries or frameworks without explicit approval.

## Monorepo

* pnpm workspaces
* TypeScript

## Frontend

* Next.js
* React
* Tailwind CSS
* shadcn/ui
* Phosphor Icons
* `@xyflow/react` / React Flow
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
* GPT-5.6 Terra as the default configured model
* Structured Outputs
* Zod-backed output contracts

## Testing

* Vitest
* React Testing Library
* Playwright

## Deployment

* Railway

  * Next.js service
  * Fastify service
  * PostgreSQL

---

# 8. Explicitly Forbidden Scope Creep

Do not introduce:

* authentication
* users
* organizations
* RBAC
* payment processing
* real bank integrations
* Razorpay production integrations
* ERP integrations
* settlement reconciliation
* tax-line matching
* cash forecasting
* settlement Q&A
* journal-entry posting
* automatic modification of financial records
* full accounting-close workflows
* reviewer/approval systems
* Redis
* Kafka
* GraphQL
* vector databases
* embeddings databases
* LangChain
* LangGraph
* CrewAI
* AutoGen
* Kubernetes
* microservices beyond the web/API split

Do not add infrastructure because it appears more production-like.

Every dependency must solve an actual requirement.

---

# 9. Core Package Boundary

The core reconciliation logic belongs in:

```text
packages/reconciliation
```

It must not depend on:

* React
* Next.js
* Fastify
* PostgreSQL
* Drizzle
* UI components

The core package should be independently testable.

Expected responsibilities:

```text
normalization/
matching/
candidates/
agent/
verification/
pipeline/
trace/
metrics/
```

Framework adapters may call this package.

The package must not call framework code.

---

# 10. Money Handling

Never use JavaScript floating-point numbers for financial calculations.

CSV may contain:

```text
12450.00
```

Convert internally to integer paise:

```text
1245000n
```

Use `bigint` or an equivalent integer representation for:

* amount comparison
* differences
* grouped totals
* metrics involving money

Do not introduce automatic rounding to make records match.

---

# 11. Deterministic Rule Contract

Rules execute strongest → weakest.

Frozen order:

```text
R1 Exact reference + exact amount

R2 Normalized reference
   + exact amount
   + date tolerance

R3 Exact amount
   + exact normalized counterparty
   + date tolerance
   + unique candidate

R4 One bank → many ledger

R5 Many bank → one ledger
```

Date tolerance:

```text
-1 day ≤ bank_date - ledger_date ≤ +3 days
```

This is a benchmark configuration, not an industry claim.

Automatic amount tolerance:

```text
NONE
```

Amounts must balance exactly for deterministic reconciliation.

If multiple candidates satisfy the same deterministic rule:

```text
DO NOT AUTO-MATCH
```

Return:

```text
NEEDS_REASONING
```

---

# 12. Deterministic Stage Output

The deterministic matcher has only two outcomes:

```text
AUTO_RECONCILED
```

or:

```text
NEEDS_REASONING
```

Useful reason metadata may include:

```text
NO_RULE_MATCH
MULTIPLE_CANDIDATES
AMOUNT_DIFFERENCE
DATE_OUTSIDE_TOLERANCE
GROUPING_AMBIGUITY
MISSING_COUNTERPART
```

Do not assign the final four finance outcomes inside individual deterministic rules.

---

# 13. AI Responsibility

The agent may reason about:

* semantic reference equivalence
* counterparty/entity equivalence
* transaction-description meaning
* multiple weak pieces of evidence
* conflicting semantic evidence
* whether a case appears to be:

  * a match
  * timing difference
  * discrepancy
  * insufficient evidence

The agent must receive deterministic facts instead of recalculating them.

---

# 14. AI Must NOT Own Financial Truth

The LLM must never be authoritative for:

* arithmetic
* amount equality
* grouped totals
* currency equality
* date differences
* transaction uniqueness
* duplicate usage
* record existence
* evaluation metrics
* whether a candidate has already been reconciled

If normal code can answer a question deterministically, use normal code.

---

# 15. Agent Output Contract

Agent output must be structured and schema validated.

Allowed proposed outcomes:

```text
MATCH
TIMING_DIFFERENCE
DISCREPANCY
INSUFFICIENT_EVIDENCE
```

Confidence is limited to:

```text
HIGH
MEDIUM
LOW
```

Do not manufacture numerical confidence percentages such as:

```text
93.7%
```

Agent proposals must include:

* proposed outcome
* bank record IDs
* ledger record IDs
* confidence
* supporting evidence
* conflicting evidence
* concise reason

Free-form model text must never be the primary machine-readable result.

---

# 16. Verifier Authority

The deterministic verifier has final authority.

For proposed matches verify:

* candidate records exist
* currency compatibility
* transaction direction compatibility
* exact amount equality
* grouped amount equality
* supported group cardinality
* maximum group size
* record uniqueness
* no previously reconciled record is reused
* no hard contradiction exists

The verifier may reject a `HIGH` confidence AI proposal.

The LLM can never override verifier failure.

---

# 17. Semantic Evidence Rule

For a difficult case, exact amount alone is insufficient.

A proposed semantic match must have at least one meaningful additional evidence relationship, such as:

* reference relationship
* counterparty relationship
* description relationship
* grouping/batch relationship

Repeated common amounts must not create automatic matches.

---

# 18. Timing Difference Contract

The agent may propose a timing difference only if evidence in the supplied records supports it.

Acceptable evidence may include:

* accounting date
* maturity date
* booking date
* value date
* known benchmark timing information

Do not accept:

> “Maybe it is delayed.”

as evidence.

If timing cannot be established from available records:

```text
UNRESOLVED
```

---

# 19. Discrepancy Contract

The verifier independently calculates amount differences.

If records appear related but an amount difference cannot be justified using supplied evidence:

```text
DISCREPANCY
```

Do not automatically create:

* journal entries
* adjustments
* write-offs
* ledger modifications

The system only reports the issue.

---

# 20. Benchmark Isolation

The final benchmark has:

```text
bank_transactions.csv
ledger_transactions.csv
ground_truth.csv
```

Only evaluator code may import/read:

```text
ground_truth.csv
```

There must be no runtime path where:

```text
packages/reconciliation
apps/api
apps/web
```

can inspect benchmark truth before results are produced.

---

# 21. Trace Contract

Trace events are first-class execution records.

Examples:

```text
RUN_STARTED
CASE_STARTED
TRANSACTION_NORMALIZED
RULE_EVALUATED
RULE_PASSED
RULE_FAILED
AUTO_RECONCILED
CANDIDATES_GENERATED
AGENT_STARTED
AGENT_PROPOSED
VERIFICATION_CHECKED
CASE_FINALIZED
RUN_COMPLETED
```

Every trace event must correspond to something that actually happened.

Do not infer or invent trace stages on the frontend.

The frontend is a renderer of execution history.

---

# 22. Documentation Lookup Policy — Context7

For framework/library/API-specific implementation work, use **Context7 MCP before coding** whenever the task marks documentation lookup as required.

Typical lookup targets include:

* Next.js
* Fastify
* Drizzle
* PostgreSQL drivers
* React Flow
* Tailwind
* shadcn/ui
* Motion
* Zod
* csv-parse
* Playwright

Look up the API for the version actually installed in the repository.

Do not rely on remembered syntax when documentation can verify it.

For OpenAI API integration:

1. use Context7 if the current OpenAI SDK documentation is available there;
2. otherwise use OpenAI's official developer documentation as the primary-source fallback;
3. mention the fallback in the task debrief.

The current OpenAI platform uses the Responses API and supports structured model outputs, so the implementation should use the official SDK rather than an agent framework.

If Context7 cannot resolve a library:

* do not invent APIs;
* use official primary documentation when available;
* record this in the debrief.

---

# 23. Documentation Lookup Discipline

Do not perform broad documentation research for every task.

Use Context7 when:

* introducing a library API
* configuring a framework
* implementing version-sensitive behavior
* using an unfamiliar API
* changing an integration boundary

Do not use Context7 for:

* plain TypeScript functions
* arithmetic
* application-specific business rules
* simple data structures
* tests of code already understood

---

# 24. Frontend Design Gate

The user will provide:

```text
design.md
```

before frontend visual implementation begins.

For any task involving:

* page layout
* spacing
* typography
* colors
* visual hierarchy
* cards
* responsive behavior
* charts
* tables
* trace visuals
* animation
* component styling

read `design.md` fully before changing UI code.

Treat `design.md` as authoritative for presentation.

Do not invent an alternative visual language.

If a frontend-design task is reached and `design.md` does not exist:

> stop that task and report the missing prerequisite.

Do not create a temporary design and later replace it.

Pure API/data wiring may proceed if the current task explicitly says no visual design is required.

---

# 25. Task Execution Rules

Work on exactly **one TASKS.md task at a time**.

Before implementation:

1. read this file;
2. read the current task;
3. inspect only the files listed in that task plus directly required imports;
4. perform required Context7 lookups;
5. implement only the current scope.

Do not pre-implement future tasks.

Do not perform unrelated cleanup.

Do not refactor working code simply because another structure is preferred.

Small, reviewable diffs are preferred.

---

# 26. Tests Before Completion

Every task has explicit pass criteria.

A task is not complete until:

* required focused tests pass;
* TypeScript compiles for affected packages;
* task-specific behavior has been verified;
* no future-scope features were added.

Fix failures caused by the task before reporting completion.

Do not weaken tests merely to obtain a passing build.

---

# 27. Manual Testing

If the task exposes user-visible or API behavior, manually verify it where practical.

The completion debrief must state:

* how to run the relevant service;
* exact action/request to perform;
* expected behavior.

If no manual test is applicable, explicitly say:

```text
Manual test: Not applicable — covered by automated unit tests.
```

---

# 28. Required Completion Debrief

After every task, stop and report:

## Task `<ID>` complete — `<name>`

### What changed

2–5 concise bullets describing what was implemented.

### How it works

A short explanation of the execution flow.

### Files changed

List only files created or materially modified.

### Tests

Show the commands executed and whether they passed.

### Manual test

Give exact steps when applicable.

### Expected behavior

State what the user should observe.

### Documentation consulted

List Context7 libraries/topics used.

If official-document fallback was required, say so.

### Scope check

Confirm:

```text
No future-task functionality was implemented.
```

Then wait for the user to request the next task.

---

# 29. Code Quality

Prefer:

* small pure functions
* explicit types
* narrow modules
* dependency injection at external boundaries
* deterministic behavior
* descriptive names
* testable business rules

Avoid:

* large service classes
* hidden global state
* deeply nested abstractions
* generic framework wrappers
* premature abstractions
* unnecessary interfaces
* clever metaprogramming

The important code should be easy to explain line by line.

---

# 30. Errors

Never silently swallow reconciliation errors.

Differentiate:

```text
INVALID_INPUT
INTERNAL_PROCESSING_ERROR
AI_REQUEST_ERROR
AI_SCHEMA_ERROR
VERIFICATION_FAILED
```

A failed model/API request is not equivalent to:

```text
UNRESOLVED
```

`UNRESOLVED` is a legitimate finance outcome.

Infrastructure failure is a system error.

Do not mix them.

---

# 31. Logging and Secrets

Never log:

* `GROQ_API_KEY`
* database passwords
* connection strings containing secrets

Environment variables belong in `.env` files excluded from Git.

Provide `.env.example` with variable names only.

---

# 32. Project Priority

When tradeoffs arise, use this ordering:

```text
Correctness
    ↓
Verification
    ↓
Explainability
    ↓
Testability
    ↓
Simplicity
    ↓
Performance
    ↓
Visual polish
```

Visual quality matters for the demo, but never at the expense of financial correctness.

---

# 33. Final Reminder

This project is not:

> an LLM that matches CSV rows.

It is:

> **a verification-first reconciliation system where deterministic logic clears what it can prove, AI interprets messy evidence, and a deterministic verifier prevents unsafe financial conclusions.**

Keep that distinction visible in every implementation decision.
