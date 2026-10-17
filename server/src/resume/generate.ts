import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { writeFile } from "node:fs/promises";

export interface TailoredSection {
  heading: string;
  /** One paragraph of plain text per bullet/line. Keep bullets as separate strings. */
  lines: string[];
}

export interface TailoredResumeInput {
  /** e.g. "Jane Doe - Frontend Lead" */
  headerTitle: string;
  /** Contact line, e.g. "jane@example.com | +91-90000-00000 | Bangalore, India | linkedin.com/in/janedoe" */
  contactLine: string;
  /** A short 2-4 line summary, already tailored to the target JD by the calling LLM. */
  summary: string;
  sections: TailoredSection[];
}

/**
 * Writes a clean, ATS-friendly .docx from already-tailored content.
 * This tool does NOT do the tailoring itself (no LLM call baked in, on
 * purpose, so the server has no API-key dependency and works for anyone) -
 * the calling LLM decides what to keep/rewrite per job description, then
 * calls this tool with the final text to render.
 */
export async function generateResumeDocx(input: TailoredResumeInput, outPath: string): Promise<string> {
  const children: Paragraph[] = [
    new Paragraph({
      text: input.headerTitle,
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [new TextRun({ text: input.contactLine, italics: true, size: 20 })],
    }),
    new Paragraph({ text: "" }),
    new Paragraph({
      children: [new TextRun({ text: input.summary, size: 22 })],
    }),
  ];

  for (const section of input.sections) {
    children.push(
      new Paragraph({ text: "" }),
      new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_2 })
    );
    for (const line of section.lines) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: line, size: 22 })],
        })
      );
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  await writeFile(outPath, buffer);
  return outPath;
}
