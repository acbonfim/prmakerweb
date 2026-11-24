import {
  ROLE_CLAIM, canOpenWorkbenchFromDeskRoles, canUseDeskRoles, canUseWorkbenchRoles, decideRoleRoute, decodeJwtPayload,
  hasAccess, isDevRoles, isManagementOnlyRoles, roleLabel, rolesFromPayload, rolesFromToken, setupProfileFromRoles
} from './role.logic';

/** Monta um JWT falso (só o payload importa) em base64url, como o Cime.Auth emite. */
function jwt(payload: object): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `eyJhbGciOiJIUzI1NiJ9.${b64}.assinatura`;
}

describe('role.logic (0099 ajustes 2)', () => {
  describe('leitura dos papéis', () => {
    it('lê a claim longa do .NET (lista) e a curta `role` (string)', () => {
      expect(rolesFromToken(jwt({ [ROLE_CLAIM]: ['admin', 'user'] }))).toEqual(['admin', 'user']);
      expect(rolesFromToken(jwt({ role: 'management' }))).toEqual(['management']);
    });

    it('a claim longa vence a curta; normaliza caixa e repetidos', () => {
      expect(rolesFromPayload({ [ROLE_CLAIM]: ['Admin', 'admin', ' Gestor '], role: 'user' })).toEqual(['admin', 'gestor']);
    });

    it('token ausente ou inválido → sem papéis', () => {
      expect(rolesFromToken(null)).toEqual([]);
      expect(rolesFromToken('')).toEqual([]);
      expect(rolesFromToken('abc')).toEqual([]);
      expect(rolesFromToken('a.%%%.c')).toEqual([]);
    });

    it('decodifica base64url com acento (UTF-8) e sem preenchimento', () => {
      const p = decodeJwtPayload(jwt({ name: 'João Ação ~~~>>>???', role: 'user' }));
      expect(p?.['name']).toBe('João Ação ~~~>>>???');
    });
  });

  describe('regras por papel', () => {
    it('dev = user ou support', () => {
      expect(isDevRoles(['user'])).toBeTrue();
      expect(isDevRoles(['support'])).toBeTrue();
      expect(isDevRoles(['gestor'])).toBeFalse();
    });

    it('management sozinho: Mesa sim, Bancada não, perfil management', () => {
      const r = ['management'];
      expect(isManagementOnlyRoles(r)).toBeTrue();
      expect(canUseDeskRoles(r)).toBeTrue();
      expect(canUseWorkbenchRoles(r)).toBeFalse();
      expect(canOpenWorkbenchFromDeskRoles(r)).toBeFalse();
      expect(setupProfileFromRoles(r)).toBe('management');
    });

    it('management + dev tem os dois mundos', () => {
      const r = ['management', 'support'];
      expect(isManagementOnlyRoles(r)).toBeFalse();
      expect(canUseDeskRoles(r)).toBeTrue();
      expect(canUseWorkbenchRoles(r)).toBeTrue();
      expect(canOpenWorkbenchFromDeskRoles(r)).toBeTrue();
      expect(setupProfileFromRoles(r)).toBe('dev');
    });

    it('admin vê tudo', () => {
      expect(canUseDeskRoles(['admin'])).toBeTrue();
      expect(canUseWorkbenchRoles(['admin'])).toBeTrue();
      expect(canOpenWorkbenchFromDeskRoles(['admin'])).toBeTrue();
      expect(canUseWorkbenchRoles(['admin', 'management'])).toBeTrue();
    });

    it('dev e gestor: Bancada sim, Mesa não', () => {
      for (const r of [['user'], ['support'], ['gestor']]) {
        expect(canUseWorkbenchRoles(r)).withContext(r.join()).toBeTrue();
        expect(canUseDeskRoles(r)).withContext(r.join()).toBeFalse();
      }
      expect(canOpenWorkbenchFromDeskRoles(['gestor'])).toBeFalse();
    });

    it('sem papel nenhum continua com a Bancada (como hoje) e sem a Mesa', () => {
      expect(canUseWorkbenchRoles([])).toBeTrue();
      expect(canUseDeskRoles([])).toBeFalse();
      expect(setupProfileFromRoles([])).toBe('dev');
    });

    it('hasAccess pelas regras nomeadas', () => {
      expect(hasAccess(['management'], 'not-management-only')).toBeFalse();
      expect(hasAccess(['management', 'user'], 'not-management-only')).toBeTrue();
      expect(hasAccess(['user'], 'desk')).toBeFalse();
      expect(hasAccess(['management'], 'workbench')).toBeFalse();
    });
  });

  describe('decideRoleRoute', () => {
    it('sem dados passa', () => {
      expect(decideRoleRoute(['user'], null)).toBeTrue();
      expect(decideRoleRoute([], {})).toBeTrue();
    });

    it('roles: precisa de um deles; senão o redirecionamento (padrão Início)', () => {
      expect(decideRoleRoute(['management'], { roles: ['admin', 'management'] })).toBeTrue();
      expect(decideRoleRoute(['user'], { roles: ['admin', 'management'] })).toBe('/auth/dashboard');
      expect(decideRoleRoute(['user'], { roles: ['admin'], redirect: '/auth/x' })).toBe('/auth/x');
    });

    it('deny: barra só quem tem apenas os papéis negados', () => {
      expect(decideRoleRoute(['management'], { deny: ['management'], redirect: '/auth/desk' })).toBe('/auth/desk');
      expect(decideRoleRoute(['management', 'user'], { deny: ['management'] })).toBeTrue();
      expect(decideRoleRoute([], { deny: ['management'] })).toBeTrue();
    });

    it('access: Bancada barra management sozinho e manda para a Mesa', () => {
      const data = { access: 'workbench' as const, redirect: '/auth/desk' };
      expect(decideRoleRoute(['management'], data)).toBe('/auth/desk');
      expect(decideRoleRoute(['gestor'], data)).toBeTrue();
      expect(decideRoleRoute(['admin', 'management'], data)).toBeTrue();
    });
  });

  it('rótulo amigável dos papéis', () => {
    expect(roleLabel('management')).toBe('Gestão (management)');
    expect(roleLabel('outro')).toBe('outro');
    expect(roleLabel('admin')).toBe('admin');
  });
});
