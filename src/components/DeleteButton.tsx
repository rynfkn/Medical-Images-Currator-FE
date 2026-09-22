interface Props {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}

export function DeleteButton({ label, disabled, busy, onClick }: Props) {
  return (
    <button
      type="button"
      className="delete-icon"
      aria-label={label}
      title={busy ? "Deleting…" : label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onClick}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
      </svg>
    </button>
  );
}
