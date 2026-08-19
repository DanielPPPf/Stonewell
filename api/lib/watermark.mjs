/* Burn a per-viewer watermark into a PDF using pdf-lib (pure JS, no native deps).
   Draws a low-opacity diagonal tile of the viewer label across every page plus a
   footer line, so any screenshot/print is bound to the named recipient. */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export async function stampPdf(srcBytes, label) {
  const pdf = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.12, 0.18, 0.29);

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = 11;
    const stepX = 240;
    const stepY = 120;
    // Diagonal tiled watermark
    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        page.drawText(label, {
          x, y, size, font, color: navy, opacity: 0.06, rotate: degrees(30),
        });
      }
    }
    // Footer attribution bar
    page.drawText(label, {
      x: 24, y: 14, size: 8, font, color: navy, opacity: 0.55,
    });
  }
  return pdf.save();
}
