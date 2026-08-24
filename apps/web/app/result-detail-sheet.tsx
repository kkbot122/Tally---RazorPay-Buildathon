"use client";

import { useEffect, useRef } from "react";
import React from "react";
import type { AgentEvidence } from "@tally/contracts";

import type { RunResult } from "../lib/api/runs";
import { formatPaise } from "../lib/reconciliation/format-paise";

const outcomeStyles: Record<RunResult["finalOutcome"], string> = {
  RECONCILED: "bg-tally-success-soft text-tally-success",
  EXPLAINED_OUTSTANDING: "bg-tally-warning-soft text-tally-warning",
  DISCREPANCY: "bg-tally-danger-soft text-tally-danger",
  UNRESOLVED: "bg-tally-warning-soft text-tally-warning",
};

const outcomeLabels: Record<RunResult["finalOutcome"], string> = {
  RECONCILED: "Reconciled",
  EXPLAINED_OUTSTANDING: "Explained outstanding",
  DISCREPANCY: "Discrepancy",
  UNRESOLVED: "Unresolved",
};

const sourceLabels: Record<string, string> = {
  DETERMINISTIC: "Deterministic",
  AGENT_VERIFIED: "Agent verified",
};

function readableCode(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function EvidenceList({ title, items, conflicting = false }: { title: string; items: AgentEvidence[]; conflicting?: boolean }) {
  if (items.length === 0) return null;
  return (
    <section className={`border-t border-tally-border-subtle pt-5 ${conflicting ? "border-l-2 border-l-tally-danger pl-4" : ""}`} aria-labelledby={`${conflicting ? "conflicting" : "supporting"}-evidence-heading`}>
      <h3 id={`${conflicting ? "conflicting" : "supporting"}-evidence-heading`} className="mb-1 text-sm font-semibold">{title}</h3>
      {!conflicting && <p className="mb-3 text-xs text-tally-ink-muted">Structured evidence supplied to the verifier.</p>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {items.map((item, index) => (
          <li className="rounded border border-tally-border-subtle bg-tally-surface-subtle p-3" key={`${item.statement}-${index}`}>
            <p className="m-0 break-words leading-5">{item.statement}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-tally-ink-muted"><span>{readableCode(item.source)}</span>{item.recordIds.length > 0 && <span className="font-tally-mono">{item.recordIds.join(", ")}</span>}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecordGroup({ label, ids, emptyLabel }: { label: string; ids: string[]; emptyLabel: string }) {
  return (
    <div className="min-w-0 rounded border border-tally-border-subtle bg-tally-surface-subtle p-3">
      <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted">{label}</h3>
      {ids.length === 0 ? <p className="m-0 text-sm text-tally-ink-muted">{emptyLabel}</p> : <ul className="m-0 grid list-none gap-1 p-0">{ids.map((id) => <li className="break-words font-tally-mono text-xs text-tally-ink" key={id}>{id}</li>)}</ul>}
    </div>
  );
}

type ResultDetailSheetProps = {
  result: RunResult;
  onClose: () => void;
};

export default function ResultDetailSheet({ result, onClose }: ResultDetailSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const isAgentVerified = result.source === "AGENT_VERIFIED";
  const evidence = result.evidence ?? [];
  const conflictingEvidence = result.conflictingEvidence ?? [];
  const hasAmountDifference = result.reasonCode === "AMOUNT_DISCREPANCY" || result.amountDeltaPaise !== null && result.amountDeltaPaise !== undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button className="absolute inset-0 cursor-default bg-tally-ink/20" type="button" aria-label="Dismiss result detail backdrop" onClick={onClose} />
      <aside ref={dialogRef} className="relative flex h-full w-full max-w-[520px] flex-col overflow-y-auto border-l border-tally-border bg-tally-surface shadow-[0_8px_30px_rgb(23_24_23/0.12)]" role="dialog" aria-modal="true" aria-labelledby="result-detail-title" aria-describedby="result-detail-description">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-tally-border bg-tally-surface px-5 py-4">
          <div className="min-w-0"><p className="m-0 text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted">Result detail</p><h2 id="result-detail-title" className="mt-1 break-words text-lg font-semibold leading-6">{result.caseId}</h2><p id="result-detail-description" className="mt-1 m-0 text-sm text-tally-ink-secondary">Inspect the persisted final decision and its structured evidence.</p></div>
          <button ref={closeButtonRef} className="grid size-9 shrink-0 place-items-center rounded border border-tally-border bg-tally-surface text-xl leading-none text-tally-ink-secondary hover:bg-tally-surface-subtle" type="button" aria-label="Close result details" onClick={onClose}>×</button>
        </header>

        <div className="grid gap-6 p-5">
          <section aria-labelledby="decision-heading"><div className="mb-3 flex items-center justify-between gap-3"><h3 id="decision-heading" className="m-0 text-base font-semibold">Final decision</h3><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-xs font-semibold before:size-1.5 before:rounded-full before:bg-current before:content-[''] ${outcomeStyles[result.finalOutcome]}`}>{outcomeLabels[result.finalOutcome]}</span></div><dl className="m-0 grid gap-3"><div><dt className="text-xs text-tally-ink-muted">Reason code</dt><dd className="mt-0.5 m-0"><span className="font-medium">{readableCode(result.reasonCode)}</span><span className="ml-2 font-tally-mono text-xs text-tally-ink-muted">{result.reasonCode}</span></dd></div>{result.reason && <div><dt className="text-xs text-tally-ink-muted">Decision rationale</dt><dd className="mt-0.5 m-0 break-words leading-5">{result.reason}</dd></div>}</dl></section>

          <section className="border-t border-tally-border-subtle pt-5" aria-labelledby="relationship-heading"><h3 id="relationship-heading" className="mb-3 text-sm font-semibold">Relationship</h3><div className="grid gap-3 sm:grid-cols-2"><RecordGroup label="Bank records" ids={result.bankTxnIds} emptyLabel="No matched bank record" /><RecordGroup label="Ledger records" ids={result.ledgerTxnIds} emptyLabel="No matched ledger record" /></div></section>

          <section className="border-t border-tally-border-subtle pt-5" aria-labelledby="metadata-heading"><h3 id="metadata-heading" className="mb-3 text-sm font-semibold">Decision metadata</h3><dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-tally-ink-muted">Source</dt><dd className="mt-0.5 m-0">{sourceLabels[result.source ?? ""] ?? result.source ?? "Not recorded"}</dd></div>{result.rule && <div><dt className="text-xs text-tally-ink-muted">Rule</dt><dd className="mt-0.5 m-0 font-tally-mono text-xs">{result.rule}</dd></div>}{isAgentVerified && result.confidence && <div><dt className="text-xs text-tally-ink-muted">Agent confidence</dt><dd className="mt-0.5 m-0">{result.confidence}</dd></div>}</dl></section>

          {hasAmountDifference && <section className="border-t border-tally-border-subtle pt-5" aria-labelledby="amount-heading"><h3 id="amount-heading" className="mb-2 text-sm font-semibold">Amount difference</h3>{result.amountDeltaPaise ? <p className="m-0 font-tally-mono text-base tabular-nums">{formatPaise(result.amountDeltaPaise)}</p> : <p className="m-0 text-sm text-tally-ink-muted">Amount delta was not persisted for this result.</p>}</section>}

          {isAgentVerified && <EvidenceList title="Supporting evidence" items={evidence} />}
          {isAgentVerified && <EvidenceList title="Conflicting evidence" items={conflictingEvidence} conflicting />}
        </div>
      </aside>
    </div>
  );
}
