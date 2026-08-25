import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export type AsyncState<T> =
  | { status: "memuat"; data: T | null; error: null }
  | { status: "siap"; data: T; error: null }
  | { status: "gagal"; data: T | null; error: string };

/**
 * Memuat data sekali dan saat `deps` berubah.
 *
 * Data lama sengaja dipertahankan selama pemuatan berikutnya: mengganti filter
 * tidak boleh membuat tabel berkedip kosong lalu terisi lagi.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    status: "memuat",
    data: null,
    error: null,
  });

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let batal = false;
    setState((prev) => ({ status: "memuat", data: prev.data, error: null }));

    loaderRef
      .current()
      .then((data) => {
        // Permintaan yang sudah usang tidak boleh menimpa hasil yang lebih baru.
        if (!batal) setState({ status: "siap", data, error: null });
      })
      .catch((err: unknown) => {
        if (batal) return;
        const message =
          err instanceof ApiError ? err.message : (err as Error)?.message ?? "Galat tidak dikenal";
        setState((prev) => ({ status: "gagal", data: prev.data, error: message }));
      });

    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, reload };
}
