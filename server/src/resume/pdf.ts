import { chromium } from "playwright";
import type { TailoredResumeInput } from "./generate.js";

/**
 * Renders tailored resume content to an ATS-friendly, text-selectable PDF.
 * Uses a private headless Chromium (not the user's logged-in Chrome from
 * browser.ts) - this is pure rendering, no site is visited.
 */
export async function generateResumePdf(input: TailoredResumeInput, outPath: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(renderResumeHtml(input), { waitUntil: "load" });
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" },
    });
    return outPath;
  } finally {
    await browser.close();
  }
}

function renderResumeHtml(input: TailoredResumeInput): string {
  const sections = input.sections
    .map(
      (s) => `
      <section>
        <h2>${esc(s.heading)}</h2>
        <ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      </section>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1d1f24; }
  header { border-bottom: 1.5px solid #1d1f24; padding-bottom: 8px; margin-bottom: 12px; }
  h1 { margin: 0 0 4px; font-size: 19pt; letter-spacing: -0.01em; }
  .contact { margin: 0; font-size: 9.5pt; color: #4a4f5a; }
  .summary { margin: 0 0 6px; }
  h2 { margin: 14px 0 6px; font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #2f3a8f; }
  ul { margin: 0; padding-left: 16px; }
  li { margin: 0 0 3px; }
  section { break-inside: auto; }
  h2 { break-after: avoid; }
  li { break-inside: avoid; }
</style>
</head>
<body>
  <header>
    <h1>${esc(input.headerTitle)}</h1>
    <p class="contact">${esc(input.contactLine)}</p>
  </header>
  <p class="summary">${esc(input.summary)}</p>
  ${sections}
</body>
</html>`;
}

function esc(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
