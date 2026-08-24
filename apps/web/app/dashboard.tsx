"use client";

import { useMemo, useRef, useState } from "react";
import React from "react";
import type { FinalOutcome } from "@tally/contracts";

import { createRun, getRun, getRunResults, type RunResult, type RunSummary } from "../lib/api/runs";
import { createSubmissionLock, filterResults, isRunFormComplete, summarizeResults } from "../lib/dashboard-model";

type OutcomeFilter = "ALL" | FinalOutcome;

const outcomes: Array<{ value: OutcomeFilter; label: string }> = [
  { value: "ALL", label: "All outcomes" },
  { value: "RECONCILED", label: "Reconciled" },
  { value: "EXPLAINED_OUTSTANDING", label: "Explained outstanding" },
  { value: "DISCREPANCY", label: "Discrepancy" },
  { value: "UNRESOLVED", label: "Unresolved" },
];

function percentage(value: number, total: number): string {
  return `${(total === 0 ? 0 : (value / total) * 100).toFixed(1)}%`;
}

function outcomeLabel(outcome: FinalOutcome): string {
  return outcomes.find((item) => item.value === outcome)?.label ?? outcome;
}

function outcomeClass(outcome: FinalOutcome): string {
  return outcome === "RECONCILED" ? "outcome-reconciled"
    : outcome === "EXPLAINED_OUTSTANDING" ? "outcome-explained"
      : outcome === "DISCREPANCY" ? "outcome-discrepancy" : "outcome-unresolved";
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
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const submissionLock = useRef(createSubmissionLock());

  const filteredResults = useMemo(() => filterResults(results, filter), [filter, results]);
  const { total, reconciled, explainedOutstanding: explained, discrepancies: discrepancy, unresolved } = summarizeResults(results);
  const resolved = total - unresolved;

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
    try {
      const [nextSummary, nextResults] = await Promise.all([getRun(runId), getRunResults(runId)]);
      setSummary(nextSummary);
      setResults(nextResults);
      setFilter("ALL");
    } catch (readFailure) {
      setReadError(readFailure instanceof Error ? readFailure.message : "Run data could not be loaded.");
    } finally {
      setIsLoadingResults(false);
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
    setStatusMessage("Reading files and starting reconciliation…");
    setIsRunning(true);
    try {
      const [bankCsv, ledgerCsv] = await Promise.all([bankFile.text(), ledgerFile.text()]);
      const created = await createRun({ asOfDate, bankCsv, ledgerCsv });
      setActiveRunId(created.runId);
      setSummary({ runId: created.runId, status: created.status, totalCases: 0, reconciled: 0, explainedOutstanding: 0, discrepancies: 0, unresolved: 0 });
      setResults([]);
      setStatusMessage("Run completed. Loading persisted results…");
      await loadRunData(created.runId);
      setStatusMessage(null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Reconciliation could not be completed.");
      setStatusMessage(null);
    } finally {
      submissionLock.current.release();
      setIsRunning(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Tally dashboard"><span className="brand-mark">T</span><span>Tally</span></a>
        <nav className="topbar-nav" aria-label="Primary navigation">
          <a className="topbar-link active" href="/">Dashboard</a>
          <a className="topbar-link" href="/trace">Trace</a>
          <a className="topbar-link" href="/docs">Docs</a>
        </nav>
        <span className="topbar-context">Runtime reconciliation</span>
      </header>

      <main className="page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">Operational dashboard</div>
            <h1 className="page-title">Reconciliation control room</h1>
            <p className="page-description">Run a bank-to-books reconciliation and inspect the persisted operational outcomes that need attention.</p>
          </div>
          {summary !== null && <div className="run-context"><span className="run-id">{summary.runId}</span><span className={`status-badge status-${summary.status.toLowerCase()}`}>{summary.status}</span></div>}
        </div>

        <form className="run-form" onSubmit={runReconciliation}>
          <h2 className="section-title">Start a reconciliation run</h2>
          <p className="section-description">Choose the two source files and the date used to evaluate outstanding timing differences.</p>
          <div className="form-grid">
            <label className="field" htmlFor="bank-file"><span className="field-label">Bank transactions CSV</span><input id="bank-file" className="file-input" type="file" accept=".csv,text/csv" onChange={(event) => selectCsvFile(event.target.files?.[0], "bank")} /><span className="field-help">{bankFile?.name ?? "No file selected"}</span></label>
            <label className="field" htmlFor="ledger-file"><span className="field-label">Ledger transactions CSV</span><input id="ledger-file" className="file-input" type="file" accept=".csv,text/csv" onChange={(event) => selectCsvFile(event.target.files?.[0], "ledger")} /><span className="field-help">{ledgerFile?.name ?? "No file selected"}</span></label>
            <label className="field" htmlFor="as-of-date"><span className="field-label">As-of date</span><input id="as-of-date" className="date-input" type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} /><span className="field-help">Required</span></label>
            <button className="primary-button" type="submit" disabled={isRunning || bankFile === null || ledgerFile === null || asOfDate === ""}>{isRunning ? "Running…" : "Run reconciliation"}</button>
          </div>
          {statusMessage !== null && <p className="form-status" role="status">{statusMessage}</p>}
          {error !== null && <p className="form-error" role="alert">{error}</p>}
          {readError !== null && activeRunId !== null && <div className="form-error" role="alert"><div>Run <span className="mono">{activeRunId}</span> was created, but its saved results could not be loaded.</div><button className="secondary-button retry-button" type="button" onClick={() => void loadRunData(activeRunId)} disabled={isLoadingResults}>{isLoadingResults ? "Retrying…" : "Retry loading results"}</button></div>}
        </form>

        {summary === null ? (
          <section className="run-form empty-state" aria-labelledby="ready-heading"><h2 id="ready-heading">Ready for a run</h2><p>Upload the bank and ledger CSVs above to see completion status, operational counts, and the persisted result list here.</p></section>
        ) : (
          <>
            <section className="summary-region" aria-labelledby="summary-heading">
              <h2 id="summary-heading" className="section-title">Run summary</h2>
              <p className="section-description">Operational counts from {summary.runId}; no benchmark or ground-truth metrics are used.</p>
              <div className="metric-strip">
                <div className="metric"><span className="metric-label">Processed</span><strong className="metric-value">{total}</strong><span className="metric-subtext">final results</span></div>
                <div className="metric"><span className="metric-label">Reconciled</span><strong className="metric-value">{reconciled}</strong><span className="metric-subtext">{percentage(reconciled, total)} of total</span></div>
                <div className="metric"><span className="metric-label">Exceptions</span><strong className="metric-value">{explained + discrepancy + unresolved}</strong><span className="metric-subtext">needs review or context</span></div>
                <div className="metric"><span className="metric-label">Explained outstanding</span><strong className="metric-value">{explained}</strong></div>
                <div className="metric"><span className="metric-label">Discrepancies</span><strong className="metric-value">{discrepancy}</strong></div>
                <div className="metric"><span className="metric-label">Resolution rate</span><strong className="metric-value">{percentage(resolved, total)}</strong><span className="metric-subtext">not unresolved</span></div>
              </div>
              <div className="distribution" aria-label="Outcome distribution">
                <div className="distribution-bar" aria-hidden="true">{([
                  ["segment-reconciled", reconciled],
                  ["segment-explained", explained],
                  ["segment-discrepancy", discrepancy],
                  ["segment-unresolved", unresolved],
                ] as Array<[string, number]>).filter(([, value]) => value > 0).map(([className, value]) => <span className={`distribution-segment ${className}`} key={className} style={{ width: `${value / total * 100}%` }} />)}</div>
                <div className="distribution-legend"><span className="legend-item"><i className="legend-swatch segment-reconciled" />Reconciled {reconciled}</span><span className="legend-item"><i className="legend-swatch segment-explained" />Explained outstanding {explained}</span><span className="legend-item"><i className="legend-swatch segment-discrepancy" />Discrepancy {discrepancy}</span><span className="legend-item"><i className="legend-swatch segment-unresolved" />Unresolved {unresolved}</span></div>
              </div>
            </section>

            <section className="results-region" aria-labelledby="results-heading">
              <div className="results-header"><div><h2 id="results-heading" className="section-title">Reconciliation results</h2><p className="section-description">{filteredResults.length} of {total} persisted results</p></div><div className="results-controls"><label className="filter-label" htmlFor="outcome-filter">Filter</label><select id="outcome-filter" className="filter-select" value={filter} onChange={(event) => setFilter(event.target.value as OutcomeFilter)}>{outcomes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div>
              {filteredResults.length === 0 ? <div className="table-empty">No results match this outcome filter.</div> : <div className="table-scroll"><table className="results-table"><thead><tr><th scope="col">Case</th><th scope="col">Outcome</th><th scope="col">Bank records</th><th scope="col">Ledger records</th><th scope="col">Reason</th><th scope="col">Source</th></tr></thead><tbody>{filteredResults.map((result) => <tr key={result.resultId ?? result.caseId}><td><span className="result-id">{result.caseId}</span></td><td><span className={`outcome-badge ${outcomeClass(result.finalOutcome)}`}>{outcomeLabel(result.finalOutcome)}</span></td><td><div className="result-references">{result.bankTxnIds.length === 0 ? <span className="muted">—</span> : result.bankTxnIds.map((id) => <span className="reference-line" key={id}>{id}</span>)}</div></td><td><div className="result-references">{result.ledgerTxnIds.length === 0 ? <span className="muted">—</span> : result.ledgerTxnIds.map((id) => <span className="reference-line" key={id}>{id}</span>)}</div></td><td><span className="reason-code">{result.reasonCode}</span></td><td><span className="source-cell">{result.source ?? "—"}</span></td></tr>)}</tbody></table></div>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
