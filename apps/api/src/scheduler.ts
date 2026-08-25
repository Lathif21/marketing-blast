/**
 * Penjadwal berulang yang tahan jeda panjang.
 *
 * `setTimeout`/`setInterval` Node memakai signed 32-bit, jadi jeda di atas
 * ~24,8 hari meluap dan langsung fire — `retention-sweep` yang berjalan tiap
 * 30 hari akan berubah jadi loop tanpa henti. Jeda panjang di sini dipecah
 * menjadi beberapa potongan di bawah batas tersebut.
 *
 * Jadwal berikutnya dipasang setelah pekerjaan selesai, bukan sebelum, supaya
 * satu pekerjaan tidak pernah menumpuk di atas dirinya sendiri.
 */

const MAX_TIMEOUT = 2_147_483_647;

export interface Cancellable {
  cancel: () => void;
}

export function scheduleEvery(intervalMs: number, run: () => Promise<void>): Cancellable {
  let handle: NodeJS.Timeout | undefined;
  let remaining = intervalMs;
  let cancelled = false;

  const arm = () => {
    if (cancelled) return;

    const wait = Math.min(remaining, MAX_TIMEOUT);
    remaining -= wait;

    handle = setTimeout(() => {
      if (cancelled) return;

      // Masih ada sisa jeda: pasang potongan berikutnya tanpa menjalankan apa pun.
      if (remaining > 0) {
        arm();
        return;
      }

      remaining = intervalMs;
      void run().finally(arm);
    }, wait);
  };

  arm();

  return {
    cancel: () => {
      cancelled = true;
      if (handle) clearTimeout(handle);
    },
  };
}
