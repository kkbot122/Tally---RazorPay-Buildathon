# Railway deployment

Tally is deployed as three Railway services:

- `web` — Next.js production server
- `api` — Fastify production server
- `postgresql` — Railway PostgreSQL

Configure the services from the repository root (`/`) so workspace packages remain available.

## Web service

- Build command: `pnpm install --frozen-lockfile && pnpm --filter @tally/web build`
- Start command: `pnpm --filter @tally/web start`
- Healthcheck path: `/`
- Variable: `NEXT_PUBLIC_API_BASE_URL=https://<api-public-domain>`

`NEXT_PUBLIC_API_BASE_URL` is captured during the Next.js build and is the browser’s API origin. Do not put secrets in this variable. The development-only `TALLY_API_ORIGIN` rewrite remains available for local same-origin development; production has no localhost fallback.

## API service

- Build command: `pnpm install --frozen-lockfile && pnpm --filter @tally/api typecheck`
- Pre-deploy command: `pnpm --filter @tally/api db:migrate`
- Start command: `pnpm --filter @tally/api start`
- Healthcheck path: `/health`

Required Railway variables:

- `NODE_ENV=production`
- `DATABASE_URL=${{postgresql.DATABASE_URL}}`
- `OPENAI_API_KEY=<Railway secret variable>`
- `OPENAI_MODEL=gpt-5.6-terra` (or an approved configured model)
- `AI_PROVIDER=openai` (use `nvidia` with an NVIDIA API key)
- `AI_BASE_URL` (optional; use `https://integrate.api.nvidia.com/v1` for NVIDIA)
- `WEB_ORIGIN=https://<web-public-domain>`

For NVIDIA’s hosted OpenAI-compatible API, set `AI_PROVIDER=nvidia`, `AI_BASE_URL=https://integrate.api.nvidia.com/v1`, `OPENAI_API_KEY=<NVIDIA API key>`, and use a served NVIDIA model such as `meta/llama-3.1-70b-instruct`. The application uses NVIDIA’s `/v1/chat/completions` path and validates the returned proposal against the shared contract.

The API listens on Railway’s `PORT` and binds to `0.0.0.0`. `/health` is liveness-only; `/health/db` is available for database diagnostics and is not the deployment healthcheck.

## PostgreSQL service

Use Railway’s private service reference for `DATABASE_URL` where supported. Do not expose the database publicly or commit a connection URL. The API migration runs before the API deployment starts and uses the checked-in Drizzle migrations without resetting production data.

## URL wiring and verification

The wiring is:

`web browser → NEXT_PUBLIC_API_BASE_URL → api → DATABASE_URL → postgresql`

The API allows browser requests only from `WEB_ORIGIN` and supports `OPTIONS` preflight. After deployment, verify:

1. `https://<web-public-domain>/` loads.
2. A benchmark run completes and returns persisted results.
3. A result opens with evidence and verifier details.
4. `/trace?runId=<run-id>` shows persisted execution events.
5. `/docs` loads.

No production variable should contain `localhost`, `127.0.0.1`, or a developer-machine path. Secrets belong only in Railway variables.
