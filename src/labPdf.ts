import { type ParsedStudy, parseLabReport } from "../shared/labs.ts";

/** A piece of text on a PDF page, with where it starts and how wide it is (PDF points, y grows upward). */
export interface PdfText {
  str: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Lines of a page laid out like `pdftotext -layout`: pieces at the same height join into one line
 * in reading order, a small gap becomes a space and a wide one (a new column) two or more spaces,
 * which is what parseLabReport splits columns on.
 */
export function layoutLines(items: PdfText[]): string[] {
  const rows: PdfText[][] = [];
  const sorted = items.filter((i) => i.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r[0]!.y - item.y) <= 2.5);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let line = "";
    let end = -Infinity;
    for (const item of row) {
      // About one character: the average width of this piece's letters.
      const char = item.width / Math.max(item.str.length, 1) || 4;
      const gap = item.x - end;
      if (line) line += gap > char * 1.6 ? "    " : gap > char * 0.15 ? " " : "";
      line += item.str;
      end = item.x + item.width;
    }
    return line;
  });
}

/**
 * Reads a lab report PDF on the device, so the file never leaves it. pdf.js is large and loads
 * only here, the first time a PDF is picked.
 */
export async function readLabPdf(file: File): Promise<ParsedStudy> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const lines: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const upright: PdfText[] = [];
    const turned: PdfText[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const [a, b, , , e, f] = item.transform as number[];
      // Text turned 90° (an electrocardiograph's printout in landscape) runs along the page's
      // height: read it in its own frame, where it is laid out like any other page.
      if (Math.abs(b!) > Math.abs(a!)) turned.push({ str: item.str, x: f! * Math.sign(b!), y: -e! * Math.sign(b!), width: item.width });
      else upright.push({ str: item.str, x: e!, y: f!, width: item.width });
    }
    lines.push(...layoutLines(upright), ...layoutLines(turned));
  }
  // Frees the worker and the file's memory.
  await task.destroy();
  return parseLabReport(lines);
}
