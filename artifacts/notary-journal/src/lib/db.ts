import { openDB, deleteDB, IDBPDatabase } from 'idb';
import {
  bytesToBase64,
  base64ToBytes,
  canonicalJson,
  decryptJSON,
  deriveKey,
  deriveKeyMaterial,
  encryptJSON,
  generateSalt,
  importAesKey,
  sha256Hex,
  DEFAULT_ITERATIONS,
  type EncBlob,
} from './crypto';
import {
  buildDraftEntriesFromSession,
  validateSigningSessionPayload,
  type SigningSessionPayload,
} from './signing-session';
import {
  expandAppointmentToEntries,
  validateSigningAppointmentPayload,
  sanitizePayloadForDraft,
  type SigningAppointmentPayload,
} from './signing-appointment';

export interface JournalEntry {
  id?: number;
  entryNumber: number;
  status: 'draft' | 'completed' | 'amended';

  // Signer info
  signerFullName: string;
  signerAddress: string;
  signerCity: string;
  signerState: string;
  // DOB / ID number / expiration are conditionally required based on the
  // notary's state-compliance settings (`recordSignerDOB`, `recordSignerIdNumber`).
  // Persisted as optional so jurisdictions that don't require them don't
  // store a blank string in the encrypted blob.
  signerDOB?: string; // YYYY-MM-DD
  signerPhone?: string;

  // ID info
  idType: 'driver_license' | 'passport' | 'state_id' | 'military_id' | 'other';
  idNumber?: string;
  idIssuingState?: string;
  idExpirationDate?: string; // YYYY-MM-DD

  // Document info
  documentType: string;
  documentDate?: string;
  documentDescription?: string;

  // Notarial act
  notarialActType: 'acknowledgment' | 'jurat' | 'copy_certification' | 'signature_witnessing' | 'other';
  feeCharged: number; // in cents
  feeWaived: boolean;
  // Itemized fee category (Acknowledgment, Jurat, Oath, Copy Certification,
  // Signature Witnessing, Travel, Other). Optional for backward compatibility
  // with older entries and backups that predate the field — when missing,
  // callers should resolve a default via `resolveFeeType` (see lib/fees.ts)
  // rather than back-filling on disk (which would invalidate the entry's
  // signed hash).
  feeType?: string;
  /** Number of notarial acts (stamps) charged on this entry. Optional for legacy rows. */
  stampCount?: number;
  locationCity: string;
  locationState: string;
  locationAddress?: string;

  // Images and signatures (base64 or blob URLs)
  signatureImage?: string;
  idFrontImage?: string;
  idBackImage?: string;

  // Extraction metadata
  extractedRawText?: string;
  extractionMethod?: 'barcode' | 'ocr' | 'mrz' | 'manual';
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

  /** Optional signing-session metadata (v1: not included in hash). */
  signingGroupId?: string;
  signingGroupLabel?: string;
  actIndexInGroup?: number;
  actCountInGroup?: number;

  /** Multi-signer appointment metadata (v1: not included in hash). */
  appointmentId?: string;
  appointmentLabel?: string;
  signerSlotId?: string;
  signerIndexInAppointment?: number;
  documentSlotId?: string;
  coSignerNames?: string[];
  /** Full details for signers #2+ on a combined PA-style journal line. */
  additionalSigners?: import('./entry-signers').AdditionalSignerRecord[];
  feeAllocation?: 'primary' | 'split' | 'waived';
  certificateStyle?: 'shared' | 'individual';
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
  /** Backup frequency: 'off' | 'after-entry' (current auto-backup) | 'daily' */
  backupFrequency?: string;
  googleEmail?: string;
  // Per-fee-type default amounts in cents, e.g. { Acknowledgment: 1000 }.
  // Used by the new-entry wizard to auto-fill the fee. Stored encrypted.
  defaultFees?: Record<string, number>;
  // Notary's official seal as a data URL (PNG). Embedded into PDF exports.
  // Caller is expected to keep this ≤ ~200 KB to avoid bloating backups.
  // Stored encrypted along with the rest of settings.
  sealImage?: string;
  // Backup-staleness nudge configuration.
  // `backupReminderDays` is the threshold (in days) past which the dashboard
  // shows a yellow "back up now?" banner. Default is 7 when unset.
  // `manualBackupOnly` opts out of the nudge entirely (the user has accepted
  // responsibility for backing up via JSON export).
  backupReminderDays?: number;
  manualBackupOnly?: boolean;
  // Settings-page visibility for optional backup connectors. These are safe to
  // include in backups; connector secrets and tokens stay in browser storage.
  showGoogleBackup?: boolean;
  showZoBackup?: boolean;
  // Client Intake Form — Web3Forms integration (all hosts) or Zo token (Zo Computer only)
  web3formsKey?: string;
  /** Zo Computer per-notary intake token (SQLite multi-user intake on Zo deploy). */
  zoComputerToken?: string;
  // State-compliance toggles. Default to `true` (record everything) when
  // unset so existing installs see no behavior change. When set to `false`,
  // the corresponding fields are hidden in the new-entry / edit-entry forms,
  // omitted from validation, and skipped in PDF/CSV exports.
  recordSignerDOB?: boolean;
  recordSignerIdNumber?: boolean;
  /** Per-stamp notarial fee in cents (e.g. 500 = $5.00). Used when auto-filling fees. */
  stampFeeCents?: number;
  /** Optional per-state stamp fee overrides (2-letter state → cents). */
  stampFeeByState?: Record<string, number>;
  /** When true, require a front-of-ID photo before completing an entry (after barcode scan too). */
  requireIdFrontPhoto?: boolean;
  /** When false, the signer signature step is skipped and not required for completion. */
  requireSignerSignature?: boolean;
  /**
   * Shared-certificate journal layout: PA-style one line with all signers vs separate lines.
   * When unset, PA defaults to combined_line; other states default to separate_lines.
   */
  journalSharedCertMode?: 'combined_line' | 'separate_lines';
  /**
   * When true (default), comma-separated document types in the new-entry wizard split into
   * one journal line per document. When false, all documents stay on a single line.
   */
  journalSplitDocumentsDefault?: boolean;
}

// ── Storage shapes (encrypted records actually written to IDB) ─────────────

interface StoredEntry {
  id?: number;
  entryNumber: number; // cleartext index only — non-sensitive sequence number
  _enc: EncBlob;       // encrypts every other field including status/createdAt
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
const DB_VERSION = 3;
const DARK_MODE_LS_KEY = 'notary_dark_mode';
const CANARY_PLAINTEXT = 'notary-journal-canary-v1';
const FORMAT_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;
let cryptoKey: CryptoKey | null = null;

// ── Session key cache (survives tab refresh / Vite HMR) ────────────────────
//
// The PIN-derived AES key normally lives only in module-scope memory, so any
// page reload — a tab refresh, a Vite HMR full reload, a service-worker
// update — drops it and forces the user back to the PIN screen, even mid-form.
// To keep the journal usable across reloads without weakening the encryption
// we stash the *raw key material* in sessionStorage gated by an idle timeout.
//
// Why this is acceptable:
//   * sessionStorage is scoped to the tab — closing the tab clears it.
//   * It's not shared with other origins or other tabs of the same origin.
//   * Any code already running in this origin can call requireKey() / read
//     the in-memory key anyway, so writing the same bytes to sessionStorage
//     does not expand the trust boundary against script-injection attacks.
//   * We bound exposure with a sliding idle timeout — if the user walks
//     away, the cached key expires and they must PIN-unlock again.
//
// We deliberately use sessionStorage (not localStorage) so the cached key
// never persists across browser restarts.
const KEY_CACHE_STORAGE_KEY = 'notary-journal:keyCache';
const KEY_CACHE_IDLE_MS = 30 * 60 * 1000; // 30 minutes of inactivity

interface CachedKeyRecord {
  material: string; // base64-encoded 32 bytes
  expiresAt: number; // ms epoch
}

function cacheKeyMaterial(material: Uint8Array): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const record: CachedKeyRecord = {
      material: bytesToBase64(material),
      expiresAt: Date.now() + KEY_CACHE_IDLE_MS,
    };
    sessionStorage.setItem(KEY_CACHE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // sessionStorage may be unavailable (private mode, quota) — degrade
    // silently to "must re-unlock after refresh".
  }
}

function clearKeyCache(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(KEY_CACHE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readCachedKeyMaterial(): Uint8Array | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as CachedKeyRecord;
    if (!record?.material || typeof record.expiresAt !== 'number') {
      clearKeyCache();
      return null;
    }
    if (Date.now() > record.expiresAt) {
      clearKeyCache();
      return null;
    }
    return base64ToBytes(record.material);
  } catch {
    clearKeyCache();
    return null;
  }
}

function touchKeyCacheExpiry(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(KEY_CACHE_STORAGE_KEY);
    if (!raw) return;
    const record = JSON.parse(raw) as CachedKeyRecord;
    if (!record?.material) return;
    record.expiresAt = Date.now() + KEY_CACHE_IDLE_MS;
    sessionStorage.setItem(KEY_CACHE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore — touch is best-effort
  }
}

/**
 * Attempt to restore the in-memory crypto key from a previously cached copy
 * in sessionStorage. Verifies the cached material against the canary so a
 * stale entry (e.g. after a PIN change in another tab) is rejected rather
 * than silently used. Returns true iff the journal is now unlocked.
 */
export async function tryRestoreFromSessionCache(): Promise<boolean> {
  if (cryptoKey) return true;
  const material = readCachedKeyMaterial();
  if (!material) return false;
  try {
    const ok = await unlockWithKeyMaterial(material);
    if (!ok) {
      clearKeyCache();
      return false;
    }
    // unlockWithKeyMaterial already installed cryptoKey but did not refresh
    // the cache record; bump the idle window so an active reload counts
    // as activity.
    touchKeyCacheExpiry();
    return true;
  } catch {
    clearKeyCache();
    return false;
  }
}

/**
 * IndexedDB schema:
 *   - `entries`: { id (auto), entryNumber (UNIQUE INDEX, cleartext), _enc, iv }
 *     Only `entryNumber` is cleartext on disk — it is a non-sensitive sequence
 *     number used as the lookup index. ALL other entry fields (signer, ID,
 *     document, location, notes, status, dates, hashes, amendments, photos)
 *     live inside the AES-GCM-encrypted `_enc` blob with a per-record IV.
 *   - `settings`: encrypted blob keyed by id=1.
 *   - `meta`: PBKDF2 salt + canary used to verify the unlock PIN.
 */
export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains('entries')) {
          const entryStore = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
          entryStore.createIndex('entryNumber', 'entryNumber', { unique: true });
        } else {
          // v2 had plaintext indexes on status and createdAt; drop them so no
          // sensitive metadata leaks into IDB. entryNumber stays as the only
          // cleartext index (it's just a sequence number).
          const entryStore = tx.objectStore('entries');
          // Drop every legacy plaintext index. `entryNumber` (a sequence
          // number) is the only cleartext index that should remain.
          for (const name of Array.from(entryStore.indexNames)) {
            if (name !== 'entryNumber') entryStore.deleteIndex(name);
          }
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
  clearKeyCache();
}

/**
 * Wipe all journal data on this device — entries, settings, encryption metadata,
 * the open IDB connection, and any auth/cache helpers in localStorage /
 * sessionStorage. Returns the app to a fresh "first run" state. Irreversible.
 *
 * Caller is responsible for navigating / reloading after this resolves.
 */
export async function wipeAllLocalData(): Promise<void> {
  // 1. Drop the in-memory key + sessionStorage cache so nothing tries to
  //    re-encrypt against a key whose meta we're about to delete.
  cryptoKey = null;
  clearKeyCache();

  // 2. Close the existing connection before deleting the DB; otherwise
  //    deleteDB blocks indefinitely waiting for "versionchange".
  try {
    const db = await getDB();
    db.close();
  } catch {
    // Ignore: a fresh install may not have an open DB yet.
  }
  dbPromise = null;

  // 3. Delete the IndexedDB database itself.
  await deleteDB(DB_NAME);

  // 4. Clear any localStorage keys this app owns. Keep the list narrow so
  //    we don't nuke unrelated origin storage.
  if (typeof localStorage !== 'undefined') {
    for (const key of [
      'notary-journal:darkMode',
      'notary-journal:lastBackupTime',
      'notary-journal:backupSnoozedUntil',
      'notary-journal:biometricCredId',
      'notary-journal:newEntryDraft', // in case sessionStorage was unavailable
    ]) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    try { sessionStorage.clear(); } catch { /* ignore */ }
  }
}

export function _setKeyForTests(key: CryptoKey | null): void {
  cryptoKey = key;
  if (!key) clearKeyCache();
}

function requireKey(): CryptoKey {
  if (!cryptoKey) throw new Error('Database is locked. Unlock with PIN before reading or writing.');
  // Every successful key use is "activity" — slide the idle-expiry window
  // forward so the cached key persists as long as the user is working.
  touchKeyCacheExpiry();
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
  // Derive raw material so we can both install the in-memory key AND cache
  // the bytes in sessionStorage for refresh-survival.
  const material = await deriveKeyMaterial(pin, salt, DEFAULT_ITERATIONS);
  const key = await importAesKey(material);
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
  cacheKeyMaterial(material);
}

/** Returns true on success, false on wrong PIN. Throws on missing setup or hardware errors. */
export async function unlock(pin: string): Promise<boolean> {
  const meta = await getCryptoMeta();
  if (!meta) throw new Error('Encryption is not set up on this device');
  const salt = base64ToBytes(meta.salt);
  // Derive raw material first so a successful PIN can be cached for refresh
  // survival; importAesKey gives us the same non-extractable AES-GCM key
  // the rest of the code path expects.
  const material = await deriveKeyMaterial(pin, salt, meta.iterations);
  const key = await importAesKey(material);
  try {
    const value = await decryptJSON<string>(key, meta.canary);
    if (value !== CANARY_PLAINTEXT) return false;
    cryptoKey = key;
    cacheKeyMaterial(material);
    return true;
  } catch {
    return false;
  }
}

/**
 * Non-mutating PIN check. Used when the journal is already unlocked but we
 * need to confirm the user knows their current PIN (for example, before
 * enrolling biometric unlock). Does NOT swap the in-memory crypto key.
 */
export async function verifyPin(pin: string): Promise<boolean> {
  const meta = await getCryptoMeta();
  if (!meta) return false;
  const salt = base64ToBytes(meta.salt);
  const candidate = await deriveKey(pin, salt, meta.iterations);
  try {
    const value = await decryptJSON<string>(candidate, meta.canary);
    return value === CANARY_PLAINTEXT;
  } catch {
    return false;
  }
}

/**
 * Derive the journal encryption key MATERIAL (raw 32 bytes) for the given
 * PIN. Caller is expected to immediately wrap these bytes with another key
 * (e.g. one derived from a WebAuthn PRF output) and discard the cleartext
 * copy. Returns null if the PIN does not match the canary, which keeps this
 * helper safe to call before re-confirming a PIN.
 */
export async function deriveJournalKeyMaterial(pin: string): Promise<Uint8Array | null> {
  const meta = await getCryptoMeta();
  if (!meta) return null;
  const salt = base64ToBytes(meta.salt);
  // Verify against canary first so we never hand out key material for a
  // wrong PIN (which would invisibly poison biometric enrollment).
  const verifyKey = await deriveKey(pin, salt, meta.iterations);
  try {
    const value = await decryptJSON<string>(verifyKey, meta.canary);
    if (value !== CANARY_PLAINTEXT) return null;
  } catch {
    return null;
  }
  return deriveKeyMaterial(pin, salt, meta.iterations);
}

/**
 * Unlock using raw key material (32 bytes) instead of a PIN. Used by the
 * biometric path: the wrapped key is unwrapped via PRF, imported as an
 * AES-GCM key, and verified against the canary before being installed as
 * the in-memory journal key.
 *
 * Returns true on success, false if the material is the wrong key (e.g.
 * stale wrapped key after a PIN change). Throws on missing setup.
 */
export async function unlockWithKeyMaterial(material: Uint8Array): Promise<boolean> {
  const meta = await getCryptoMeta();
  if (!meta) throw new Error('Encryption is not set up on this device');
  let candidate: CryptoKey;
  try {
    candidate = await importAesKey(material);
  } catch {
    return false;
  }
  try {
    const value = await decryptJSON<string>(candidate, meta.canary);
    if (value !== CANARY_PLAINTEXT) return false;
    cryptoKey = candidate;
    cacheKeyMaterial(material);
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
  const newMaterial = await deriveKeyMaterial(newPin, newSalt, DEFAULT_ITERATIONS);
  const newKey = await importAesKey(newMaterial);

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

  // Commit succeeded — refresh the session cache to the new key material so
  // a refresh after a PIN change doesn't accidentally restore the old key.
  cacheKeyMaterial(newMaterial);

  return true;
}

// ── Entry / settings encryption helpers ────────────────────────────────────

async function encryptEntry(entry: JournalEntry): Promise<StoredEntry> {
  const key = requireKey();
  // Only entryNumber stays cleartext (it is a non-sensitive sequence number used
  // as the primary IDB index). status, createdAt, signer info, etc. all live
  // inside the encrypted blob.
  const { id, entryNumber, ...rest } = entry;
  const _enc = await encryptJSON(key, rest);
  // IMPORTANT: omit `id` when undefined. The entries store uses
  // { keyPath: 'id', autoIncrement: true }, and an explicit `id: undefined`
  // makes IDB throw "Evaluating the object store's key path yielded a value
  // that is not a valid key." Auto-increment only fires when the property
  // is absent, not when it is present-but-undefined.
  return id === undefined ? { entryNumber, _enc } : { id, entryNumber, _enc };
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
  recordSignerDOB: true,
  recordSignerIdNumber: true,
  requireSignerSignature: true,
};

/**
 * Resolve the compliance toggles: an undefined value means "this setting
 * predates the toggle and should default ON" (preserving prior behavior for
 * existing users). Centralized so callers don't accidentally treat undefined
 * as `false` and silently drop required fields.
 */
export function shouldRecordSignerDOB(s?: Pick<NotarySettings, 'recordSignerDOB'> | null): boolean {
  return s?.recordSignerDOB !== false;
}
export function shouldRecordSignerIdNumber(s?: Pick<NotarySettings, 'recordSignerIdNumber'> | null): boolean {
  return s?.recordSignerIdNumber !== false;
}
export function shouldRequireSignature(s?: Pick<NotarySettings, 'requireSignerSignature'> | null): boolean {
  return s?.requireSignerSignature !== false;
}

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
  const all = await db.getAll('entries');
  const decrypted = await Promise.all(all.map(s => decryptStoredEntry(s)));
  // Sort newest-first by createdAt for stable journal-list order. createdAt is
  // inside the encrypted blob, so this sort necessarily happens after decrypt.
  return decrypted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function searchEntries(query: string): Promise<JournalEntry[]> {
  const all = await getAllEntries();
  const lower = query.toLowerCase();
  return all.filter(e =>
    e.signerFullName.toLowerCase().includes(lower)
    || e.entryNumber.toString().includes(lower)
    || (e.appointmentLabel?.toLowerCase().includes(lower) ?? false)
    || (e.signingGroupLabel?.toLowerCase().includes(lower) ?? false)
    || (e.documentType?.toLowerCase().includes(lower) ?? false),
  );
}

export async function getRecentEntries(limit: number): Promise<JournalEntry[]> {
  const all = await getAllEntries();
  return all.slice(0, limit);
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
 *
 * For legacy v1 backups that lack hash/previousEntryHash, callers should
 * invoke `recomputeChainFrom(1)` AFTER bulk-importing into an empty journal
 * (and only into an empty journal — restamping a non-empty journal could
 * mask tampering on the user's existing entries).
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
  'notarialActType', 'feeCharged', 'feeWaived', 'feeType',
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
  let totalFees = 0, completed = 0, draft = 0, thisMonth = 0, needsIdScan = 0;
  for (const e of all) {
    if (e.status === 'completed' || e.status === 'amended') {
      completed++;
      totalFees += e.feeCharged;
    } else {
      draft++;
      if (!e.idFrontImage) needsIdScan++;
    }
    if (e.createdAt >= thisMonthStart) thisMonth++;
  }
  return { total: all.length, completed, draft, thisMonth, totalFees, needsIdScan };
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
  const {
    id,
    hash,
    updatedAt,
    signingGroupId,
    signingGroupLabel,
    actIndexInGroup,
    actCountInGroup,
    appointmentId,
    appointmentLabel,
    signerSlotId,
    signerIndexInAppointment,
    documentSlotId,
    coSignerNames,
    feeAllocation,
    certificateStyle,
    ...signed
  } = entry;
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

/**
 * Create and complete one journal entry per act in a signing session.
 * Shared signer/ID/signature are copied to each row; documents/fees differ per act.
 */
export async function createAndCompleteSigningSession(
  payload: SigningSessionPayload,
): Promise<number[]> {
  const errors = validateSigningSessionPayload(payload);
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
  const drafts = buildDraftEntriesFromSession(payload);
  const ids: number[] = [];
  for (const draft of drafts) {
    const id = await createEntry(draft);
    await completeEntry(id);
    ids.push(id);
  }
  return ids;
}

/** All entries belonging to a signing group, sorted by act index then entry number. */
export async function getEntriesBySigningGroup(groupId: string): Promise<JournalEntry[]> {
  const all = await getAllEntries();
  return all
    .filter(e => e.signingGroupId === groupId || e.appointmentId === groupId)
    .sort((a, b) => {
      const ai = a.actIndexInGroup ?? a.entryNumber;
      const bi = b.actIndexInGroup ?? b.entryNumber;
      return ai - bi || a.entryNumber - b.entryNumber;
    });
}

/** Alias for appointment-scoped queries (appointmentId === signingGroupId). */
export async function getEntriesByAppointmentId(appointmentId: string): Promise<JournalEntry[]> {
  return getEntriesBySigningGroup(appointmentId);
}

/**
 * Create and complete journal entries for an appointment matrix.
 * PA shared cert: one line with all signers; OK/default: separate lines per signer.
 */
export async function createAndCompleteSigningAppointment(
  payload: SigningAppointmentPayload,
  settings?: NotarySettings,
): Promise<number[]> {
  const errors = validateSigningAppointmentPayload(payload);
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
  const expanded = expandAppointmentToEntries(payload, settings ?? null);
  const ids: number[] = [];
  for (const { draft } of expanded) {
    const id = await createEntry(draft);
    await completeEntry(id);
    ids.push(id);
  }
  return ids;
}

/** Save appointment matrix as draft journal rows (planning ahead — not completed). */
export async function createDraftSigningAppointment(
  payload: SigningAppointmentPayload,
  settings?: NotarySettings,
): Promise<number[]> {
  const sanitized = sanitizePayloadForDraft(payload);
  const existing = await getEntriesByAppointmentId(payload.appointmentId);
  for (const entry of existing) {
    if (entry.status === 'draft' && entry.id != null) {
      await deleteEntry(entry.id);
    }
  }
  const expanded = expandAppointmentToEntries(sanitized, settings ?? null);
  const ids: number[] = [];
  for (const { draft } of expanded) {
    const id = await createEntry({ ...draft, status: 'draft' });
    ids.push(id);
  }
  return ids;
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

/**
 * Pure verification helper. Exported so it can be unit-tested without IDB.
 * Critical: the chain link for entry N is checked against the *recomputed*
 * hash of entry N-1, not its stored hash. That way, tampering with any older
 * entry's content propagates as a chain break for every later entry, even if
 * an attacker leaves the older entry's stored `hash` field untouched.
 */
export async function verifyChainPure(rawEntries: JournalEntry[]): Promise<ChainVerificationResult> {
  const all = rawEntries
    .filter(e => e.status === 'completed' || e.status === 'amended')
    .sort((a, b) => a.entryNumber - b.entryNumber);

  let prevExpectedHash = '';
  let chainBroken = false; // once true, every later entry is reported broken too
  let ok = 0;
  const issues: ChainVerificationIssue[] = [];

  for (const entry of all) {
    if (!entry.hash) {
      issues.push({ entryNumber: entry.entryNumber, reason: 'Missing integrity hash' });
      chainBroken = true;
      prevExpectedHash = '';
      continue;
    }
    const computed = await generateEntryHash(entry);
    const stampedMatches = computed === entry.hash;
    const linkMatches = (entry.previousEntryHash ?? '') === prevExpectedHash;
    if (chainBroken) {
      issues.push({ entryNumber: entry.entryNumber, reason: 'Chain integrity broken upstream' });
    } else if (!stampedMatches) {
      issues.push({ entryNumber: entry.entryNumber, reason: 'Entry data has been modified since signing' });
      chainBroken = true;
    } else if (!linkMatches) {
      issues.push({ entryNumber: entry.entryNumber, reason: 'Chain link does not match previous entry' });
      chainBroken = true;
    } else {
      ok++;
    }
    // Always advance using the *recomputed* hash, so downstream entries
    // notice when an upstream entry's content changed even if their own
    // stored hash is internally consistent.
    prevExpectedHash = computed;
  }
  return { totalChecked: all.length, okCount: ok, issues };
}

export async function verifyChain(): Promise<ChainVerificationResult> {
  return verifyChainPure(await getAllEntries());
}

/**
 * Recompute the chain forward starting at `fromEntryNumber` (inclusive).
 * Used after a legitimate amendment so the journal stays internally
 * consistent: each later entry's previousEntryHash is restamped to the
 * freshly recomputed hash of the entry before it, and its own hash is
 * recomputed.
 */
export async function recomputeChainFrom(fromEntryNumber: number): Promise<void> {
  const all = (await getAllEntries())
    .filter(e => e.status === 'completed' || e.status === 'amended')
    .sort((a, b) => a.entryNumber - b.entryNumber);
  const startIdx = all.findIndex(e => e.entryNumber >= fromEntryNumber);
  if (startIdx === -1) return;
  let prevHash = '';
  if (startIdx > 0) {
    const prev = all[startIdx - 1];
    prevHash = await generateEntryHash({ ...prev, previousEntryHash: prev.previousEntryHash ?? '' });
  }
  const db = await getDB();
  for (let i = startIdx; i < all.length; i++) {
    const e = all[i];
    e.previousEntryHash = prevHash;
    e.hash = await generateEntryHash(e);
    if (typeof e.id !== 'number') continue;
    await db.put('entries', await encryptEntry(e));
    prevHash = e.hash;
  }
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

/**
 * Pure helper used by `migratePlaintext` (and tested directly): given the set
 * of already-encrypted-then-decrypted entries plus the remaining plaintext
 * entries, fill in `previousEntryHash` and `hash` on each completed/amended
 * plaintext entry so the resulting chain links cleanly off the most recent
 * already-migrated entry. Mutates `plaintext` in place. `plaintext` must
 * already be sorted by `entryNumber`.
 */
export async function rebuildChainForResume(
  encrypted: JournalEntry[],
  plaintext: JournalEntry[],
): Promise<void> {
  const minPlainEntryNumber = plaintext.length
    ? plaintext[0].entryNumber
    : Number.POSITIVE_INFINITY;
  let prevHash = '';
  const upstream = encrypted
    .filter(e => (e.status === 'completed' || e.status === 'amended') && e.entryNumber < minPlainEntryNumber)
    .sort((a, b) => a.entryNumber - b.entryNumber);
  if (upstream.length > 0) {
    prevHash = await generateEntryHash(upstream[upstream.length - 1]);
  }
  for (const entry of plaintext) {
    if (entry.status === 'completed' || entry.status === 'amended') {
      entry.previousEntryHash = prevHash;
      entry.hash = await generateEntryHash(entry);
      prevHash = entry.hash;
    }
  }
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

  // Decrypt any already-migrated entries so we can seed `prevHash` from the
  // last encrypted completed entry whose `entryNumber` is below the lowest
  // remaining plaintext entry. Without this, resuming a partially-finished
  // migration would stamp the next plaintext entry as a new genesis and
  // permanently break the chain.
  const encryptedRaw = allRaw.filter(e => (e as StoredEntry)._enc) as StoredEntry[];
  const encrypted: JournalEntry[] = [];
  for (const r of encryptedRaw) {
    encrypted.push(await decryptStoredEntry(r));
  }

  plaintextEntries.sort((a, b) => a.entryNumber - b.entryNumber);
  await rebuildChainForResume(encrypted, plaintextEntries);

  for (const entry of plaintextEntries) {
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
