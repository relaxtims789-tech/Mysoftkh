import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Report } from './reports.service';

function cell(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Values starting with = + - @ would run as formulas in Excel; prefix them so they stay text. */
function safeCsv(v: unknown): string {
  let s = cell(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(r: Report): Buffer {
  const lines = [r.columns.map((c) => safeCsv(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => safeCsv(row[c.key])).join(','));
  // BOM so Excel opens UTF-8 (Khmer names) correctly
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

export async function toXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MySoft QR and Phones Attendance';
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/*?:[\]]/g, ' '));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([`${r.companyName} · ${r.subtitle}`]).font = { color: { argb: 'FF555555' } };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    c.alignment = { vertical: 'middle' };
  });
  for (const row of r.rows) {
    ws.addRow(r.columns.map((c) => {
      const v = row[c.key];
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) return `'${v}`;
      return v ?? '';
    }));
  }
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c, i) => (i === 0 ? 'Total' : r.totals![c.key] ?? '')));
    t.font = { bold: true };
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(c.width ?? 10, c.label.length + 2);
    if (c.align) col.alignment = { horizontal: c.align };
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: r.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(r: Report): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true, info: { Title: r.title, Author: r.companyName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const usable = doc.page.width - left - doc.page.margins.right;
    const totalWeight = r.columns.reduce((s, c) => s + (c.width ?? 10), 0);
    const widths = r.columns.map((c) => ((c.width ?? 10) / totalWeight) * usable);
    const fontSize = r.columns.length > 12 ? 7 : 8;
    const rowH = fontSize + 7;

    const title = () => {
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#111').text(r.title, left, 32);
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(`${r.companyName} · ${r.subtitle}`, left, doc.y + 2);
      doc.moveDown(0.6);
    };
    const headerRow = () => {
      const y = doc.y;
      doc.rect(left, y, usable, rowH + 2).fill('#1F4E79');
      let x = left;
      doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#fff');
      r.columns.forEach((c, i) => {
        doc.text(c.label, x + 3, y + 4, { width: widths[i] - 6, height: fontSize + 2, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + rowH + 2;
    };
    const line = (row: Record<string, unknown>, bold = false, shade = false) => {
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 14) {
        doc.addPage();
        title();
        headerRow();
      }
      const y = doc.y;
      if (shade) doc.rect(left, y, usable, rowH).fill('#F2F5F9');
      let x = left;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#111');
      r.columns.forEach((c, i) => {
        // The standard PDF fonts only cover Latin-1; other scripts would print as garbage.
        const text = cell(row[c.key]).replace(/[^\x20-\xFF]/g, '?');
        doc.text(text, x + 3, y + 3.5, { width: widths[i] - 6, height: fontSize + 2, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + rowH;
    };

    title();
    headerRow();
    if (!r.rows.length) {
      doc.font('Helvetica').fontSize(9).fillColor('#555').text('No records for this period.', left, doc.y + 6);
    }
    r.rows.forEach((row, i) => line(row, false, i % 2 === 1));
    if (r.totals) line({ [r.columns[0].key]: 'Total', ...r.totals }, true);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Writing inside the bottom margin would start a new (blank) page.
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#888').text(
        `Generated ${new Date(r.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · Page ${i + 1} of ${range.count}`,
        left, doc.page.height - 24, { width: usable, align: 'right', lineBreak: false },
      );
    }
    doc.end();
  });
}
