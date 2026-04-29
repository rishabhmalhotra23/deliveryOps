import { tableFromIPC } from "apache-arrow";

export function decodeArrowTable(b64: string): Record<string, unknown>[] {
  const buf = Buffer.from(b64, "base64");
  const table = tableFromIPC(buf);

  const rows: Record<string, unknown>[] = [];
  for (let r = 0; r < table.numRows; r++) {
    const row: Record<string, unknown> = {};
    for (const field of table.schema.fields) {
      const col = table.getChild(field.name);
      row[field.name] = col?.get(r) ?? null;
    }
    rows.push(row);
  }
  return rows;
}

export function decodeArrowSchema(b64: string): { name: string; type: string }[] {
  const buf = Buffer.from(b64, "base64");
  const table = tableFromIPC(buf);
  return table.schema.fields.map((f) => ({ name: f.name, type: String(f.type) }));
}
