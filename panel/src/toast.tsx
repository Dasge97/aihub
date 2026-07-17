import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ToastItem {
  id: number;
  kind: "error" | "success" | "info";
  message: string;
}

interface ToastCtx {
  toast: (message: string, kind?: ToastItem["kind"]) => void;
  toastError: (err: unknown) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {}, toastError: () => {} });

export function useToast() {
  return useContext(Ctx);
}

const KIND_STYLES: Record<ToastItem["kind"], string> = {
  error: "border-red-800 bg-red-950/90 text-red-200",
  success: "border-emerald-800 bg-emerald-950/90 text-emerald-200",
  info: "border-zinc-700 bg-zinc-800/95 text-zinc-200",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: ToastItem["kind"] = "info") => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const toastError = useCallback(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast(msg, "error");
    },
    [toast]
  );

  return (
    <Ctx.Provider value={{ toast, toastError }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg backdrop-blur ${KIND_STYLES[t.kind]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
