import { execFileSync } from "node:child_process";

export default function globalSetup(): void {
  const databaseUrl = process.env.TALLY_E2E_DATABASE_URL ?? "postgresql://tally:tally@127.0.0.1:55432/tally_e2e";

  execFileSync("pnpm", ["--dir", "apps/api", "db:migrate"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: "inherit",
  });
}
