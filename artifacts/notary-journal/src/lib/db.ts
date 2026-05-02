import { openDB, IDBPDatabase } from 'idb';

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
  createdAt: string; // ISO
  updatedAt: string; // ISO
  completedAt?: string;
  
  // Amendments
  amendments?: Array<{ note: string; date: string; }>;
  
  // Edit history
  editHistory?: Array<{ field: string; oldValue: string; newValue: string; date: string; }>;
  
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
  pinHash?: string;
  darkMode: boolean;
  autoBackup?: boolean;
  googleEmail?: string;
}

const DB_NAME = 'notary_journal_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('entries')) {
          const entryStore = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
          entryStore.createIndex('entryNumber', 'entryNumber', { unique: true });
          entryStore.createIndex('status', 'status', { unique: false });
          entryStore.createIndex('signerFullName', 'signerFullName', { unique: false });
          entryStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function getSettings(): Promise<NotarySettings> {
  const db = await getDB();
  const settings = await db.get('settings', 1);
  if (!settings) {
    const defaultSettings: NotarySettings = {
      id: 1,
      notaryName: '',
      commissionNumber: '',
      commissionExpiration: '',
      defaultCity: '',
      defaultState: '',
      pinEnabled: false,
      darkMode: false,
    };
    await db.put('settings', defaultSettings);
    return defaultSettings;
  }
  return settings;
}

export async function saveSettings(settings: NotarySettings): Promise<void> {
  const db = await getDB();
  settings.id = 1;
  await db.put('settings', settings);
}

export async function getEntry(id: number): Promise<JournalEntry | undefined> {
  const db = await getDB();
  return db.get('entries', id);
}

export async function getAllEntries(): Promise<JournalEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex('entries', 'createdAt');
}

export async function searchEntries(query: string): Promise<JournalEntry[]> {
  const db = await getDB();
  const entries = await db.getAll('entries');
  const lowerQuery = query.toLowerCase();
  
  return entries.filter(e => 
    e.signerFullName.toLowerCase().includes(lowerQuery) ||
    e.entryNumber.toString().includes(lowerQuery)
  ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getRecentEntries(limit: number): Promise<JournalEntry[]> {
  const db = await getDB();
  const tx = db.transaction('entries', 'readonly');
  const store = tx.objectStore('entries');
  const index = store.index('createdAt');
  
  const entries: JournalEntry[] = [];
  let cursor = await index.openCursor(null, 'prev');
  
  while (cursor && entries.length < limit) {
    entries.push(cursor.value);
    cursor = await cursor.continue();
  }
  
  return entries;
}

export async function createEntry(entry: Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'>): Promise<number> {
  const db = await getDB();
  
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  
  // Get next entry number
  let nextNumber = 1;
  const numIndex = store.index('entryNumber');
  const lastEntryCursor = await numIndex.openCursor(null, 'prev');
  if (lastEntryCursor) {
    nextNumber = lastEntryCursor.value.entryNumber + 1;
  }
  
  const now = new Date().toISOString();
  const newEntry: JournalEntry = {
    ...entry,
    entryNumber: nextNumber,
    createdAt: now,
    updatedAt: now,
  };
  
  const id = await store.add(newEntry);
  await tx.done;
  return id as number;
}

/**
 * Import a journal entry from a backup, preserving its original entryNumber.
 * Throws if an entry with the same entryNumber already exists.
 */
export async function importEntry(entry: Omit<JournalEntry, 'id'>): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');

  // Check for duplicate entryNumber
  const existing = await store.index('entryNumber').get(entry.entryNumber);
  if (existing) {
    await tx.done;
    throw Object.assign(new Error(`Entry number ${entry.entryNumber} already exists`), { code: 'DUPLICATE' });
  }

  const id = await store.add({ ...entry });
  await tx.done;
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
  const db = await getDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  
  const existing = await store.get(id);
  if (!existing) throw new Error(`Entry ${id} not found`);

  if (existing.status === 'completed' || existing.status === 'amended') {
    const blockedFields = IMMUTABLE_FIELDS.filter(f => f in updates);
    if (blockedFields.length > 0) {
      await tx.done;
      throw new Error(
        `Cannot modify completed/amended entry fields: ${blockedFields.join(', ')}. Use an amendment note instead.`
      );
    }
  }
  
  const updatedEntry = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await store.put(updatedEntry);
  await tx.done;
}

export async function deleteEntry(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('entries', id);
}

export async function getStats() {
  const db = await getDB();
  const entries = await db.getAll('entries');
  
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  
  let totalFees = 0;
  let completed = 0;
  let draft = 0;
  let thisMonth = 0;
  
  for (const entry of entries) {
    if (entry.status === 'completed' || entry.status === 'amended') {
      completed++;
      totalFees += entry.feeCharged;
    } else {
      draft++;
    }
    
    if (entry.createdAt >= thisMonthStart) {
      thisMonth++;
    }
  }
  
  return {
    total: entries.length,
    completed,
    draft,
    thisMonth,
    totalFees
  };
}

export async function generateEntryHash(entry: JournalEntry): Promise<string> {
  const data = JSON.stringify({
    entryNumber: entry.entryNumber,
    signerFullName: entry.signerFullName,
    signerDOB: entry.signerDOB,
    idNumber: entry.idNumber,
    documentType: entry.documentType,
    notarialActType: entry.notarialActType,
    feeCharged: entry.feeCharged,
    completedAt: entry.completedAt,
  });
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
