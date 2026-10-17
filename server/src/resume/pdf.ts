import { chromium } from "playwright";
import { isListSection, type TailoredEntry, type TailoredResumeInput } from "./generate.js";

/**
 * Renders tailored resume content to an ATS-friendly, text-selectable PDF:
 * one column, standard fonts and headings, no tables or graphics.
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
      margin: { top: "14mm", bottom: "14mm", left: "16mm", right: "16mm" },
    });
    return outPath;
  } finally {
    await browser.close();
  }
}

function renderEntry(entry: TailoredEntry): string {
  const where = [entry.organization, entry.location].filter((p) => p?.trim()).map((p) => `, ${esc(p!)}`).join("");
  const bullets = entry.bullets?.length ? `<ul>${entry.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "";
  return `
        <div class="entry">
          <div class="entry__head"><span><strong>${esc(entry.title)}</strong>${where}</span>${entry.dates?.trim() ? `<span class="entry__dates">${esc(entry.dates)}</span>` : ""}</div>
          ${bullets}
        </div>`;
}

function renderLines(heading: string, lines: string[]): string {
  if (!lines.length) return "";
  if (!isListSection(heading)) return `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
  // "Category: a, b" lines with the category bolded.
  return lines
    .map((l) => {
      const match = /^([^:]{1,40}):\s*(.+)$/.exec(l);
      return `<p class="list-line">${match ? `<strong>${esc(match[1])}:</strong> ${esc(match[2])}` : esc(l)}</p>`;
    })
    .join("");
}

function renderResumeHtml(input: TailoredResumeInput): string {
  const sections = (input.sections ?? [])
    .map(
      (s) => `
      <section>
        <h2>${esc(s.heading)}</h2>
        ${renderLines(s.heading, s.lines ?? [])}
        ${(s.entries ?? []).map(renderEntry).join("")}
      </section>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(input.headerTitle)} - Resume</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Calibri, Carlito, "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; color: #1d1f24; }
  header { text-align: center; margin-bottom: 8px; }
  h1 { margin: 0; font-size: 19pt; letter-spacing: -0.01em; }
  .headline { margin: 2px 0 0; font-size: 11.5pt; color: #1f3a68; }
  .contact { margin: 4px 0 0; font-size: 9.5pt; color: #4a4f5a; }
  p { margin: 0; }
  h2 { margin: 12px 0 5px; padding-bottom: 2px; border-bottom: 1px solid #1f3a68; font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #1f3a68; break-after: avoid; }
  ul { margin: 2px 0 0; padding-left: 16px; }
  li { margin: 0 0 2px; break-inside: avoid; }
  .list-line { margin: 0 0 2px; }
  .entry { margin: 0 0 6px; }
  .entry__head { display: flex; justify-content: space-between; gap: 12px; break-after: avoid; }
  .entry__dates { white-space: nowrap; color: #4a4f5a; }
</style>
</head>
<body>
  <header>
    <h1>${esc(input.headerTitle)}</h1>
    ${input.headline?.trim() ? `<p class="headline">${esc(input.headline)}</p>` : ""}
    <p class="contact">${esc(input.contactLine)}</p>
  </header>
  ${input.summary?.trim() ? `<section><h2>Professional Summary</h2><p>${esc(input.summary)}</p></section>` : ""}
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
