// Parser CSV sesuai RFC 4180. Ditulis sendiri, bukan dependensi.
//
// Yang membuat CSV tidak sesederhana `split(",")`: field berkutip boleh berisi
// koma, baris baru, dan kutip ganda yang di-escape jadi dua kutip. Berkas
// ekspor dari alat lain rutin memuat ketiganya — nama perusahaan seperti
// `PT Maju, Jaya` sudah cukup untuk merusak pemisahan naif.

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

/** Membuang BOM UTF-8 yang sering ditinggalkan Excel. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Menebak pemisah dari baris pertama. Ekspor Excel dengan locale Indonesia
 * kerap memakai titik koma karena koma dipakai sebagai desimal.
 */
export function detectDelimiter(sample: string): "," | ";" | "\t" {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
  const candidates: ("," | ";" | "\t")[] = [",", ";", "\t"];

  let best: "," | ";" | "\t" = ",";
  let bestCount = -1;
  for (const c of candidates) {
    // Hitung hanya yang berada di luar kutip.
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === c && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter?: string): ParsedCsv {
  const text = stripBom(input);
  const delim = delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Baris kosong (hanya satu field kosong) dilewati — akhir berkas dan
    // baris pemisah tidak boleh menjadi kontak kosong.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF maupun CR sendirian.
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Sisa di buffer saat berkas tidak diakhiri baris baru.
  if (field !== "" || row.length > 0) endRow();

  if (rows.length === 0) return { header: [], rows: [] };

  const header = rows[0].map((h) => h.trim());
  return { header, rows: rows.slice(1) };
}

/** Memasangkan tiap baris dengan nama kolomnya. */
export function toRecords(parsed: ParsedCsv): Record<string, string>[] {
  return parsed.rows.map((row) => {
    const record: Record<string, string> = {};
    parsed.header.forEach((name, i) => {
      record[name] = (row[i] ?? "").trim();
    });
    return record;
  });
}
