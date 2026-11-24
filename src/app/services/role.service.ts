import { Injectable, inject } from '@angular/core';
import { StorageService } from './storage.service';
import {
  RoleAccess, canOpenWorkbenchFromDeskRoles, canUseDeskRoles, canUseWorkbenchRoles, hasAccess, hasAnyRole, isAdminRoles,
  isDevRoles, isManagementOnlyRoles, isManagementRoles, rolesFromToken, setupProfileFromRoles
} from './role.logic';

/**
 * 0099 (ajustes 2): papéis do usuário logado (da api-key) e as regras de acesso por papel — fonte única para guardas,
 * menu e telas (antes cada tela decodificava o JWT por conta própria). Lê o token a cada chamada (login/troca de
 * usuário na mesma aba não deixa papel velho); o custo é só decodificar um JWT pequeno.
 */
@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly storage = inject(StorageService);
  private cacheToken: string | null = null;
  private cacheRoles: string[] = [];

  /** Papéis em minúsculas (vazio sem api-key). */
  roles(): string[] {
    let token: string | null = null;
    try {
      token = `${this.storage.getItem('apiKey') ?? ''}` || null;
    } catch {
      token = null;
    }
    if (token !== this.cacheToken) {
      this.cacheToken = token;
      this.cacheRoles = rolesFromToken(token);
    }
    return this.cacheRoles;
  }

  has(...roles: string[]): boolean { return hasAnyRole(this.roles(), roles); }
  allows(access: RoleAccess): boolean { return hasAccess(this.roles(), access); }

  get isAdmin(): boolean { return isAdminRoles(this.roles()); }
  get isManagement(): boolean { return isManagementRoles(this.roles()); }
  /** `user` ou `support`. */
  get isDev(): boolean { return isDevRoles(this.roles()); }
  /** Management sem papel de dev nem admin — só a Mesa. */
  get isManagementOnly(): boolean { return isManagementOnlyRoles(this.roles()); }
  get canUseWorkbench(): boolean { return canUseWorkbenchRoles(this.roles()); }
  get canUseDesk(): boolean { return canUseDeskRoles(this.roles()); }
  /** "Abrir na Bancada" dentro da Mesa: admin ou dev. */
  get canOpenWorkbenchFromDesk(): boolean { return canOpenWorkbenchFromDeskRoles(this.roles()); }
  /** Perfil dos primeiros passos/doctor. */
  get setupProfile(): 'management' | 'dev' { return setupProfileFromRoles(this.roles()); }
}
