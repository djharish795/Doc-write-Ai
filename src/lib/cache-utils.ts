import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Using a predictable temp directory that works well in local dev
const CACHE_DIR = path.join(process.cwd(), '.cache');

export function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function generateHash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function getCachedResult(hash: string): any | null {
  ensureCacheDir();
  const cachePath = path.join(CACHE_DIR, `${hash}.json`);
  
  if (fs.existsSync(cachePath)) {
    try {
      const data = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to read cache:', e);
      return null;
    }
  }
  return null;
}

export function setCachedResult(hash: string, data: any): void {
  ensureCacheDir();
  const cachePath = path.join(CACHE_DIR, `${hash}.json`);
  try {
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write cache:', e);
  }
}
