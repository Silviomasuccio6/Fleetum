import { FleetumEnvironment } from "../../shared/config/staging-safety.js";

export type AutomaticCronTask = {
  stop: () => void;
};

export type AutomaticCronStarters = {
  reminder: () => AutomaticCronTask;
  emailQueue: () => AutomaticCronTask;
  reports: () => AutomaticCronTask;
  privacyRetention: () => AutomaticCronTask;
  billingDunning: () => AutomaticCronTask;
};

export const startAutomaticCronTasks = (
  environment: FleetumEnvironment,
  starters: AutomaticCronStarters
): AutomaticCronTask[] => {
  if (environment === "staging") return [];

  return [
    starters.reminder(),
    starters.emailQueue(),
    starters.reports(),
    starters.privacyRetention(),
    starters.billingDunning()
  ];
};

export const stopAutomaticCronTasks = (tasks: AutomaticCronTask[]) => {
  for (const task of tasks) task.stop();
};
