import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { Pagination, PAGE_SIZE } from "../components/Pagination";
import { NewProjectForm } from "../components/ProjectForms";
import type { Dataset, User } from "../types/api";

export function DatasetListPage({ user }: { user: User | null }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api
      .get<Dataset[]>("/datasets", {
        params: { limit: PAGE_SIZE, offset },
        signal: controller.signal,
      })
      .then(({ data }) => setDatasets(data))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(errorMessage(error, "Failed to load datasets."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offset, retry]);
  return (
    <>
      <div className="page-heading with-action">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Projects</h1>
          <p className="muted">
            Open a project to see its files, or create one and upload data.
          </p>
        </div>
        {user?.role === "ADMIN" && (
          <NewProjectForm onCreated={() => setRetry((value) => value + 1)} />
        )}
      </div>
      {loading ? (
        <p role="status">Loading datasets…</p>
      ) : error ? (
        <div className="error" role="alert">
          {error}{" "}
          <button className="secondary" onClick={() => setRetry(retry + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {!datasets.length && (
            <div className="empty panel">
              {user?.role === "ADMIN"
                ? "No projects yet. Use “New project” above, then add files to it."
                : "No projects found. Ask an administrator to create one."}
            </div>
          )}
          <div className="dataset-grid">
            {datasets.map((dataset) => (
              <article className="panel dataset-card" key={dataset.id}>
                <span className="format-icon" aria-hidden="true">
                  {dataset.dimension}
                </span>
                <h2>
                  <Link to={`/datasets/${dataset.id}`}>{dataset.name}</Link>
                </h2>
                {dataset.description && (
                  <p className="muted">{dataset.description}</p>
                )}
                <dl className="facts">
                  <div>
                    <dt>Image format</dt>
                    <dd>{dataset.image_format}</dd>
                  </div>
                  <div>
                    <dt>Annotation format</dt>
                    <dd>{dataset.annotation_format}</dd>
                  </div>
                </dl>
                <Link
                  className="button secondary"
                  to={`/datasets/${dataset.id}`}
                >
                  Open project <span aria-hidden="true">→</span>
                </Link>
              </article>
            ))}
          </div>
          <Pagination
            offset={offset}
            count={datasets.length}
            onChange={setOffset}
          />
        </>
      )}
    </>
  );
}
