"use client";

import { useEffect, useMemo, useState } from "react";
import React from "react";
import type { TraceEvent } from "@tally/contracts";

import { getRunTrace } from "../../lib/api/runs";
import {
  caseOptions,
  displayValue,
  eventMatches,
  eventSummary,
  payloadOf,
  proposalEvidence,
  readableCode,
  recordIdsFor,
  ruleLabel,
  stringArray,
  stringValue,
  numberValue,
  traceMeta,
  type TraceStage,
} from "../../lib/trace/event-display";

const stages: Array<TraceStage | "ALL"> = ["ALL", "Run", "Normalize", "Rules", "Candidates", "Agent", "Verifier", "Outcome"];

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function Header({ runId, count }: { runId?: string; count: number }) {
  return (
    <header className="flex min-h-[52px] flex-wrap items-center gap-x-4 border-b border-tally-border bg-tally-surface px-4 sm:h-[52px] sm:flex-nowrap sm:px-6">
      <a className="inline-flex items-center gap-[9px] text-[15px] font-semibold tracking-[-.01em] text-tally-ink no-underline" href="/" aria-label="Tally dashboard"><img src="/tally-logo.png" alt="" aria-hidden="true" className="size-5 shrink-0 object-contain" /><span>Tally</span></a>
      <nav className="order-3 flex h-10 w-full gap-4 sm:order-none sm:ml-8 sm:h-full sm:w-auto sm:gap-5" aria-label="Primary navigation">
        <a className="inline-flex items-center border-b-2 border-transparent text-[13px] text-tally-ink-muted no-underline" href="/">Dashboard</a>
        <a className="inline-flex items-center border-b-2 border-tally-accent font-semibold text-[13px] text-tally-ink no-underline" href="/trace">Trace</a>
        <a className="inline-flex items-center border-b-2 border-transparent text-[13px] text-tally-ink-muted no-underline" href="/docs">Docs</a>
      </nav>
      <span className="ml-auto text-xs text-tally-ink-muted">Execution inspection</span>
      {runId && <span className="hidden font-tally-mono text-xs text-tally-ink-secondary lg:inline">{count} events</span>}
    </header>
  );
}

function EvidenceBlock({ title, items }: { title: string; items: Array<Record<string, unknown>> }) {
  if (items.length === 0) return null;
  return <section className="mt-4 border-t border-tally-border-subtle pt-4"><h4 className="mb-2 text-xs font-semibold text-tally-ink-secondary">{title}</h4><ul className="m-0 grid list-none gap-2 p-0">{items.map((item, index) => <li className="rounded border border-tally-border-subtle bg-tally-surface-subtle p-2.5" key={`${displayValue(item.statement)}-${index}`}><p className="m-0 break-words text-sm leading-5">{displayValue(item.statement)}</p>{stringArray(item, "recordIds").length > 0 && <p className="m-1.5 mb-0 break-words font-tally-mono text-xs text-tally-ink-muted">{stringArray(item, "recordIds").join(", ")}</p>}</li>)}</ul></section>;
}

function PayloadDetails({ event }: { event: TraceEvent }) {
  const payload = payloadOf(event);
  const candidateIds = recordIdsFor(event, "candidateRecordIds");
  const bankIds = recordIdsFor(event, "bankRecordIds");
  const ledgerIds = recordIdsFor(event, "ledgerRecordIds");
  const evidence = proposalEvidence(event, "evidence");
  const conflictingEvidence = proposalEvidence(event, "conflictingEvidence");

  if (event.type === "AGENT_PROPOSED") {
    return <div className="mt-4 border-t border-tally-border-subtle pt-4"><dl className="grid gap-2 sm:grid-cols-2"><div><dt className="text-xs text-tally-ink-muted">Proposed outcome</dt><dd className="mt-0.5 m-0 font-medium">{readableCode(stringValue(payload, "proposedOutcome") ?? "Not recorded")}</dd></div><div><dt className="text-xs text-tally-ink-muted">Confidence</dt><dd className="mt-0.5 m-0 font-medium">{stringValue(payload, "confidence") ?? "Not recorded"}</dd></div></dl><div className="mt-3 grid gap-2 sm:grid-cols-2"><div><p className="m-0 text-xs text-tally-ink-muted">Bank records</p><p className="mt-0.5 break-words font-tally-mono text-xs">{bankIds.join(", ") || "None"}</p></div><div><p className="m-0 text-xs text-tally-ink-muted">Ledger records</p><p className="mt-0.5 break-words font-tally-mono text-xs">{ledgerIds.join(", ") || "None"}</p></div></div>{stringValue(payload, "reason") && <p className="mt-3 mb-0 break-words text-sm leading-5">{stringValue(payload, "reason")}</p>}<EvidenceBlock title="Supporting evidence" items={evidence} /><EvidenceBlock title="Conflicting evidence" items={conflictingEvidence} /></div>;
  }

  if (event.type === "CANDIDATES_GENERATED") {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates.filter((candidate): candidate is Record<string, unknown> => candidate !== null && typeof candidate === "object") : [];
    return <div className="mt-4 border-t border-tally-border-subtle pt-4"><dl className="grid gap-2 sm:grid-cols-3"><div><dt className="text-xs text-tally-ink-muted">Eligible candidates</dt><dd className="mt-0.5 m-0 font-medium">{numberValue(payload, "totalEligibleCandidates") ?? candidateIds.length}</dd></div><div><dt className="text-xs text-tally-ink-muted">Displayed IDs</dt><dd className="mt-0.5 m-0 font-medium">{candidateIds.length}</dd></div><div><dt className="text-xs text-tally-ink-muted">Candidate list</dt><dd className="mt-0.5 m-0 font-medium">{payload.truncated === true ? "Truncated" : "Complete"}</dd></div></dl>{candidates.length > 0 ? <ul className="mt-3 grid list-none gap-2 p-0">{candidates.map((candidate) => { const facts = candidate.facts !== null && typeof candidate.facts === "object" ? candidate.facts as Record<string, unknown> : {}; return <li className="rounded border border-tally-border-subtle bg-tally-surface-subtle p-3" key={stringValue(candidate, "recordId") ?? displayValue(candidate)}><p className="m-0 text-sm font-semibold">Candidate {stringValue(candidate, "recordId") ?? "record"}</p><p className="mt-1 mb-0 text-xs text-tally-ink-secondary">{stringArray(candidate, "signals").map(readableCode).join(" · ") || "No selection signals recorded"}</p><dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-3">{Object.entries(facts).map(([key, value]) => <div key={key}><dt className="text-[11px] text-tally-ink-muted">{readableCode(key)}</dt><dd className="m-0 break-words font-tally-mono text-xs">{displayValue(value)}</dd></div>)}</dl></li>; })}</ul> : <p className="mt-3 mb-0 break-words font-tally-mono text-xs text-tally-ink-secondary">{candidateIds.join(", ") || "No candidate IDs recorded"}</p>}{payload.truncated === true && <p className="mt-3 mb-0 text-xs text-tally-warning">The persisted candidate list was truncated; hidden candidates are not inferred.</p>}</div>;
  }

  if (event.type === "RUN_COMPLETED" && payload.metrics !== null && typeof payload.metrics === "object") {
    const metrics = payload.metrics as Record<string, unknown>;
    const deterministic = (numberValue(metrics, "deterministicallyResolved") ?? 0) + (numberValue(metrics, "deterministicExceptions") ?? 0);
    const escalationRate = Math.round((numberValue(metrics, "aiEscalationRate") ?? 0) * 100);
    return <div className="mt-4 border-t border-tally-border-subtle pt-4"><div className="grid gap-2 sm:grid-cols-3"><p className="m-0 text-sm font-medium">{deterministic} deterministic</p><p className="m-0 text-sm font-medium">{escalationRate}% escalation rate</p><p className="m-0 text-sm font-medium">{numberValue(metrics, "aiAbstentions") ?? 0} abstentions</p></div><dl className="mt-3 grid gap-2 sm:grid-cols-3"><div><dt className="text-xs text-tally-ink-muted">Initial calls</dt><dd className="m-0 font-tally-mono text-xs">{numberValue(metrics, "initialAiCalls") ?? 0}</dd></div><div><dt className="text-xs text-tally-ink-muted">Repair calls</dt><dd className="m-0 font-tally-mono text-xs">{numberValue(metrics, "aiRepairCalls") ?? 0}</dd></div><div><dt className="text-xs text-tally-ink-muted">Duration</dt><dd className="m-0 font-tally-mono text-xs">{numberValue(metrics, "durationMs") ?? 0} ms</dd></div></dl></div>;
  }

  if (event.type === "VERIFICATION_CHECKED") {
    const result = payload.result !== null && typeof payload.result === "object" ? payload.result as Record<string, unknown> : {};
    if (result.status === "VERIFIED") {
      const bankIds = stringArray(result, "bankRecordIds");
      const ledgerIds = stringArray(result, "ledgerRecordIds");
      return <div className="mt-4 border-t border-tally-border-subtle pt-4"><dl className="grid gap-2 sm:grid-cols-3"><div><dt className="text-xs text-tally-ink-muted">Verification status</dt><dd className="mt-0.5 m-0 font-medium">Verified</dd></div><div><dt className="text-xs text-tally-ink-muted">Bank records</dt><dd className="mt-0.5 m-0 break-words font-tally-mono text-xs">{bankIds.join(", ") || "None"}</dd></div><div><dt className="text-xs text-tally-ink-muted">Ledger records</dt><dd className="mt-0.5 m-0 break-words font-tally-mono text-xs">{ledgerIds.join(", ") || "None"}</dd></div></dl>{stringValue(result, "outcome") && <p className="mt-3 mb-0">Outcome: <span className="font-medium">{readableCode(stringValue(result, "outcome")!)}</span></p>}{stringValue(result, "reasonCode") && <p className="mt-1 mb-0 font-tally-mono text-xs text-tally-ink-muted">{stringValue(result, "reasonCode")}</p>}{stringValue(result, "amountDeltaPaise") && <p className="mt-1 mb-0 font-tally-mono text-xs text-tally-ink-muted">Amount delta: {stringValue(result, "amountDeltaPaise")}</p>}</div>;
    }

    const failures = Array.isArray(result.failures) ? result.failures.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : [];
    return <div className="mt-4 border-t border-tally-border-subtle pt-4"><p className="m-0 font-medium">Verification rejected</p>{failures.length > 0 ? <ul className="m-1.5 grid list-disc gap-2 pl-4 text-sm">{failures.map((failure, index) => { const code = stringValue(failure, "code") ?? "Verification failure"; const message = stringValue(failure, "message"); const recordIds = stringArray(failure, "recordIds"); return <li key={`${code}-${index}`}><span className="font-medium">{readableCode(code)}</span> <span className="font-tally-mono text-xs text-tally-ink-muted">{code}</span>{message && <p className="mt-0.5 mb-0 break-words">{message}</p>}{recordIds.length > 0 && <p className="mt-0.5 mb-0 break-words font-tally-mono text-xs text-tally-ink-muted">Records: {recordIds.join(", ")}</p>}</li>; })}</ul> : <p className="mt-2 mb-0 text-sm text-tally-ink-muted">No failure details were recorded.</p>}</div>;
  }

  const fields = Object.entries(payload).filter(([key]) => key !== "result" && key !== "failures");
  return fields.length === 0 ? null : <dl className="mt-4 grid gap-2 border-t border-tally-border-subtle pt-4 sm:grid-cols-2">{fields.map(([key, value]) => <div className="min-w-0" key={key}><dt className="text-xs text-tally-ink-muted">{readableCode(key)}</dt><dd className="mt-0.5 m-0 break-words font-tally-mono text-xs text-tally-ink-secondary">{displayValue(value)}</dd></div>)}</dl>;
}

function TraceEventRow({ event }: { event: TraceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = traceMeta(event);
  return <li className="relative pl-12 sm:pl-16"><span className="absolute left-[15px] top-5 size-2.5 rounded-full border-2 border-tally-surface bg-tally-accent shadow-[0_0_0_1px_theme(colors.tally.border)]" aria-hidden="true" /><div className="rounded border border-tally-border bg-tally-surface px-4 py-3 shadow-[0_1px_2px_rgb(23_24_23/0.04)]"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-tally-mono text-xs font-semibold text-tally-ink-muted">#{event.sequenceNo ?? "—"}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.stageClassName}`}>{meta.stage}</span><span className="text-xs font-semibold text-tally-ink-secondary">{meta.label}</span></div><p className="mt-1.5 mb-0 break-words text-sm text-tally-ink">{eventSummary(event)}</p><p className="mt-1 mb-0 break-words text-xs text-tally-ink-muted">{event.caseId === null ? "Run-level event" : `Case ${event.caseId}`}</p></div><button className="min-h-8 shrink-0 self-start rounded border border-tally-border px-2.5 py-1 text-xs font-semibold text-tally-ink-secondary hover:bg-tally-surface-subtle focus-visible:outline-tally-accent" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide details" : "Show details"}</button></div>{expanded && <PayloadDetails event={event} />}</div></li>;
}

export default function TracePage({ runId }: { runId?: string }) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [selectedCase, setSelectedCase] = useState("ALL");
  const [selectedStage, setSelectedStage] = useState<TraceStage | "ALL">("ALL");
  const [isLoading, setIsLoading] = useState(Boolean(runId));
  const [error, setError] = useState<"not-found" | "unavailable" | "generic" | null>(null);

  useEffect(() => {
    if (runId === undefined) {
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    setError(null);
    void getRunTrace(runId).then((nextEvents) => {
      if (!active) return;
      setEvents(nextEvents);
      setIsLoading(false);
    }).catch((failure: unknown) => {
      if (!active) return;
      const code = errorCode(failure) ?? (failure instanceof Error && failure.message.toLowerCase().includes("run not found") ? "RUN_NOT_FOUND" : "");
      setError(code === "RUN_NOT_FOUND" ? "not-found" : code === "TRACE_NOT_FOUND" ? "unavailable" : "generic");
      setEvents([]);
      setIsLoading(false);
    });
    return () => { active = false; };
  }, [runId]);

  const cases = useMemo(() => caseOptions(events), [events]);
  const visibleEvents = useMemo(() => events.filter((event) => eventMatches(event, selectedCase, selectedStage)), [events, selectedCase, selectedStage]);

  return <div className="min-h-screen"><Header runId={runId} count={events.length} /><main className="mx-auto w-full max-w-[1200px] px-4 pb-14 pt-[22px] sm:px-6 sm:pt-7"><div className="mb-6 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end"><div><div className="text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted">Execution inspection</div><h1 className="mb-1 mt-1 text-2xl font-semibold leading-[30px] tracking-[-.025em]">Reconciliation trace</h1><p className="m-0 max-w-[660px] text-tally-ink-secondary">Inspect the persisted execution sequence. This view shows recorded runtime events only.</p></div>{runId && <div className="font-tally-mono text-xs text-tally-ink-secondary">runId={runId}</div>}</div>
    {runId === undefined ? <section className="rounded border border-tally-border bg-tally-surface px-6 py-14 text-center" aria-labelledby="trace-ready-heading"><h2 id="trace-ready-heading" className="mb-2 text-lg font-semibold">Select a reconciliation run</h2><p className="mx-auto m-0 max-w-[440px] text-tally-ink-secondary">Open Trace from a completed run or use <span className="font-tally-mono text-xs">/trace?runId=…</span> to inspect its recorded execution.</p><a className="mt-5 inline-flex min-h-[38px] items-center rounded border border-tally-accent bg-tally-accent px-[14px] py-2 font-semibold text-white no-underline hover:bg-tally-accent/90" href="/">Back to dashboard</a></section> : isLoading ? <section className="rounded border border-tally-border bg-tally-surface px-6 py-14 text-center" aria-live="polite"><h2 className="mb-2 text-lg font-semibold">Loading trace</h2><p className="m-0 text-tally-ink-secondary">Loading persisted execution events…</p></section> : error === "not-found" ? <section className="rounded border border-tally-border bg-tally-surface px-6 py-14 text-center" role="alert"><h2 className="mb-2 text-lg font-semibold">Run not found</h2><p className="m-0 text-tally-ink-secondary">No persisted trace is available for this run ID.</p></section> : error === "unavailable" ? <section className="rounded border border-tally-border bg-tally-surface px-6 py-14 text-center" role="alert"><h2 className="mb-2 text-lg font-semibold">Trace unavailable</h2><p className="m-0 text-tally-ink-secondary">This run has no persisted execution trace. No events were synthesized.</p></section> : error === "generic" ? <section className="rounded border border-tally-border bg-tally-surface px-6 py-14 text-center" role="alert"><h2 className="mb-2 text-lg font-semibold">Trace could not be loaded</h2><p className="m-0 text-tally-ink-secondary">The persisted execution history is temporarily unavailable. Try opening the trace again.</p></section> : <><section className="mb-5 rounded border border-tally-border bg-tally-surface p-4" aria-labelledby="trace-controls-heading"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="trace-controls-heading" className="m-0 text-base font-semibold">Trace controls</h2><p className="mt-1 mb-0 text-sm text-tally-ink-secondary">Filtering changes the view only; the stored sequence is not modified.</p></div><div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2"><label className="grid gap-1.5 text-xs text-tally-ink-muted" htmlFor="trace-case-filter">Case<select id="trace-case-filter" className="h-[36px] min-w-[190px] rounded border border-tally-border bg-tally-surface px-2 py-1.5 text-tally-ink focus-visible:outline-tally-accent" value={selectedCase} onChange={(event) => setSelectedCase(event.target.value)}><option value="ALL">All cases</option>{cases.map((caseId) => <option key={caseId} value={caseId}>{caseId}</option>)}</select></label><label className="grid gap-1.5 text-xs text-tally-ink-muted" htmlFor="trace-stage-filter">Stage<select id="trace-stage-filter" className="h-[36px] min-w-[150px] rounded border border-tally-border bg-tally-surface px-2 py-1.5 text-tally-ink focus-visible:outline-tally-accent" value={selectedStage} onChange={(event) => setSelectedStage(event.target.value as TraceStage | "ALL")}><option value="ALL">All stages</option>{stages.slice(1).map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label></div></div></section><section aria-labelledby="trace-events-heading"><div className="mb-3 flex items-center justify-between gap-4"><div><h2 id="trace-events-heading" className="m-0 text-base font-semibold">Recorded events</h2><p className="mt-1 mb-0 text-sm text-tally-ink-secondary">{visibleEvents.length} of {events.length} events · sequence order preserved</p></div><span className="font-tally-mono text-xs text-tally-ink-muted">{events.length} total</span></div>{visibleEvents.length === 0 ? <div className="rounded border border-tally-border bg-tally-surface px-6 py-12 text-center"><p className="m-0 text-tally-ink-secondary">No recorded events match these filters.</p></div> : <ol className="relative m-0 grid list-none gap-3 p-0 before:absolute before:bottom-3 before:left-[19px] before:top-3 before:w-px before:w-px before:bg-tally-border sm:before:left-[23px]">{visibleEvents.map((event) => <TraceEventRow event={event} key={event.eventId} />)}</ol>}</section></>}
  </main></div>;
}
