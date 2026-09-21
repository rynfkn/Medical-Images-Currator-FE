import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { Pagination, PAGE_SIZE } from "../components/Pagination";
import { StatusBadge } from "../components/StatusBadge";
import { UploadFilesForm } from "../components/ProjectForms";
import type { Case, Dataset, User } from "../types/api";

export function DatasetPage({ user }: { user: User | null }) {
  const { datasetId } = useParams();
  return <DatasetCases key={datasetId} datasetId={datasetId!} user={user} />;
}

function DatasetCases({
  datasetId,
  user,
}: {
  datasetId: string;
  user: User | null;
}) {
  const navigate = useNavigate();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  async function remove(item?: Case) {
    if (!dataset || deleting) return;
    const description = item
      ? `Delete “${item.case_uid}” and all its annotations, drafts, and review history?`
      : `Delete project “${dataset.name}” and all its data, annotations, drafts, and review history?`;
    if (
      !window.confirm(
        `${description}\nThis permanently removes the managed files and cannot be undone.`,
      )
    )
      return;
    setDeleting(item?.id || datasetId);
    setDeleteError("");
    setMessage("");
    try {
      await api.delete(item ? `/cases/${item.id}` : `/datasets/${datasetId}`);
      if (!item) {
        navigate("/datasets", { replace: true });
        return;
      }
      setMessage(`Deleted ${item.case_uid}.`);
      if (cases.length === 1 && offset > 0)
        setOffset(Math.max(0, offset - PAGE_SIZE));
      else setRetry((value) => value + 1);
    } catch (cause) {
      setDeleteError(
        errorMessage(cause, "Failed to delete. Please try again."),
      );
    } finally {
      setDeleting(null);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      api.get<Dataset>(`/datasets/${datasetId}`, { signal: controller.signal }),
      api.get<Case[]>(`/datasets/${datasetId}/cases`, {
        params: { limit: PAGE_SIZE, offset },
        signal: controller.signal,
      }),
    ])
      .then(([dataset, cases]) => {
        setDataset(dataset.data);
        setCases(cases.data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(errorMessage(error, "Failed to load cases."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [datasetId, offset, retry]);
  return (
    <>
      <Link className="back-link" to="/datasets">
        ← All projects
      </Link>
      <div className="page-heading">
        <p className="eyebrow">Project</p>
        <h1>{dataset?.name || "Dataset"}</h1>
        {dataset && (
          <p className="muted">
            {dataset.dimension} · {dataset.image_format} ·{" "}
            {dataset.annotation_format} annotations
          </p>
        )}
        {dataset?.description && <p>{dataset.description}</p>}
        {user?.role === "ADMIN" && dataset && (
          <button
            className="danger"
            disabled={deleting !== null}
            onClick={() => void remove()}
          >
            {deleting === datasetId ? "Deleting…" : "Delete project"}
          </button>
        )}
      </div>
      {deleteError && (
        <p className="error" role="alert">
          {deleteError}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">Loading files…</p>
      ) : error ? (
        <div className="error" role="alert">
          {error}{" "}
          <button className="secondary" onClick={() => setRetry(retry + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <section className="files-section">
            <div className="section-heading">
              <h2>Files</h2>
              <span className="tag">{cases.length} on this page</span>
              {user?.role === "ADMIN" && dataset && (
                <UploadFilesForm
                  dataset={dataset}
                  onUploaded={(count) => {
                    setMessage(`Added ${count} file(s) to this project.`);
                    setRetry((value) => value + 1);
                  }}
                />
              )}
            </div>
            {!cases.length ? (
              <p className="empty panel">No files found in this dataset.</p>
            ) : (
              <div className="file-grid">
                {cases.map((item) => (
                  <article className="panel file-card" key={item.id}>
                    <Link className="file-name" to={`/cases/${item.id}`}>
                      <span className="format-icon" aria-hidden="true">
                        {item.image_format === "NIFTI"
                          ? "NII"
                          : item.image_format === "DICOM"
                            ? "DCM"
                            : item.image_format}
                      </span>
                      <strong>{item.case_uid}</strong>
                    </Link>
                    <p className="muted small">
                      {item.annotation_format === "NONE"
                        ? "No annotation format"
                        : item.current_annotation
                          ? `Segmentation v${item.current_annotation.version}`
                          : "No segmentation yet"}
                    </p>
                    <div className="file-card-foot">
                      <StatusBadge status={item.status} />
                      <Link
                        to={`/cases/${item.id}`}
                        aria-label={`Open ${item.case_uid}`}
                      >
                        Open →
                      </Link>
                    </div>
                    {user?.role === "ADMIN" && (
                      <button
                        className="danger"
                        disabled={deleting !== null}
                        aria-label={`Delete data ${item.case_uid}`}
                        onClick={() => void remove(item)}
                      >
                        {deleting === item.id ? "Deleting…" : "Delete data"}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
          <Pagination
            offset={offset}
            count={cases.length}
            onChange={setOffset}
          />
        </>
      )}
    </>
  );
}
