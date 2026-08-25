import type { FastifyInstance } from "fastify";
import { list } from "../suppression/repo.js";

/**
 * Hanya baca. Tidak ada `DELETE /suppression/:email`, dan itu bukan kelalaian
 * — daftar ini permanen di setiap lapisan (04-aturan-kepatuhan.md §2).
 * Peran basis data aplikasi pun tidak punya hak DELETE pada tabelnya.
 */
export async function suppressionRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { page?: string; per_page?: string } }>(
    "/suppression",
    async (req) => {
      const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
      const perPage = Math.min(Math.max(Number(req.query.per_page ?? 50) || 50, 1), 200);
      const result = await list(page, perPage);
      return {
        ...result,
        items: result.items.map((item) => ({ ...item, email: String(item.email) })),
        permanen: true,
      };
    },
  );
}
