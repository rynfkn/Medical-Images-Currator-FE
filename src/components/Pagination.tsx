export const PAGE_SIZE = 20;

export function Pagination({
  offset,
  count,
  onChange,
}: {
  offset: number;
  count: number;
  onChange: (offset: number) => void;
}) {
  if (!offset && count < PAGE_SIZE) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted">
        {count ? `${offset + 1}–${offset + count}` : "No more results"}
      </span>
      <div>
        <button
          className="secondary"
          disabled={!offset}
          onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}
        >
          Previous
        </button>{" "}
        <button
          className="secondary"
          disabled={count < PAGE_SIZE}
          onClick={() => onChange(offset + PAGE_SIZE)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
