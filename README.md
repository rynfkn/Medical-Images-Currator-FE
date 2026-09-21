# Medical Dataset Curator frontend

A React + TypeScript workspace for the existing FastAPI backend: a dataset/file browser, a medical image viewer with brush-based segmentation editing, and the review workflow. All frontend source, dependencies, configuration, and build output stay in this directory. The viewer is plain canvas — no imaging library is pulled in.

## Manage projects and labels

On a project page, administrators can use **Delete project** or **Delete data**
on an individual file card. Both ask for confirmation and permanently remove the
managed data and associated annotations and reviews.

In the viewer, **Manage labels** opens the label names and delete controls.
**Save names** persists renamed labels. Deleting a label clears it across every
slice in your draft; use **Save segmentation** to commit or **Discard** to restore
it. Saved annotation history remains available.

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

## Deploy on Vercel with a separate backend

Set the Vercel project's **Root Directory** to `frontend`, framework to **Vite**,
build command to `npm run build`, and output directory to `dist`. In **Settings →
Environment Variables**, set this for each environment you deploy (Production or Preview):

```dotenv
VITE_API_BASE_URL=https://YOUR-PUBLIC-BACKEND/api/v1
```

Use your backend's public HTTPS domain, including `/api/v1`, then **redeploy**.
Vite embeds this value during the build. `API_PROXY_TARGET` only works in local
development/preview; Vercel does not run that proxy. The supplied `vercel.json`
serves the SPA, so `/api/v1` on the Vercel domain returns HTML instead of API JSON.
Vercel builds now reject a missing, relative, or non-HTTPS API URL.

On the backend, add the exact frontend origin to its environment, without a path
or trailing slash. Keep any local origins you still use:

```dotenv
CORS_ORIGINS=["https://medical-images-currator.vercel.app","http://localhost:5173"]
```

From `backend/`, apply the environment and backend code changes:

```bash
docker compose up -d --build --force-recreate backend
```

`docker compose restart` alone does not apply changed Compose environment values.
For a deployment outside Compose, update the running service's environment and
restart/redeploy it. The browser accesses the backend API; only the backend
connects to PostgreSQL. Database credentials do not belong in Vercel's `VITE_*`
variables.

Check the tunnel and browser preflight without credentials:

```bash
curl -i https://YOUR-PUBLIC-BACKEND/openapi.json
curl -i -X OPTIONS https://YOUR-PUBLIC-BACKEND/api/v1/datasets \
  -H 'Origin: https://medical-images-currator.vercel.app' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

Expect JSON from OpenAPI and a successful preflight with
`access-control-allow-origin: https://medical-images-currator.vercel.app`.
`400 Disallowed CORS origin` means the running backend does not allow that origin.
Include each Preview deployment origin explicitly if you use Vercel Preview URLs.
A Cloudflare Quick Tunnel URL changes when recreated; update the Vercel API URL
and redeploy each time, or use a named tunnel with a stable hostname.

References: [Vercel Vite deployment](https://vercel.com/docs/frameworks/frontend/vite),
[Vercel environment variables](https://vercel.com/docs/environment-variables),
and [backend deployment instructions](../backend/DEPLOYMENT.md).

## Projects and files

Administrators see **New project** on `/datasets` and **Add files** inside a project.
Creating a project picks one of the backend's supported format combinations by
name ("NIfTI volumes", "DICOM series, segmentable", "PNG images + COCO", …), and
adding files uploads them straight from the browser — no server-side paths. For
NIfTI, segmentations are optional and matched to their image by file name, so a
project can be filled with images alone and segmented later in the viewer.
Reviewers see the projects and files but not these actions.

## Viewing and annotating

The `/cases/:caseId` page is the workspace. Images are never downloaded whole: the
viewer asks the backend for one windowed PNG slice at a time, so a 300-slice CT opens
as fast as a thumbnail.

- **Planes.** Axial, coronal, and sagittal, each drawn with its own millimetre spacing so anisotropic volumes keep their proportions. 2D images (PNG/JPEG) are shown as a single-slice volume.
- **Mouse.** Wheel moves through slices, Ctrl+wheel or pinch zooms, the right button drags window/level, the middle button or the Navigate tool pans. Arrow keys step slices; `b`, `e`, `v` pick brush, eraser, navigate; `[` and `]` size the brush; Ctrl+Z undoes the last stroke on the current slice.
- **Windowing.** Presets (soft tissue, lung, bone, brain, auto) plus numeric WW/WL fields for exact Hounsfield values. Volumes that look like CT open on a soft-tissue window instead of a percentile stretch.
- **Brush.** Paint and erase the segmentation directly. Each stroke is sent to the reviewer's server-side working copy, so edits show up in every plane and survive a reload, and no annotation version is created until **Save segmentation**.
- **Labels.** Label values can be named (`1` → `Kidney`), renamed, and extended. Names are saved with the case and written beside the mask as `labels.json`, since a NIfTI mask stores numbers only.
- **Leaving with unsaved edits.** Any in-app link, the previous/next file arrows, and a browser reload ask first, offering save, discard, or keep editing. Nothing is discarded silently.
- **Files.** `‹` and `›` step through the dataset with an `n/total` indicator, and the dataset page shows each file as a card.
- **Export.** The current annotation and its label names download from the case page, in the case's own format: NIfTI in, NIfTI out.

COCO supports polygon, uncompressed RLE, and compressed RLE segmentations. Category
IDs such as `0` or `300` are mapped to viewer labels `1..255` and restored to their
original IDs on export. Up to 255 categories are supported; COCO editing uses the
dataset's existing categories. Annotation v0 is preserved.

Decoded slices are cached in the browser (64 of them) and the next eight in the
direction of travel are prefetched, so wheel scrolling normally issues no request at
all. Images are drawn with linear interpolation, which is what keeps a thick-slice
coronal or sagittal view readable; label overlays stay nearest-neighbour so colours
are never blended into classes that do not exist.

## Workflow and API compatibility

The four pages are `/login`, `/datasets`, `/datasets/:datasetId`, and `/cases/:caseId`.

- Login uses OAuth2 form encoding, stores the JWT in localStorage, and verifies `/auth/me`. API 401 responses clear the session and return to login.
- Dataset and case lists use the backend's `limit` / `offset` pagination.
- Images, slices, and downloads are fetched with bearer authentication; nothing is addressed by a token-bearing URL.
- Opening a case creates an `APPROVED` draft or reuses the existing draft. Another reviewer's open draft locks correction and review actions. Saving a draft preserves the chosen decision and comment. Opening a previously submitted case starts a new review, as requested by the MVP workflow.
- Corrections use multipart `file` uploads. The current annotation, version history, draft reference, and case status refresh after upload. The backend preserves v0 and validates NIfTI/COCO contents.
- `MODIFIED` requires a current correction uploaded by the signed-in reviewer. DICOM cases support the other three decisions and have no correction upload.
- Submission saves the form to the same draft and then submits it. Success refreshes the case status and review history. Unsaved form edits are not persisted when leaving the page; use **Save draft** first.

The backend exposes `PATCH /api/v1/reviews/{review_id}` for saving an open draft's decision and comment, and the `/api/v1/viewer/...` endpoints the viewer reads and writes. No database migration is needed.

File downloads are buffered in browser memory, so exporting a very large mask is limited by available memory; viewing is not, because slices are fetched individually.

## Browser integration tests

The Playwright suite starts the actual FastAPI application and Vite, generates synthetic NIfTI/PNG/JPEG/DICOM files, creates isolated test users, and runs real HTTP requests. It covers login/logout/session expiry, navigation, draft reuse, all four decisions, reviewer locking, protected files, NIfTI and COCO corrections, preservation of the original v0 bytes, mobile layout, painting a mask and saving it as a new version, and the prompt shown when leaving with unsaved edits.

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
