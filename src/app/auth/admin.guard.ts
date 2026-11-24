import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { GlobalService } from '../services/global.service';
import { RoleService } from '../services/role.service';

// Restringe a rota a usuários com o papel "admin" (lido da api-key do usuário logado pelo RoleService).
@Injectable({ providedIn: 'root' })
export class AdminGuard {
  constructor(
    private router: Router,
    private _roles: RoleService,
    private _globalService: GlobalService
  ) {}

  canActivate(): boolean {
    if (this._roles.isAdmin) {
      return true;
    }
    this._globalService.sendAlertError('Acesso restrito a administradores.', 'OK');
    // Management sozinho não tem Início (vai para a Mesa).
    this.router.navigate([this._roles.isManagementOnly ? '/auth/desk' : '/auth/dashboard']);
    return false;
  }
}
