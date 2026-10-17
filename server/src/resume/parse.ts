import { readFile } from "node:fs/promises";
import { extname } from "node:path";

/**
 * Extracts plain text from any resume file (.pdf, .docx, .txt/.md).
 * Intentionally does NOT try to "understand" the resume (no NER, no
 * skills extraction) - this server is resume-agnostic, so it hands back
 * clean text and leaves tailoring/judgment to whatever LLM is driving it.
 */
export async function extractResumeText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    // pdf-parse ships a CJS default export; dynamic import keeps ESM happy.
    const pdfParse = (await import("pdf-parse")).default;
    const buf = await readFile(filePath);
    const result = await pdfParse(buf);
    return normalize(result.text);
  }

  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ path: filePath });
    return normalize(value);
  }

  if (ext === ".txt" || ext === ".md") {
    const buf = await readFile(filePath, "utf-8");
    return normalize(buf);
  }

  throw new Error(
    `Unsupported resume format "${ext}". Supported: .pdf, .docx, .txt, .md. ` +
      `Convert the file first if it's in another format.`
  );
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
