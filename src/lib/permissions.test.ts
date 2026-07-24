import { describe, expect, it } from 'vitest';
import {
  PERMISSION_REGISTRY,
  PERMISSION_ROLES,
  PERM_CATEGORIES,
  ALL_PERMISSIONS,
  REGISTRY_MAP,
  defaultPermissions,
  normalizePermissions,
  type PermissionKey,
  type PermissionSet,
} from './permissions';

describe('permissions registry', () => {
  it('registry has exactly 43 unique keys', () => {
    expect(PERMISSION_REGISTRY.length).toBe(43);
    const keys = new Set(PERMISSION_REGISTRY.map(p => p.key));
    expect(keys.size).toBe(43);
  });

  it('registry uses only 8 defined categories', () => {
    const categories = new Set(PERMISSION_REGISTRY.map(p => p.category));
    expect(categories.size).toBe(8);
    for (const c of categories) expect(PERM_CATEGORIES).toContain(c);
  });

  it('every role has all 43 keys in defaultPermissions', () => {
    for (const role of PERMISSION_ROLES) {
      const perms = defaultPermissions(role);
      expect(Object.keys(perms).length).toBe(43);
      for (const p of PERMISSION_REGISTRY) {
        expect(perms[p.key]).toEqual(p.defaultFor[role]);
      }
    }
  });

  it('Owner defaults are all true', () => {
    const perms = defaultPermissions('Owner');
    for (const p of PERMISSION_REGISTRY) expect(perms[p.key]).toBe(true);
  });

  it('ALL_PERMISSIONS has all 43 keys set to true and is frozen', () => {
    expect(Object.keys(ALL_PERMISSIONS).length).toBe(43);
    for (const p of PERMISSION_REGISTRY) expect(ALL_PERMISSIONS[p.key]).toBe(true);
    expect(Object.isFrozen(ALL_PERMISSIONS)).toBe(true);
  });

  it('REGISTRY_MAP has 43 entries with matching keys', () => {
    expect(REGISTRY_MAP.size).toBe(43);
    for (const p of PERMISSION_REGISTRY) {
      expect(REGISTRY_MAP.get(p.key)).toBe(p);
    }
  });

  it('normalizePermissions fills missing keys per role', () => {
    const partial = { dashboard: false } as Partial<PermissionSet>;
    const result = normalizePermissions(partial, 'Staff Admin Toko');
    expect(Object.keys(result).length).toBe(43);
    expect(result.dashboard).toBe(false);            // preserved
    expect(result.can_start_opname).toBe(true);      // filled per Staff Admin Toko preset
    expect(result.can_approve_adjustment).toBe(false); // filled per Staff Admin Toko preset
  });

  it('normalizePermissions drops unknown legacy keys', () => {
    const partial = { dashboard: true, pipeline: true } as Record<string, unknown>;
    const result = normalizePermissions(partial, 'Owner');
    expect(Object.keys(result)).not.toContain('pipeline');
    expect(Object.keys(result).length).toBe(43);
  });

  it('normalizePermissions coerces non-boolean input safely', () => {
    const partial = { dashboard: 'yes', kasir: 1 } as Record<string, unknown>;
    const result = normalizePermissions(partial, 'Owner');
    // Non-boolean input → falls through to role default (Owner = true)
    expect(result.dashboard).toBe(true);
    expect(result.kasir).toBe(true);
  });

  it('isActionPerm consistent with can_ prefix (canConfigureSalesChannels is special)', () => {
    const specialCase = new Set(['canConfigureSalesChannels']);
    for (const p of PERMISSION_REGISTRY) {
      const startsCan = p.key.startsWith('can_');
      const expected = startsCan || specialCase.has(p.key);
      expect(p.isActionPerm).toBe(expected);
    }
  });

  it('PermissionKey union derived from registry (compile-time guard)', () => {
    // If this line fails to compile, PermissionKey drifted from registry.
    const k: PermissionKey = PERMISSION_REGISTRY[0].key;
    expect(typeof k).toBe('string');
  });

  it('every registry entry has 4 role defaults', () => {
    for (const p of PERMISSION_REGISTRY) {
      expect(Object.keys(p.defaultFor).length).toBe(4);
      for (const role of PERMISSION_ROLES) {
        expect(typeof p.defaultFor[role]).toBe('boolean');
      }
    }
  });
});
