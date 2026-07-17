export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-zinc-400 ${className ?? "h-5 w-5"}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-80"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z"
      />
    </svg>
  );
}

export function CenteredSpinner() {
  return (
    <div className="flex justify-center py-12">
      <Spinner className="h-6 w-6" />
    </div>
  );
}
