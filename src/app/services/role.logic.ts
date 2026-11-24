// 0099 (ajustes 2): papéis do usuário lidos da api-key (JWT emitido pelo Cime.Auth) e as regras de acesso por papel.
// Lógica pura (sem Angular) para ser testada sem TestBed — o RoleService só lê o token e chama estas funções.

export const ROLE_CLAIM = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';

export const ROLE_ADMIN = 'admin';
export const ROLE_MANAGEMENT = 'management';
export const ROLE_SUPPORT = 'support';
export const ROLE_USER = 'user';
export const ROLE_GESTOR = 'gestor';

/** Papéis de desenvolvedor (quem trata card com código, banco e git). */
export const DEV_ROLES = [ROLE_USER, ROLE_SUPPORT];

/** Decodifica o payload de um JWT (base64url, UTF-8). Token inválido → null. */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  const part = `${token ?? ''}`.split('.')[1];
  if (!part) return null;
  try {
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/** Papéis do payload: claim longa do .NET ou `role`, string ou lista; sem caixa, sem repetidos. */
export function rolesFromPayload(payload: Record<string, unknown> | null | undefined): string[] {
  if (!payload) return [];
  const raw = payload[ROLE_CLAIM] ?? payload['role'] ?? payload['roles'];
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const out: string[] = [];
  for (const r of list) {
    const v = `${r ?? ''}`.trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function rolesFromToken(token: string | null | undefined): string[] {
  return rolesFromPayload(decodeJwtPayload(token));
}

export function hasAnyRole(roles: readonly string[], wanted: readonly string[]): boolean {
  const set = new Set(roles.map(r => r.toLowerCase()));
  return wanted.some(w => set.has(`${w}`.toLowerCase()));
}

export function isAdminRoles(roles: readonly string[]): boolean {
  return hasAnyRole(roles, [ROLE_ADMIN]);
}

export function isManagementRoles(roles: readonly string[]): boolean {
  return hasAnyRole(roles, [ROLE_MANAGEMENT]);
}

/** Desenvolvedor = `user` ou `support`. */
export function isDevRoles(roles: readonly string[]): boolean {
  return hasAnyRole(roles, DEV_ROLES);
}

/** Management sem papel de desenvolvedor nem admin (o PO / gestor de problemas: só a Mesa). */
export function isManagementOnlyRoles(roles: readonly string[]): boolean {
  return isManagementRoles(roles) && !isAdminRoles(roles) && !isDevRoles(roles);
}

/**
 * Bancada: admin, dev, gestor — e qualquer outro papel que não seja management (como hoje).
 * Só quem tem management sem papel de dev/admin/gestor fica de fora.
 */
export function canUseWorkbenchRoles(roles: readonly string[]): boolean {
  return isAdminRoles(roles) || isDevRoles(roles) || hasAnyRole(roles, [ROLE_GESTOR]) || !isManagementRoles(roles);
}

/** Mesa de gestão: admin ou management. */
export function canUseDeskRoles(roles: readonly string[]): boolean {
  return isAdminRoles(roles) || isManagementRoles(roles);
}

/** "Abrir na Bancada" dentro da Mesa: só admin ou desenvolvedor (regra do contrato dos ajustes 2). */
export function canOpenWorkbenchFromDeskRoles(roles: readonly string[]): boolean {
  return isAdminRoles(roles) || isDevRoles(roles);
}

/** Perfil para os primeiros passos e o doctor: `management` só quando não há papel de dev nem admin. */
export function setupProfileFromRoles(roles: readonly string[]): 'management' | 'dev' {
  return isManagementOnlyRoles(roles) ? 'management' : 'dev';
}

/** Regras nomeadas para as rotas (evita repetir a combinação de papéis em cada rota). */
export type RoleAccess = 'workbench' | 'desk' | 'not-management-only';

export function hasAccess(roles: readonly string[], access: RoleAccess): boolean {
  switch (access) {
    case 'workbench': return canUseWorkbenchRoles(roles);
    case 'desk': return canUseDeskRoles(roles);
    case 'not-management-only': return !isManagementOnlyRoles(roles);
    default: return true;
  }
}

export interface RoleRouteData {
  /** Precisa de pelo menos um destes papéis. */
  roles?: readonly string[];
  /** Barra quem só tem estes papéis (todos os papéis do usuário estão aqui). */
  deny?: readonly string[];
  /** Regra nomeada (ver `hasAccess`). */
  access?: RoleAccess;
  /** Para onde vai quem não passa (padrão: Início). */
  redirect?: string;
  /** Aviso mostrado ao redirecionar (opcional). */
  message?: string;
}

/** Decide uma rota protegida por papel: true ou o caminho do redirecionamento. */
export function decideRoleRoute(
  roles: readonly string[],
  data: RoleRouteData | null | undefined,
  fallbackRedirect = '/auth/dashboard'
): true | string {
  const need = data?.roles ?? [];
  const deny = data?.deny ?? [];
  const redirect = data?.redirect || fallbackRedirect;
  if (need.length && !hasAnyRole(roles, need)) return redirect;
  if (deny.length && roles.length && roles.every(r => hasAnyRole([r], deny))) return redirect;
  if (data?.access && !hasAccess(roles, data.access)) return redirect;
  return true;
}

/** Rótulo amigável dos papéis (gestão de usuários, governança). */
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador (admin)',
  support: 'Suporte (support)',
  user: 'Desenvolvedor (user)',
  gestor: 'Gestor (gestor)',
  management: 'Gestão (management)',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[`${role ?? ''}`.toLowerCase()] ?? role;
}
