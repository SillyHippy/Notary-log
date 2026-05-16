import { getStore } from "@netlify/blobs";
import type { IntakeRecord, IntakeSettingsFile, IntakeStore } from "./intake-types";

const STORE_NAME = "notary-intake";
const SETTINGS_KEY = "settings";
const SUB_PREFIX = "sub-";

/** Netlify Blobs adapter (free tier, auto-provisioned on Netlify). */
export function createNetlifyIntakeStore(): IntakeStore {
  const store = getStore(STORE_NAME);

  return {
    async getSettings() {
      return store.get(SETTINGS_KEY, { type: "json" }) as Promise<IntakeSettingsFile | null>;
    },

    async setSettings(data) {
      await store.setJSON(SETTINGS_KEY, data);
    },

    async getSubmission(id) {
      return store.get(`${SUB_PREFIX}${id}`, { type: "json" }) as Promise<IntakeRecord | null>;
    },

    async setSubmission(record) {
      await store.setJSON(`${SUB_PREFIX}${record.id}`, record);
    },

    async deleteSubmission(id) {
      await store.delete(`${SUB_PREFIX}${id}`);
    },

    async listSubmissions() {
      const { blobs } = await store.list({ prefix: SUB_PREFIX });
      const out: IntakeRecord[] = [];
      for (const blob of blobs) {
        const rec = (await store.get(blob.key, { type: "json" })) as IntakeRecord | null;
        if (rec) out.push(rec);
      }
      return out;
    },
  };
}
