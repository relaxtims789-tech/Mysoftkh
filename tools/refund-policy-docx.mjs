// Makes the Word version of the Cancellation & Refund Policy from apps/web/src/lib/refund-policy.ts (the same text the
// payment page shows). Writes docs/ and apps/web/public/legal/ (served for download).   node tools/refund-policy-docx.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, LevelFormat, Packer, PageNumber, Paragraph, ShadingType, Table,
  TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { REFUND_POLICY as P, REFUND_POLICY_EFFECTIVE, REFUND_POLICY_VERSION } from '../apps/web/src/lib/refund-policy.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = [path.join(ROOT, 'docs', 'MySoft-Cancellation-Refund-Policy.docx'), path.join(ROOT, 'apps', 'web', 'public', 'legal', 'MySoft-Cancellation-Refund-Policy.docx')];

const BRAND = '0F6FDE';
const MUTED = '5B6472';
// Khmer UI ships with Windows; Word falls back to another Khmer font elsewhere.
const FONT = { en: { ascii: 'Calibri', hAnsi: 'Calibri', cs: 'Calibri' }, km: { ascii: 'Khmer UI', hAnsi: 'Khmer UI', cs: 'Khmer UI', eastAsia: 'Khmer UI' } };
const SIZE = { en: 21, km: 21 }; // half-points
const LINE = { en: 276, km: 340 }; // Khmer needs taller lines for stacked vowels and subscripts

const run = (lang, text, o = {}) => new TextRun({ text, font: FONT[lang], size: o.size ?? SIZE[lang], bold: o.bold, color: o.color, language: lang === 'km' ? { value: 'km-KH', bidirectional: 'km-KH' } : { value: 'en-US' } });
const para = (lang, text, o = {}) => new Paragraph({
  children: [run(lang, text, o)],
  spacing: { before: o.before ?? 0, after: o.after ?? 120, line: LINE[lang] },
  alignment: o.align,
  numbering: o.numbering,
  keepNext: o.keepNext,
  border: o.border,
});

function part(lang) {
  const out = [];
  const heading = (text, o = {}) => out.push(para(lang, text, { bold: true, size: lang === 'km' ? 25 : 26, color: BRAND, before: 260, after: 100, keepNext: true, ...o }));
  out.push(para(lang, P.title[lang], { bold: true, size: lang === 'km' ? 36 : 40, color: '111827', after: 60 }));
  out.push(para(lang, P.provider[lang], { color: MUTED, after: 60 }));
  out.push(para(lang, `${P.versionLabel[lang]} ${REFUND_POLICY_VERSION} · ${P.effectiveLabel[lang]} ${REFUND_POLICY_EFFECTIVE[lang]}`, {
    color: MUTED, after: 200, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND, space: 8 } },
  }));
  out.push(para(lang, P.intro[lang]));

  // "In short" box: a one-cell shaded table.
  const W = 9026;
  out.push(new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: W, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF5FF' },
        margins: { top: 140, bottom: 80, left: 200, right: 200 },
        borders: { top: { style: BorderStyle.SINGLE, size: 6, color: 'BFD7F5' }, bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFD7F5' }, left: { style: BorderStyle.SINGLE, size: 24, color: BRAND }, right: { style: BorderStyle.SINGLE, size: 6, color: 'BFD7F5' } },
        children: [
          para(lang, P.summaryTitle[lang], { bold: true, color: BRAND, after: 80 }),
          ...P.summary.map((s) => para(lang, s[lang], { numbering: { reference: 'bullets', level: 0 }, after: 60 })),
        ],
      })],
    })],
  }));

  P.sections.forEach((s, i) => {
    heading(s.title[lang]);
    for (const t of s.text ?? []) out.push(para(lang, t[lang]));
    for (const t of s.items ?? []) out.push(para(lang, t[lang], { numbering: { reference: 'bullets', level: 0 }, after: 80 }));
    for (const t of s.lettered ?? []) out.push(para(lang, t[lang], { numbering: { reference: `letters-${lang}-${i}`, level: 0 }, after: 80 }));
    for (const t of s.after ?? []) out.push(para(lang, t[lang], { before: 60 }));
  });

  heading(P.acknowledgeTitle[lang]);
  out.push(para(lang, `☐  ${P.acknowledge[lang]}`, { after: 120 }));
  out.push(para(lang, P.acknowledgeNote[lang], { color: MUTED, size: lang === 'km' ? 19 : 19 }));
  return out;
}

const lettered = (ref) => ({
  reference: ref,
  levels: [{ level: 0, format: LevelFormat.LOWER_LETTER, text: '%1)', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 640, hanging: 360 } } } }],
});
const sectionCount = P.sections.length;
const numbering = {
  config: [
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 640, hanging: 320 } } } }] },
    ...['en', 'km'].flatMap((l) => Array.from({ length: sectionCount }, (_, i) => lettered(`letters-${l}-${i}`))),
  ],
};

const page = { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1200, left: 1440, right: 1440 } };
const header = (lang) => new Header({ children: [para(lang, lang === 'km' ? 'MySoft Attendance · គោលការណ៍លុបចោល និងសងប្រាក់វិញ' : 'MySoft Attendance · Cancellation & Refund Policy', { size: 17, color: MUTED, align: AlignmentType.RIGHT, after: 0 })] });
const footer = (lang) => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      run('en', `www.mysoftkh.com · Telegram @mysoftkh · 014 789 987 · 096 89 99 169 · v${REFUND_POLICY_VERSION} · `, { size: 16, color: MUTED }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT.en, size: 16, color: MUTED }),
    ],
  })],
});

const doc = new Document({
  creator: 'MySoft KH',
  title: 'MySoft Attendance - Cancellation & Refund Policy',
  description: `Cancellation & Refund Policy v${REFUND_POLICY_VERSION} (English and Khmer)`,
  styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
  numbering,
  sections: ['en', 'km'].map((lang) => ({ properties: { page }, headers: { default: header(lang) }, footers: { default: footer(lang) }, children: part(lang) })),
});

const buf = await Packer.toBuffer(doc);
for (const f of OUT) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  console.log('wrote', path.relative(ROOT, f), `${(buf.length / 1024).toFixed(0)} KB`);
}
