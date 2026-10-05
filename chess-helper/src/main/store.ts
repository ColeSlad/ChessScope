import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '../shared/contracts';

const geometrySchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(340).max(4000), height: z.number().int().min(480).max(4000) }).strict();
export type Geometry = z.infer<typeof geometrySchema>;
const persistedSchema = z.object({ version: z.literal(1), settings: settingsSchema, credential: z.string().optional(), geometry: geometrySchema.optional() }).strict();
export class Store {
  private file: string;
  private data: z.infer<typeof persistedSchema> = { version: 1, settings: structuredClone(DEFAULT_SETTINGS) };
  constructor(directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); this.file = path.join(directory, 'preferences.json');
    try { this.data = persistedSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* Never load unvalidated settings or expose corrupt credential content. */ }
  }
  get settings(): Settings { return structuredClone(this.data.settings); }
  get geometry() { return this.data.geometry; }
  get hasApiKey(): boolean { return !!this.apiKey(); }
  apiKey(): string | undefined {
    if (!this.data.credential || !safeStorage.isEncryptionAvailable()) return undefined;
    try { return safeStorage.decryptString(Buffer.from(this.data.credential, 'base64')); } catch { return undefined; }
  }
  save(settings: Settings, apiKey?: string) {
    const next = { ...this.data, settings: settingsSchema.parse(settings) };
    if (apiKey !== undefined) {
      if (apiKey && !safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable. Unlock your macOS Keychain and retry.');
      next.credential = apiKey ? safeStorage.encryptString(apiKey).toString('base64') : undefined;
    }
    this.persist(next); this.data = next;
  }
  saveGeometry(geometry: Geometry) { const next = { ...this.data, geometry: geometrySchema.parse(geometry) }; this.persist(next); this.data = next; }
  private persist(data: z.infer<typeof persistedSchema>) {
    const temporary = this.file + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 }); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, this.file);
  }
}
