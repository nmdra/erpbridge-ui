# ERPBridge SDK verification UI

This project checks the ERPBridge SDK against a real ERPBridge server.

The browser uses the SDK for MCP and tools. The Node BFF uses the SDK for REST. ERPBridge does not provide a browser CORS contract for REST.

## Start the test stack

Run these commands from this directory:

```bash
npm install
npm run sdk:stage
npm run infra:up
npm run infra:ready
npm run infra:seed
ERPBRIDGE_BASE_URL=http://localhost:8080 npm run dev
```

Open `http://127.0.0.1:5173`.

The console includes an interactive integration runner. It checks the local
environment, MCP root and client imports, REST/BFF behavior, typed errors,
logs, metrics, cache, and registry reads. Registry lifecycle and cache flush
checks are state-changing and require both confirmation toggles. The
environment controls only accept loopback ERPBridge URLs. Stopping the stack
removes local Compose volumes and requires an explicit confirmation.

The staged SDK comes from the sibling `erpbridge-sdk` worktree. The script stores its version, revision, and SHA-256 value in `.scratch/artifacts/sdk-manifest.json`.

## Host fallback

Use the host fallback when Docker cannot fetch the Compose builder images.

Start Mock ERP with `uv run main.py` in `ERPBridge/mock-erp`.

Start Redis with the cached image, if it is available.

Start `ERPBridge/erpbridge-server` with these settings:

```bash
BASE_URL=http://localhost:8080 \
MCP_PORT=8080 \
ERP_BASE_URL=http://localhost:8081 \
REDIS_URL=redis://localhost:6379 \
DATABASE_PATH=/tmp/erpbridge-ui-live/erpbridge.db \
ERP_PRIMARY_KEY='token adm_key_001:adm_sec_stu901' \
./erpbridge-server
```

Build the server before the browser test:

```bash
make build
```

Run `npm run infra:ready` after the server starts. This command checks health and the MCP browser CORS headers.

Run `npm run infra:seed` to register the Mock ERP and apply the per-tool JSON schemas.

## Verify

```bash
npm test
npm run typecheck
npm run build
ERPBRIDGE_TEST_SERVER=http://localhost:8080 npm run test:integration
ERPBRIDGE_TEST_SERVER=http://localhost:8080 npm run test:e2e
```

The e2e command needs a local Playwright Chromium browser. Install it with `npx playwright install chromium` in a network-enabled environment.

## Records

Read `.scratch/README.md` before you add a finding. Record every failed command, documentation mismatch, compatibility issue, regression, workaround, and root cause in `.scratch/`.

Do not store tokens, cookies, authorization headers, or unredacted server output.
