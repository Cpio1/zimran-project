/**
 * Builds a small, valid one-page PDF with the given lines of text.
 * Used for the clearly labelled "Try a sample document" flow, which uploads it through
 * the normal Entry + Upload API (so in http mode it is analyzed by the real backend).
 */
export function buildSimplePdf(lines: string[], title = "Sample document"): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => "\\" + m).replace(/[^\x20-\x7e]/g, "?");
  const wrap = (s: string, n = 86) => {
    const out: string[] = [];
    let cur = "";
    for (const w of s.split(/\s+/)) {
      if ((cur + " " + w).trim().length > n) {
        out.push(cur);
        cur = w;
      } else cur = (cur + " " + w).trim();
    }
    if (cur) out.push(cur);
    return out;
  };
  const textLines = [title.toUpperCase(), "", ...lines.flatMap((l) => (l ? wrap(l) : [""]))];
  const ops = ["BT", "/F1 11 Tf", "14 TL", "56 760 Td"];
  for (const l of textLines) ops.push(`(${esc(l)}) Tj T*`);
  ops.push("ET");
  const stream = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export const SAMPLE_DOCUMENT = {
  title: "Sample dental certificate",
  category: "gift_certificate" as const,
  provider: "Sample Dental",
  subject: "Cleaning services",
  filename: "sample-dental.pdf",
  lines: [
    "Sample Dental - Gift certificate",
    "",
    "This certificate includes four dental cleaning services. Valid through December 31, 2026.",
    "Confirm prior usage with the provider before booking.",
    "To book, contact Sample Dental and present this certificate.",
    "",
    "SAMPLE DOCUMENT - created by Claimly for demonstration.",
  ],
};

export function sampleDocumentFile(): File {
  const bytes = buildSimplePdf(SAMPLE_DOCUMENT.lines, "Sample Dental certificate");
  return new File([bytes as BlobPart], SAMPLE_DOCUMENT.filename, { type: "application/pdf", lastModified: 1763121600000 });
}
