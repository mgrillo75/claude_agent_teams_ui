import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureOpenCodeProfileNodeModulesJunction,
  extractProfileIdFromSymlinkError,
  getProfileNodeModulesPath,
  getSharedCacheNodeModulesPath,
  isOpenCodeNodeModulesSymlinkError,
} from '../../../../src/features/runtime-provider-management/main/infrastructure/openCodeWindowsNodeModulesJunction';

describe('openCodeWindowsNodeModulesJunction', () => {
  describe('isOpenCodeNodeModulesSymlinkError', () => {
    it('matches EPERM symlink errors containing opencode and node_modules', () => {
      const message = [
        'Runtime provider management command failed unexpectedly:',
        "EPERM: operation not permitted, symlink 'C:\\Users\\test\\AppData\\Local\\claude-multimodel-nodejs\\Cache\\opencode\\shared-cache\\config-node_modules'",
        "-> 'C:\\Users\\test\\AppData\\Local\\claude-multimodel-nodejs\\Data\\opencode\\profiles\\abc123\\config\\opencode\\node_modules'",
      ].join(' ');
      expect(isOpenCodeNodeModulesSymlinkError(message)).toBe(true);
    });

    it('matches EACCES symlink errors containing opencode and node_modules', () => {
      const message =
        "EACCES: access denied, symlink 'opencode' -> 'node_modules'";
      expect(isOpenCodeNodeModulesSymlinkError(message)).toBe(true);
    });

    it('is case-insensitive', () => {
      const message =
        "eperm: operation not permitted, SYMLINK 'OpenCode' -> 'NODE_MODULES'";
      expect(isOpenCodeNodeModulesSymlinkError(message)).toBe(true);
    });

    it('does not match errors missing symlink keyword', () => {
      const message =
        "EPERM: operation not permitted, open 'opencode' -> 'node_modules'";
      expect(isOpenCodeNodeModulesSymlinkError(message)).toBe(false);
    });

    it('does not match errors missing opencode keyword', () => {
      const message =
        "EPERM: operation not permitted, symlink '/some/path' -> 'node_modules'";
      expect(isOpenCodeNodeModulesSymlinkError(message)).toBe(false);
    });

    it('does not match errors missing node_modules keyword', () => {
      const message =
        "EPERM: operation not permitted, symlink 'opencode' -> '/some/path'";
      expect(isOpenCodeNodeModulesSymlinkError(message)).toBe(false);
    });
  });

  describe('extractProfileIdFromSymlinkError', () => {
    it('extracts the profile hash from a Windows path', () => {
      const message = [
        "EPERM: operation not permitted, symlink 'C:\\Users\\Swarog\\AppData\\Local\\claude-multimodel-nodejs\\Cache\\opencode\\shared-cache\\config-node_modules'",
        "-> 'C:\\Users\\Swarog\\AppData\\Local\\claude-multimodel-nodejs\\Data\\opencode\\profiles\\e8e2eadb00beea6c\\config\\opencode\\node_modules'",
      ].join(' ');
      expect(extractProfileIdFromSymlinkError(message)).toBe('e8e2eadb00beea6c');
    });

    it('extracts the profile hash from a Unix-style path', () => {
      const message =
        "EPERM: symlink '/home/user/.cache/opencode/shared-cache/config-node_modules' -> '/home/user/.data/opencode/profiles/abc123def456/config/opencode/node_modules'";
      expect(extractProfileIdFromSymlinkError(message)).toBe('abc123def456');
    });

    it('returns null when no profile path pattern is found', () => {
      const message = 'EPERM: some other error without a profile path';
      expect(extractProfileIdFromSymlinkError(message)).toBeNull();
    });
  });

  describe('getSharedCacheNodeModulesPath', () => {
    it('uses LOCALAPPDATA environment variable when set', () => {
      const originalEnv = process.env.LOCALAPPDATA;
      process.env.LOCALAPPDATA = 'X:\\custom\\local';
      try {
        const result = getSharedCacheNodeModulesPath();
        expect(result).toBe(
          path.join('X:\\custom\\local', 'claude-multimodel-nodejs', 'Cache', 'opencode', 'shared-cache', 'config-node_modules')
        );
      } finally {
        process.env.LOCALAPPDATA = originalEnv;
      }
    });

    it('falls back to homedir AppData Local when LOCALAPPDATA is unset', () => {
      const originalEnv = process.env.LOCALAPPDATA;
      delete process.env.LOCALAPPDATA;
      try {
        const result = getSharedCacheNodeModulesPath();
        expect(result).toContain('AppData');
        expect(result).toContain('Local');
        expect(result).toContain('claude-multimodel-nodejs');
      } finally {
        process.env.LOCALAPPDATA = originalEnv;
      }
    });
  });

  describe('getProfileNodeModulesPath', () => {
    it('constructs the correct profile node_modules path', () => {
      const originalEnv = process.env.LOCALAPPDATA;
      process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
      try {
        const result = getProfileNodeModulesPath('abc123');
        expect(result).toBe(
          path.join(
            'C:\\Users\\test\\AppData\\Local',
            'claude-multimodel-nodejs',
            'Data',
            'opencode',
            'profiles',
            'abc123',
            'config',
            'opencode',
            'node_modules'
          )
        );
      } finally {
        process.env.LOCALAPPDATA = originalEnv;
      }
    });
  });

  describe('ensureOpenCodeProfileNodeModulesJunction', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('returns false on non-Windows platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const result = ensureOpenCodeProfileNodeModulesJunction('abc123');
      expect(result).toBe(false);
    });

    it('returns false on Windows when shared cache does not exist', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const statSyncSpy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const result = ensureOpenCodeProfileNodeModulesJunction('abc123');
      expect(result).toBe(false);
      statSyncSpy.mockRestore();
    });

    it('returns true on Windows when target node_modules already exists', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const statSyncSpy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
        return {} as fs.Stats;
      });
      const result = ensureOpenCodeProfileNodeModulesJunction('abc123');
      expect(result).toBe(true);
      statSyncSpy.mockRestore();
    });

    it('creates junction on Windows when shared cache exists and target is missing', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      let callCount = 0;
      const statSyncSpy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
        callCount++;
        // First call: target does not exist (throw)
        // Second call: source exists (return stats)
        if (callCount === 1) {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return {} as fs.Stats;
      });
      const mkdirSyncSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => '');
      const symlinkSyncSpy = vi.spyOn(fs, 'symlinkSync').mockImplementation(() => undefined);
      const result = ensureOpenCodeProfileNodeModulesJunction('abc123');
      expect(result).toBe(true);
      expect(symlinkSyncSpy).toHaveBeenCalledTimes(1);
      expect(symlinkSyncSpy.mock.calls[0][2]).toBe('junction');
      statSyncSpy.mockRestore();
      mkdirSyncSpy.mockRestore();
      symlinkSyncSpy.mockRestore();
    });

    it('returns false when junction creation fails', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      let callCount2 = 0;
      const statSyncSpy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
        callCount2++;
        if (callCount2 === 1) {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return {} as fs.Stats;
      });
      const mkdirSyncSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => '');
      const symlinkSyncSpy = vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {
        throw new Error('EPERM');
      });
      const result = ensureOpenCodeProfileNodeModulesJunction('abc123');
      expect(result).toBe(false);
      statSyncSpy.mockRestore();
      mkdirSyncSpy.mockRestore();
      symlinkSyncSpy.mockRestore();
    });
  });
});