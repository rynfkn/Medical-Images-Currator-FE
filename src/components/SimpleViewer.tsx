import { useEffect, useState } from "react";
import { errorMessage, getFile } from "../api/client";
import type { Case } from "../types/api";
import { FileDownload } from "./FileDownload";

function format(value: unknown): string {
  if (value === null || value === undefined) return "Not available";
  if (Array.isArray(value)) return value.join(" × ");
  return String(value);
}

export function SimpleViewer({ item }: { item: Case }) {
  const raster = item.image_format === "PNG" || item.image_format === "JPEG";
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setImage("");
    setError("");
    if (!raster || !item.image_url) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    getFile(item.image_url, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImage(objectUrl);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(errorMessage(error, "Failed to load image."));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [raster, item.image_url, retry]);
  const m = item.metadata;
  const shape = Array.isArray(m.shape) ? m.shape : [];
  const dicom = item.image_format === "DICOM";
  return (
    <section className="panel viewer-panel">
      <div className="section-heading">
        <h2>
          {raster ? "Case image" : dicom ? "DICOM Series" : "3D NIfTI Case"}
        </h2>
        <span className="tag">
          {item.dimension} · {item.image_format}
        </span>
      </div>
      {raster ? (
        <div className="image-stage">
          {error ? (
            <div>
              <p className="error" role="alert">
                {error}
              </p>
              <button className="secondary" onClick={() => setRetry(retry + 1)}>
                Retry image
              </button>
            </div>
          ) : !item.image_url ? (
            <p>No image file available.</p>
          ) : image ? (
            <img
              src={image}
              alt={`Case ${item.case_uid}`}
              onError={() =>
                setError(
                  "The image could not be displayed. You can download the file below.",
                )
              }
            />
          ) : (
            <p role="status">Loading image…</p>
          )}
        </div>
      ) : (
        <div className="medical-placeholder">
          <span className="format-icon" aria-hidden="true">
            {dicom ? "DCM" : "NII"}
          </span>
          <p>Medical viewer not enabled in integration MVP.</p>
          <p className="muted">
            Case metadata and source files are available below.
          </p>
        </div>
      )}
      <dl className="facts viewer-facts">
        {dicom ? (
          <>
            <div>
              <dt>Modality</dt>
              <dd>{format(m.Modality)}</dd>
            </div>
            <div>
              <dt>Series description</dt>
              <dd>{format(m.SeriesDescription)}</dd>
            </div>
            <div>
              <dt>Number of slices</dt>
              <dd>{item.image_urls.length}</dd>
            </div>
            <div>
              <dt>Rows / columns</dt>
              <dd>{format(shape.slice(0, 2))}</dd>
            </div>
          </>
        ) : raster ? (
          <>
            <div>
              <dt>Width</dt>
              <dd>{format(m.width)}</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>{format(m.height)}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Shape</dt>
              <dd>{format(m.shape)}</dd>
            </div>
            <div>
              <dt>Spacing</dt>
              <dd>{format(m.spacing)}</dd>
            </div>
          </>
        )}
      </dl>
      {item.image_url && (
        <FileDownload
          url={item.image_url}
          filename={
            raster ? `image.${item.image_format.toLowerCase()}` : "image.nii.gz"
          }
        >
          Download image file
        </FileDownload>
      )}
      {dicom && (
        <details>
          <summary>Series files ({item.image_urls.length})</summary>
          <div className="file-list">
            {item.image_urls.map((url, index) => (
              <FileDownload key={url} url={url} filename={`${index}.dcm`}>
                Download slice {index + 1}
              </FileDownload>
            ))}
          </div>
        </details>
      )}
      <details>
        <summary>Case metadata</summary>
        <pre>{JSON.stringify(m, null, 2)}</pre>
      </details>
    </section>
  );
}
