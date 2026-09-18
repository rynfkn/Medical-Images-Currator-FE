import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "../api/client";
import { pairFiles } from "../pairing";
import type { Dataset } from "../types/api";

/** The format combinations the backend accepts, in the words a user would pick. */
const KINDS = [
  {
    id: "NIFTI",
    label: "NIfTI volumes (CT/MRI)",
    hint: "Images with optional segmentations. Masks are saved as NIfTI.",
    dimension: "3D",
    image_format: "NIFTI",
    annotation_format: "NIFTI",
  },
  {
    id: "DICOM_SEG",
    label: "DICOM series, segmentable",
    hint: "One folder of .dcm files per series. Masks are saved as NIfTI.",
    dimension: "3D",
    image_format: "DICOM",
    annotation_format: "NIFTI",
  },
  {
    id: "DICOM",
    label: "DICOM series, viewing only",
    hint: "No segmentation; reviewers can still comment and decide.",
    dimension: "3D",
    image_format: "DICOM",
    annotation_format: "NONE",
  },
  {
    id: "PNG",
    label: "PNG images + COCO",
    hint: "2D images with a COCO instances.json file.",
    dimension: "2D",
    image_format: "PNG",
    annotation_format: "COCO",
  },
  {
    id: "JPEG",
    label: "JPEG images + COCO",
    hint: "2D images with a COCO instances.json file.",
    dimension: "2D",
    image_format: "JPEG",
    annotation_format: "COCO",
  },
] as const;

export function NewProjectForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<string>(KINDS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = KINDS.find((item) => item.id === kind) || KINDS[0];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post<Dataset>("/datasets", {
        name: name.trim(),
        description: description.trim() || null,
        dimension: chosen.dimension,
        image_format: chosen.image_format,
        annotation_format: chosen.annotation_format,
      });
      setName("");
      setDescription("");
      setOpen(false);
      onCreated();
    } catch (cause) {
      setError(errorMessage(cause, "Failed to create the project."));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)}>
        <span aria-hidden="true">+</span> New project
      </button>
    );
  return (
    <form
      className="panel inline-form"
      onSubmit={(event) => void submit(event)}
    >
      <h2>New project</h2>
      <label htmlFor="project-name">Name</label>
      <input
        id="project-name"
        required
        maxLength={200}
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus
      />
      <label htmlFor="project-description">
        Description <span className="muted">(optional)</span>
      </label>
      <input
        id="project-description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <label htmlFor="project-kind">Data type</label>
      <select
        id="project-kind"
        value={kind}
        onChange={(event) => setKind(event.target.value)}
      >
        {KINDS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <p className="muted small">{chosen.hint}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create project"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function megabytes(bytes: number): string {
  return (
    (bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1) + " MB"
  );
}

export function UploadFilesForm({
  dataset,
  onUploaded,
}: {
  dataset: Dataset;
  onUploaded: (count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [picked, setPicked] = useState<{ images: File[]; labels: File[] }>({
    images: [],
    labels: [],
  });
  const imagesRef = useRef<HTMLInputElement>(null);
  const labelsRef = useRef<HTMLInputElement>(null);
  const cocoRef = useRef<HTMLInputElement>(null);
  const dicom = dataset.image_format === "DICOM";
  const coco = dataset.annotation_format === "COCO";
  const accept = dicom
    ? ".dcm"
    : coco
      ? dataset.image_format === "PNG"
        ? ".png"
        : ".jpg,.jpeg"
      : ".nii,.nii.gz";
  const volumes = !dicom && !coco;
  const { pairs, unmatched } = pairFiles(picked.images, picked.labels);
  const total = picked.images.reduce((sum, file) => sum + file.size, 0);

  function pick() {
    setError("");
    setStatus("");
    setPicked({
      images: [...(imagesRef.current?.files || [])],
      labels: [...(labelsRef.current?.files || [])],
    });
  }

  function reset() {
    for (const input of [imagesRef, labelsRef, cocoRef])
      if (input.current) input.current.value = "";
    setPicked({ images: [], labels: [] });
  }

  async function send(
    files: [string, File, string?][],
    progress: (part: number) => void,
  ) {
    const body = new FormData();
    for (const [field, file, name] of files)
      name ? body.append(field, file, name) : body.append(field, file);
    const { data } = await api.post<{ cases_ingested: number }>(
      `/datasets/${dataset.id}/upload`,
      body,
      {
        onUploadProgress: (event) =>
          progress(event.total ? event.loaded / event.total : 0),
      },
    );
    return data.cases_ingested;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!picked.images.length) return;
    setBusy(true);
    setError("");
    setStatus("");
    let added = 0;
    const failures: string[] = [];
    try {
      if (volumes) {
        // One request per volume: a dropped connection then costs one file
        // instead of the whole batch, and each file reports its own progress.
        for (const [position, pair] of pairs.entries()) {
          const name = `${position + 1}/${pairs.length} · ${pair.image.name}`;
          setStatus(`Uploading ${name}`);
          const files: [string, File, string?][] = [["images", pair.image]];
          // The backend pairs by name, so send the mask under the image's name.
          if (pair.label) files.push(["labels", pair.label, pair.image.name]);
          try {
            added += await send(files, (part) =>
              setStatus(`Uploading ${name} — ${Math.round(part * 100)}%`),
            );
          } catch (cause) {
            failures.push(
              `${pair.image.name}: ${errorMessage(cause, "upload interrupted")}`,
            );
          }
        }
      } else {
        const files: [string, File, string?][] = picked.images.map((file) => [
          "images",
          file,
        ]);
        const annotation = cocoRef.current?.files?.[0];
        if (annotation) files.push(["annotations", annotation]);
        added = await send(files, (part) =>
          setStatus(`Uploading — ${Math.round(part * 100)}%`),
        );
      }
    } catch (cause) {
      failures.push(errorMessage(cause, "Failed to upload the files."));
    } finally {
      setBusy(false);
      setStatus("");
    }
    if (failures.length) {
      const extra =
        failures.length > 3 ? ` · and ${failures.length - 3} more` : "";
      setError(failures.slice(0, 3).join(" · ") + extra);
    }
    if (added) {
      reset();
      onUploaded(added);
    }
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)}>
        <span aria-hidden="true">+</span> Add files
      </button>
    );
  return (
    <form
      className="panel inline-form"
      onSubmit={(event) => void submit(event)}
    >
      <h2>Add files</h2>
      <label htmlFor="upload-images">
        {dicom
          ? "DICOM files (.dcm)"
          : coco
            ? "Images"
            : "Images (.nii/.nii.gz)"}
      </label>
      <input
        id="upload-images"
        ref={imagesRef}
        type="file"
        multiple
        accept={accept}
        required
        onChange={pick}
      />
      {volumes && (
        <>
          <label htmlFor="upload-labels">
            Segmentations <span className="muted">(optional)</span>
          </label>
          <input
            id="upload-labels"
            ref={labelsRef}
            type="file"
            multiple
            accept=".nii,.nii.gz"
            onChange={pick}
          />
          {pairs.length > 0 && (
            <ul className="pairing">
              {pairs.map((pair) => (
                <li key={pair.image.name}>
                  <strong>{pair.image.name}</strong>{" "}
                  <span className="muted">({megabytes(pair.image.size)})</span>
                  <small>
                    {pair.label
                      ? `segmentation: ${pair.label.name}`
                      : "no segmentation — draw it in the viewer"}
                  </small>
                </li>
              ))}
            </ul>
          )}
          {unmatched.length > 0 && (
            <p className="notice" role="status">
              These segmentations match no image and would be skipped:{" "}
              {unmatched.map((file) => file.name).join(", ")}
            </p>
          )}
          <p className="muted small">
            A segmentation is paired with the image of the same name, or with
            the image whose name it starts with. Images without a mask are added
            unsegmented, ready to be drawn in the viewer.
          </p>
        </>
      )}
      {coco && (
        <>
          <label htmlFor="upload-coco">COCO annotations (instances.json)</label>
          <input
            id="upload-coco"
            ref={cocoRef}
            type="file"
            accept=".json,application/json"
            required
          />
        </>
      )}
      {dicom && (
        <p className="muted small">
          Select every slice of the series; files are grouped by
          SeriesInstanceUID.
        </p>
      )}
      {status && (
        <p className="muted small" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button disabled={busy || !picked.images.length}>
          {busy ? "Uploading…" : `Upload${total ? ` ${megabytes(total)}` : ""}`}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>
      <p className="muted small">
        Each volume is uploaded on its own, so a dropped connection costs one
        file instead of the whole batch. Keep this tab open while it runs.
      </p>
    </form>
  );
}
