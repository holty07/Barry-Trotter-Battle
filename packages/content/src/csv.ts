/** Minimal RFC4180-ish CSV parser: comma-delimited, "-quoted fields with
 * embedded commas/newlines/escaped quotes ("" -> "). No external dependency
 * — the format is small and bounded enough not to need one. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  const normalised = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < normalised.length; i++) {
    const char = normalised[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (normalised[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) return [];

  const header = nonEmpty[0]!.map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = (r[index] ?? "").trim();
    });
    return record;
  });
}
