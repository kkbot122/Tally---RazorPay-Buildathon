/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocsContent from "./docs-content";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

afterEach(() => cleanup());

describe("documentation page", () => {
  it("documents the frozen reconciliation system and its safety boundaries", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<DocsContent />);

    expect(screen.getByRole("heading", { name: "Reconciliation that can explain itself." })).toBeTruthy();
    for (const heading of ["Problem / overview", "Problem narrowing", "Real workflow research", "Frozen scope", "Benchmark", "Deterministic rules", "Agent + verifier", "System architecture", "Experiments", "Failures are part of the design", "Final results / methodology"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("100", { exact: true })).toBeTruthy();
    expect(screen.getByText("Grouped one-to-many (R4)")).toBeTruthy();
    expect(screen.getByText("Grouped many-to-one (R5)")).toBeTruthy();
    for (const outcome of ["RECONCILED", "EXPLAINED_OUTSTANDING", "DISCREPANCY", "UNRESOLVED"]) {
      expect(document.body.textContent).toContain(outcome);
    }
    expect(document.body.textContent).not.toMatch(/var\(--(?:paper|ink|muted|line|surface)/);
    expect(document.body.textContent).toContain("safe unresolved outcomes");
    expect(screen.queryByText(/99%|98%|accuracy is/)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps the frozen rule ordering and primary navigation visible", () => {
    render(<DocsContent />);
    const text = screen.getByRole("heading", { name: "Deterministic rules" }).closest("section")?.textContent ?? "";
    expect(text.indexOf("Exact reference")).toBeLessThan(text.indexOf("Normalized reference"));
    expect(text.indexOf("Normalized reference")).toBeLessThan(text.indexOf("Strong context"));
    expect(text.indexOf("Strong context")).toBeLessThan(text.indexOf("One-to-many"));
    expect(text.indexOf("One-to-many")).toBeLessThan(text.indexOf("Many-to-one"));
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Trace" }).getAttribute("href")).toBe("/trace");
    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe("/docs");
  });

  it("keeps every documentation navigation link connected to a section", () => {
    render(<DocsContent />);
    const navigation = screen.getByRole("navigation", { name: "On this page" });
    const links = Array.from(navigation.querySelectorAll("a"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute("href");
      expect(href?.startsWith("#")).toBe(true);
      expect(document.getElementById(href!.slice(1))).toBeTruthy();
    }
  });

  it("lets readers select each architecture system and inspect its detail panel", async () => {
    const user = userEvent.setup();
    render(<DocsContent />);

    expect(screen.getAllByRole("button")).toHaveLength(9);
    expect(screen.getByRole("heading", { name: "Bank CSV + Ledger CSV", level: 3 })).toBeTruthy();

    const validationButton = screen.getByRole("button", { name: /02 CSV validation/ });
    await user.click(validationButton);

    expect(validationButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "CSV validation", level: 3 })).toBeTruthy();
    expect(screen.getByText("The parser checks required headers, row shape, dates, amounts, currency, direction, and identifiers before the data can enter the pipeline.")).toBeTruthy();

    expect(screen.getByRole("heading", { name: "Complete high-level design", level: 3 })).toBeTruthy();
  });

  it("keeps the high-level design in Frozen scope without the old code block", () => {
    render(<DocsContent />);

    const frozenScope = screen.getByRole("heading", { name: "Frozen scope" }).closest("section");
    expect(frozenScope?.querySelector("h3")?.textContent).toBe("Complete high-level design");
    expect(screen.queryByText(/collect → validate \/ parse/)).toBeNull();
  });

  it("places the table of contents in the left desktop grid column", () => {
    render(<DocsContent />);

    const navigation = screen.getByRole("navigation", { name: "On this page" });
    expect(navigation.closest("aside")?.className).toContain("lg:col-start-1");
    expect(navigation.closest("aside")?.className).toContain("lg:sticky");
    expect(navigation.closest("aside")?.className).toContain("lg:top-[68px]");
    expect(navigation.closest("main")?.className).toContain("lg:grid-cols-[220px_minmax(0,760px)]");
  });
});
