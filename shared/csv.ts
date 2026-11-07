/**
 * A table as CSV text (RFC 4180): cells with a comma, quote or line break go in quotes and their
 * quotes are doubled. Lines end in CRLF, which spreadsheet apps read everywhere. A byte order mark
 * up front makes Excel open accented letters (ñ, á) correctly.
 */
export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
