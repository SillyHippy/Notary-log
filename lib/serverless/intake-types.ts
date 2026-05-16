export interface IntakeFormConfig {
  title: string;
  allowIdUpload: boolean;
  showEmail: boolean;
  showPhone: boolean;
  showAddress: boolean;
  showNotes: boolean;
  showPreferredDate: boolean;
}

export interface IntakeSettingsFile {
  secret: string;
  config: IntakeFormConfig;
}

export interface IntakeRecord {
  id: string;
  createdAt: string;
  read: boolean;
  fields: Record<string, unknown>;
}

export interface IntakeStore {
  getSettings(): Promise<IntakeSettingsFile | null>;
  setSettings(data: IntakeSettingsFile): Promise<void>;
  getSubmission(id: string): Promise<IntakeRecord | null>;
  setSubmission(record: IntakeRecord): Promise<void>;
  deleteSubmission(id: string): Promise<void>;
  listSubmissions(): Promise<IntakeRecord[]>;
}
