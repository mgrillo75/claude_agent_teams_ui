import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OPENCODE_SHARED_CACHE_NODE_MODULES_RELATIVE = path.join(
  'Cache',
  'opencode',
  'shared-cache',
  'config-node_modules'
);
const OPENCODE_PROFILES_BASE_RELATIVE = path.join(
  'Data',
  'opencode',
  'profiles'
);

function getLocalAppDataPath(): string {
  return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
}

function getBaseDir(): string {
  return path.join(getLocalAppDataPath(), 'claude-multimodel-nodejs');
}

export function getSharedCacheNodeModulesPath(): string {
  return path.join(getBaseDir(), OPENCODE_SHARED_CACHE_NODE_MODULES_RELATIVE);
}

export function getProfileNodeModulesPath(profileId: string): string {
  return path.join(
    getBaseDir(),
    OPENCODE_PROFILES_BASE_RELATIVE,
    profileId,
    'config',
    'opencode',
    'node_modules'
  );
}

export function isOpenCodeNodeModulesSymlinkError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes('eperm') || normalized.includes('eacces')) &&
    normalized.includes('symlink') &&
    normalized.includes('opencode') &&
    normalized.includes('node_modules')
  );
}

export function extractProfileIdFromSymlinkError(message: string): string | null {
  const profilePathPattern =
    /profiles[\\/]([0-9a-f]+)[\\/]config[\\/]opencode[\\/]node_modules/i;
  const match = profilePathPattern.exec(message);
  return match ? match[1] : null;
}

export function ensureOpenCodeProfileNodeModulesJunction(profileId: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  const source = getSharedCacheNodeModulesPath();
  const target = getProfileNodeModulesPath(profileId);

  try {
    const existingStat = fs.statSync(target, { throwIfNoEntry: false });
    if (existingStat !== undefined) {
      return true;
    }
  } catch {
    // Target does not exist, proceed to create junction.
  }

  try {
    const sourceStat = fs.statSync(source, { throwIfNoEntry: false });
    if (sourceStat === undefined) {
      return false;
    }
  } catch {
    return false;
  }

  const parentDir = path.dirname(target);
  try {
    fs.mkdirSync(parentDir, { recursive: true });
  } catch {
    return false;
  }

  try {
    fs.symlinkSync(source, target, 'junction');
    return true;
  } catch {
    return false;
  }
}