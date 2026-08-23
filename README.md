# Finance Reconciliation Agent

This project is a verification-first finance reconciliation system built for the Razorpay AI Buildathon.

It reconciles **bank transactions against accounting ledger records** across a full batch, safely resolving what it can and explicitly flagging what it cannot.

The core idea is simple:

> Deterministic rules handle what can be proven mechanically, AI reasons over messy financial evidence, and a deterministic verifier decides whether the AI's proposal is safe enough to accept.

## What it does

Given:

* `bank_transactions.csv`
* `ledger_transactions.csv`

The system processes the batch and classifies each reconciliation case as one of:

* `RECONCILED`
* `EXPLAINED_OUTSTANDING`
* `DISCREPANCY`
* `UNRESOLVED`

It also reports measurable outcomes such as:

* match rate
* resolution rate
* match precision
* false reconciliation rate
* exception accuracy
* unresolved / abstention rate

A hidden synthetic ground-truth dataset is used only for evaluation so benchmark results can be measured objectively.

## Product surfaces

### `/`

Reconciliation dashboard showing batch results, metrics, exceptions, and evidence for individual decisions.

### `/trace`

A visual execution trace showing the real path a case took through normalization, deterministic rules, candidate generation, AI reasoning, verification, and final outcome.

### `/docs`

Engineering and research documentation covering problem narrowing, real reconciliation workflows, benchmark design, architecture, experiments, failures, and final results.

## Tech stack

* **Frontend:** Next.js, React, Tailwind CSS, shadcn/ui, React Flow, Motion, Recharts, MDX
* **Backend:** Fastify, TypeScript, Zod, `csv-parse`, `p-limit`
* **Database:** PostgreSQL + Drizzle ORM
* **AI:** OpenAI Responses API with Structured Outputs
* **Testing:** Vitest, React Testing Library, Playwright
* **Deployment:** Railway

## Project philosophy

The system does **not** optimize for the highest possible match rate.

It optimizes for the highest **safe resolution rate** while keeping incorrect confident matches as close to zero as possible.

An honest unresolved transaction is better than a confidently wrong financial decision.
