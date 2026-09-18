import { useRef, useState } from "react";
import type { Annotation, AnnotationFormat } from "../types/api";
import { FileDownload } from "./FileDownload";

export function AnnotationInfo({
  current,
  history,
  format,
  disabled,
  uploading,
  onUpload,
}: {
  current: Annotation | null;
  history: Annotation[];
  format: AnnotationFormat;
  disabled: boolean;
  uploading: boolean;
  onUpload: (file: File) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="panel annotation-panel">
      <div className="section-heading">
        <h2>Current annotation</h2>
        {current && (
          <span className="tag">
            v{current.version} ·{" "}
            {current.version === 0 ? "Original" : "Corrected"}
          </span>
        )}
      </div>
      {current ? (
        <>
          <dl className="facts">
            <div>
              <dt>Format</dt>
              <dd>{current.format}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{new Date(current.created_at).toLocaleString()}</dd>
            </div>
          </dl>
          <FileDownload
            url={current.url}
            filename={current.annotation_path.split("/").pop() || "annotation"}
          >
            Download annotation v{current.version}
          </FileDownload>
        </>
      ) : (
        <p className="muted">
          {format === "NONE"
            ? "This dataset has no annotations. General case reviews are available."
            : "No annotation available for this case."}
        </p>
      )}
      <details>
        <summary>Annotation history ({history.length})</summary>
        {history.length ? (
          <ul className="history">
            {history.map((annotation) => (
              <li key={annotation.id}>
                <div>
                  <strong>
                    v{annotation.version} ·{" "}
                    {annotation.version === 0
                      ? "Original"
                      : "Doctor correction"}
                  </strong>
                  <small>
                    {new Date(annotation.created_at).toLocaleString()}
                  </small>
                </div>
                <FileDownload
                  url={annotation.url}
                  filename={
                    annotation.annotation_path.split("/").pop() || "annotation"
                  }
                >
                  Download v{annotation.version}
                </FileDownload>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No annotation versions yet.</p>
        )}
      </details>
      <div className="upload-section">
        <h3>Corrected annotation</h3>
        {format === "NONE" ? (
          <p className="muted">
            Correction uploads are not supported for DICOM cases.
          </p>
        ) : (
          <>
            <p className="muted">
              Upload a{" "}
              {format === "COCO" ? "per-case COCO JSON" : "NIfTI segmentation"}{" "}
              file. Each upload creates a new version and preserves the
              original.
            </p>
            <label htmlFor="correction-file">Correction file</label>
            <input
              ref={input}
              id="correction-file"
              type="file"
              accept={
                format === "COCO" ? ".json,application/json" : ".nii,.nii.gz"
              }
              disabled={disabled || !current}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <button
              className="secondary"
              disabled={disabled || !current || !file}
              onClick={async () => {
                if (file && (await onUpload(file))) {
                  setFile(null);
                  if (input.current) input.current.value = "";
                }
              }}
            >
              {uploading ? "Uploading correction…" : "Upload correction"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
