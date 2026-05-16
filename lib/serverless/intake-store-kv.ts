import type { IntakeRecord, IntakeSettingsFile, IntakeStore } from "./intake-types";

const SETTINGS_KEY = "intake:settings";
const INDEX_KEY = "intake:index";

function submissionKey(id: string): string {
  return `intake:sub:${id}`;
}

/** Cloudflare Workers KV adapter for intake storage. */
export function createKvIntakeStore(kv: KVNamespace): IntakeStore {
  return {
    async getSettings() {
      const raw = await kv.get(SETTINGS_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as IntakeSettingsFile;
      } catch {
        return null;
      }
    },

    async setSettings(data) {
      await kv.put(SETTINGS_KEY, JSON.stringify(data));
    },

    async getSubmission(id) {
      const raw = await kv.get(submissionKey(id));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as IntakeRecord;
      } catch {
        return null;
      }
    },

    async setSubmission(record) {
      await kv.put(submissionKey(record.id), JSON.stringify(record));
      const ids = await readIndex(kv);
      if (!ids.includes(record.id)) {
        ids.push(record.id);
        await writeIndex(kv, ids);
      }
    },

    async deleteSubmission(id) {
      await kv.delete(submissionKey(id));
      const ids = (await readIndex(kv)).filter((x) => x !== id);
      await writeIndex(kv, ids);
    },

    async listSubmissions() {
      const ids = await readIndex(kv);
      const out: IntakeRecord[] = [];
      for (const id of ids) {
        const rec = await this.getSubmission(id);
        if (rec) out.push(rec);
      }
      return out;
    },
  };
}

async function readIndex(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw) as string[];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

async function writeIndex(kv: KVNamespace, ids: string[]): Promise<void> {
  await kv.put(INDEX_KEY, JSON.stringify(ids));
}
