/**
 * Best-effort job title and company for a posting the user pasted a link to,
 * from the URL (Workday/Greenhouse/Lever put the company in it) and the
 * page's <title>. Only used to name the tailored resume and its history entry.
 */

const GENERIC_LABELS = new Set(["careers", "career", "jobs", "job", "apply", "boards", "job-boards", "talent", "hire", "www", "en"]);
const GENERIC_TITLE_PARTS = /^(careers?|jobs?|job details|job application|workday|apply|home)$/i;

export function guessJobDetails(url: string, pageTitle: string): { title?: string; company?: string } {
  const { hostname, pathname, searchParams } = new URL(url);
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const path = pathname.split("/").filter(Boolean);

  let company: string | undefined;
  let title: string | undefined;

  if (host.endsWith("myworkdayjobs.com")) {
    // acme.wd5.myworkdayjobs.com/en-US/External/job/City/Senior-Engineer_R12345
    company = host.split(".")[0];
    const jobIdx = path.indexOf("job");
    const slug = jobIdx >= 0 ? path[path.length - 1] : undefined;
    if (slug && jobIdx < path.length - 1) title = slug.replace(/_[A-Z]*-?\d[\w-]*$/, "");
  } else if (host.endsWith("greenhouse.io")) {
    // boards.greenhouse.io/acme/jobs/123 or job-boards.greenhouse.io/embed/job_app?for=acme
    company = searchParams.get("for") ?? (path[0] !== "embed" ? path[0] : undefined);
  } else if (host.endsWith("lever.co")) {
    company = path[0]; // jobs.lever.co/acme/<uuid>
  } else {
    const labels = host.split(".");
    let i = labels.length - 2;
    if (i > 0 && labels[i].length <= 3) i--; // acme.co.uk
    if (i >= 0 && !GENERIC_LABELS.has(labels[i])) company = labels[i];
  }
  company = company ? titleCase(company) : undefined;

  const fromPage = parsePageTitle(pageTitle, company);
  return { title: fromPage.title ?? (title ? titleCase(title) : undefined), company: fromPage.company ?? company };
}

function parsePageTitle(pageTitle: string, knownCompany?: string): { title?: string; company?: string } {
  const text = pageTitle.replace(/\s+/g, " ").trim();
  if (!text) return {};

  const greenhouse = /^Job Application for (.+?) at (.+)$/i.exec(text);
  if (greenhouse) return { title: greenhouse[1].trim(), company: greenhouse[2].trim() };

  const known = knownCompany?.toLowerCase();
  const parts = text
    .split(/\s+[|–—-]\s+/)
    .map((p) => p.trim())
    .filter((p) => p && !GENERIC_TITLE_PARTS.test(p) && !/\bcareers?\b|\bjobs\b/i.test(p));
  const title = parts.find((p) => !known || !p.toLowerCase().includes(known));
  return { title: title && title.length <= 120 ? title : undefined };
}

function titleCase(text: string): string {
  return text
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
