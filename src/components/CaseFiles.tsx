import type { Case } from "../types/api";
import { FileDownload } from "./FileDownload";

function format(value: unknown): string {
  if (value === null || value === undefined) return "Not available";
  if (Array.isArray(value)) return value.join(" × ");
  return String(value);
}

export function CaseFiles({ item }: { item: Case }) {
  const meta = item.metadata;
  const dicom = item.image_format === "DICOM";
  const raster = item.image_format === "PNG" || item.image_format === "JPEG";
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Source files</h2>
        <span className="tag">
          {item.dimension} · {item.image_format}
        </span>
      </div>
      <dl className="facts viewer-facts">
        {dicom ? (
          <>
            <div>
              <dt>Modality</dt>
              <dd>{format(meta.Modality)}</dd>
            </div>
            <div>
              <dt>Series</dt>
              <dd>{format(meta.SeriesDescription)}</dd>
            </div>
            <div>
              <dt>Slices</dt>
              <dd>{item.image_urls.length}</dd>
            </div>
          </>
        ) : raster ? (
          <>
            <div>
              <dt>Width</dt>
              <dd>{format(meta.width)}</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>{format(meta.height)}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Shape</dt>
              <dd>{format(meta.shape)}</dd>
            </div>
            <div>
              <dt>Spacing (mm)</dt>
              <dd>
                {Array.isArray(meta.spacing)
                  ? meta.spacing
                      .map((value) => Number(value).toFixed(2))
                      .join(" × ")
                  : "Not available"}
              </dd>
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
          <summary>DICOM slices ({item.image_urls.length})</summary>
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
        <pre>{JSON.stringify(meta, null, 2)}</pre>
      </details>
    </section>
  );
}
