// Lock the canonical name-formatting helpers — they back every AE / FDE
// rendering and the Delivery FDE filter, so a regression here is felt
// across the whole app (workload chart, customer strips, ARR drill-down,
// project tables, operations chat).

import { describe, it, expect } from "vitest";
import {
  formatPersonName,
  formatPeopleList,
  isPlaceholderName,
  peopleNames,
  unionPeopleColumns,
} from "@/lib/delivery/taxonomy";

describe("formatPersonName", () => {
  it("normalises case + last initial", () => {
    expect(formatPersonName("Rishabh Malhotra")).toBe("Rishabh M.");
    expect(formatPersonName("RISHABH MALHOTRA")).toBe("Rishabh M.");
    expect(formatPersonName("rishabh malhotra")).toBe("Rishabh M.");
  });

  it("handles email form", () => {
    expect(formatPersonName("karthik.nagabhushana@kognitos.com")).toBe("Karthik N.");
    expect(formatPersonName("rishabh@kognitos.com")).toBe("Rishabh");
  });

  it("handles single-name input", () => {
    expect(formatPersonName("Andrew")).toBe("Andrew");
    expect(formatPersonName("rishabh")).toBe("Rishabh");
  });

  it("appends PM suffix for Shyam (any case)", () => {
    expect(formatPersonName("Shyam Prabhakara")).toBe("Shyam P. (PM)");
    expect(formatPersonName("shyam Prabhakara")).toBe("Shyam P. (PM)");
    expect(formatPersonName("SHYAM PRABHAKARA")).toBe("Shyam P. (PM)");
    expect(formatPersonName("shyam.prabhakara@kognitos.com")).toBe("Shyam P. (PM)");
  });

  it("returns empty string on null / empty / whitespace", () => {
    expect(formatPersonName(null)).toBe("");
    expect(formatPersonName(undefined)).toBe("");
    expect(formatPersonName("")).toBe("");
    expect(formatPersonName("   ")).toBe("");
  });
});

describe("isPlaceholderName", () => {
  it("flags Monday placeholders", () => {
    expect(isPlaceholderName("Customer Implementing")).toBe(true);
    expect(isPlaceholderName("customer implementing")).toBe(true);
    expect(isPlaceholderName("TBD")).toBe(true);
    expect(isPlaceholderName("tbd")).toBe(true);
    expect(isPlaceholderName("Unassigned")).toBe(true);
    expect(isPlaceholderName("N/A")).toBe(true);
    expect(isPlaceholderName("—")).toBe(true);
    expect(isPlaceholderName("Open")).toBe(true);
    expect(isPlaceholderName("Kognitos")).toBe(true);
  });

  it("does not flag real people", () => {
    expect(isPlaceholderName("Rishabh Malhotra")).toBe(false);
    expect(isPlaceholderName("Shyam Prabhakara")).toBe(false);
    expect(isPlaceholderName("Andrew")).toBe(false);
  });

  it("treats null / empty as a placeholder", () => {
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName(undefined)).toBe(true);
    expect(isPlaceholderName("")).toBe(true);
  });
});

describe("peopleNames", () => {
  it("formats + filters placeholders + dedupes", () => {
    expect(
      peopleNames("Rishabh Malhotra, Customer Implementing, TBD")
    ).toEqual(["Rishabh M."]);
    expect(peopleNames("TBD, shyam Prabhakara, TBA")).toEqual([
      "Shyam P. (PM)",
    ]);
    expect(peopleNames(null)).toEqual([]);
    expect(peopleNames("")).toEqual([]);
  });

  it("handles email + plain names together", () => {
    expect(
      peopleNames("Rishabh Malhotra, karthik.nagabhushana@kognitos.com")
    ).toEqual(["Rishabh M.", "Karthik N."]);
  });
});

describe("unionPeopleColumns", () => {
  it("merges + dedupes raw names across the two Monday columns", () => {
    expect(unionPeopleColumns("Rishabh Malhotra", "Arushi Bohra")).toBe(
      "Rishabh Malhotra, Arushi Bohra"
    );
    expect(unionPeopleColumns("Rishabh Malhotra", "Rishabh Malhotra")).toBe(
      "Rishabh Malhotra"
    );
  });

  it("drops placeholders so they never reach the UI", () => {
    expect(unionPeopleColumns("Rishabh Malhotra", "Customer Implementing")).toBe(
      "Rishabh Malhotra"
    );
    expect(unionPeopleColumns("TBD", "Customer Implementing")).toBeNull();
    expect(unionPeopleColumns(null, null)).toBeNull();
  });
});

describe("formatPeopleList", () => {
  it("renders a single name canonical-cased", () => {
    expect(formatPeopleList("Rishabh Malhotra")).toBe("Rishabh M.");
  });

  it("collapses long lists by default", () => {
    expect(
      formatPeopleList("Rishabh Malhotra, Karthik Nagabhushana, Arushi Bohra")
    ).toBe("Rishabh M., Karthik N. +1");
  });

  it("expands the full list with opts.expand", () => {
    expect(
      formatPeopleList(
        "Rishabh Malhotra, Karthik Nagabhushana, Arushi Bohra",
        { expand: true }
      )
    ).toBe("Rishabh M., Karthik N., Arushi B.");
  });

  it("accepts a string[] directly", () => {
    expect(formatPeopleList(["Rishabh Malhotra", "Arushi Bohra"])).toBe(
      "Rishabh M., Arushi B."
    );
  });

  it("returns empty string on falsy input", () => {
    expect(formatPeopleList(null)).toBe("");
    expect(formatPeopleList("")).toBe("");
    expect(formatPeopleList([])).toBe("");
  });
});
