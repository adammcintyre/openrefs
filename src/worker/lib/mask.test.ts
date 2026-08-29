import { describe, expect, it } from "vitest";

import { maskLogin } from "./mask";

describe("maskLogin", () => {
  it("keeps two characters and the domain", () => {
    expect(maskLogin("test@brandpacks.com")).toBe("te***@brandpacks.com");
  });

  it("never reveals more of the local part than two characters", () => {
    // The masked form must not contain the tail of the local part.
    expect(maskLogin("averylonglogin@example.com")).toBe("av***@example.com");
    expect(maskLogin("averylonglogin@example.com")).not.toContain("verylong");
  });

  it("reveals less, not more, for short local parts", () => {
    expect(maskLogin("a@b.com")).toBe("a***@b.com");
  });

  it("uses the last @ so plus-addressing and odd locals stay safe", () => {
    expect(maskLogin("ada+seo@example.com")).toBe("ad***@example.com");
    expect(maskLogin('"we@ird"@example.com')).toBe('"w***@example.com');
  });

  it("treats a value with no usable local part as fully opaque", () => {
    expect(maskLogin("not-an-email")).toBe("no***");
    expect(maskLogin("@example.com")).toBe("@e***");
  });

  it("returns an empty string for blank input rather than a bare mask", () => {
    expect(maskLogin("")).toBe("");
    expect(maskLogin("   ")).toBe("");
  });

  it("trims before masking so whitespace cannot shift the reveal", () => {
    expect(maskLogin("  test@brandpacks.com  ")).toBe("te***@brandpacks.com");
  });
});
