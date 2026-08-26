"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import React from "react";
import type { FinalOutcome } from "@tally/contracts";

import { createRun, getRun, getRunResults, type RunResult, type RunSummary } from "../lib/api/runs";
import { createSubmissionLock, filterResults, isRunFormComplete, summarizeResults } from "../lib/dashboard-model";
import ResultDetailSheet from "./result-detail-sheet";

type OutcomeFilter = "ALL" | FinalOutcome;

const outcomes: Array<{ value: OutcomeFilter; label: string }> = [
  { value: "ALL", label: "All outcomes" },
  { value: "RECONCILED", label: "Reconciled" },
  { value: "EXPLAINED_OUTSTANDING", label: "Explained outstanding" },
  { value: "DISCREPANCY", label: "Discrepancy" },
  { value: "UNRESOLVED", label: "Unresolved" },
];

const surface = "rounded border border-tally-border bg-tally-surface";
const sectionTitle = "m-0 mb-1 text-base font-semibold leading-[22px]";
const sectionDescription = "m-0 text-tally-ink-secondary";
const fieldLabel = "text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted";
const control = "h-[38px] w-full rounded border border-tally-border bg-tally-surface px-[9px] py-[7px] text-tally-ink focus-visible:outline-tally-accent";
const secondaryButton = "min-h-[38px] rounded border border-tally-border bg-tally-surface px-[14px] py-2 font-semibold text-tally-ink-secondary hover:bg-tally-surface-subtle";

const outcomeStyles: Record<FinalOutcome, string> = {
  RECONCILED: "bg-tally-success-soft text-tally-success",
  EXPLAINED_OUTSTANDING: "bg-tally-warning-soft text-tally-warning",
  DISCREPANCY: "bg-tally-danger-soft text-tally-danger",
  UNRESOLVED: "bg-tally-warning-soft text-tally-warning",
};

const distributionStyles = {
  RECONCILED: "bg-tally-success",
  EXPLAINED_OUTSTANDING: "bg-tally-warning",
  DISCREPANCY: "bg-tally-danger",
  UNRESOLVED: "bg-tally-ink-muted",
} as const;

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function percentage(value: number, total: number): string {
  return `${(total === 0 ? 0 : (value / total) * 100).toFixed(1)}%`;
}

function metricSeparatorClasses(index: number): string {
  return [
    "border-r",
    index % 2 === 1 ? "border-r-0" : "",
    index >= 2 ? "border-t" : "",
    "sm:border-r",
    index % 3 === 2 ? "sm:border-r-0" : "",
    index === 2 ? "sm:border-t-0" : "",
    index >= 3 ? "sm:border-t" : "",
    "lg:border-r",
    index === 5 ? "lg:border-r-0" : "",
    "lg:border-t-0",
  ].filter(Boolean).join(" ");
}

function outcomeLabel(outcome: FinalOutcome): string {
  return outcomes.find((item) => item.value === outcome)?.label ?? outcome;
}

function statusStyles(status: RunSummary["status"]): string {
  return status === "COMPLETED"
    ? "bg-tally-success-soft text-tally-success"
    : status === "PROCESSING" || status === "PENDING"
      ? "bg-tally-warning-soft text-tally-warning"
      : "bg-tally-danger-soft text-tally-danger";
}

function StatusBadge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-xs font-semibold before:size-1.5 before:rounded-full before:bg-current before:content-[''] ${className}`}>{children}</span>;
}

export default function Dashboard() {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [ledgerFile, setLedgerFile] = useState<File | null>(null);
  const [asOfDate, setAsOfDate] = useState("");
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [filter, setFilter] = useState<OutcomeFilter>("ALL");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [readErrorCode, setReadErrorCode] = useState<string | undefined>(undefined);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [hasLoadedRunData, setHasLoadedRunData] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<RunResult | null>(null);
  const submissionLock = useRef(createSubmissionLock());
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);

  const filteredResults = useMemo(() => filterResults(results, filter), [filter, results]);
  const { total, reconciled, explainedOutstanding: explained, discrepancies: discrepancy, unresolved } = summarizeResults(results);
  const resolved = total - unresolved;

  function openResult(result: RunResult, trigger: HTMLButtonElement) {
    selectedTriggerRef.current = trigger;
    setSelectedResult(result);
  }

  const closeResult = useCallback(() => {
    setSelectedResult(null);
    window.setTimeout(() => selectedTriggerRef.current?.focus(), 0);
  }, []);

  function selectCsvFile(file: File | undefined, role: "bank" | "ledger") {
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      if (role === "bank") setBankFile(null); else setLedgerFile(null);
      setError(`${role === "bank" ? "Bank" : "Ledger"} transactions must be a .csv file.`);
      return;
    }
    if (role === "bank") setBankFile(file); else setLedgerFile(file);
    setError(null);
  }

  async function loadRunData(runId: string) {
    setIsLoadingResults(true);
    setReadError(null);
    setReadErrorCode(undefined);
    try {
      const nextSummary = await getRun(runId);
      if (nextSummary.status === "FAILED") {
        setSummary(nextSummary);
        throw Object.assign(new Error(`Run ${runId} failed operationally; no finance outcome was produced.`), { code: "RUN_FAILED" });
      }
      if (nextSummary.status !== "COMPLETED") throw new Error(`Run ${runId} is still ${nextSummary.status.toLowerCase()}.`);
      const nextResults = await getRunResults(runId);
      setSummary(nextSummary);
      setResults(nextResults);
      setHasLoadedRunData(true);
      setFilter("ALL");
    } catch (readFailure) {
      setHasLoadedRunData(false);
      setReadError(readFailure instanceof Error ? readFailure.message : "Run data could not be loaded.");
      setReadErrorCode(errorCode(readFailure));
    } finally {
      setIsLoadingResults(false);
    }
  }

  async function waitForRun(runId: string) {
    const deadline = Date.now() + 15 * 60 * 1000;
    while (true) {
      const nextSummary = await getRun(runId);
      setSummary(nextSummary);
      if (nextSummary.status === "FAILED") {
        throw Object.assign(new Error(`Run ${runId} failed operationally; no finance outcome was produced.`), { code: "RUN_FAILED" });
      }
      if (nextSummary.status === "COMPLETED") {
        await loadRunData(runId);
        return;
      }
      setStatusMessage(`Reconciliation is ${nextSummary.status.toLowerCase()}…`);
      if (Date.now() >= deadline) throw new Error("The reconciliation run exceeded the client wait limit.");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
    }
  }

  async function runReconciliation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isRunFormComplete(bankFile, ledgerFile, asOfDate)) {
      setError("Choose both CSV files and an as-of date before running reconciliation.");
      return;
    }
    if (bankFile === null || ledgerFile === null) return;
    if (!submissionLock.current.tryAcquire()) return;
    setError(null);
    setReadError(null);
    setReadErrorCode(undefined);
    setSummary(null);
    setResults([]);
    setActiveRunId(null);
    setHasLoadedRunData(false);
    setStatusMessage("Reading files and starting reconciliation…");
    setIsRunning(true);
    let createdRunId: string | null = null;
    try {
      const [bankCsv, ledgerCsv] = await Promise.all([bankFile.text(), ledgerFile.text()]);
      const created = await createRun({ asOfDate, bankCsv, ledgerCsv });
      createdRunId = created.runId;
      setActiveRunId(created.runId);
      setSummary({ runId: created.runId, status: created.status, totalCases: 0, reconciled: 0, explainedOutstanding: 0, discrepancies: 0, unresolved: 0 });
      setResults([]);
      setStatusMessage("Reconciliation accepted. Waiting for results…");
      await waitForRun(created.runId);
      setStatusMessage(null);
    } catch (runError) {
      if (createdRunId !== null) {
        setReadError(errorCode(runError) === "RUN_FAILED"
          ? `Run ${createdRunId} failed operationally; no finance outcome was produced.`
          : runError instanceof Error ? runError.message : "Run results could not be loaded.");
        setReadErrorCode(errorCode(runError));
      } else {
        setError(errorCode(runError) === "SYSTEM_ERROR"
          ? "The reconciliation service is temporarily unavailable. No finance outcome was produced."
          : runError instanceof Error ? runError.message : "Reconciliation could not be completed.");
      }
      setStatusMessage(null);
    } finally {
      submissionLock.current.release();
      setIsRunning(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="flex min-h-[52px] flex-wrap items-center gap-x-4 border-b border-tally-border bg-tally-surface px-4 sm:h-[52px] sm:flex-nowrap sm:px-6">
        <a className="inline-flex items-center gap-[9px] text-[15px] font-semibold tracking-[-.01em] text-tally-ink no-underline" href="/" aria-label="Tally dashboard"><span className="grid size-5 place-items-center rounded border border-tally-ink text-[11px] font-bold">T</span><span>Tally</span></a>
        <nav className="order-3 flex h-10 w-full gap-4 sm:order-none sm:ml-8 sm:h-full sm:w-auto sm:gap-5" aria-label="Primary navigation">
          <a className="inline-flex items-center border-b-2 border-tally-accent font-semibold text-[13px] text-tally-ink no-underline" href="/">Dashboard</a>
          <a className="inline-flex items-center border-b-2 border-transparent text-[13px] text-tally-ink-muted no-underline" href="/trace">Trace</a>
          <a className="inline-flex items-center border-b-2 border-transparent text-[13px] text-tally-ink-muted no-underline" href="/docs">Docs</a>
        </nav>
        <span className="ml-auto text-xs text-tally-ink-muted">Runtime reconciliation</span>
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-4 pb-14 pt-[22px] sm:px-6 sm:pt-7">
        <div className="mb-6 flex flex-col items-start justify-between gap-6 sm:flex-row sm:gap-6">
          <div>
            <div className={fieldLabel}>Operational dashboard</div>
            <h1 className="mb-[5px] mt-1 text-2xl font-semibold leading-[30px] tracking-[-.025em]">Reconciliation control room</h1>
            <p className="m-0 max-w-[620px] text-tally-ink-secondary">Run a bank-to-books reconciliation and inspect the persisted operational outcomes that need attention.</p>
          </div>
          {summary !== null && <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="font-tally-mono text-xs">{summary.runId}</span><StatusBadge className={statusStyles(summary.status)}>{summary.status}</StatusBadge></div>{activeRunId !== null && <a className="text-xs font-semibold text-tally-accent underline-offset-2 hover:underline" href={`/trace?runId=${encodeURIComponent(activeRunId)}`}>View trace</a>}</div>}
        </div>

        <form className={`${surface} mb-6 p-5`} onSubmit={runReconciliation}>
          <h2 className={sectionTitle}>Start a reconciliation run</h2>
          <p className={sectionDescription}>Choose the two source files and the date used to evaluate outstanding timing differences.</p>
          <div className="mt-[18px] grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_auto]">
            <label className="grid min-w-0 gap-1.5" htmlFor="bank-file"><span className={fieldLabel}>Bank transactions CSV</span><input id="bank-file" className={`${control} p-1.5 text-[13px] file:mr-2 file:rounded-[3px] file:border file:border-tally-border file:bg-tally-surface-subtle file:px-2 file:py-[5px] file:text-tally-ink-secondary`} type="file" accept=".csv,text/csv" onChange={(event) => selectCsvFile(event.target.files?.[0], "bank")} /><span className="min-h-[18px] text-xs text-tally-ink-muted">{bankFile?.name ?? "No file selected"}</span></label>
            <label className="grid min-w-0 gap-1.5" htmlFor="ledger-file"><span className={fieldLabel}>Ledger transactions CSV</span><input id="ledger-file" className={`${control} p-1.5 text-[13px] file:mr-2 file:rounded-[3px] file:border file:border-tally-border file:bg-tally-surface-subtle file:px-2 file:py-[5px] file:text-tally-ink-secondary`} type="file" accept=".csv,text/csv" onChange={(event) => selectCsvFile(event.target.files?.[0], "ledger")} /><span className="min-h-[18px] text-xs text-tally-ink-muted">{ledgerFile?.name ?? "No file selected"}</span></label>
            <label className="grid min-w-0 gap-1.5" htmlFor="as-of-date"><span className={fieldLabel}>As-of date</span><input id="as-of-date" className={control} type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} /><span className="min-h-[18px] text-xs text-tally-ink-muted">Required</span></label>
            <button className="min-h-[38px] whitespace-nowrap rounded border border-tally-accent bg-tally-accent px-[14px] py-2 font-semibold text-white hover:bg-tally-accent/90 disabled:cursor-not-allowed disabled:opacity-[.55] sm:w-max lg:w-auto" type="submit" disabled={isRunning || bankFile === null || ledgerFile === null || asOfDate === ""}>{isRunning ? "Running…" : "Run reconciliation"}</button>
          </div>
          {statusMessage !== null && <p className="mt-[14px] text-tally-ink-secondary" role="status">{statusMessage}</p>}
          {error !== null && <p className="mt-[14px] border-l-[3px] border-tally-danger bg-tally-danger-soft px-3 py-2.5 text-tally-danger" role="alert">{error}</p>}
          {readError !== null && activeRunId !== null && <div className="mt-[14px] border-l-[3px] border-tally-danger bg-tally-danger-soft px-3 py-2.5 text-tally-danger" role="alert"><div>{readErrorCode === "RUN_FAILED" ? `Run ${activeRunId} failed operationally; no finance outcome was produced.` : <>Run <span className="font-tally-mono">{activeRunId}</span> was created, but its saved results could not be loaded.</>}</div><button className={`${secondaryButton} mt-2.5`} type="button" onClick={() => void loadRunData(activeRunId)} disabled={isLoadingResults}>{isLoadingResults ? "Retrying…" : "Retry loading results"}</button></div>}
        </form>

        {summary === null ? (
          <section className={`${surface} px-6 py-14 text-center`} aria-labelledby="ready-heading"><h2 id="ready-heading" className="mb-2 text-lg font-semibold">Ready for a run</h2><p className="mx-auto m-0 max-w-[440px] text-tally-ink-secondary">Upload the bank and ledger CSVs above to see completion status, operational counts, and the persisted result list here.</p></section>
        ) : !hasLoadedRunData && (summary.status === "PENDING" || summary.status === "PROCESSING") ? (
          <section className={`${surface} px-6 py-14 text-center`} role="status" aria-labelledby="run-progress-heading"><h2 id="run-progress-heading" className="mb-2 text-lg font-semibold">Reconciliation in progress</h2><p className="mx-auto m-0 max-w-[440px] text-tally-ink-secondary">The run is being processed in the background. This page will load the persisted results when it completes.</p></section>
        ) : !hasLoadedRunData ? (
          <section className={`${surface} px-6 py-14 text-center`} role="alert" aria-labelledby="results-unavailable-heading"><h2 id="results-unavailable-heading" className="mb-2 text-lg font-semibold">{readErrorCode === "RUN_FAILED" ? "Run failed" : "Run results unavailable"}</h2><p className="mx-auto m-0 max-w-[440px] text-tally-ink-secondary">{readErrorCode === "RUN_FAILED" ? "This operational failure produced no finance results. Resolve the underlying service issue before retrying." : "The run was created, but persisted finance results are not available yet. Use the retry control above to load them again."}</p></section>
        ) : (
          <>
            <section className={`${surface} mb-6 p-[18px] sm:px-5 sm:pb-5`} aria-labelledby="summary-heading">
              <h2 id="summary-heading" className={sectionTitle}>Run summary</h2>
              <p className={sectionDescription}>Operational counts from {summary.runId}; no benchmark or ground-truth metrics are used.</p>
              <div className="mt-4 grid grid-cols-2 border-y border-tally-border-subtle sm:grid-cols-3 lg:grid-cols-6">
                {[["Processed", total, "final results"], ["Reconciled", reconciled, `${percentage(reconciled, total)} of total`], ["Exceptions", explained + discrepancy + unresolved, "needs review or context"], ["Explained outstanding", explained, ""], ["Discrepancies", discrepancy, ""], ["Resolution rate", percentage(resolved, total), "not unresolved"]].map(([label, value, subtext], index) => <div className={`${metricSeparatorClasses(index)} min-h-[82px] border-tally-border-subtle px-4 py-[13px] first:pl-0`} key={label}><span className={fieldLabel}>{label}</span><strong className="mt-1.5 block text-2xl font-semibold leading-7 tabular-nums">{value}</strong>{subtext !== "" && <span className="text-xs text-tally-ink-muted">{subtext}</span>}</div>)}
              </div>
              <div className="mt-[18px] grid gap-[9px]" aria-label="Outcome distribution"><div className="flex h-2 overflow-hidden rounded-sm bg-tally-surface-subtle" aria-hidden="true">{(["RECONCILED", "EXPLAINED_OUTSTANDING", "DISCREPANCY", "UNRESOLVED"] as FinalOutcome[]).map((outcome) => { const value = { RECONCILED: reconciled, EXPLAINED_OUTSTANDING: explained, DISCREPANCY: discrepancy, UNRESOLVED: unresolved }[outcome]; return value > 0 ? <span className={`h-full ${distributionStyles[outcome]}`} style={{ width: `${value / total * 100}%` }} key={outcome} /> : null; })}</div><div className="flex flex-wrap gap-x-5 gap-y-3 text-xs text-tally-ink-secondary">{(["RECONCILED", "EXPLAINED_OUTSTANDING", "DISCREPANCY", "UNRESOLVED"] as FinalOutcome[]).map((outcome) => { const value = { RECONCILED: reconciled, EXPLAINED_OUTSTANDING: explained, DISCREPANCY: discrepancy, UNRESOLVED: unresolved }[outcome]; return <span className="inline-flex items-center gap-1.5" key={outcome}><i className={`size-2 rounded-sm ${distributionStyles[outcome]}`} />{outcomeLabel(outcome)} {value}</span>; })}</div></div>
            </section>

            <section className={`${surface} overflow-hidden`} aria-labelledby="results-heading">
              <div className="flex flex-col items-start justify-between gap-4 border-b border-tally-border px-5 py-[18px] sm:flex-row sm:items-center"><div><h2 id="results-heading" className={sectionTitle}>Reconciliation results</h2><p className={sectionDescription}>{filteredResults.length} of {total} persisted results</p></div><div className="flex w-full items-center justify-between gap-2 sm:w-auto"><label className="text-xs text-tally-ink-muted" htmlFor="outcome-filter">Filter</label><select id="outcome-filter" className="h-[34px] flex-1 rounded border border-tally-border bg-tally-surface px-2 py-[5px] text-tally-ink sm:flex-none" value={filter} onChange={(event) => setFilter(event.target.value as OutcomeFilter)}>{outcomes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div>
              {filteredResults.length === 0 ? <div className="px-5 py-9 text-center text-tally-ink-muted">No results match this outcome filter.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] border-collapse"><thead><tr><th className="bg-tally-surface-subtle px-4 py-2.5 text-left text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted" scope="col">Case</th><th className="bg-tally-surface-subtle px-4 py-2.5 text-left text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted" scope="col">Outcome</th><th className="bg-tally-surface-subtle px-4 py-2.5 text-left text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted" scope="col">Bank records</th><th className="bg-tally-surface-subtle px-4 py-2.5 text-left text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted" scope="col">Ledger records</th><th className="bg-tally-surface-subtle px-4 py-2.5 text-left text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted" scope="col">Reason</th><th className="bg-tally-surface-subtle px-4 py-2.5 text-left text-[11px] font-semibold uppercase leading-4 tracking-[.04em] text-tally-ink-muted" scope="col">Source</th></tr></thead><tbody>{filteredResults.map((result) => <tr className="hover:bg-tally-accent-soft" key={result.resultId ?? result.caseId}><td className="min-h-11 border-t border-tally-border-subtle px-4 py-3 align-middle"><button className="block max-w-full break-words text-left font-tally-mono text-xs text-tally-ink underline-offset-2 hover:underline" type="button" aria-label={`Inspect result ${result.caseId}`} onClick={(event) => openResult(result, event.currentTarget)}>{result.caseId}</button></td><td className="min-h-11 border-t border-tally-border-subtle px-4 py-3 align-middle"><StatusBadge className={outcomeStyles[result.finalOutcome]}>{outcomeLabel(result.finalOutcome)}</StatusBadge></td><td className="min-h-11 border-t border-tally-border-subtle px-4 py-3 align-middle"><div className="grid gap-[3px]">{result.bankTxnIds.length === 0 ? <span className="text-tally-ink-muted">—</span> : result.bankTxnIds.map((id) => <span className="font-tally-mono text-xs text-tally-ink-secondary" key={id}>{id}</span>)}</div></td><td className="min-h-11 border-t border-tally-border-subtle px-4 py-3 align-middle"><div className="grid gap-[3px]">{result.ledgerTxnIds.length === 0 ? <span className="text-tally-ink-muted">—</span> : result.ledgerTxnIds.map((id) => <span className="font-tally-mono text-xs text-tally-ink-secondary" key={id}>{id}</span>)}</div></td><td className="min-h-11 border-t border-tally-border-subtle px-4 py-3 align-middle"><span className="text-[13px] text-tally-ink-secondary">{result.reasonCode}</span></td><td className="min-h-11 border-t border-tally-border-subtle px-4 py-3 align-middle"><span className="text-xs text-tally-ink-muted">{result.source ?? "—"}</span></td></tr>)}</tbody></table></div>}
            </section>
          </>
        )}
      </main>
      {selectedResult !== null && <ResultDetailSheet result={selectedResult} onClose={closeResult} />}
    </div>
  );
}
