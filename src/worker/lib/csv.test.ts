import { describe, expect, it } from "vitest";

import {
  attachmentHeader,
  escapeCsvValue,
  slugify,
  toCsv,
  toCsvRow,
  UTF8_BOM,
} from "./csv";

describe("escapeCsvValue", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeCsvValue("seo tools")).toBe("seo tools");
  });

  it("quotes a field containing a comma", () => {
    expect(escapeCsvValue("shoes, mens")).toBe('"shoes, mens"');
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvValue('say "hello"')).toBe('"say ""hello"""');
  });

  it("quotes newlines, both LF and CRLF", () => {
    expect(escapeCsvValue("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvValue("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("quotes a lone carriage return", () => {
    // Escapes as a formula guard first, then quotes — both rules apply.
    expect(escapeCsvValue("a\rb")).toBe('"a\rb"');
  });

  it("quotes leading and trailing whitespace so it survives", () => {
    expect(escapeCsvValue("  padded  ")).toBe('"  padded  "');
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });

  it("keeps zero as zero — an empty cell is a different fact", () => {
    expect(escapeCsvValue(0)).toBe("0");
  });

  it("stringifies numbers and booleans", () => {
    expect(escapeCsvValue(1234)).toBe("1234");
    expect(escapeCsvValue(1.5)).toBe("1.5");
    expect(escapeCsvValue(false)).toBe("false");
  });

  it("survives a field that is only a quote", () => {
    expect(escapeCsvValue('"')).toBe('""""');
  });

  it("passes an empty string through unquoted", () => {
    expect(escapeCsvValue("")).toBe("");
  });

  describe("formula injection", () => {
    // A keyword is user-controlled text that lands in a spreadsheet; without
    // this guard, opening an export can execute it.
    it("neutralises every formula-triggering prefix", () => {
      expect(escapeCsvValue("=1+1")).toBe("'=1+1");
      expect(escapeCsvValue("+1")).toBe("'+1");
      expect(escapeCsvValue("-1")).toBe("'-1");
      expect(escapeCsvValue("@SUM(A1)")).toBe("'@SUM(A1)");
    });

    it("neutralises the classic command-execution payload", () => {
      // Single quotes and pipes need no CSV quoting, so the formula guard is
      // the only thing standing between this cell and Excel running it.
      expect(escapeCsvValue("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    });

    it("applies the guard inside the quotes when both rules fire", () => {
      expect(escapeCsvValue('=HYPERLINK("http://x","go")')).toBe(
        `"'=HYPERLINK(""http://x"",""go"")"`,
      );
    });

    it("does not disturb a formula character mid-string", () => {
      expect(escapeCsvValue("a=b")).toBe("a=b");
      expect(escapeCsvValue("seo-tools")).toBe("seo-tools");
    });
  });
});

describe("toCsvRow", () => {
  it("comma-joins escaped fields", () => {
    expect(toCsvRow(["seo tools", 1000, null])).toBe("seo tools,1000,");
  });

  it("keeps a comma inside a field from splitting the row", () => {
    const row = toCsvRow(["shoes, mens", 50]);
    expect(row).toBe('"shoes, mens",50');
    // The unquoted comma count is what a parser splits on: one separator.
    expect(row.split('"')[2]).toBe(",50");
  });
});

describe("toCsv", () => {
  it("emits a BOM, a header, CRLF endings and a trailing newline", () => {
    const csv = toCsv(["keyword", "volume"], [["seo tools", 1000]]);
    expect(csv).toBe(`${UTF8_BOM}keyword,volume\r\nseo tools,1000\r\n`);
  });

  it("writes a header-only file when there are no rows", () => {
    expect(toCsv(["keyword"], [])).toBe(`${UTF8_BOM}keyword\r\n`);
  });

  it("round-trips a nasty row through a minimal RFC 4180 parser", () => {
    const nasty = ['say "hi", now', "multi\nline", "  spaced  "];
    const csv = toCsv(["a", "b", "c"], [nasty]);
    const [, dataLine] = splitRecords(csv.slice(UTF8_BOM.length));
    expect(dataLine).toBeDefined();
    expect(parseRecord(dataLine as string)).toEqual(nasty);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My SEO Keywords")).toBe("my-seo-keywords");
  });

  it("collapses runs of punctuation into one hyphen", () => {
    expect(slugify("a  --  b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("!!! hello !!!")).toBe("hello");
  });

  it("falls back when nothing survives", () => {
    expect(slugify("キーワード")).toBe("collection");
    expect(slugify("")).toBe("collection");
    expect(slugify("...", "fallback")).toBe("fallback");
  });

  it("never leaves a trailing hyphen after truncation", () => {
    const slug = slugify(`${"a".repeat(79)} tail`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("cannot produce a path separator or traversal", () => {
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("a/b\\c")).toBe("a-b-c");
  });
});

describe("attachmentHeader", () => {
  it("marks the response as a download with both filename forms", () => {
    expect(attachmentHeader("my-keywords.csv")).toBe(
      `attachment; filename="my-keywords.csv"; filename*=UTF-8''my-keywords.csv`,
    );
  });

  it("cannot be broken out of with a quote in the name", () => {
    const header = attachmentHeader('a"b.csv');
    expect(header).toBe(
      `attachment; filename="ab.csv"; filename*=UTF-8''a%22b.csv`,
    );
    // Exactly one quoted section — no injected parameters.
    expect(header.split('"')).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */
/* A deliberately small RFC 4180 reader, used only to prove the writer.        */
/* -------------------------------------------------------------------------- */

/** Splits on CRLFs that sit outside quotes. */
function splitRecords(csv: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && char === "\r" && csv[i + 1] === "\n") {
      records.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += char;
  }
  if (current !== "") records.push(current);
  return records;
}

function parseRecord(record: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < record.length; i += 1) {
    const char = record[i];
    if (inQuotes) {
      if (char === '"' && record[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      fields.push(current);
      current = "";
    } else current += char;
  }
  fields.push(current);
  return fields;
}
