# ERPBridge Integration Console

## Purpose

This repository provides a local interactive console for testing the
ERPBridge SDK against a real ERPBridge server.

- The browser uses the SDK directly for MCP and exact-name tool calls.
- The Node BFF uses the SDK for REST operations because ERPBridge REST has no
  browser CORS contract.
- The integration runner checks environment readiness, MCP, REST/BFF,
  typed errors, logs, metrics, cache, and registry behavior.

## Start the console

Use Node.js 20 or newer.

For an already-running local ERPBridge server:

```bash
npm install
ERPBRIDGE_BASE_URL=http://localhost:8080 npm run dev
```

Open <http://127.0.0.1:5173/>. The BFF listens on port `8787` by default.
The configured ERPBridge target is `http://localhost:8080` by default.

For the complete local stack, run these commands before starting the console:

```bash
npm run sdk:stage
npm run infra:up
npm run infra:ready
npm run infra:seed
npm run dev
```

`infra:up`, `infra:ready`, and `infra:seed` use the ERPBridge checkout
configured by `ERPBRIDGE_ROOT`. The host fallback in `README.md` is the
alternative when Compose images are unavailable. `sdk:stage` only verifies a
release candidate: it requires the sibling SDK worktree at the `@erpbridge/sdk@1.0.0`
release commit and refuses any other version.

## Use the web console

1. Check the Environment panel. It reports loopback safety, ERPBridge health,
   and the MCP CORS contract.
2. Use **Start and seed local stack** when the local Compose lifecycle should
   be managed from the console. Watch the reported `compose-up`, `ready`, and
   `seed` stages.
3. Run **Run all safe checks** for read-only verification. Individual checks
   can also be run from their row.
4. To run registry lifecycle or cache-flush checks, enable both state-change
   confirmations. Registry probes use a unique name and are hard-deleted in a
   cleanup step. Cache flush clears the local cache.
5. Use the MCP console to choose the SDK root or `./client` entry point,
   connect, inspect schemas, and call a tool directly or through the exact-name
   proxy.
6. Use REST diagnostics for BFF health, invokes, registry operations, logs,
   metrics, and cache inspection. Browser REST calls stay same-origin through
   the BFF.
7. Use **Stop local stack** only for the local environment. Confirming it
   removes Compose volumes.

Run results remain in the current browser session. Save sanitized findings in
`.scratch/` when a command or integration run reveals a failure, compatibility
issue, documentation mismatch, workaround, regression, or root cause. Keep
credentials, tokens, cookies, authorization headers, and unredacted server
output out of records.

## Verification commands

```bash
npm run typecheck
npm test
npm run build
npm run test:integration
ERPBRIDGE_TEST_SERVER=http://localhost:8080 npm run test:integration
npm run test:e2e
```

The live integration command requires a reachable, seeded ERPBridge server.
The browser suite requires a Playwright Chromium executable. Install it with
`npx playwright install chromium` in a network-enabled environment when the
system Chromium path is unavailable.

Authenticated MCP and role-gated cases stay skipped unless
`ERPBRIDGE_TEST_TOKEN` (and, for role-aware REST checks,
`ERPBRIDGE_TEST_GUARDED_TOOL` with `ERPBRIDGE_TEST_ROLE`) are supplied.
The console pairs exact `@erpbridge/sdk@1.0.0` with an ERPBridge
v0.3-compatible server.

## Local-only safety

Lifecycle operations accept loopback ERPBridge URLs only: `localhost`,
`127.0.0.1`, or `::1`. The BFF owns lifecycle commands and never accepts an
arbitrary shell command or remote target from the browser.

State-changing checks require explicit UI confirmation. Keep the test target
local and disposable, especially when using cache flush or stack teardown.

## Agent workflow

Before changing behavior:

1. Read this file and `README.md`.
2. Inspect the relevant seam: browser adapters under `src/lib/`, UI under
   `src/components/`, BFF routes under `server/`, and lifecycle scripts under
   `scripts/`.
3. Preserve the same-origin REST boundary and loopback lifecycle guard.
4. Add or update the nearest unit, live integration, or Playwright test.
5. Run typecheck, unit tests, build, and the relevant integration/browser
   checks before reporting completion.

Use `apply_patch` for repository edits. Keep generated build output, SDK
artifacts, browser recordings, and runtime findings in their existing ignored
locations.
