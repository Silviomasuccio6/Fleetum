export type SlaSettingsDto = {
  LOW: number;
  MEDIUM: number;
  HIGH: number;
  CRITICAL: number;
};

export type PlaybookSettingDto = {
  enabled: boolean;
  reminderEveryDays: number;
  [key: string]: string | number | boolean | null | undefined;
};

export type PlaybooksSettingsDto = Record<string, PlaybookSettingDto>;

export type ReportsSettingsDto = {
  enabled: boolean;
  recipients: string[];
  frequency: "daily" | "weekly" | "monthly" | string;
  hour: number;
  minute: number;
  reportStyle: "EXECUTIVE" | string;
};

export type IntegrationsSettingsDto = {
  erpWebhookUrl: string;
  telematicsWebhookUrl: string;
  ticketingWebhookUrl: string;
};

export type SettingsUpdateResponseDto = {
  updated: boolean;
};
