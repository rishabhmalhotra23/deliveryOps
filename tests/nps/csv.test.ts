import { describe, it, expect } from "vitest";
import { parseNpsRecipientCsv } from "@/lib/nps/csv";

const KEYS = new Set(["acme", "globex"]);

describe("parseNpsRecipientCsv", () => {
  it("parses a valid CSV", () => {
    const csv = "customer_key,email,respondent_name,respondent_type\nacme,a@acme.com,Alice,SME\nglobex,b@globex.com,Bob,";
    const { rows, errors } = parseNpsRecipientCsv(csv, KEYS);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { rowNumber: 2, customerKey: "acme", email: "a@acme.com", respondentName: "Alice", respondentType: "SME" },
      { rowNumber: 3, customerKey: "globex", email: "b@globex.com", respondentName: "Bob", respondentType: null },
    ]);
  });

  it("skips blank lines silently", () => {
    const csv = "customer_key,email\nacme,a@acme.com\n\n\nglobex,b@globex.com\n";
    const { rows, errors } = parseNpsRecipientCsv(csv, KEYS);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it("requires the header columns", () => {
    const { errors } = parseNpsRecipientCsv("foo,bar\n1,2", KEYS);
    expect(errors).toEqual(["Missing required column: customer_key", "Missing required column: email"]);
  });

  it("flags a missing customer_key", () => {
    const { rows, errors } = parseNpsRecipientCsv("customer_key,email\n,a@acme.com", KEYS);
    expect(rows).toEqual([]);
    expect(errors).toEqual(["Row 2: missing customer_key"]);
  });

  it("flags an unknown customer_key without inserting or auto-creating anything", () => {
    const { rows, errors } = parseNpsRecipientCsv("customer_key,email\nnope,a@acme.com", KEYS);
    expect(rows).toEqual([]);
    expect(errors).toEqual(["Row 2: unknown customer_key 'nope'"]);
  });

  it("flags a missing email", () => {
    const { errors } = parseNpsRecipientCsv("customer_key,email\nacme,", KEYS);
    expect(errors).toEqual(["Row 2: missing email"]);
  });

  it("flags an invalid email", () => {
    const { errors } = parseNpsRecipientCsv("customer_key,email\nacme,not-an-email", KEYS);
    expect(errors).toEqual(["Row 2: invalid email 'not-an-email'"]);
  });

  it("flags a duplicate email (case-insensitive), keeping the first", () => {
    const csv = "customer_key,email\nacme,A@acme.com\nglobex,a@acme.com";
    const { rows, errors } = parseNpsRecipientCsv(csv, KEYS);
    expect(rows).toEqual([{ rowNumber: 2, customerKey: "acme", email: "A@acme.com", respondentName: null, respondentType: null }]);
    expect(errors).toEqual(["Row 3: duplicate email 'a@acme.com' (first seen at row 2)"]);
  });

  it("allows the same customer_key across multiple rows", () => {
    const csv = "customer_key,email\nacme,a@acme.com\nacme,c@acme.com";
    const { rows, errors } = parseNpsRecipientCsv(csv, KEYS);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it("rejects more than 1000 data rows", () => {
    const header = "customer_key,email\n";
    const body = Array.from({ length: 1001 }, (_, i) => `acme,u${i}@acme.com`).join("\n");
    const { rows, errors } = parseNpsRecipientCsv(header + body, KEYS);
    expect(rows).toEqual([]);
    expect(errors).toEqual(["CSV has 1001 rows — max 1000 recipients per upload."]);
  });

  it("returns an error for an empty file", () => {
    const { rows, errors } = parseNpsRecipientCsv("", KEYS);
    expect(rows).toEqual([]);
    expect(errors).toEqual(["CSV is empty."]);
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'customer_key,email,respondent_name\nacme,a@acme.com,"Doe, Jane"';
    const { rows } = parseNpsRecipientCsv(csv, KEYS);
    expect(rows[0].respondentName).toBe("Doe, Jane");
  });
});
