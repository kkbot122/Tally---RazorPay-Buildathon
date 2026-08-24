import React from "react";
import Link from "next/link";

const toc = [
  ["overview", "Overview"], ["narrowing", "Problem narrowing"], ["research", "Real workflow research"],
  ["scope-contract", "Frozen scope"], ["benchmark", "Benchmark"], ["rules", "Deterministic rules"],
  ["agent", "Agent + verifier"], ["architecture", "System architecture"], ["experiments", "Experiments"],
  ["failures", "Failures"], ["results", "Final results"],
] as const;

const outcomes = [
  ["RECONCILED", "A verified relationship is safe to treat as matched."],
  ["EXPLAINED_OUTSTANDING", "Evidence explains a timing or operational difference without a match."],
  ["DISCREPANCY", "Records conflict, differ in amount, or show duplicate usage."],
  ["UNRESOLVED", "Evidence is insufficient or ambiguous, so the system abstains."],
] as const;

const rules = [
  ["R1", "Exact reference", "Hard compatibility, exact amount, exact raw reference, and one unique candidate."],
  ["R2", "Normalized reference", "Hard compatibility, exact amount, normalized reference, date tolerance, and one unique candidate."],
  ["R3", "Strong context", "Exact amount, hard compatibility, normalized counterparty equality, date tolerance, and one unique candidate."],
  ["R4", "One-to-many", "One bank record to 2–3 ledger records with shared non-null batch, compatible dates, hard compatibility, and an exact bigint sum."],
  ["R5", "Many-to-one", "2–3 bank records to one ledger record with bounded batch, compatibility, date, and exact-sum constraints."],
] as const;

const benchmark = [
  ["Exact", "20"], ["Normalized reference", "10"], ["Strong context", "10"], ["Semantic", "15"],
  ["Timing", "10"], ["Grouped one-to-many (R4)", "8"], ["Grouped many-to-one (R5)", "7"],
  ["Discrepancy", "10"], ["Ambiguous", "6"], ["No candidate", "4"], ["Total", "100"],
] as const;

const metrics = [
  ["Match rate", "Actual RECONCILED / total cases"],
  ["Resolution rate", "Actual outcome other than UNRESOLVED / total cases"],
  ["Match precision", "Correct RECONCILED relationships / actual RECONCILED"],
  ["False reconciliation rate", "False reconciliations / actual RECONCILED"],
  ["Exception accuracy", "Exact correct non-RECONCILED exceptions / actual non-RECONCILED"],
  ["Abstention rate", "Actual UNRESOLVED / total cases"],
] as const;

function Section({ id, eyebrow, title, children }: { id: string; eyebrow?: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-8 border-t border-tally-border py-10 first:border-t-0 first:pt-0">
    {eyebrow && <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-tally-accent">{eyebrow}</p>}
    <h2 className="font-semibold tracking-[-0.03em] text-tally-ink text-2xl">{title}</h2>
    <div className="mt-5 space-y-5 leading-7 text-tally-ink-secondary">{children}</div>
  </section>;
}

function Callout({ tone = "accent", title, children }: { tone?: "accent" | "warning" | "neutral"; title: string; children: React.ReactNode }) {
  const colors = { accent: "border-l-tally-accent bg-tally-accent-soft", warning: "border-l-tally-warning bg-tally-warning-soft", neutral: "border-l-tally-border bg-tally-surface-subtle" };
  return <aside className={"border-l-[3px] px-4 py-3 " + colors[tone]}><p className="font-semibold text-tally-ink">{title}</p><div className="mt-1 text-sm leading-6 text-tally-ink-secondary">{children}</div></aside>;
}

function Table({ headers, rows }: { headers: string[]; rows: readonly (readonly string[])[] }) {
  return <div className="overflow-x-auto rounded border border-tally-border"><table className="w-full min-w-[520px] text-left text-sm"><thead className="bg-tally-surface-subtle text-xs uppercase tracking-[0.12em] text-tally-ink-muted"><tr>{headers.map((header) => <th className="px-4 py-3 font-semibold" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr className="border-t border-tally-border-subtle" key={row[0]}>{row.map((cell, index) => <td className={"px-4 py-3 " + (index === 0 ? "font-semibold text-tally-ink" : "text-tally-ink-secondary")} key={row[0] + "-" + index}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function CodeBlock({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded border border-tally-border bg-tally-ink px-4 py-4 text-sm leading-6 text-tally-canvas"><code>{children}</code></pre>;
}

export default function DocsContent() {
  return <div className="min-h-screen bg-tally-canvas text-tally-ink">
    <header className="flex min-h-[52px] flex-wrap items-center gap-x-4 border-b border-tally-border bg-tally-surface px-4 sm:h-[52px] sm:flex-nowrap sm:px-6">
      <nav className="flex w-full flex-wrap items-center gap-x-4 sm:flex-nowrap" aria-label="Primary navigation">
        <Link href="/" className="inline-flex items-center gap-[9px] text-[15px] font-semibold tracking-[-.01em] text-tally-ink no-underline" aria-label="Tally dashboard"><span className="grid size-5 place-items-center rounded border border-tally-ink text-[11px] font-bold">T</span><span>Tally</span></Link>
        <div className="order-3 flex h-10 w-full gap-4 sm:order-none sm:ml-8 sm:h-full sm:w-auto sm:gap-5"><Link href="/" className="inline-flex items-center border-b-2 border-transparent text-[13px] text-tally-ink-muted no-underline">Dashboard</Link><Link href="/trace" className="inline-flex items-center border-b-2 border-transparent text-[13px] text-tally-ink-muted no-underline">Trace</Link><Link href="/docs" aria-current="page" className="inline-flex items-center border-b-2 border-tally-accent font-semibold text-[13px] text-tally-ink no-underline">Docs</Link></div>
        <span className="ml-auto text-xs text-tally-ink-muted">Engineering documentation</span>
      </nav>
    </header>
    <main className="mx-auto grid max-w-[1440px] gap-12 px-6 py-10 lg:grid-cols-[minmax(0,760px)_220px] lg:gap-20 lg:px-10 lg:py-14">
      <article className="min-w-0">
        <div className="mb-12"><p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-tally-accent">Engineering / research report</p><h1 className="max-w-[760px] text-3xl font-semibold leading-[1.12] tracking-[-0.035em] text-tally-ink">Reconciliation that can explain itself.</h1><p className="mt-5 max-w-[680px] text-lg leading-7 text-tally-ink-secondary">Tally is a verification-first bank-to-ledger reconciliation system. It resolves obvious relationships deterministically, investigates bounded ambiguity, and abstains when the evidence is not strong enough.</p><p className="mt-4 text-sm text-tally-ink-muted">This page records the frozen design, benchmark methodology, and current limits. It is documentation, not a live evaluation.</p></div>

        <Section id="overview" eyebrow="01 / Why this exists" title="Problem / overview"><p>Reconciliation explains whether two financial records represent the same economic event. Bank and ledger exports rarely share one perfect identifier: references may be formatted differently, settlement may span several ledger rows, and dates may move across operational boundaries.</p><p>The goal is not maximum matching coverage. A wrong confident match can be more damaging than an honest unresolved case, so every positive outcome passes deterministic verification and keeps its evidence visible.</p><Callout title="Core principle">Safe resolution is more valuable than coverage. A model may propose an interpretation; it never becomes the financial authority.</Callout></Section>

        <Section id="narrowing" eyebrow="02 / Scope" title="Problem narrowing"><p>The unit of work is a bank record compared with ledger records. Tally is not a general accounting platform or a universal payment settlement product.</p><Table headers={["In scope", "Out of scope"]} rows={[["Exact, normalized, contextual, semantic, timing, grouped, discrepancy, duplicate, ambiguous, and missing-evidence cases", "Payment ↔ settlement as the core workflow; live provider integrations"],["Four explicit outcomes, abstention, measured evaluation, persistence, and observable trace", "Journal posting, accounting software, tax, forecasting, invoice processing, email/contracts"],["Bounded one-to-many and many-to-one relationships", "Many-to-many, autonomous edits, and unnecessary distributed infrastructure"],["Synthetic, truth-first benchmark with controlled distractors", "Auth/RBAC and enterprise production claims"]]} /></Section>

        <Section id="research" eyebrow="03 / Evidence" title="Real workflow research"><p>Research shaped the workflow around operational reconciliation. Razorpay’s settlement guidance distinguishes transaction and settlement views; Adyen documents transaction-level settlement reconciliation; Oracle’s matching material describes rules, supported transactions, manual matching, and assisted matching.</p><p>These sources support collecting exports, validating them, normalizing fields, applying conservative rules, investigating the remainder, verifying every proposal, and retaining an audit trail. They do not justify treating semantic similarity as proof.</p><div className="flex flex-wrap gap-2 text-sm"><a className="text-tally-accent underline underline-offset-4" href="https://razorpay.com/docs/payments/settlements/faqs/">Razorpay settlement FAQs</a><a className="text-tally-accent underline underline-offset-4" href="https://docs.adyen.com/reporting/settlement-reconciliation/transaction-level/">Adyen transaction-level reconciliation</a><a className="text-tally-accent underline underline-offset-4" href="https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/raarc/transaction_matching_about.html">Oracle transaction matching</a></div></Section>

        <Section id="scope-contract" eyebrow="04 / Frozen contract" title="Frozen scope"><p>The workflow is intentionally linear at its boundaries:</p><CodeBlock>{`collect → validate / parse → normalize → deterministic rules
→ candidate generation → agent investigation → verifier
 → final outcome → persistence + trace`}</CodeBlock><Table headers={["Outcome", "Meaning"]} rows={outcomes} /><Callout tone="warning" title="Boundaries that do not move">No foreign-exchange conversion, floating-point money arithmetic, invented identifiers, unsupported relationship shapes, or hidden chain-of-thought are accepted as shortcuts.</Callout></Section>

        <Section id="benchmark" eyebrow="05 / Measurement" title="Benchmark"><p>The benchmark is synthetic, truth-first, deterministic, and frozen before final evaluation. Truth generates controlled scenarios and scores them later; it is never placed in runtime CSV fields. IDs, row order, amounts, counterparties, dates, and distractors vary to prevent category or case-ID leakage.</p><Table headers={["Scenario family", "Cases"]} rows={benchmark} /><p>The 100-case benchmark is distinct from the smaller development fixture. Quality checks include shuffled rows, repeated values, runtime schemas without truth fields, no category leakage, and deterministic regeneration.</p></Section>

        <Section id="rules" eyebrow="06 / Deterministic first" title="Deterministic rules"><p>Rules run in order from strongest evidence to bounded grouped relationships. Every rule requires uniqueness and hard compatibility; a candidate is not a match merely because it appears in a candidate list.</p><Table headers={["Rule", "Name", "Required evidence"]} rows={rules} /><p>The benchmark date window is <code className="rounded bg-tally-surface-subtle px-1.5 py-0.5 text-sm text-tally-ink">-1 day ≤ bank_date - ledger_date ≤ +3 days</code>. This is project configuration, not an accounting standard. Money becomes integer paise and is compared with bigint arithmetic; there is no floating-point comparison or FX conversion.</p><Callout tone="neutral" title="Hard compatibility">Existence, reuse, currency, and direction are mechanically checked. Semantic matching does not override these constraints.</Callout></Section>

        <Section id="agent" eyebrow="07 / Controlled reasoning" title="Agent + verifier"><p>Candidate generation exposes only mechanically related records using reference, normalized reference, batch, exact amount, normalized counterparty, and date signals. The reasoning model receives the primary plus supplied candidates in a closed world: it cannot invent IDs or search outside that set.</p><p>An agent may propose only <code className="text-tally-ink">MATCH</code>, <code className="text-tally-ink">TIMING_DIFFERENCE</code>, <code className="text-tally-ink">DISCREPANCY</code>, or <code className="text-tally-ink">INSUFFICIENT_EVIDENCE</code>. Its structured response contains an outcome proposal, IDs, qualitative confidence, evidence, conflicting evidence, and a concise reason—not hidden chain-of-thought.</p><p>The verifier is authoritative. It checks existence, candidate membership, primary participation, relationship shape, reuse, compatibility, exact amounts or group sums, and evidence. Unsupported positive claims become safe unresolved outcomes.</p><Table headers={["Reason family", "Codes"]} rows={[["Reconciled", "EXACT_MATCH · NORMALIZED_REFERENCE_MATCH · SEMANTIC_REFERENCE_MATCH · COUNTERPARTY_MATCH · GROUPED_MATCH · MULTI_EVIDENCE_MATCH"],["Explained", "TIMING_DIFFERENCE"],["Discrepancy", "AMOUNT_DISCREPANCY · CONFLICTING_RECORDS · DUPLICATE_USAGE"],["Unresolved", "NO_CANDIDATE · MULTIPLE_PLAUSIBLE_CANDIDATES · INSUFFICIENT_EVIDENCE · VERIFICATION_FAILED"]]} /></Section>

        <Section id="architecture" eyebrow="08 / System" title="System architecture"><div className="grid gap-2 sm:grid-cols-2">{["Bank CSV + Ledger CSV", "CSV validation", "Normalization", "Deterministic rules", "Remaining cases + candidates", "Reasoning model", "Deterministic verifier", "Final outcome", "Persistence + trace"].map((step, index) => <div className={"rounded border px-4 py-3 " + (index === 0 ? "border-tally-accent bg-tally-accent-soft" : index === 8 ? "border-tally-warning bg-tally-warning-soft" : "border-tally-border bg-tally-surface")} key={step}><span className="mr-2 text-xs font-semibold text-tally-accent">{String(index + 1).padStart(2, "0")}</span><span className="font-medium text-tally-ink">{step}</span></div>)}</div><p>Parsing and normalization establish safe inputs. Deterministic rules commit obvious relationships. Candidate generation narrows the search space. The model proposes; the verifier checks; persistence stores completed runs, results, and trace atomically.</p><p>Model proposals can run concurrently, but financial verification and commits are serialized in deterministic work order. Parallel calls do not imply parallel commits.</p><Callout title="Trace is an audit surface">Trace records observable events—rule evaluations, proposals, verification, committed outcomes, and finalization. It does not expose private reasoning.</Callout></Section>

        <Section id="experiments" eyebrow="09 / Evaluation plan" title="Experiments"><p>The evaluator loads frozen ground truth only after runtime processing. Results align to runtime-owned case identities, including the finalization contract for duplicate-usage cases. A wrong counterpart is a false reconciliation even if its outcome label says reconciled.</p><Table headers={["Metric", "Definition"]} rows={metrics} /><p>Zero denominators produce <code className="text-tally-ink">0</code>; metrics are unrounded ratios in <code className="text-tally-ink">[0,1]</code>. The evaluation endpoint is read-only and does not rerun reconciliation or model calls.</p></Section>

        <Section id="failures" eyebrow="10 / Safety" title="Failures are part of the design"><p>Ambiguous evidence, missing candidates, conflicting records, duplicate usage, malformed input, verification failures, and infrastructure failures are distinct classes. They must not be hidden behind a successful-looking match.</p><Callout tone="warning" title="Abstention is a valid result">When evidence cannot support a verified relationship, Tally returns UNRESOLVED. This preserves reviewability and prevents a probabilistic guess from becoming a financial fact.</Callout><p>Known limitations include synthetic data, no live integrations, one workflow, no many-to-many support, no FX, no auth/RBAC, and model-dependent semantic interpretation. This is an engineering system and research baseline, not a production-ready enterprise reconciliation claim.</p></Section>

        <Section id="results" eyebrow="11 / Current status" title="Final results / methodology"><p>The methodology and evaluator are in place for later measured runs. Final benchmark accuracy, precision, recall, and failure counts are intentionally not claimed here because those experiments are not part of this documentation task.</p><p>When results are available, report the frozen artifact version, runtime configuration, deterministic baseline, model configuration, full metric table, error taxonomy, and representative trace links. The format is designed to make results reproducible.</p><Callout tone="neutral" title="Next measurement step">Run the frozen 100-case benchmark through the production-shaped pipeline, then publish observed metrics and failure analysis without modifying the benchmark after seeing results.</Callout></Section>
      </article>
      <aside className="hidden lg:block"><nav className="sticky top-6" aria-label="On this page"><p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-tally-ink-muted">On this page</p><div className="space-y-2 border-l border-tally-border pl-4">{toc.map(([id, label]) => <a className="block text-sm text-tally-ink-muted transition-colors hover:text-tally-ink" href={"#" + id} key={id}>{label}</a>)}</div></nav></aside>
    </main>
  </div>;
}
