/**
 * IndexedDB kayıt/yükleme (idb). GameState düz JSON olduğu için olduğu gibi saklanır.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { GameState } from '../sim/types.ts';

const DB_NAME = 'vapur-istanbul';
const STORE = 'saves';
export const AUTO_SLOT = 'auto';
export const MANUAL_SLOT = 'manual';

export interface SaveRecord {
  slot: string;
  savedAt: number;
  minute: number;
  money: number;
  piers: number;
  lines: number;
  state: GameState;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'slot' });
    },
  });
  return dbPromise;
}

/** Kaydedilebilir kopya: geçici alanlar temizlenir. */
export function snapshot(state: GameState): GameState {
  const copy = structuredClone(state);
  copy.notices = [];
  return copy;
}

export async function saveGame(state: GameState, slot: string = AUTO_SLOT): Promise<void> {
  const rec: SaveRecord = {
    slot,
    savedAt: Date.now(),
    minute: state.minute,
    money: state.money,
    piers: state.piers.length,
    lines: state.lines.length,
    state: snapshot(state),
  };
  await (await db()).put(STORE, rec);
}

export async function loadGame(slot: string = AUTO_SLOT): Promise<SaveRecord | null> {
  const rec = (await (await db()).get(STORE, slot)) as SaveRecord | undefined;
  if (!rec || rec.state?.version !== 1) return null;
  return rec;
}

export async function deleteSave(slot: string): Promise<void> {
  await (await db()).delete(STORE, slot);
}

export async function listSaves(): Promise<SaveRecord[]> {
  return (await (await db()).getAll(STORE)) as SaveRecord[];
}
