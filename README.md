# Medical Dataset Curator frontend

A small React + TypeScript integration MVP for the existing FastAPI backend. All frontend source, dependencies, configuration, and build output stay in this directory.

## Run locally

Requires Node.js 20.19+ (or 22.12+) and the backend running on port 8000. Set up PostgreSQL, migrate the backend, create a user, and ingest datasets using [the backend instructions](../backend/README.md).

From the repository root:

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173`. Sign in with a user created in the backend; the application has no built-in credentials or mock datasets.

Vite proxies `/api` to `http://localhost:8000`. Change `API_PROXY_TARGET` in `.env.local` if the backend runs elsewhere. For a directly accessed remote backend, set `VITE_API_BASE_URL=https://your-api.example/api/v1` and allow your frontend origin in the backend's `CORS_ORIGINS`. Restart Vite after changing environment variables.

```bash
npm run build
npm run preview
npm run format:check
```

Build output is in `frontend/dist`. Production hosting must serve `index.html` for client-side routes and proxy `/api` to the backend, or use a directly configured API base URL at build time.

## Workflow and API compatibility

The four pages are `/login`, `/datasets`, `/datasets/:datasetId`, and `/cases/:caseId`.

- Login uses OAuth2 form encoding, stores the JWT in localStorage, and verifies `/auth/me`. API 401 responses clear the session and return to login.
- Dataset and case lists use the backend's `limit` / `offset` pagination.
- PNG/JPEG images and all downloads are fetched with bearer authentication. Blob URLs allow images to render without exposing tokens in URLs. NIfTI and DICOM show metadata and downloadable files only.
- Opening a case creates an `APPROVED` draft or reuses the existing draft. Another reviewer's open draft locks correction and review actions. Saving a draft preserves the chosen decision and comment. Opening a previously submitted case starts a new review, as requested by the MVP workflow.
- Corrections use multipart `file` uploads. The current annotation, version history, draft reference, and case status refresh after upload. The backend preserves v0 and validates NIfTI/COCO contents.
- `MODIFIED` requires a current correction uploaded by the signed-in reviewer. DICOM cases support the other three decisions and have no correction upload.
- Submission saves the form to the same draft and then submits it. Success refreshes the case status and review history. Unsaved form edits are not persisted when leaving the page; use **Save draft** first.

**Small backend compatibility change:** the original API could create and submit drafts but could not update their decision/comment. `PATCH /api/v1/reviews/{review_id}` accepts the existing `ReviewCreate` JSON schema, checks ownership and immutability, and targets the current annotation. CORS now allows PATCH. Restart the backend with these changes before running the frontend. No database migration is needed.

File downloads are buffered in browser memory for this MVP. Large medical volumes may require a streaming download approach later. Medical image editing and segmentation visualization are intentionally outside this implementation.

## Browser integration tests

The Playwright suite starts the actual FastAPI application and Vite, generates synthetic NIfTI/PNG/JPEG/DICOM files, creates isolated test users, and runs real HTTP requests. It covers login/logout/session expiry, navigation, draft reuse, all four decisions, reviewer locking, protected files, NIfTI and COCO corrections, preservation of the original v0 bytes, and mobile layout.

Install backend test dependencies in a Python 3.12+ environment using `pip install -e '../backend[test]'`, then run from `frontend`:

```bash
npx playwright install chromium
E2E_PYTHON=/path/to/backend/venv/bin/python npm run test:e2e
```

Alternatively, use installed Google Chrome with `PLAYWRIGHT_CHANNEL=chrome`. By default the suite uses temporary SQLite storage. To check PostgreSQL, provide a disposable test database:

```bash
E2E_PYTHON=/path/to/backend/venv/bin/python \
E2E_DATABASE_URL=postgresql+psycopg://USER:PASSWORD@localhost:5432/curator_test \
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

PostgreSQL runs use a unique schema, removed on normal shutdown. Do not use a production database. File fixtures use a temporary directory. Test manifests are ignored under `.e2e/`, and screenshots/traces are under `test-results/`. Test servers use ports 18081 and 15173.

## Docker

A standalone Nginx image serves the build, handles SPA routes, and proxies requests to the existing backend. No extra Compose infrastructure is required.

```bash
# From frontend/
docker build -t medical-curator-frontend .
docker run --rm -p 5173:80 \
  --add-host=host.docker.internal:host-gateway \
  -e BACKEND_ORIGIN=http://host.docker.internal:8000 \
  medical-curator-frontend
```

The backend must be reachable from the container. If it is in another container, join its network and set `BACKEND_ORIGIN=http://backend:8000`; a host service listening only on loopback is not reachable through the host gateway. `BACKEND_ORIGIN` should have no trailing slash. The default proxy accepts uploads up to 1 GiB, matching the backend default.
