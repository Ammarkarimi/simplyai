import { describe, expect, it } from 'vitest';
import { APP_TEMPLATES, SYSTEM_ROLES, appDefinitionSchema, emptyAppDefinition, roleHas, safeUrl, sanitizeStyle, sanitizeStyleValue } from './index';

describe('app definitions', () => {
  it('every starter template is a valid app', () => {
    for (const t of APP_TEMPLATES) {
      const r = appDefinitionSchema.safeParse(t.build());
      expect(r.success, `${t.key}: ${r.success ? '' : r.error.issues[0]?.message}`).toBe(true);
    }
  });

  it('rejects duplicate names, reserved names and bad page paths', () => {
    const def = emptyAppDefinition();
    def.pages[0]!.root.children = [
      { id: 'a', type: 'text', name: 'title', props: {} },
      { id: 'b', type: 'text', name: 'title', props: {} },
    ];
    expect(appDefinitionSchema.safeParse(def).success).toBe(false);
    def.pages[0]!.root.children = [{ id: 'a', type: 'text', name: 'state', props: {} }];
    expect(appDefinitionSchema.safeParse(def).success).toBe(false);
    def.pages[0]!.root.children = [];
    def.pages[0]!.path = 'Bad Path';
    expect(appDefinitionSchema.safeParse(def).success).toBe(false);
  });

  it('sanitizes styles and urls', () => {
    expect(sanitizeStyleValue('background', 'url(javascript:alert(1))')).toBeUndefined();
    expect(sanitizeStyleValue('background', 'url("http://tracker.example/x.png")')).toBeUndefined();
    expect(sanitizeStyleValue('backgroundImage', 'url("https://images.example/x.png")')).toBe('url("https://images.example/x.png")');
    expect(sanitizeStyleValue('color', 'red; position: fixed')).toBeUndefined();
    expect(sanitizeStyleValue('position', 'fixed')).toBeUndefined();
    expect(sanitizeStyle({ color: 'red', onclick: 'x', background: 'linear-gradient(90deg, #fff, #000)' } as never)).toEqual({ color: 'red', background: 'linear-gradient(90deg, #fff, #000)' });
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('//evil.example')).toBeUndefined();
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('/a/my-app')).toBe('/a/my-app');
  });

  it('grants app permissions by role', () => {
    const perms = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!.permissions;
    expect(roleHas(perms('viewer'), 'app:read')).toBe(true);
    expect(roleHas(perms('viewer'), 'app:manage')).toBe(false);
    expect(roleHas(perms('editor'), 'app:manage')).toBe(true);
  });
});
