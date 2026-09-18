import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { Pagination, PAGE_SIZE } from "../components/Pagination";
import { StatusBadge } from "../components/StatusBadge";
import type { Case, Dataset } from "../types/api";

export function DatasetPage() {
  const { datasetId } = useParams();
  return <DatasetCases key={datasetId} datasetId={datasetId!} />;
}

function DatasetCases({ datasetId }: { datasetId: string }) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
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
        ← All datasets
      </Link>
      <div className="page-heading">
        <p className="eyebrow">Case library</p>
        <h1>{dataset?.name || "Dataset"}</h1>
        {dataset && (
          <p className="muted">
            {dataset.dimension} · {dataset.image_format} ·{" "}
            {dataset.annotation_format} annotations
          </p>
        )}
        {dataset?.description && <p>{dataset.description}</p>}
      </div>
      {loading ? (
        <p role="status">Loading cases…</p>
      ) : error ? (
        <div className="error" role="alert">
          {error}{" "}
          <button className="secondary" onClick={() => setRetry(retry + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <section className="panel table-panel">
            <h2>Cases</h2>
            {!cases.length ? (
              <p className="empty">No cases found.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Format</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link className="case-name" to={`/cases/${item.id}`}>
                            {item.case_uid}
                          </Link>
                        </td>
                        <td>{item.image_format}</td>
                        <td>
                          <StatusBadge status={item.status} />
                        </td>
                        <td>
                          <Link
                            to={`/cases/${item.id}`}
                            aria-label={`Open ${item.case_uid}`}
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
