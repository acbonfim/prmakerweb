import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { StorageService } from '../services/storage.service';
import { GlobalService } from '../services/global.service';

// Restringe a rota a usuários com o papel "admin" (lido da api-key do usuário logado).
@Injectable({ providedIn: 'root' })
export class AdminGuard {
  constructor(
    private router: Router,
    private _storageService: StorageService,
    private _globalService: GlobalService
  ) {}

  canActivate(): boolean {
    if (this.getRoles().includes('admin')) {
      return true;
    }
    this._globalService.sendAlertError('Acesso restrito a administradores.', 'OK');
    this.router.navigate(['/auth/dashboard']);
    return false;
  }

  private getRoles(): string[] {
    const token = this._storageService.getItem('apiKey');
    if (!token) return [];
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const roleKey = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';
      const raw = payload[roleKey] ?? payload['role'];
      return Array.isArray(raw) ? raw : (raw ? [raw] : []);
    } catch {
      return [];
    }
  }
}
