import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AggregationResult,
  ApplicationRecord,
  ApplyResult,
  Profile,
  ResumeExtraction,
  ResumeInfo
} from './models';

export type ResumeUploadResult = Required<Pick<ResumeInfo, 'fileName' | 'length' | 'preview' | 'extracted'>>;

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

  /** Inline URL for previewing a job's tailored PDF. */
  tailoredPdfUrl(jobId: string): string {
    return `${BASE}/tailored/${encodeURIComponent(jobId)}.pdf`;
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

  downloadUrl(path: string): string {
    return `${BASE.replace('/api', '')}${path}`;
  }
}
