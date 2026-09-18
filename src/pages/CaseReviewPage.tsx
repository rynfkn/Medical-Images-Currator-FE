import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { AnnotationInfo } from "../components/AnnotationInfo";
import { ReviewPanel } from "../components/ReviewPanel";
import { SimpleViewer } from "../components/SimpleViewer";
import { StatusBadge } from "../components/StatusBadge";
import type { Annotation, Case, Decision, Review, User } from "../types/api";

interface CaseData {
  item: Case;
  current: Annotation | null;
  history: Annotation[];
  reviews: Review[];
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

export function CaseReviewPage({ user }: { user: User }) {
  const { caseId } = useParams();
  return <CaseWorkspace key={caseId} caseId={caseId!} user={user} />;
}

function CaseWorkspace({ caseId, user }: { caseId: string; user: User }) {
  const [data, setData] = useState<CaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [decision, setDecision] = useState<Decision>("APPROVED");
  const [comment, setComment] = useState("");
  const [operation, setOperation] = useState<
    "upload" | "save" | "submit" | null
  >(null);
  const draft = data?.reviews.find((review) => !review.submitted_at);
  const ownDraft = draft?.reviewer_id === user.id;
  const busy = operation !== null;
  function applyDraft(next: CaseData) {
    const draft = next.reviews.find(
      (review) => !review.submitted_at && review.reviewer_id === user.id,
    );
    setDecision(draft?.decision || "APPROVED");
    setComment(draft?.comment || "");
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    openCase(caseId, user.id)
      .then((next) => {
        if (active) {
          setData(next);
          applyDraft(next);
        }
      })
      .catch((error: unknown) => {
        if (active) setError(errorMessage(error, "Failed to load case."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseId, user.id, retry]);

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
      // Reflect committed uploads even if the subsequent refresh fails.
      setData(
        (previous) =>
          previous && {
            ...previous,
            current: annotation,
            history: [...previous.history, annotation],
            item: {
              ...previous.item,
              status: "IN_REVIEW",
              current_annotation: annotation,
            },
            reviews: previous.reviews.map((review) =>
              review.id === draft?.id
                ? { ...review, annotation_version_id: annotation.id }
                : review,
            ),
          },
      );
      setMessage(
        `Correction uploaded successfully. Current annotation: v${annotation.version}.`,
      );
      setData(await loadCase(caseId));
    } catch (error) {
      setError(
        uploaded
          ? "Correction uploaded, but refreshing the case failed. Reload to verify it before uploading again."
          : errorMessage(error, "Failed to upload correction."),
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
        "Please upload a corrected annotation before submitting MODIFIED. The correction must be uploaded by you.",
      );
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
        const { data: result } = await api.post<Review>(
          `/reviews/${saved.id}/submit`,
        );
        submitted = true;
        setData(
          (previous) =>
            previous && {
              ...previous,
              item: { ...previous.item, status: result.decision },
              reviews: previous.reviews.map((review) =>
                review.id === result.id ? result : review,
              ),
            },
        );
        setMessage("Review submitted successfully.");
        setData(await loadCase(caseId));
      } else setMessage("Draft saved.");
    } catch (error) {
      setError(
        submitted
          ? "Review submitted, but refreshing the case failed. Reload to see the latest case information."
          : errorMessage(
              error,
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
  return (
    <>
      <Link className="back-link" to={`/datasets/${item.dataset_id}`}>
        ← Back to cases
      </Link>
      <div className="page-heading case-heading">
        <div>
          <p className="eyebrow">Case review</p>
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
          <SimpleViewer item={item} />
          <AnnotationInfo
            current={current}
            history={history}
            format={item.annotation_format}
            disabled={busy || !ownDraft}
            uploading={operation === "upload"}
            onUpload={upload}
          />
          <details className="panel">
            <summary>Case information</summary>
            <dl className="debug-info">
              <dt>Case ID</dt>
              <dd>{item.id}</dd>
              <dt>Dataset ID</dt>
              <dd>{item.dataset_id}</dd>
              <dt>Current annotation</dt>
              <dd>
                {current ? `v${current.version} · ${current.id}` : "None"}
              </dd>
            </dl>
          </details>
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
    </>
  );
}
