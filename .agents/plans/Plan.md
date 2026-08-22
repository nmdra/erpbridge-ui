# Plan: ERPBridge SDK Integration Verification UI

## Goal

Create a separate React diagnostic application that verifies ERPBridge end to end: a browser uses the SDK directly for MCP and exact-name tools, while a local Node BFF uses the SDK for REST-only surfaces. Run the real ERPBridge Compose stack, manage seed tools with `bridgectl`, and preserve a sanitized record of every setup, documentation, compatibility, regression, and root-cause finding.

## Current State

- The SDK browser compatibility work is present but unreleased: commit `9141f83` removes the MCP runtime `node:module` lookup (`erpbridge-sdk/src/mcp.ts:6`), injects the package version at build time (`tsdown.config.ts:14`), and adds a packed Vite smoke test for both package root and `./client` (`scripts/assert-browser-bundle.mjs`). `0.1.1` was released before that commit, so npm `0.1.1` does not prove this behavior.
- ERPBridge commit `2137644` allows the browser MCP protocol header in CORS preflight (`ERPBridge/internal/mcp/server.go:472`) and tests the allowed/exposed session headers (`internal/mcp/server_test.go:207`). CORS remains MCP-only; health, direct invoke, cache, logs, metrics, and registry APIs are explicitly outside the cross-origin browser contract (`ERPBridge/docs/connectivity.md:20`).
- The established real-server SDK suite already covers MCP, tools, REST, logs, metrics, cache, and registry behavior, and records live-server deviations in `erpbridge-sdk/tests/integration/README.md`.
- The local ERPBridge repository contains a repo-local `bridgectl` binary and reproducible per-tool JSON schemas in `ERPBridge/schemas/erp/`; the documented generated multi-document YAML is a known `bridgectl tool apply` incompatibility and must be recorded when reproduced.
- The host fallback is running for this verification session with rebuilt ERPBridge and `bridgectl` binaries, Mock ERP on `:8081`, Redis on `:6379`, ERPBridge on `:8080`, and the UI BFF on `:8787`.
- Docker Compose is blocked by registry authorization/EOF errors while fetching builder images. Playwright is blocked because the Chromium download stalled at 0%.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Browser SDK scope | Browser imports `@erpbridge/sdk` and `@erpbridge/sdk/client` directly for `.mcp` and `.tools` only. | Validates the new browser-compatible ESM build and the server MCP CORS contract. |
| REST scope | A same-origin Node BFF owns all SDK REST calls. | ERPBridge intentionally has no REST browser CORS contract. The UI must not disguise this limitation with direct browser REST calls. |
| SDK artifact | Stage a tarball built from the current SDK worktree for the first verification run; rerun unchanged tests against npm only after a release contains `9141f83`. | The published `0.1.1` artifact predates the browser changes. |
| Stack | Start ERPBridge, Mock ERP, and Redis with the documented Docker Compose stack; seed existing JSON schemas using the repo-local `bridgectl`. | Exercises the real server, tooling, registry, cache, and downstream ERP path. |
| Records | Every unexpected result creates a sanitized Markdown record and matching JSONL entry in the UI project's ignored `.scratch/`. | Keeps evidence useful for SDK, ERPBridge, CLI, and docs follow-ups without committing secrets or runtime data. |

## Scope

**In:** browser MCP/tool calls, browser CORS preflight/runtime validation, Node REST validation, Compose/Mock ERP/Redis startup, `bridgectl` API and tool management, all public SDK surfaces, typed errors, live logs and metrics, browser and server integration tests, and issue/RCA/regression capture.

**Out:** adding REST CORS to ERPBridge, implementing SDK authentication, changing ERPBridge production security policy, or modifying SDK/server behavior beyond separately approved defect fixes.

Existing unrelated untracked files in the ERPBridge repository are out of scope and must remain untouched.

## Tasks

- [x] **T1 — Create the standalone diagnostic app.** Scaffold `/home/nimendra/Documents/Projects/erpbridge-ui` with React, Vite, TypeScript, Vitest, Playwright, a Node BFF, `.gitignore`, and scripts for local development, build, tests, SDK staging, infrastructure control, and report generation. Keep generated tarballs, test recordings, and `.scratch/` ignored. (**Seam:** Vite app entry and Node BFF entry; **Files:** `package.json`, `vite.config.ts`, `tsconfig*.json`, `src/`, `server/`, `.gitignore`; **Verify:** `npm run typecheck && npm run build` — green with writable Vite cache access.)

- [x] **T2 — Stage and identify the SDK under test.** Add `sdk:stage` to build and pack `/home/nimendra/Documents/Projects/erpbridge-sdk` at the current revision, install that tarball into the UI's `node_modules` without changing the committed dependency declaration, and write a sanitized artifact manifest containing SDK version, git revision, and tarball integrity. Make every browser and integration script invoke staging first. Add `sdk:npm` for the post-release run that replaces staging with the released npm version. (**Seam:** npm package installation and browser entry imports; **Files:** `scripts/stage-sdk.ts`, `package.json`; **Verify:** staged `@erpbridge/sdk@0.1.1` from `9141f83` installed successfully; SDK build/publint/attw passed.)

- [ ] **T3 — Implement direct-browser MCP and tools probes.** Create browser-only SDK adapters for both the root and `./client` imports. Each adapter must construct a client from the configurable ERPBridge base URL, call `mcp.connect()`, list tools, call a selected tool, call the same selected tool through `client.tools[name]`, render results, and always close the MCP session. The UI must show the source entry point, session state, operation duration, typed error class, message, status, and protocol code. (**Seam:** browser `fetch` against `http://localhost:8080/mcp/`; **Files:** `src/lib/browser-mcp-root.ts`, `src/lib/browser-mcp-client.ts`, `src/components/McpConsole.tsx`; **Verify:** Playwright runs both import paths against the real Compose stack and proves the preflight includes `MCP-Protocol-Version` and receives `Mcp-Session-Id`.) **Status:** adapters and live Node probes pass for both imports; Playwright is blocked by browser provisioning.

- [x] **T4 — Implement the REST-only Node BFF.** Use one Node-owned SDK client configured from `ERPBRIDGE_BASE_URL`; expose JSON endpoints for health, REST invoke, registry list/apply/delete, recent logs, log SSE forwarding, raw/parsed metrics, cache stats, and cache flush. Do not expose MCP endpoints through this BFF. Normalize SDK failures to safe JSON with class name, message, status, code, retry metadata, and body; strip authorization and credential fields before logging or returning diagnostics. Close streams and the client on shutdown. (**Seam:** `@erpbridge/sdk` REST facade; **Files:** `server/index.ts`, `server/app.ts`, `server/error-response.ts`; **Verify:** `ERPBRIDGE_TEST_SERVER=http://localhost:8080 npm run test:integration` passed 13 tests, including every route and typed errors.)

- [ ] **T5 — Build the full diagnostic UI.** Provide a connection/status panel; MCP tools table with schema and JSON arguments; root-versus-client import selector; direct MCP and proxy-call controls; REST invoke and registry controls; recent and streaming logs; raw and parsed metrics; cache stats and flush; and an operation timeline. Render tool execution failures (`isError`) separately from SDK transport/protocol errors. Disable direct-browser REST controls and explain that REST CORS is unsupported by contract. (**Seam:** React API adapters; **Files:** `src/App.tsx`, `src/components/`, `src/lib/rest-api.ts`, `src/styles.css`; **Verify:** a user can complete every supported operation without browser console errors.) **Status:** implemented and production-built; browser completion remains unverified because Playwright cannot launch.

- [ ] **T6 — Automate real ERPBridge orchestration with bridgectl.** Add explicit scripts that run `docker compose -f /home/nimendra/Documents/Projects/ERPBridge/docker-compose.yml up -d --build`, wait for `/mcp/health`, register Mock ERP, apply `ERPBridge/schemas/erp/*.json` using `/home/nimendra/Documents/Projects/ERPBridge/bridgectl`, confirm `READY` tools, and stop the stack only through an explicit teardown command. Do not mutate the user's existing CLI context; pass target URLs through environment variables or command-scoped configuration. (**Seam:** Compose health endpoint and `bridgectl` commands; **Files:** `scripts/infra-up.ts`, `scripts/infra-ready.ts`, `scripts/seed-tools.ts`, `scripts/infra-down.ts`; **Verify:** `npm run infra:up && npm run infra:seed` makes `list_employees` available to both browser MCP probes and REST invoke.) **Status:** host fallback and `bridgectl` seed pass; Compose is blocked by registry access.

- [x] **T7 — Add issue, documentation, RCA, and regression records.** Create `.scratch/README.md`, `index.jsonl`, and `issues/`, `rca/`, `regressions/`, `runs/`, and `artifacts/` directories. A report must include a stable ID, UTC date, severity, owner component, SDK artifact identity, command/UI action, expected and actual behavior, evidence, reproduction, workaround, RCA status, regression status, and recommended follow-up. Save every failed setup, docs mismatch, unexpected behavior, flaky result, compatibility break, and validated workaround. Never store tokens, credentials, cookies, authorization headers, or unredacted server output. (**Seam:** infrastructure/test runners and UI operation recorder; **Files:** `.scratch/README.md`, `.scratch/index.jsonl`, `.scratch/**`; **Verify:** controlled unknown-tool and setup failures have Markdown records and valid JSONL entries.)

- [ ] **T8 — Add automated verification and final report.** Unit-test the BFF error and SSE handling; integration-test every BFF REST route; and use Playwright to validate direct browser MCP for both SDK entry points, tool proxy behavior, unknown tools, invalid arguments, and a browser attempt to access a REST endpoint being rejected/blocked as expected. Exercise health, invoke, registry round-trip with cleanup, logs, metrics, cache-enabled behavior, and cache-disabled behavior when reproducible. Produce a final `.scratch/runs/` compatibility report classifying every finding as SDK, ERPBridge, bridgectl, documentation, environment, or UI. (**Seam:** live Compose stack and browser UI; **Files:** `server/**/*.test.ts`, `tests/integration/`, `tests/e2e/`, `playwright.config.ts`, `.scratch/runs/`; **Verify:** `npm test && npm run test:integration && npm run test:e2e` pass and the final report reconciles all recorded findings.) **Status:** unit, build, live SDK, live adapters, and BFF integration pass; e2e is blocked by Playwright browser provisioning.

## Verification

1. The staged tarball passes the SDK's packed Vite browser check for both `@erpbridge/sdk` and `@erpbridge/sdk/client` before the UI uses it.
2. A real browser completes MCP initialize, receives/exposes the session ID, lists seeded tools, calls one through `mcp.callTool`, and repeats it through the exact-name proxy for both SDK entry points.
3. No browser request is made directly to ERPBridge REST endpoints; all REST UI actions traverse the Node BFF and retain typed SDK error information.
4. Compose startup, Mock ERP registration, schema application, registry verification, and teardown are reproducible and do not overwrite user CLI configuration.
5. Logs stream and stop cleanly, metrics parse supported families, registry probe tools are hard-deleted in cleanup, and cache behavior is reported accurately for the active backend.
6. Every unexpected finding has a sanitized `.scratch` record and the final compatibility report has no unclassified failures.

## Open Questions

None. The published npm validation run is deferred only until a release containing SDK commit `9141f83` exists; until then, the staged tarball is the authoritative artifact for browser verification.
