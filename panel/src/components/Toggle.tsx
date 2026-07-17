import { Spinner } from "./Spinner";

export function Toggle({
  checked,
  onChange,
  busy,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  if (busy) {
    return (
      <span className="inline-flex h-5 w-9 items-center justify-center">
        <Spinner className="h-4 w-4" />
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-accent-600" : "bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}
