/** One PDF page: a JPEG of `pixels` drawn over a page of `width` by `height` points. */
export type PdfPage = { jpeg: Uint8Array; pixels: { width: number; height: number }; width: number; height: number };

/** A PDF document with one full-bleed image per page. */
export function pdfDocument(pages: readonly PdfPage[]): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => { const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk; parts.push(bytes); length += bytes.length; };
  const object = (id: number, body: () => void) => { offsets[id] = length; push(`${id} 0 obj\n`); body(); push("\nendobj\n"); };
  push("%PDF-1.4\n%âãÏÓ\n");
  const pageIds = pages.map((_, at) => 3 + at * 3);
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`));
  pages.forEach((page, at) => {
    const id = pageIds[at]!;
    const width = Math.round(page.width * 100) / 100;
    const height = Math.round(page.height * 100) / 100;
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    object(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    object(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    object(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${page.pixels.width} /Height ${page.pixels.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
      push(page.jpeg);
      push("\nendstream");
    });
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${Array.from({ length: count - 1 }, (_, at) => `${String(offsets[at + 1] ?? 0).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}
