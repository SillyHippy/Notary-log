import { openDB, IDBPDatabase } from 'idb';
import {
  bytesToBase64,
  base64ToBytes,
  canonicalJson,
  decryptJSON,
  deriveKey,
  encryptJSON,
  generateSalt,
  sha256Hex,
  DEFAULT_ITERATIONS,
  type EncBlob,
} from './crypto';

export interface JournalEntry {
  id?: number;
  entryNumber: number;
  status: 'draft' | 'completed' | 'amended';

  // Signer info
  signerFullName: string;
  signerAddress: string;
  signerCity: string;
  signerState: string;
  signerDOB: string; // YYYY-MM-DD
  signerPhone?: string;

  // ID info
  idType: 'driver_license' | 'passport' | 'state_id' | 'military_id' | 'other';
  idNumber: string;
  idIssuingState?: string;
  idExpirationDate: string; // YYYY-MM-DD

  // Document info
  documentType: string;
  documentDate?: string;
  documentDescription?: string;

  // Notarial act
  notarialActType: 'acknowledgment' | 'jurat' | 'copy_certification' | 'signature_witnessing' | 'other';
  feeCharged: number; // in cents
  feeWaived: boolean;
  locationCity: string;
  locationState: string;
  locationAddress?: string;

  // Images and signatures (base64 or blob URLs)
  signatureImage?: string;
  idFrontImage?: string;
  idBackImage?: string;

  // Extraction metadata
  extractedRawText?: string;
  extractionMethod?: 'barcode' | 'ocr' | 'manual';
  extractionConfidence?: number;
  needsReview?: boolean;

  // Audit trail
  hash?: string;
  previousEntryHash?: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  completedAt?: string;

  // Amendments
  amendments?: Array<{ note: string; date: string }>;

  // Edit history
  editHistory?: Array<{ field: string; oldValue: string; newValue: string; date: string }>;

  notes?: string;
}

export interface NotarySettings {
  id?: number;
  notaryName: string;
  commissionNumber: string;
  commissionExpiration: string;
  defaultCity: string;
  defaultState: string;
  pinEnabled: boolean;
  pinHash?: string; // legacy plaintext-mode field — unused after migration
  darkMode: boolean;
  autoBackup?: boolean;
  googleEmail?: string;
}

// ── Storage shapes (encrypted records actually written to IDB) ─────────────

interface StoredEntry {
  id?: number;
  entryNumber: number;
  status: string;
  createdAt: string;
  _enc: EncBlob; // encrypts everything except the indexed fields above
}

interface StoredSettings {
  id: 1;
  _enc: EncBlob;
}

export interface CryptoMeta {
  id: 'crypto';
  salt: string; // base64
  canary: EncBlob;
  iterations: number;
  formatVersion: number;
}

const DB_NAME = 'notary_journal_db';
const DB_VERSION = 2;
const DARK_MODE_LS_KEY = 'notary_dark_mode';
const CANARY_PLAINTEXT = 'notary-journal-canary-v1';
const FORMAT_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;
let cryptoKey: CryptoKey | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('entries')) {
          const entryStore = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
          entryStore.createIndex('entryNumber', 'entryNumber', { unique: true });
          entryStore.createIndex('status', 'status', { unique: false });
          entryStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// ── Lock state ─────────────────────────────────────────────────────────────

export function isUnlocked(): boolean {
  return cryptoKey !== null;
}

export function lock(): void {
  cryptoKey = null;
}

export function _setKeyForTests(key: CryptoKey | null): void {
  cryptoKey = key;
}

function requireKey(): CryptoKey {
  if (!cryptoKey) throw new Error('Database is locked. Unlock with PIN before reading or writing.');
  return cryptoKey;
}

// ── Crypto setup / unlock ──────────────────────────────────────────────────

export async function getCryptoMeta(): Promise<CryptoMeta | undefined> {
  const db = await getDB();
  return db.get('meta', 'crypto') as Promise<CryptoMeta | undefined>;
}

export async function hasCryptoSetup(): Promise<boolean> {
  return !!(await getCryptoMeta());
}

export async function setupCrypto(pin: string): Promise<void> {
  if (await hasCryptoSetup()) throw new Error('Encryption already initialized');
  if (!pin || pin.length < 4) throw new Error('PIN must be at least 4 digits');
  const salt = generateSalt();
  const key = await deriveKey(pin, salt, DEFAULT_ITERATIONS);
  const canary = await encryptJSON(key, CANARY_PLAINTEXT);
  const meta: CryptoMeta = {
    id: 'crypto',
    salt: bytesToBase64(salt),
    canary,
    iterations: DEFAULT_ITERATIONS,
    formatVersion: FORMAT_VERSION,
  };
  const db = await getDB();
  await db.put('meta', meta);
  cryptoKey = key;
}

/** Returns true on success, false on wrong PIN. Throws on missing setup or hardware errors. */
export async function unlock(pin: string): Promise<boolean> {
  const meta = await getCryptoMeta();
  if (!meta) throw new Error('Encryption is not set up on this device');
  const salt = base64ToBytes(meta.salt);
  const key = await deriveKey(pin, salt, meta.iterations);
  try {
    const value = await decryptJSON<string>(key, meta.canary);
    if (value !== CANARY_PLAINTEXT) return false;
    cryptoKey = key;
    return true;
  } catch {
    return false;
  }
}

export async function changePin(oldPin: string, newPin: string): Promise<boolean> {
  if (!newPin || newPin.length < 4) throw new Error('New PIN must be at least 4 digits');
  const ok = await unlock(oldPin);
  if (!ok) return false;
  const oldKey = cryptoKey!;

  // Phase 1: decrypt everything with the OLD key (still in cryptoKey)
  const allEntries = await getAllEntries();
  const settings = await getSettings();

  // Phase 2: derive new key + re-encrypt everything in memory.
  // Crucially, do not touch the database until *all* records are successfully
  // re-encrypted, then commit them in a single readwrite transaction.
  const newSalt = generateSalt();
  const newKey = await deriveKey(newPin, newSalt, DEFAULT_ITERATIONS);

  // Temporarily swap cryptoKey to newKey for the encrypt helpers, then restore
  // it if the commit fails so the user can keep using the journal.
  cryptoKey = newKey;
  let reEncryptedEntries: StoredEntry[];
  let reEncryptedSettings: StoredSettings;
  let canary;
  try {
    reEncryptedEntries = await Promise.all(allEntries.map(e => encryptEntry(e)));
    settings.id = 1;
    setDarkModePref(!!settings.darkMode);
    reEncryptedSettings = await encryptSettings(settings);
    canary = await encryptJSON(newKey, CANARY_PLAINTEXT);
  } catch (err) {
    cryptoKey = oldKey;
    throw err;
  }

  const newMeta: CryptoMeta = {
    id: 'crypto',
    salt: bytesToBase64(newSalt),
    canary,
    iterations: DEFAULT_ITERATIONS,
    formatVersion: FORMAT_VERSION,
  };

  // Phase 3: atomic commit. IDB guarantees that a transaction either commits
  // entirely or rolls back, so meta cannot get out of sync with the records.
  const db = await getDB();
  const tx = db.transaction(['meta', 'entries', 'settings'], 'readwrite');
  try {
    await Promise.all([
      tx.objectStore('meta').put(newMeta),
      ...reEncryptedEntries.map(e => tx.objectStore('entries').put(e)),
      tx.objectStore('settings').put(reEncryptedSettings),
    ]);
    await tx.done;
  } catch (err) {
    cryptoKey = oldKey; // commit failed — keep using the old key
    throw err;
  }

  return true;
}

// ── Entry / settings encryption helpers ────────────────────────────────────

async function encryptEntry(entry: JournalEntry): Promise<StoredEntry> {
  const key = requireKey();
  const { id, entryNumber, status, createdAt, ...rest } = entry;
  const _enc = await encryptJSON(key, rest);
  return { id, entryNumber, status, createdAt, _enc };
}

async function decryptStoredEntry(stored: StoredEntry | JournalEntry): Promise<JournalEntry> {
  // Tolerate legacy plaintext rows that haven't been migrated yet
  if (!('_enc' in stored) || !(stored as StoredEntry)._enc) {
    return stored as JournalEntry;
  }
  const key = requireKey();
  const s = stored as StoredEntry;
  const rest = await decryptJSON<Partial<JournalEntry>>(key, s._enc);
  return {
    ...(rest as JournalEntry),
    id: s.id,
    entryNumber: s.entryNumber,
    status: s.status as JournalEntry['status'],
    createdAt: s.createdAt,
  };
}

async function encryptSettings(s: NotarySettings): Promise<StoredSettings> {
  const key = requireKey();
  const { id: _id, ...rest } = s;
  const _enc = await encryptJSON(key, rest);
  return { id: 1, _enc };
}

async function decryptStoredSettings(stored: StoredSettings | NotarySettings): Promise<NotarySettings> {
  if (!('_enc' in stored) || !(stored as StoredSettings)._enc) {
    return stored as NotarySettings;
  }
  const key = requireKey();
  const s = stored as StoredSettings;
  const rest = await decryptJSON<Partial<NotarySettings>>(key, s._enc);
  return { id: 1, ...(rest as NotarySettings) };
}

// ── Theme preference (read pre-unlock) ────────────────────────────────────

export function getDarkModePref(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(DARK_MODE_LS_KEY) === '1';
}

export function setDarkModePref(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DARK_MODE_LS_KEY, on ? '1' : '0');
}

// ── Public CRUD (require unlock) ───────────────────────────────────────────

const DEFAULT_SETTINGS: NotarySettings = {
  id: 1,
  notaryName: '',
  commissionNumber: '',
  commissionExpiration: '',
  defaultCity: '',
  defaultState: '',
  pinEnabled: true,
  darkMode: false,
};

export async function getSettings(): Promise<NotarySettings> {
  const db = await getDB();
  const stored = await db.get('settings', 1);
  if (!stored) {
    // First run after setup — persist defaults encrypted
    if (cryptoKey) {
      await db.put('settings', await encryptSettings(DEFAULT_SETTINGS));
    }
    return { ...DEFAULT_SETTINGS };
  }
  return decryptStoredSettings(stored);
}

export async function saveSettings(settings: NotarySettings): Promise<void> {
  const db = await getDB();
  settings.id = 1;
  setDarkModePref(!!settings.darkMode);
  await db.put('settings', await encryptSettings(settings));
}

export async function getEntry(id: number): Promise<JournalEntry | undefined> {
  const db = await getDB();
  const stored = await db.get('entries', id);
  if (!stored) return undefined;
  return decryptStoredEntry(stored);
}

export async function getAllEntries(): Promise<JournalEntry[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('entries', 'createdAt');
  return Promise.all(all.map(s => decryptStoredEntry(s)));
}

export async function searchEntries(query: string): Promise<JournalEntry[]> {
  const all = await getAllEntries();
  const lower = query.toLowerCase();
  return all
    .filter(e => e.signerFullName.toLowerCase().includes(lower) || e.entryNumber.toString().includes(lower))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getRecentEntries(limit: number): Promise<JournalEntry[]> {
  const db = await getDB();
  const tx = db.transaction('entries', 'readonly');
  const store = tx.objectStore('entries');
  const index = store.index('createdAt');
  const stored: StoredEntry[] = [];
  let cursor = await index.openCursor(null, 'prev');
  while (cursor && stored.length < limit) {
    stored.push(cursor.value as StoredEntry);
    cursor = await cursor.continue();
  }
  return Promise.all(stored.map(s => decryptStoredEntry(s)));
}

export async function createEntry(
  entry: Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'>,
): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('entries', 'readonly');
  const store = tx.objectStore('entries');
  let nextNumber = 1;
  const lastCursor = await store.index('entryNumber').openCursor(null, 'prev');
  if (lastCursor) nextNumber = (lastCursor.value as StoredEntry).entryNumber + 1;
  await tx.done;

  const now = new Date().toISOString();
  const newEntry: JournalEntry = {
    ...entry,
    entryNumber: nextNumber,
    createdAt: now,
    updatedAt: now,
  };
  const stored = await encryptEntry(newEntry);
  const id = await db.add('entries', stored);
  return id as number;
}

/**
 * Import a journal entry from a backup, preserving its original entryNumber.
 * Throws { code: 'DUPLICATE' } if an entry with the same entryNumber already exists.
 */
export async function importEntry(entry: Omit<JournalEntry, 'id'>): Promise<number> {
  const db = await getDB();
  const existing = await db.getFromIndex('entries', 'entryNumber', entry.entryNumber);
  if (existing) {
    throw Object.assign(new Error(`Entry number ${entry.entryNumber} already exists`), { code: 'DUPLICATE' });
  }
  const stored = await encryptEntry(entry as JournalEntry);
  const id = await db.add('entries', stored);
  return id as number;
}

const IMMUTABLE_FIELDS: Array<keyof JournalEntry> = [
  'signerFullName', 'signerAddress', 'signerCity', 'signerState', 'signerDOB', 'signerPhone',
  'idType', 'idNumber', 'idIssuingState', 'idExpirationDate',
  'documentType', 'documentDate', 'documentDescription',
  'notarialActType', 'feeCharged', 'feeWaived',
  'locationCity', 'locationState', 'locationAddress',
  'idFrontImage', 'idBackImage', 'signatureImage',
];

export async function updateEntry(id: number, updates: Partial<JournalEntry>): Promise<void> {
  const existing = await getEntry(id);
  if (!existing) throw new Error(`Entry ${id} not found`);

  if (existing.status === 'completed' || existing.status === 'amended') {
    const blocked = IMMUTABLE_FIELDS.filter(f => f in updates);
    if (blocked.length > 0) {
      throw new Error(
        `Cannot modify completed/amended entry fields: ${blocked.join(', ')}. Use an amendment note instead.`,
      );
    }
  }

  const updated: JournalEntry = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  const db = await getDB();
  await db.put('entries', await encryptEntry(updated));
}

export async function deleteEntry(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('entries', id);
}

export async function getStats() {
  const all = await getAllEntries();
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  let totalFees = 0, completed = 0, draft = 0, thisMonth = 0;
  for (const e of all) {
    if (e.status === 'completed' || e.status === 'amended') {
      completed++;
      totalFees += e.feeCharged;
    } else {
      draft++;
    }
    if (e.createdAt >= thisMonthStart) thisMonth++;
  }
  return { total: all.length, completed, draft, thisMonth, totalFees };
}

// ── Tamper-evident hash chain ─────────────────────────────────────────────

/**
 * Hash the full content of an entry. We exclude only:
 *   - `id` (IDB autoincrement, not user data)
 *   - `hash` (this would recurse)
 *   - `updatedAt` (changes on every harmless re-save / amendment)
 * Every other persisted field is signed, so any tampering with the IDB
 * record (notes, addresses, images, location, amendments, …) breaks
 * verification.
 */
export async function generateEntryHash(entry: JournalEntry): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, hash, updatedAt, ...signed } = entry;
  return sha256Hex(canonicalJson({
    ...signed,
    previousEntryHash: entry.previousEntryHash ?? '',
  }));
}

/**
 * Mark a draft as completed and stamp it with a chain hash linking to the
 * previous completed entry. Idempotent: re-completing recomputes the chain.
 */
export async function completeEntry(id: number): Promise<JournalEntry> {
  const entry = await getEntry(id);
  if (!entry) throw new Error('Entry not found');
  const all = await getAllEntries();
  const prior = all
    .filter(e => e.entryNumber < entry.entryNumber && e.hash)
    .sort((a, b) => b.entryNumber - a.entryNumber)[0];
  const previousEntryHash = prior?.hash ?? '';
  const completedAt = entry.completedAt ?? new Date().toISOString();
  const draft: JournalEntry = { ...entry, status: 'completed', completedAt, previousEntryHash };
  const hash = await generateEntryHash(draft);
  await updateEntry(id, { status: 'completed', completedAt, previousEntryHash, hash });
  return { ...draft, hash };
}

export interface ChainVerificationIssue {
  entryNumber: number;
  reason: string;
}

export interface ChainVerificationResult {
  totalChecked: number;
  okCount: number;
  issues: ChainVerificationIssue[];
}

export async function verifyChain(): Promise<ChainVerificationResult> {
  const all = (await getAllEntries())
    .filter(e => e.status === 'completed' || e.status === 'amended')
    .sort((a, b) => a.entryNumber - b.entryNumber);

  let prevHash = '';
  let ok = 0;
  const issues: ChainVerificationIssue[] = [];

  for (const entry of all) {
    if (!entry.hash) {
      issues.push({ entryNumber: entry.entryNumber, reason: 'Missing integrity hash' });
      prevHash = '';
      continue;
    }
    const computed = await generateEntryHash(entry);
    if (computed !== entry.hash) {
      issues.push({ entryNumber: entry.entryNumber, reason: 'Entry data has been modified since signing' });
    } else if ((entry.previousEntryHash ?? '') !== prevHash) {
      issues.push({ entryNumber: entry.entryNumber, reason: 'Chain link does not match previous entry' });
    } else {
      ok++;
    }
    prevHash = entry.hash;
  }
  return { totalChecked: all.length, okCount: ok, issues };
}

// ── Migration: legacy plaintext IDB → encrypted-at-rest format ─────────────

export interface LegacySnapshot {
  hadPinHash: string | null;
  darkMode: boolean;
  entryCount: number;
}

/**
 * Compare a candidate PIN against the legacy plaintext-mode pinHash.
 * Used during one-time migration so existing PIN protection is not bypassed.
 */
export async function verifyLegacyPin(pin: string, legacyPinHash: string): Promise<boolean> {
  const candidate = await sha256Hex(pin);
  return candidate === legacyPinHash;
}

/**
 * Inspect IDB before unlocking, used to drive the first-launch UI.
 * Reads only top-level cleartext fields — never touches encrypted blobs.
 */
export async function inspectLegacy(): Promise<LegacySnapshot> {
  const db = await getDB();
  const settings = await db.get('settings', 1);
  const entries = await db.getAll('entries');
  const hasPlainSettings = settings && !(settings as StoredSettings)._enc;
  return {
    hadPinHash: hasPlainSettings ? ((settings as NotarySettings).pinHash ?? null) : null,
    darkMode: hasPlainSettings ? !!(settings as NotarySettings).darkMode : false,
    entryCount: entries.length,
  };
}

export async function needsMigration(): Promise<boolean> {
  const db = await getDB();
  const entries = await db.getAll('entries');
  if (entries.some(e => !(e as StoredEntry)._enc)) return true;
  const settings = await db.get('settings', 1);
  if (settings && !(settings as StoredSettings)._enc) return true;
  return false;
}

/**
 * Encrypt-in-place any legacy plaintext entries and settings. While doing so,
 * rebuild the hash chain across completed entries (sorted by entryNumber).
 * Must be called after `setupCrypto` or `unlock`.
 */
export async function migratePlaintext(
  onProgress?: (done: number, total: number) => void,
): Promise<{ migratedEntries: number; migratedSettings: boolean }> {
  if (!cryptoKey) throw new Error('Database is locked; unlock before migrating');
  const db = await getDB();
  const allRaw = await db.getAll('entries');
  const settingsRaw = await db.get('settings', 1);

  const plaintextEntries = allRaw.filter(e => !(e as StoredEntry)._enc) as JournalEntry[];
  const hasPlainSettings = !!(settingsRaw && !(settingsRaw as StoredSettings)._enc);
  const total = plaintextEntries.length + (hasPlainSettings ? 1 : 0);
  let done = 0;
  onProgress?.(done, total);

  // Rebuild the chain in entryNumber order
  plaintextEntries.sort((a, b) => a.entryNumber - b.entryNumber);
  let prevHash = '';
  for (const entry of plaintextEntries) {
    if (entry.status === 'completed' || entry.status === 'amended') {
      entry.previousEntryHash = prevHash;
      entry.hash = await generateEntryHash(entry);
      prevHash = entry.hash;
    }
    await db.put('entries', await encryptEntry(entry));
    done++;
    onProgress?.(done, total);
  }

  if (hasPlainSettings) {
    const s = settingsRaw as NotarySettings;
    setDarkModePref(!!s.darkMode);
    s.pinEnabled = true;
    delete s.pinHash; // legacy plaintext PIN hash no longer used
    await db.put('settings', await encryptSettings(s));
    done++;
    onProgress?.(done, total);
  }

  return { migratedEntries: plaintextEntries.length, migratedSettings: hasPlainSettings };
}
