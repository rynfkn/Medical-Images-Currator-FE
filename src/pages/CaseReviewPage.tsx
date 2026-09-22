import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { AnnotationInfo } from "../components/AnnotationInfo";
import { CaseFiles } from "../components/CaseFiles";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ReviewPanel } from "../components/ReviewPanel";
import { StatusBadge } from "../components/StatusBadge";
import { clearSlices } from "../components/viewer/slices";
import { Viewer } from "../components/Viewer";
import type {
  Annotation,
  Case,
  CaseSummary,
  Decision,
  Review,
  User,
  ViewerInfo,
} from "../types/api";

interface CaseData {
  item: Case;
  current: Annotation | null;
  history: Annotation[];
  reviews: Review[];
}

interface Guard {
  href: string | null;
  title: string;
}

async function loadCase(caseId: string): Promise<CaseData> {
  const [item, current, history, reviews] = await Promise.all([
    api.get<Case>(`/cases/${caseId}`),
    api
      .get<Annotation>(`/cases/${caseId}/annotations/current`)
      .then(({ data }) => data)
      .catch((error: unknown) => {
        if (
          axios.isAxiosError(error) &&
          error.response?.status === 404 &&
          error.response.data?.detail === "Case has no annotation"
        )
          return null;
        throw error;
      }),
    api.get<Annotation[]>(`/cases/${caseId}/annotations`),
    api.get<Review[]>(`/cases/${caseId}/reviews`),
  ]);
  return {
    item: item.data,
    current,
    history: history.data,
    reviews: reviews.data,
  };
}

// Coalesce repeated mounts/navigation while the backend creates the one open draft.
const openings = new Map<string, Promise<CaseData>>();
function openCase(caseId: string, userId: string): Promise<CaseData> {
  const key = `${caseId}:${userId}`;
  const pending = openings.get(key);
  if (pending) return pending;
  const request = (async () => {
    const data = await loadCase(caseId);
    if (!data.reviews.some((review) => !review.submitted_at)) {
      try {
        await api.post<Review>(`/cases/${caseId}/reviews`, {
          decision: "APPROVED",
          comment: null,
          annotation_version_id: data.current?.id || null,
        });
      } catch (error) {
        // A concurrent tab/reviewer may have acquired the case in the meantime.
        if (!axios.isAxiosError(error) || error.response?.status !== 409)
          throw error;
      }
      return loadCase(caseId);
    }
    return data;
  })().finally(() => openings.delete(key));
  openings.set(key, request);
  return request;
}

// One ordered case list per dataset is enough for previous/next navigation.
const indexes = new Map<string, Promise<CaseSummary[]>>();
function caseIndex(datasetId: string): Promise<CaseSummary[]> {
  const cached = indexes.get(datasetId);
  if (cached) return cached;
  const request = api
    .get<CaseSummary[]>(`/datasets/${datasetId}/cases/index`)
    .then(({ data }) => data)
    .catch(() => {
      indexes.delete(datasetId);
      return [] as CaseSummary[];
    });
  indexes.set(datasetId, request);
  return request;
}

export function CaseReviewPage({ user }: { user: User }) {
  const { caseId } = useParams();
  return <CaseWorkspace key={caseId} caseId={caseId!} user={user} />;
}

function CaseWorkspace({ caseId, user }: { caseId: string; user: User }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<CaseData | null>(null);
  const [viewer, setViewer] = useState<ViewerInfo | null>(null);
  const [viewerError, setViewerError] = useState("");
  const [viewerVersion, setViewerVersion] = useState(0);
  const [siblings, setSiblings] = useState<CaseSummary[]>([]);
  const [dirty, setDirty] = useState(false);
  const [guard, setGuard] = useState<Guard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [decision, setDecision] = useState<Decision>("APPROVED");
  const [comment, setComment] = useState("");
  const [operation, setOperation] = useState<
    "upload" | "save" | "submit" | "mask" | "discard" | "delete" | null
  >(null);
  const draft = data?.reviews.find((review) => !review.submitted_at);
  const ownDraft = draft?.reviewer_id === user.id;
  const busy = operation !== null;

  function applyDraft(next: CaseData) {
    const own = next.reviews.find(
      (review) => !review.submitted_at && review.reviewer_id === user.id,
    );
    setDecision(own?.decision || "APPROVED");
    setComment(own?.comment || "");
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    openCase(caseId, user.id)
      .then((next) => {
        if (!active) return;
        setData(next);
        applyDraft(next);
        void caseIndex(next.item.dataset_id).then(
          (list) => active && setSiblings(list),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, "Failed to load case."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseId, user.id, retry]);

  useEffect(() => {
    let active = true;
    setViewerError("");
    api
      .get<ViewerInfo>(`/viewer/cases/${caseId}`)
      .then(({ data: info }) => {
        if (!active) return;
        setViewer(info);
        setDirty(info.has_draft);
      })
      .catch((cause: unknown) => {
        if (active)
          setViewerError(
            errorMessage(cause, "Failed to prepare the image viewer."),
          );
      });
    return () => {
      active = false;
    };
  }, [caseId, retry]);

  // Unsaved segmentation edits live on the server, but never leave without asking.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!anchor || anchor.target === "_blank" || !href) return;
      if (!href.startsWith("/") || href === location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setGuard({ href, title: "You have unsaved segmentation changes." });
    };
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty, location.pathname]);

  async function deleteCase() {
    if (!data || busy || user.role !== "ADMIN") return;
    if (
      !window.confirm(
        `Delete “${data.item.case_uid}” and all its annotations, drafts, and review history?\nThis includes unsaved segmentation changes and permanently removes the managed files. It cannot be undone.`,
      )
    )
      return;
    setOperation("delete");
    setError("");
    setMessage("");
    try {
      await api.delete(`/cases/${caseId}`);
      indexes.delete(data.item.dataset_id);
      clearSlices(caseId);
      setDirty(false);
      navigate(`/datasets/${data.item.dataset_id}`, { replace: true });
    } catch (cause) {
      setError(
        errorMessage(cause, "Failed to delete the data. Please try again."),
      );
    } finally {
      setOperation(null);
    }
  }

  async function refreshViewer() {
    const { data: info } = await api.get<ViewerInfo>(`/viewer/cases/${caseId}`);
    setViewer(info);
    setDirty(info.has_draft);
    setViewerVersion((value) => value + 1);
  }

  async function saveSegmentation(): Promise<boolean> {
    if (busy) return false;
    setOperation("mask");
    setError("");
    setMessage("");
    try {
      const { data: annotation } = await api.post<Annotation>(
        `/viewer/cases/${caseId}/save`,
      );
      setMessage(`Segmentation saved as version v${annotation.version}.`);
      setData(await loadCase(caseId));
      await refreshViewer();
      return true;
    } catch (cause) {
      setError(errorMessage(cause, "Failed to save the segmentation."));
      return false;
    } finally {
      setOperation(null);
    }
  }

  async function discardSegmentation(): Promise<boolean> {
    if (busy) return false;
    setOperation("discard");
    setError("");
    setMessage("");
    try {
      await api.post(`/viewer/cases/${caseId}/discard`);
      await refreshViewer();
      setMessage("Unsaved segmentation changes discarded.");
      return true;
    } catch (cause) {
      setError(errorMessage(cause, "Failed to discard the changes."));
      return false;
    } finally {
      setOperation(null);
    }
  }

  async function resolveGuard(action: "save" | "discard" | "stay") {
    const target = guard?.href;
    if (action === "stay") return setGuard(null);
    const done =
      action === "save"
        ? await saveSegmentation()
        : await discardSegmentation();
    if (!done) return;
    setGuard(null);
    if (target) navigate(target);
  }

  async function upload(file: File): Promise<boolean> {
    if (!ownDraft || busy) return false;
    setOperation("upload");
    setError("");
    setMessage("");
    let uploaded = false;
    try {
      const body = new FormData();
      body.append("file", file);
      const { data: annotation } = await api.post<Annotation>(
        `/cases/${caseId}/annotations`,
        body,
      );
      uploaded = true;
      setMessage(
        `Correction uploaded successfully. Current annotation: v${annotation.version}.`,
      );
      setData(await loadCase(caseId));
      await refreshViewer();
    } catch (cause) {
      setError(
        uploaded
          ? "Correction uploaded, but refreshing the case failed. Reload to verify it before uploading again."
          : errorMessage(cause, "Failed to upload correction."),
      );
    } finally {
      setOperation(null);
    }
    return uploaded;
  }

  async function save(submit: boolean) {
    if (!draft || !ownDraft || busy || !data) return;
    setError("");
    setMessage("");
    if (
      submit &&
      decision === "MODIFIED" &&
      (!data.current ||
        data.current.version === 0 ||
        data.current.created_by !== user.id)
    ) {
      setError(
        "Please save or upload a corrected annotation before submitting MODIFIED. The correction must be made by you.",
      );
      return;
    }
    if (submit && dirty) {
      setGuard({
        href: null,
        title: "Save the segmentation before submitting the review.",
      });
      return;
    }
    setOperation(submit ? "submit" : "save");
    let submitted = false;
    try {
      const { data: saved } = await api.patch<Review>(`/reviews/${draft.id}`, {
        decision,
        comment: comment || null,
        annotation_version_id: data.current?.id || null,
      });
      setData(
        (previous) =>
          previous && {
            ...previous,
            reviews: previous.reviews.map((review) =>
              review.id === saved.id ? saved : review,
            ),
          },
      );
      if (submit) {
        await api.post<Review>(`/reviews/${saved.id}/submit`);
        submitted = true;
        setMessage("Review submitted successfully.");
        setData(await loadCase(caseId));
      } else setMessage("Draft saved.");
    } catch (cause) {
      setError(
        submitted
          ? "Review submitted, but refreshing the case failed. Reload to see the latest case information."
          : errorMessage(
              cause,
              submit ? "Failed to submit review." : "Failed to save draft.",
            ),
      );
    } finally {
      setOperation(null);
    }
  }

  if (loading) return <p role="status">Loading case…</p>;
  if (!data)
    return (
      <>
        <Link to="/datasets">← All datasets</Link>
        <p className="error" role="alert">
          {error}
        </p>
        <button onClick={() => setRetry(retry + 1)}>Try again</button>
      </>
    );
  const { item, current, history, reviews } = data;
  const position = siblings.findIndex((entry) => entry.id === item.id);
  const previous = position > 0 ? siblings[position - 1] : null;
  const next =
    position >= 0 && position < siblings.length - 1
      ? siblings[position + 1]
      : null;
  const canEdit = Boolean(viewer?.editable) && Boolean(ownDraft);

  return (
    <>
      <div className="case-topbar">
        <Link className="back-link" to={`/datasets/${item.dataset_id}`}>
          ← Back to files
        </Link>
        <nav className="file-nav" aria-label="Files in this dataset">
          {previous ? (
            <Link
              className="button secondary"
              to={`/cases/${previous.id}`}
              aria-label="Previous file"
            >
              ‹
            </Link>
          ) : (
            <button className="secondary" disabled aria-label="Previous file">
              ‹
            </button>
          )}
          <span className="file-position">
            {position >= 0 ? `${position + 1}/${siblings.length}` : "—"}
          </span>
          {next ? (
            <Link
              className="button secondary"
              to={`/cases/${next.id}`}
              aria-label="Next file"
            >
              ›
            </Link>
          ) : (
            <button className="secondary" disabled aria-label="Next file">
              ›
            </button>
          )}
        </nav>
      </div>
      <div className="page-heading case-heading">
        <div>
          <p className="eyebrow">File review</p>
          <h1>{item.case_uid}</h1>
          <p className="muted">
            {item.dimension} · {item.image_format} image ·{" "}
            {item.annotation_format} annotation
          </p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {draft && !ownDraft && (
        <p className="notice" role="status">
          Another reviewer has an open draft for this case. You can view its
          files, but review and correction actions are locked.
        </p>
      )}
      <div className="case-layout">
        <div className="case-content">
          {viewerError ? (
            <section className="panel">
              <h2>Image viewer</h2>
              <p className="error" role="alert">
                {viewerError}
              </p>
              <button className="secondary" onClick={() => setRetry(retry + 1)}>
                Try again
              </button>
            </section>
          ) : viewer ? (
            <ErrorBoundary title="Image viewer">
              <Viewer
                caseId={caseId}
                info={viewer}
                canEdit={canEdit}
                deleteLabel={`Delete data ${item.case_uid}`}
                deleting={operation === "delete"}
                onDelete={
                  user.role === "ADMIN" ? () => void deleteCase() : undefined
                }
                dirty={dirty}
                busy={busy}
                version={viewerVersion}
                onDirty={() => setDirty(true)}
                onSave={() => void saveSegmentation()}
                onDiscard={() =>
                  setGuard({
                    href: null,
                    title: "Discard your unsaved segmentation changes?",
                  })
                }
              />
            </ErrorBoundary>
          ) : (
            <section className="panel">
              <h2>Image viewer</h2>
              {/* Not role="status": the page already announces its own loading state. */}
              <p className="muted">Preparing the volume for viewing…</p>
            </section>
          )}
          <AnnotationInfo
            current={current}
            history={history}
            format={item.annotation_format}
            disabled={busy || !ownDraft}
            uploading={operation === "upload"}
            onUpload={upload}
          />
          <CaseFiles item={item} />
        </div>
        <aside>
          {draft && ownDraft ? (
            <ReviewPanel
              draft={draft}
              decision={decision}
              comment={comment}
              disabled={busy}
              submitting={operation === "submit"}
              saving={operation === "save"}
              canModify={item.annotation_format !== "NONE" && current !== null}
              onDecision={setDecision}
              onComment={setComment}
              onSave={() => void save(false)}
              onSubmit={() => void save(true)}
            />
          ) : (
            <section className="panel">
              <h2>{draft ? "Review in progress" : "Review complete"}</h2>
              <p className="muted">
                {draft
                  ? "This case is reserved by another reviewer."
                  : "Your submitted review has been recorded."}
              </p>
              {!draft && (
                <button
                  className="secondary"
                  onClick={() => {
                    setMessage("");
                    setRetry(retry + 1);
                  }}
                >
                  Start another review
                </button>
              )}
            </section>
          )}
          <section className="panel review-history">
            <h2>Review history</h2>
            {reviews.filter((review) => review.submitted_at).length ? (
              <ul className="history">
                {reviews
                  .filter((review) => review.submitted_at)
                  .slice()
                  .reverse()
                  .map((review) => (
                    <li key={review.id}>
                      <div>
                        <StatusBadge status={review.decision} />
                        <small>
                          {new Date(review.submitted_at!).toLocaleString()}
                        </small>
                        {review.comment && (
                          <p className="review-comment">{review.comment}</p>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="muted">No submitted reviews yet.</p>
            )}
          </section>
        </aside>
      </div>
      {guard && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Unsaved changes"
        >
          <div className="modal panel">
            <h2>{guard.title}</h2>
            <p className="muted">
              Your brush edits are kept as a private draft. Save them as a new
              annotation version, or discard them to return to the stored
              segmentation.
            </p>
            <div className="modal-actions">
              <button disabled={busy} onClick={() => void resolveGuard("save")}>
                {operation === "mask" ? "Saving…" : "Save changes"}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void resolveGuard("discard")}
              >
                {operation === "discard" ? "Discarding…" : "Discard changes"}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void resolveGuard("stay")}
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
