import { useState } from "react";
import { api, errorMessage, filePath } from "../api/client";

export function FileDownload({
  url,
  filename,
  children,
}: {
  url: string;
  filename: string;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await api.get<Blob>(filePath(url), {
        responseType: "blob",
      });
      const disposition: string = response.headers["content-disposition"] || "";
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
      const objectUrl = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = encoded ? decodeURIComponent(encoded) : plain || filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setError(errorMessage(error, "Failed to download file."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="file-download">
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? "Downloading…" : children}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
