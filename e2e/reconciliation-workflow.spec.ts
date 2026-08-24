import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const bankFixture = resolve(process.cwd(), "data/benchmark/bank_transactions.csv");
const ledgerFixture = resolve(process.cwd(), "data/benchmark/ledger_transactions.csv");
const asOfDate = "2026-10-01";

async function loadBenchmarkAndRun(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Bank transactions CSV").setInputFiles(bankFixture);
  await page.getByLabel("Ledger transactions CSV").setInputFiles(ledgerFixture);
  await page.getByLabel("As-of date").fill(asOfDate);

  await expect(page.getByText("bank_transactions.csv", { exact: true })).toBeVisible();
  await expect(page.getByText("ledger_transactions.csv", { exact: true })).toBeVisible();

  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/runs")
  );
  await page.getByRole("button", { name: "Run reconciliation" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const created = await response.json() as { runId: string };

  await expect(page.getByText(created.runId, { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("heading", { name: "Reconciliation results" })).toBeVisible();
  await expect(page.getByText(/of \d+ persisted results/)).toBeVisible();
  return created.runId;
}

test("Flow 1: loads the benchmark through the UI, runs reconciliation, and shows results", async ({ page }) => {
  await loadBenchmarkAndRun(page);
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toBeVisible();
});

test("Flow 2: a difficult reconciled case shows evidence and verifier information", async ({ page }) => {
  await loadBenchmarkAndRun(page);
  const difficultRow = page.getByRole("row").filter({ hasText: "Reconciled" }).filter({ hasText: "AGENT_VERIFIED" }).first();
  await expect(difficultRow).toBeVisible();
  const caseId = await difficultRow.getByRole("button", { name: /Inspect result/ }).innerText();
  const recordId = (await difficultRow.innerText()).match(/\b[BL]\d+\b/)?.[0];
  expect(recordId).toBeDefined();
  await difficultRow.getByRole("button", { name: /Inspect result/ }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("heading", { name: caseId })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Supporting evidence" })).toBeVisible();
  await expect(page.getByText("Structured evidence supplied to the verifier.")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("listitem").filter({ hasText: recordId! }).first()).toBeVisible();
  await expect(page.getByText("Verifier decision")).toBeVisible();
  await expect(page.getByText("Verified by authoritative verifier")).toBeVisible();
});

test("Flow 3: an unresolved case shows a concrete abstention reason", async ({ page }) => {
  await loadBenchmarkAndRun(page);
  const unresolvedRow = page.getByRole("row").filter({ hasText: "Unresolved" }).first();
  await expect(unresolvedRow).toBeVisible();
  await unresolvedRow.getByRole("button", { name: /Inspect result/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Unresolved", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Reason code")).toBeVisible();
  await expect(dialog.getByText(/MULTIPLE_PLAUSIBLE_CANDIDATES|NO_CANDIDATE|INSUFFICIENT_EVIDENCE|VERIFICATION_FAILED/)).toBeVisible();
});

test("Flow 4: Trace shows persisted events from the run just created", async ({ page }) => {
  const runId = await loadBenchmarkAndRun(page);
  await page.getByRole("link", { name: "View trace" }).click();
  await expect(page).toHaveURL(new RegExp(`/trace\\?runId=${runId}`));
  await expect(page.getByRole("heading", { name: "Reconciliation trace" })).toBeVisible();
  await expect(page.getByText(`runId=${runId}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recorded events" })).toBeVisible();
  await expect(page.getByText("Run started", { exact: true })).toBeVisible();
  await expect(page.getByText("Run completed", { exact: true })).toBeVisible();
  await expect(page.getByText(/events · sequence order preserved/)).toBeVisible();
});
