import type { CaseStatus } from "../types/api";

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
