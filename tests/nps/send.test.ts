import { describe, it, expect } from "vitest";
import { renderTemplate, renderQuickScoreLinksMarkdown } from "@/lib/nps/constants";

describe("renderTemplate", () => {
  it("substitutes name, company, and link", () => {
    const out = renderTemplate("Hi {{name}} from {{company}}, see {{link}}", {
      name: "Alice",
      company: "Acme",
      link: "https://example.com/x",
    });
    expect(out).toBe("Hi Alice from Acme, see https://example.com/x");
  });

  it("falls back to 'there' when name is blank", () => {
    const out = renderTemplate("Hi {{name}}", { name: "  ", company: "Acme", link: "https://x" });
    expect(out).toBe("Hi there");
  });

  it("substitutes scoreLinks when provided, and blanks it when absent", () => {
    const withLinks = renderTemplate("{{scoreLinks}}", {
      name: "Alice",
      company: "Acme",
      link: "https://x",
      scoreLinks: "0 1 2",
    });
    expect(withLinks).toBe("0 1 2");

    const withoutLinks = renderTemplate("before {{scoreLinks}} after", {
      name: "Alice",
      company: "Acme",
      link: "https://x",
    });
    expect(withoutLinks).toBe("before  after");
  });

  it("substitutes every occurrence of a repeated placeholder", () => {
    const out = renderTemplate("{{name}} {{name}}", { name: "Alice", company: "Acme", link: "https://x" });
    expect(out).toBe("Alice Alice");
  });
});

describe("renderQuickScoreLinksMarkdown", () => {
  const md = renderQuickScoreLinksMarkdown("abc123", "https://app.example.com");

  it("includes a markdown link for every score 0-10", () => {
    for (let score = 0; score <= 10; score++) {
      expect(md).toContain(`[${score}](https://app.example.com/api/nps/quick/abc123?score=${score})`);
    }
  });

  it("groups scores into the three npsCategory emoji buckets", () => {
    const detractorIdx = md.indexOf("😞");
    const passiveIdx = md.indexOf("😐");
    const promoterIdx = md.indexOf("😊");
    expect(detractorIdx).toBeGreaterThanOrEqual(0);
    expect(passiveIdx).toBeGreaterThan(detractorIdx);
    expect(promoterIdx).toBeGreaterThan(passiveIdx);
    // score 6 (detractor boundary) appears before the passive emoji;
    // score 7 (passive boundary) appears after it.
    expect(md.indexOf("[6](")).toBeLessThan(passiveIdx);
    expect(md.indexOf("[7](")).toBeGreaterThan(passiveIdx);
  });
});
