import cron, { type ScheduledTask } from "node-cron";
import type { Profile } from "./types.js";
import { aggregateJobs } from "./jobsStore.js";
import { getState } from "./state.js";

let activeTask: ScheduledTask | undefined;

/** (Re)starts the background aggregation job per profile.schedule, or stops it if disabled/invalid. */
export function applySchedule(profile: Profile): { running: boolean; cron?: string; error?: string } {
  activeTask?.stop();
  activeTask = undefined;

  if (!profile.schedule?.enabled) {
    return { running: false };
  }

  const expression = profile.schedule.cron ?? "0 7 * * *";
  if (!cron.validate(expression)) {
    return { running: false, error: `Invalid cron expression "${expression}"` };
  }

  activeTask = cron.schedule(expression, async () => {
    const { resumeText } = getState();
    if (!resumeText) {
      console.error("[job-search-agent] Scheduled aggregation skipped: no resume uploaded yet.");
      return;
    }
    try {
      const result = await aggregateJobs(profile, resumeText);
      console.error(
        `[job-search-agent] Scheduled aggregation at ${result.aggregatedAt}: ${result.jobs.length} jobs, ${result.errors.length} source errors.`
      );
    } catch (err) {
      console.error("[job-search-agent] Scheduled aggregation failed:", err);
    }
  });

  return { running: true, cron: expression };
}
