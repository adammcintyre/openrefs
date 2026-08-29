import { describe, expect, it } from "vitest";

import { parseStoredMarket } from "./market-storage";

describe("parseStoredMarket", () => {
  it("reads a market it wrote", () => {
    expect(parseStoredMarket('{"location":2840,"language":"es"}')).toEqual({
      location: 2840,
      language: "es",
    });
  });

  it("lowercases the language", () => {
    expect(parseStoredMarket('{"location":2826,"language":"EN"}')?.language).toBe(
      "en",
    );
  });

  it("is null for nothing stored", () => {
    expect(parseStoredMarket(null)).toBeNull();
    expect(parseStoredMarket("")).toBeNull();
  });

  /*
   * localStorage is attacker-writable and survives across app versions, so a
   * stored blob is untrusted input: a non-numeric location code must never
   * reach a request URL.
   */
  it("rejects anything malformed rather than passing it to the API", () => {
    expect(parseStoredMarket("not json")).toBeNull();
    expect(parseStoredMarket("[]")).toBeNull();
    expect(parseStoredMarket("null")).toBeNull();
    expect(parseStoredMarket('{"location":"2826","language":"en"}')).toBeNull();
    expect(parseStoredMarket('{"location":2.5,"language":"en"}')).toBeNull();
    expect(parseStoredMarket('{"location":-1,"language":"en"}')).toBeNull();
    expect(parseStoredMarket('{"location":2826}')).toBeNull();
    expect(parseStoredMarket('{"location":2826,"language":"e n"}')).toBeNull();
  });
});
