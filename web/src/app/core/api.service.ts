import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AggregationResult,
  ApplicationRecord,
  ApplyResult,
  CareerProfile,
  JobPostingPreview,
  JobSections,
  LinkTailorRequest,
  LinkTailorResult,
  Profile,
  ProfileResumeResult,
  QuickTailorRequest,
  QuickTailorResult,
  ResumeExtraction,
  ResumeInfo,
  UsageSummary
} from './models';

export type ResumeUploadResult = Required<Pick<ResumeInfo, 'fileName' | 'length' | 'preview' | 'extracted'>> & {
  /** The profile was empty, so the resume's experience/education/etc. were saved to it. */
  careerImported?: boolean;
};

const BASE = 'http://localhost:4000/api';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  getProfile(): Observable<Profile> {
    return this.http.get<Profile>(`${BASE}/profile`);
  }

  saveProfile(profile: Partial<Profile>): Observable<Profile> {
    return this.http.put<Profile>(`${BASE}/profile`, profile);
  }

  /** Experience, education etc. read from the uploaded resume (not saved). `refresh` re-reads it. */
  getCareerFromResume(refresh = false): Observable<{ career: CareerProfile; source: 'ai' | 'heuristic' }> {
    return this.http.post<{ career: CareerProfile; source: 'ai' | 'heuristic' }>(`${BASE}/profile/career/from-resume`, { refresh });
  }

  /** Writes a general ATS-friendly resume (PDF + Word) from the Profile page's details. */
  generateAtsResume(): Observable<ProfileResumeResult> {
    return this.http.post<ProfileResumeResult>(`${BASE}/profile/ats-resume`, {});
  }

  getResume(): Observable<ResumeInfo> {
    return this.http.get<ResumeInfo>(`${BASE}/resume`);
  }

  uploadResume(file: File): Observable<ResumeUploadResult> {
    const form = new FormData();
    form.append('resume', file, file.name);
    return this.http.post<ResumeUploadResult>(`${BASE}/resume`, form);
  }

  deleteResume(): Observable<ResumeInfo> {
    return this.http.delete<ResumeInfo>(`${BASE}/resume`);
  }

  /** Pulls profile details from LinkedIn (via your logged-in Chrome) or GitHub, for prefilling. */
  importProfile(source: 'linkedin' | 'github', url: string): Observable<ResumeExtraction> {
    return this.http.post<ResumeExtraction>(`${BASE}/profile/import/${source}`, { url });
  }

  getJobs(): Observable<AggregationResult> {
    return this.http.get<AggregationResult>(`${BASE}/jobs`);
  }

  aggregateJobs(): Observable<AggregationResult> {
    return this.http.post<AggregationResult>(`${BASE}/jobs/aggregate`, {});
  }

  tailorJob(jobId: string): Observable<{ jobId: string; pdfUrl: string }> {
    return this.http.post<{ jobId: string; pdfUrl: string }>(`${BASE}/jobs/${jobId}/tailor`, {});
  }

  /** Reads a job posting link: its description plus a guessed title and company. */
  getJobPosting(url: string): Observable<JobPostingPreview> {
    return this.http.post<JobPostingPreview>(`${BASE}/job-posting`, { url });
  }

  /** Key responsibilities and must-have skills from a pasted job description. */
  extractJobSections(description: string): Observable<JobSections> {
    return this.http.post<JobSections>(`${BASE}/job-sections`, { description });
  }

  /** Tailors the resume for any job posting link (Workday, a careers page, ...) for the user to apply with. */
  tailorFromLink(request: LinkTailorRequest): Observable<LinkTailorResult> {
    return this.http.post<LinkTailorResult>(`${BASE}/tailor-from-link`, request);
  }

  /** Tailors the resume to a pasted job description and makes PDF + Word copies, with an ATS keyword report. */
  tailorQuick(request: QuickTailorRequest): Observable<QuickTailorResult> {
    return this.http.post<QuickTailorResult>(`${BASE}/tailor-quick`, request);
  }

  /** Download URL for the Word copy made by `tailorQuick`. */
  tailoredDocxDownloadUrl(jobId: string, fileName: string): string {
    return `${BASE}/tailored/${encodeURIComponent(jobId)}.docx?download=1&name=${encodeURIComponent(fileName)}`;
  }

  /** Inline URL for previewing a job's tailored PDF. */
  tailoredPdfUrl(jobId: string): string {
    return `${BASE}/tailored/${encodeURIComponent(jobId)}.pdf`;
  }

  /** Download file name for a job's tailored resume. */
  tailoredPdfFileName(company: string, title: string): string {
    return `Resume - ${company} - ${title}`;
  }

  /** Same PDF, served as an attachment named `fileName`. */
  tailoredPdfDownloadUrl(jobId: string, fileName: string): string {
    return `${this.tailoredPdfUrl(jobId)}?download=1&name=${encodeURIComponent(fileName)}`;
  }

  applyToJob(jobId: string, force = false): Observable<ApplyResult> {
    return this.http.post<ApplyResult>(`${BASE}/jobs/${jobId}/apply`, { force });
  }

  explainPolicy(jobId: string): Observable<{ explanation: string; autoSubmitEligible: boolean }> {
    return this.http.get<{ explanation: string; autoSubmitEligible: boolean }>(`${BASE}/jobs/${jobId}/policy`);
  }

  getApplications(): Observable<ApplicationRecord[]> {
    return this.http.get<ApplicationRecord[]>(`${BASE}/applications`);
  }

  /** Token usage of every AI call so far (tailoring, resume reading, profile import). */
  getUsage(recentLimit = 50): Observable<UsageSummary> {
    return this.http.get<UsageSummary>(`${BASE}/usage`, { params: { limit: recentLimit } });
  }

  downloadUrl(path: string): string {
    return `${BASE.replace('/api', '')}${path}`;
  }
}
