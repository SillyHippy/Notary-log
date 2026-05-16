import { mkdir, readdir, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { IntakeRecord, IntakeSettingsFile, IntakeStore } from "./intake-types";

/** Local filesystem adapter (Zo / Bun server). */
export function createFsIntakeStore(intakeDir: string): IntakeStore {
  const settingsPath = join(intakeDir, "settings.json");

  return {
    async getSettings() {
      const file = Bun.file(settingsPath);
      if (!(await file.exists())) return null;
      try {
        return (await file.json()) as IntakeSettingsFile;
      } catch {
        return null;
      }
    },

    async setSettings(data) {
      await mkdir(intakeDir, { recursive: true });
      await Bun.write(settingsPath, JSON.stringify(data, null, 2));
    },

    async getSubmission(id) {
      const clean = basename(id);
      if (clean !== id) return null;
      const file = Bun.file(join(intakeDir, `${clean}.json`));
      if (!(await file.exists())) return null;
      try {
        return (await file.json()) as IntakeRecord;
      } catch {
        return null;
      }
    },

    async setSubmission(record) {
      await mkdir(intakeDir, { recursive: true });
      await Bun.write(
        join(intakeDir, `${record.id}.json`),
        JSON.stringify(record, null, 2),
      );
    },

    async deleteSubmission(id) {
      const clean = basename(id);
      const filePath = join(intakeDir, `${clean}.json`);
      try {
        await unlink(filePath);
      } catch {
        // ignore
      }
    },

    async listSubmissions() {
      await mkdir(intakeDir, { recursive: true });
      const names = await readdir(intakeDir);
      const out: IntakeRecord[] = [];
      for (const name of names) {
        if (!name.endsWith(".json") || name === "settings.json") continue;
        try {
          const rec = (await Bun.file(join(intakeDir, name)).json()) as IntakeRecord;
          out.push(rec);
        } catch {
          // skip corrupt
        }
      }
      return out;
    },
  };
}
