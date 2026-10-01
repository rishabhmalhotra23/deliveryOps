// POST /api/customers resolves its key through customerKeyFor(). The
// /customers page's "Add customer" button sends only a display name — it
// moved there from Delivery -> Configure on 2026-09-08 and lost the client-side
// slug on the way, while its comment said the server derived one. The server
// didn't, so every add from that page failed validation ("key: Invalid
// input") and Wipro GPO could not be added from the UI.

import { describe, it, expect } from "vitest";
import { customerKeyFor, slugifyCustomerKey } from "@/lib/customers/slug";

describe("customerKeyFor", () => {
  it("derives the key from the name when the caller sends none", () => {
    expect(customerKeyFor({ display_name: "Wipro GPO" })).toBe("wipro-gpo");
  });

  it("derives the same key the customer picker sends", () => {
    for (const name of ["Bradley & Beams", "SSD/SKP", "  Kort Payments "]) {
      expect(customerKeyFor({ display_name: name })).toBe(slugifyCustomerKey(name));
    }
  });

  it("keeps an explicit key", () => {
    expect(customerKeyFor({ key: "iheart", display_name: "iHeartRadio" })).toBe("iheart");
  });

  it("treats a blank key as absent", () => {
    expect(customerKeyFor({ key: "  ", display_name: "Wipro GPO" })).toBe("wipro-gpo");
  });

  it("returns null when the name has nothing to slug", () => {
    expect(customerKeyFor({ display_name: "!!!" })).toBeNull();
  });
});
