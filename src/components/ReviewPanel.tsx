import type { Decision, Review } from "../types/api";

const decisions: { value: Decision; label: string; hint: string }[] = [
  {
    value: "APPROVED",
    label: "APPROVED",
    hint: "Accept the current annotation.",
  },
  {
    value: "MODIFIED",
    label: "MODIFIED",
    hint: "Accept a correction you uploaded.",
  },
  {
    value: "NEEDS_CORRECTION",
    label: "NEEDS_CORRECTION",
    hint: "Request changes to the annotation.",
  },
  {
    value: "REJECTED",
    label: "REJECTED",
    hint: "Mark the case as unsuitable.",
  },
];

export function ReviewPanel({
  draft,
  decision,
  comment,
  disabled,
  submitting,
  saving,
  canModify,
  onDecision,
  onComment,
  onSave,
  onSubmit,
}: {
  draft: Review;
  decision: Decision;
  comment: string;
  disabled: boolean;
  submitting: boolean;
  saving: boolean;
  canModify: boolean;
  onDecision: (decision: Decision) => void;
  onComment: (comment: string) => void;
  onSave: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="panel review-panel">
      <div className="section-heading">
        <h2>Your review</h2>
        <span className="tag">Draft</span>
      </div>
      <p className="muted">Choose a decision and add your observations.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset disabled={disabled}>
          <legend>Decision</legend>
          <div className="decision-list">
            {decisions.map((option) => (
              <label
                className={`decision-option ${decision === option.value ? "selected" : ""}`}
                key={option.value}
              >
                <input
                  type="radio"
                  name="decision"
                  value={option.value}
                  checked={decision === option.value}
                  disabled={option.value === "MODIFIED" && !canModify}
                  onChange={() => onDecision(option.value)}
                />
                <span>
                  <strong>{option.label.replaceAll("_", " ")}</strong>
                  <small>{option.hint}</small>
                </span>
              </label>
            ))}
          </div>
          {!canModify && (
            <p className="muted small">
              MODIFIED is unavailable for cases without annotations.
            </p>
          )}
          <label htmlFor="review-comment">
            Comment <span className="muted">(optional)</span>
          </label>
          <textarea
            id="review-comment"
            rows={5}
            maxLength={10000}
            placeholder="Add your review notes…"
            value={comment}
            onChange={(event) => onComment(event.target.value)}
          />
        </fieldset>
        <button className="full-width" disabled={disabled}>
          {submitting ? "Submitting review…" : "Submit review"}
        </button>
        <button
          className="secondary full-width"
          type="button"
          disabled={disabled}
          onClick={onSave}
        >
          {saving ? "Saving draft…" : "Save draft"}
        </button>
        <p className="muted small">
          Save to keep your decision and comment for later. Submitted reviews
          cannot be edited.
        </p>
      </form>
      <details className="debug-info">
        <summary>Review information</summary>
        <dl>
          <dt>Review ID</dt>
          <dd>{draft.id}</dd>
          <dt>Annotation ID</dt>
          <dd>{draft.annotation_version_id || "None"}</dd>
        </dl>
      </details>
    </section>
  );
}
