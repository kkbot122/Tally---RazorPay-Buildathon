"use client";

import React, { useEffect, useId, useRef, useState } from "react";

const architectureSteps = [
  {
    title: "Bank CSV + Ledger CSV",
    description: "Two source exports enter the run as raw inputs. Keeping them separate preserves source provenance before any transformation happens.",
    diagram: `flowchart LR
  bank["Bank CSV"] --> parser["CSV parser"]
  ledger["Ledger CSV"] --> parser
  parser --> records["Raw records"]
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#e8f0f8,stroke:#245fa6,color:#171817,stroke-width:1.5px
  class bank,ledger source
  class parser,records process`,
  },
  {
    title: "CSV validation",
    description: "The parser checks required headers, row shape, dates, amounts, currency, direction, and identifiers before the data can enter the pipeline.",
    diagram: `flowchart LR
  input["CSV rows"] --> shape["Schema checks"]
  shape --> valid{"Valid?"}
  valid -->|yes| safe["Accepted rows"]
  valid -->|no| reject["Parse errors"]
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#e8f0f8,stroke:#245fa6,color:#171817,stroke-width:1.5px
  classDef warning fill:#fff3dd,stroke:#9a5b00,color:#171817,stroke-width:1.5px
  class input source
  class shape,valid,safe process
  class reject warning`,
  },
  {
    title: "Normalization",
    description: "Amounts become integer paise and comparable fields are canonicalized, so later rules operate on safe, deterministic values.",
    diagram: `flowchart LR
  rows["Accepted rows"] --> money["Money → paise"]
  rows --> fields["Dates · refs · names"]
  money --> normalized["Normalized records"]
  fields --> normalized
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#e8f0f8,stroke:#245fa6,color:#171817,stroke-width:1.5px
  class rows source
  class money,fields,normalized process`,
  },
  {
    title: "Deterministic rules",
    description: "Rules run from strongest evidence to bounded grouped relationships. A rule commits only when its constraints produce one unique, compatible result.",
    diagram: `flowchart LR
  records["Normalized records"] --> rules["R1 → R5"]
  rules --> unique{"Unique + compatible?"}
  unique -->|yes| match["Verified match"]
  unique -->|no| remainder["Remaining cases"]
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#e8f0f8,stroke:#245fa6,color:#171817,stroke-width:1.5px
  classDef success fill:#e8f4ed,stroke:#18794e,color:#171817,stroke-width:1.5px
  class records source
  class rules,unique,remainder process
  class match success`,
  },
  {
    title: "Remaining cases + candidates",
    description: "Cases not resolved by rules receive a closed-world candidate set built from mechanical signals such as reference, amount, batch, counterparty, and date.",
    diagram: `flowchart LR
  cases["Remaining cases"] --> signals["Mechanical signals"]
  ledger["Ledger records"] --> signals
  signals --> candidates["Bounded candidates"]
  candidates --> agent["Investigation input"]
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#e8f0f8,stroke:#245fa6,color:#171817,stroke-width:1.5px
  class cases,ledger source
  class signals,candidates,agent process`,
  },
  {
    title: "Reasoning model",
    description: "The model proposes an outcome from the supplied primary record and candidates. It cannot invent IDs or search outside the candidate set.",
    diagram: `flowchart LR
  input["Primary + candidates"] --> model["Reasoning model"]
  model --> proposal["Structured proposal"]
  proposal --> verifier["Verifier"]
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#e8f0f8,stroke:#245fa6,color:#171817,stroke-width:1.5px
  class input source
  class model,proposal,verifier process`,
  },
  {
    title: "Deterministic verifier",
    description: "The verifier is authoritative. It checks existence, membership, reuse, relationship shape, hard compatibility, exact sums, and evidence.",
    diagram: `flowchart LR
  proposal["Model proposal"] --> checks["Verifier checks"]
  checks --> valid{"All checks pass?"}
  valid -->|yes| approved["Approved outcome"]
  valid -->|no| unresolved["Safe unresolved"]
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#e8f0f8,stroke:#245fa6,color:#171817,stroke-width:1.5px
  classDef success fill:#e8f4ed,stroke:#18794e,color:#171817,stroke-width:1.5px
  classDef warning fill:#fff3dd,stroke:#9a5b00,color:#171817,stroke-width:1.5px
  class proposal source
  class checks,valid process
  class approved success
  class unresolved warning`,
  },
  {
    title: "Final outcome",
    description: "Every case is committed as RECONCILED, EXPLAINED_OUTSTANDING, DISCREPANCY, or UNRESOLVED with a reason and supporting evidence.",
    diagram: `flowchart LR
  verified["Verified result"] --> outcome{"Outcome"}
  outcome --> reconciled["RECONCILED"]
  outcome --> explained["EXPLAINED"]
  outcome --> discrepancy["DISCREPANCY"]
  outcome --> unresolved["UNRESOLVED"]
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#e8f0f8,stroke:#245fa6,color:#171817,stroke-width:1.5px
  classDef success fill:#e8f4ed,stroke:#18794e,color:#171817,stroke-width:1.5px
  classDef warning fill:#fff3dd,stroke:#9a5b00,color:#171817,stroke-width:1.5px
  classDef danger fill:#fdecea,stroke:#b42318,color:#171817,stroke-width:1.5px
  class verified source
  class outcome process
  class reconciled success
  class explained,unresolved warning
  class discrepancy danger`,
  },
  {
    title: "Persistence + trace",
    description: "Completed runs, outcomes, and observable trace events are stored atomically. Trace records the audit surface without exposing private reasoning.",
    diagram: `flowchart LR
  outcome["Final outcome"] --> commit["Serialized commit"]
  commit --> results["Results"]
  commit --> trace["Trace events"]
  results --> store["Durable run"]
  trace --> store
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#fff3dd,stroke:#9a5b00,color:#171817,stroke-width:1.5px
  classDef output fill:#e8f4ed,stroke:#18794e,color:#171817,stroke-width:1.5px
  class outcome source
  class commit process
  class results,trace,store output`,
  },
] as const;

const completeHighLevelDesign = {
  description: "The full system is a controlled pipeline: deterministic processing resolves the obvious, bounded investigation handles the remainder, and verification gates every committed outcome.",
  diagram: `flowchart LR
  sources["Bank + ledger CSVs"] --> validate["Validate"]
  validate --> normalize["Normalize"]
  normalize --> rules["Deterministic rules"]
  rules --> candidates["Candidates"]
  candidates --> model["Reasoning model"]
  model --> verifier["Deterministic verifier"]
  verifier --> outcome["Final outcome"]
  outcome --> durable["Persistence + trace"]
  classDef source fill:#f1f1ee,stroke:#6f726d,color:#171817,stroke-width:1px
  classDef process fill:#e8f0f8,stroke:#245fa6,color:#171817,stroke-width:1.5px
  classDef gate fill:#fff3dd,stroke:#9a5b00,color:#171817,stroke-width:1.5px
  classDef output fill:#e8f4ed,stroke:#18794e,color:#171817,stroke-width:1.5px
  class sources source
  class validate,normalize,rules,candidates,model process
  class verifier,outcome gate
  class durable output`,
} as const;

function MermaidDiagram({ diagram }: { diagram: string }) {
  const [diagramState, setDiagramState] = useState<"loading" | "ready" | "error">("loading");
  const diagramRef = useRef<HTMLDivElement>(null);
  const instanceId = useId().replace(/:/g, "");
  const renderCount = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setDiagramState("loading");
      try {
        const { default: mermaid } = await import("mermaid");
        if (cancelled || !diagramRef.current) return;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: "#ffffff",
            primaryColor: "#e8f0f8",
            primaryTextColor: "#171817",
            primaryBorderColor: "#245fa6",
            lineColor: "#245fa6",
            secondaryColor: "#f1f1ee",
            tertiaryColor: "#f7f7f5",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: "13px",
          },
        });

        renderCount.current += 1;
        const rendered = await mermaid.render(`${instanceId}-diagram-${renderCount.current}`, diagram);
        if (cancelled || !diagramRef.current) return;
        diagramRef.current.innerHTML = rendered.svg;
        rendered.bindFunctions?.(diagramRef.current);
        setDiagramState("ready");
      } catch {
        if (!cancelled) setDiagramState("error");
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
      if (diagramRef.current) diagramRef.current.innerHTML = "";
    };
  }, [diagram, instanceId]);

  return (
    <div aria-busy={diagramState === "loading"} className="min-h-40 p-4">
      {diagramState === "loading" && <p className="text-sm text-tally-ink-muted">Rendering system diagram…</p>}
      {diagramState === "error" && <p className="text-sm text-tally-danger" role="alert">This system diagram could not be rendered.</p>}
      <div className="overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full" ref={diagramRef} />
    </div>
  );
}

export function HighLevelDesign() {
  return (
    <div className="rounded border border-tally-border bg-tally-surface">
      <div className="border-b border-tally-border-subtle px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tally-accent">High-level design</p>
          <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-tally-ink">Complete high-level design</h3>
        </div>
        <p className="mt-2 max-w-[52ch] text-sm leading-6 text-tally-ink-secondary sm:mt-0">{completeHighLevelDesign.description}</p>
      </div>
      <MermaidDiagram diagram={completeHighLevelDesign.diagram} />
    </div>
  );
}

export default function ArchitectureExplorer() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = architectureSteps[selectedIndex];
  const panelId = "architecture-detail";

  return (
    <div aria-label="Interactive system architecture" className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2" role="list">
        {architectureSteps.map((step, index) => {
          const selectedCard = index === selectedIndex;
          const persistenceCard = index === 8;
          return (
            <div key={step.title} role="listitem">
              <button
                aria-describedby={panelId}
                aria-pressed={selectedCard}
                className={[
                  "group flex min-h-16 w-full items-center rounded border px-4 py-3 text-left transition-all duration-200",
                  "hover:-translate-y-px hover:border-tally-accent hover:bg-tally-accent-soft",
                  "active:translate-y-px active:scale-[0.995]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tally-accent",
                  selectedCard
                    ? persistenceCard
                      ? "border-tally-warning bg-tally-warning-soft"
                      : "border-tally-accent bg-tally-accent-soft"
                    : index === 0
                      ? "border-tally-accent bg-tally-accent-soft"
                      : persistenceCard
                        ? "border-tally-warning bg-tally-warning-soft"
                        : "border-tally-border bg-tally-surface",
                ].join(" ")}
                onClick={() => setSelectedIndex(index)}
                type="button"
              >
                <span className="mr-2 shrink-0 text-xs font-semibold tabular-nums text-tally-accent">{String(index + 1).padStart(2, "0")}</span>
                <span className="font-medium text-tally-ink">{step.title}</span>
                <span aria-hidden="true" className="ml-auto pl-3 text-tally-ink-muted transition-transform group-hover:translate-x-0.5">↗</span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="rounded border border-tally-border bg-tally-surface" id={panelId}>
        <div className="border-b border-tally-border-subtle px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tally-accent">{String(selectedIndex + 1).padStart(2, "0")} / Selected system</p>
            <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-tally-ink">{selected.title}</h3>
          </div>
          <p className="mt-2 max-w-[52ch] text-sm leading-6 text-tally-ink-secondary sm:mt-0">{selected.description}</p>
        </div>
        <MermaidDiagram diagram={selected.diagram} />
      </div>
    </div>
  );
}
