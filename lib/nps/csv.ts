// Pure CSV parsing for NPS campaign recipient uploads. No Supabase access —
// the caller fetches the valid customer_key set once and passes it in, so
// this stays unit-testable without a DB.

export interface ParsedNpsRecipientRow {
  rowNumber: number; // 1-indexed, header = row 1
  customerKey: string;
  email: string;
  respondentName: string | null;
  respondentType: string | null;
}

export interface ParseNpsRecipientCsvResult {
  rows: ParsedNpsRecipientRow[];
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 1000;

// Minimal quoted-CSV line tokenizer — handles quoted fields and "" escaping,
// good enough for a small recipient list without adding a dependency.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseNpsRecipientCsv(
  rawText: string,
  validCustomerKeys: Set<string>
): ParseNpsRecipientCsvResult {
  const allLines = rawText.split(/\r\n|\r|\n/);
  // Blank lines are skipped silently, but we need original line numbers for
  // errors, so track (line, originalIndex) pairs rather than filtering first.
  const numbered = allLines
    .map((line, i) => ({ line, rowNumber: i + 1 }))
    .filter((l) => l.line.trim() !== "");

  if (numbered.length === 0) {
    return { rows: [], errors: ["CSV is empty."] };
  }

  const header = splitCsvLine(numbered[0].line).map((h) => h.toLowerCase());
  const colIndex = {
    customerKey: header.indexOf("customer_key"),
    email: header.indexOf("email"),
    respondentName: header.indexOf("respondent_name"),
    respondentType: header.indexOf("respondent_type"),
  };

  const headerErrors: string[] = [];
  if (colIndex.customerKey === -1) headerErrors.push("Missing required column: customer_key");
  if (colIndex.email === -1) headerErrors.push("Missing required column: email");
  if (headerErrors.length > 0) return { rows: [], errors: headerErrors };

  const dataLines = numbered.slice(1);
  if (dataLines.length > MAX_ROWS) {
    return { rows: [], errors: [`CSV has ${dataLines.length} rows — max ${MAX_ROWS} recipients per upload.`] };
  }

  const rows: ParsedNpsRecipientRow[] = [];
  const errors: string[] = [];
  const firstSeenAtRow = new Map<string, number>(); // lowercase email -> first row number

  for (const { line, rowNumber } of dataLines) {
    const cols = splitCsvLine(line);
    const customerKey = (cols[colIndex.customerKey] ?? "").trim();
    const email = (cols[colIndex.email] ?? "").trim();
    const respondentName =
      colIndex.respondentName >= 0 ? (cols[colIndex.respondentName] ?? "").trim() || null : null;
    const respondentType =
      colIndex.respondentType >= 0 ? (cols[colIndex.respondentType] ?? "").trim() || null : null;

    if (!customerKey) {
      errors.push(`Row ${rowNumber}: missing customer_key`);
      continue;
    }
    if (!validCustomerKeys.has(customerKey)) {
      errors.push(`Row ${rowNumber}: unknown customer_key '${customerKey}'`);
      continue;
    }
    if (!email) {
      errors.push(`Row ${rowNumber}: missing email`);
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push(`Row ${rowNumber}: invalid email '${email}'`);
      continue;
    }

    const emailKey = email.toLowerCase();
    const firstRow = firstSeenAtRow.get(emailKey);
    if (firstRow) {
      errors.push(`Row ${rowNumber}: duplicate email '${email}' (first seen at row ${firstRow})`);
      continue;
    }
    firstSeenAtRow.set(emailKey, rowNumber);

    rows.push({ rowNumber, customerKey, email, respondentName, respondentType });
  }

  return { rows, errors };
}
