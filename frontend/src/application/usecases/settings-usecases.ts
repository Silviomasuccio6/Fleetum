import { httpClient } from "../../infrastructure/api/http-client";
import type {
  IntegrationsSettingsDto,
  PlaybooksSettingsDto,
  ReportsSettingsDto,
  SettingsUpdateResponseDto,
  SlaSettingsDto
} from "../dtos/settings-dto";

export const settingsUseCases = {
  getSla: () => httpClient.get<SlaSettingsDto>("/settings/sla"),
  updateSla: (input: Partial<SlaSettingsDto>) => httpClient.put<SettingsUpdateResponseDto>("/settings/sla", input),
  getPlaybooks: () => httpClient.get<PlaybooksSettingsDto>("/settings/playbooks"),
  updatePlaybooks: (input: PlaybooksSettingsDto) => httpClient.put<SettingsUpdateResponseDto>("/settings/playbooks", input),
  getReports: () => httpClient.get<ReportsSettingsDto>("/settings/reports"),
  updateReports: (input: Partial<ReportsSettingsDto>) => httpClient.put<SettingsUpdateResponseDto>("/settings/reports", input),
  getIntegrations: () => httpClient.get<IntegrationsSettingsDto>("/settings/integrations"),
  updateIntegrations: (input: Partial<IntegrationsSettingsDto>) => httpClient.put<SettingsUpdateResponseDto>("/settings/integrations", input)
};
