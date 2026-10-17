import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TabStopType, TextRun } from "docx";
import { writeFile } from "node:fs/promises";

/** One role, project or degree: a header line plus its bullets. */
export interface TailoredEntry {
  title: string;
  organization?: string;
  location?: string;
  dates?: string;
  bullets?: string[];
}

export interface TailoredSection {
  heading: string;
  /** One paragraph of plain text per bullet/line. Keep bullets as separate strings. */
  lines?: string[];
  /** Roles/projects/degrees, rendered as entry headers with their own bullets after `lines`. */
  entries?: TailoredEntry[];
}

export interface TailoredResumeInput {
  /** The candidate's name, e.g. "Jane Doe" (older content put the title here too, e.g. "Jane Doe - Frontend Lead"). */
  headerTitle: string;
  /** Professional title under the name, e.g. "Senior Frontend Engineer". */
  headline?: string;
  /** Contact line, e.g. "jane@example.com | +91-90000-00000 | Bangalore, India | linkedin.com/in/janedoe" */
  contactLine: string;
  /** A short 2-4 line summary, already tailored to the target JD by the calling LLM. */
  summary: string;
  sections: TailoredSection[];
}

/** Lines under a heading like "Skills" read as "Category: a, b" paragraphs; elsewhere they're bullets. */
export function isListSection(heading: string): boolean {
  return /skill|technolog|competenc|tools|language|certif|interest/i.test(heading);
}

const FONT = "Calibri";
const ACCENT = "1F3A68";
// docx sizes are half-points; tab stops are in twips (1/1440 inch). Right edge of A4 text with 0.7" margins.
const RIGHT_TAB = 9900;

/**
 * Writes a clean, ATS-friendly .docx from already-tailored content: one column,
 * standard headings, real Word bullets, no tables/text boxes/images - the format
 * applicant tracking systems parse most reliably. The tailoring itself happens
 * elsewhere (aiTailor.ts, or the calling LLM in MCP mode); this only renders.
 */
export async function generateResumeDocx(input: TailoredResumeInput, outPath: string): Promise<string> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: input.headerTitle, bold: true, size: 36 })],
    }),
  ];
  if (input.headline?.trim()) {
    children.push(
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: input.headline, size: 24, color: ACCENT })] })
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: input.contactLine, size: 19 })],
    })
  );
  if (input.summary?.trim()) {
    children.push(heading("Professional Summary"), new Paragraph({ children: [new TextRun({ text: input.summary })] }));
  }

  for (const section of input.sections ?? []) {
    children.push(heading(section.heading));
    const list = isListSection(section.heading);
    for (const line of section.lines ?? []) {
      children.push(list ? listLine(line) : bullet(line));
    }
    for (const entry of section.entries ?? []) {
      children.push(
        new Paragraph({
          spacing: { before: 100 },
          keepNext: true,
          tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
          children: [
            new TextRun({ text: entry.title, bold: true }),
            new TextRun({ text: [entry.organization, entry.location].filter((p) => p?.trim()).map((p) => `, ${p}`).join("") }),
            ...(entry.dates?.trim() ? [new TextRun({ text: `\t${entry.dates}` })] : []),
          ],
        }),
        ...(entry.bullets ?? []).map(bullet)
      );
    }
  }

  const doc = new Document({
    creator: input.headerTitle,
    title: `${input.headerTitle} - Resume`,
    styles: { default: { document: { run: { font: FONT, size: 21 }, paragraph: { spacing: { after: 40 } } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  await writeFile(outPath, buffer);
  return outPath;
}

function heading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 60 },
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 1 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, color: ACCENT })],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text })] });
}

/** "Category: a, b" with the category bolded; plain lines stay plain. */
function listLine(text: string): Paragraph {
  const match = /^([^:]{1,40}):\s*(.+)$/.exec(text);
  return new Paragraph({
    children: match ? [new TextRun({ text: `${match[1]}: `, bold: true }), new TextRun({ text: match[2] })] : [new TextRun({ text })],
  });
}
