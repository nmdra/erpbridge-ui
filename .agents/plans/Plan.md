# Plan: Upgrade the Integration Console to ERPBridge SDK 1.0.0

## Goal

Update the console to consume exact `@erpbridge/sdk@1.0.0` and validate its ERPBridge v0.3-compatible MCP, authentication, role, registry, and REST contracts.

## Current State

- The console is pinned to SDK `0.1.1` and its staging/npm scripts also target that baseline (`package.json:16-24`).
- Browser MCP adapters currently expect the old flattened `ToolResult` shape (`src/lib/browser-mcp.ts:1-17`); SDK v1 uses native MCP result envelopes with `content` (`../erpbridge-sdk/CHANGELOG.md:36-40`).
- The BFF already owns REST calls, preserving the required same-origin boundary (`server/app.ts:20-79`).
- The upcoming SDK contract adds bearer authentication, typed authorization errors, registry `MCPTool` manifests, filtered registry listing, and direct-invoke role selection (`../erpbridge-sdk/CHANGELOG.md:28-44`).

## Decisions

- Pin normal installs and the lockfile to exact `@erpbridge/sdk@1.0.0`.
- Retain SDK staging only as a release-candidate verification path: it must pack the SDK v1.0.0 release commit and record version, revision, and checksum before replacing the local install.
- Keep REST exclusively behind the local BFF. Browser credentials apply only to direct MCP/tool calls.
- Provide credentials only as non-persistent runtime inputs for browser MCP; configure BFF credentials exclusively through process environment variables. Never place tokens in URLs, local/session storage, logs, responses, or `.scratch` findings.
- Support role-gated tools: MCP sends the selected role as `arguments.role`; REST direct invocation sends it via the SDK’s role option, which becomes `X-ERPBridge-Role`.

## Tasks

- [x] **T1 — Update dependency and release workflow.** Pin `@erpbridge/sdk` to `1.0.0`, refresh the lockfile, and revise `sdk:npm` to reinstall that exact version. Make `sdk:stage` require and verify a v1.0.0 SDK package/revision before recording its manifest, rather than silently staging a differently versioned worktree. (**Seam:** package install and staged artifact manifest; **Files:** `package.json`, `package-lock.json`, `scripts/stage-sdk.ts`; **Verify:** `npm install && npm run sdk:npm && npm run typecheck`.)

- [x] **T2 — Migrate browser MCP adapters to v1 result types and runtime auth.** Change session `call` and proxy-call contracts to `McpToolResult`; accept transient client configuration including an optional bearer token; close and discard clients whenever connection setup fails or the user disconnects. (**Seam:** `createClient` MCP facade; **Files:** `src/lib/browser-mcp.ts`, `src/lib/browser-mcp-root.ts`, `src/lib/browser-mcp-client.ts`; **Verify:** adapter unit tests cover direct and proxy results, connect failure cleanup, and token forwarding.)

- [x] **T3 — Improve the MCP console for v1 diagnostics.** Add password-style runtime bearer-token input and optional MCP role selector; clear the token on disconnect/unmount; show native MCP `content`, `structuredContent`, and execution-error state distinctly. Render typed auth/authorization diagnostics without echoing credentials. (**Seam:** browser MCP console; **Files:** `src/components/McpConsole.tsx`, `src/styles.css`; **Verify:** Playwright covers root and `/client` entries, authenticated connect, role-gated invocation, and no token appears in visible output or browser storage.)

- [x] **T4 — Configure BFF authentication and role-aware REST routes.** Build the Node SDK client from documented environment-variable names for global, logs, and metrics credentials; extend `POST /api/invoke` to accept an optional role and pass it as the SDK direct-invoke option; add optional exact `name`/`version` filters to registry listing. Preserve only safe typed-error metadata, including authorization status and required scope. (**Seam:** BFF SDK client and HTTP routes; **Files:** `server/app.ts`, `server/error-response.ts`, `src/lib/rest-api.ts`; **Verify:** BFF unit tests assert request routing, role validation/header behavior through the client seam, registry query encoding, and sanitized 401/403 responses.)

- [x] **T5 — Align UI and safe checks with the revised contracts.** Keep REST results as `ToolResult`, but update MCP success/error assertions to use native envelopes; replace the lifecycle probe manifest’s obsolete `kind: "Tool"` with `kind: "MCPTool"`; add registry-filter and guarded-tool checks while retaining mutation confirmations and cleanup. (**Seam:** integration-check catalog; **Files:** `src/lib/integration-tests.ts`, `src/App.tsx`; **Verify:** unit tests cover envelope execution errors, the new probe shape, role propagation, and filtered registry reads.)

- [x] **T6 — Document local v1 setup and compatibility testing.** Add environment-variable documentation for BFF credentials and optional authenticated browser tests; explain that tokens are user-managed and never persisted, while direct browser REST remains unsupported. Document the required ERPBridge v0.3 server and SDK 1.0.0 pairing. (**Seam:** developer setup; **Files:** `README.md`, `.env.example`, `AGENTS.md` if its verification instructions need updating; **Verify:** a clean local setup can run open-mode checks and authenticated checks using only documented environment variables.)

## Verification

- `npm run typecheck`, `npm test`, and `npm run build` pass with `@erpbridge/sdk@1.0.0`.
- `npm run sdk:stage` rejects an SDK package that is not version `1.0.0` and records the accepted release artifact identity.
- Live integration validates root and `/client` browser MCP paths, native envelope rendering, REST/BFF health/invoke/logs/metrics/cache/registry, and typed 401/403 handling.
- Authenticated integration and Playwright tests run when `ERPBRIDGE_TEST_SERVER`, `ERPBRIDGE_TEST_TOKEN`, and role-test configuration are supplied; otherwise those cases are explicitly skipped, while open-mode coverage still runs.
- No credential is returned by BFF endpoints, rendered in results/errors, written to browser storage, or saved in sanitized findings.

## Assumptions

- `@erpbridge/sdk@1.0.0` will be the official release containing the current v0.3-compatible contract; until published, staging uses only the matching release-candidate commit.
- ERPBridge is upgraded to its compatible v0.3 release/alpha for live validation.
- Token issuance and lifecycle remain outside this console; it only consumes operator-provided credentials.
