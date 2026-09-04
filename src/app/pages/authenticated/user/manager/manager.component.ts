import { Component, ElementRef, OnInit, signal, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../../../../services/auth.service';
import { GlobalService } from '../../../../services/global.service';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { UserFormDialogComponent } from '../dialogs/user-form-dialog.component';
import { UserServicesDialogComponent } from '../dialogs/user-services-dialog.component';
import { ApiKeyDialogComponent } from '../dialogs/api-key-dialog.component';

@Component({
  selector: 'app-manager',
  templateUrl: './manager.component.html',
  styleUrls: ['./manager.component.css'],
  imports: [
    MatCardModule,
    MatIconModule,
    FormsModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatInputModule,
    MatButtonModule
  ]
})
export class ManagerComponent implements OnInit {
  users = signal<any[]>([]);
  stillFetchable = signal(false);
  total = signal(0);
  loadingList = signal(false);
  loadingMore = signal(false);
  apiKeyLoading = signal(false);
  togglingId = signal<number | null>(null);

  roles = signal<string[]>([]);
  searchOpen = signal(false);
  filterName = signal('');

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  readonly skeletons = Array.from({ length: 6 });
  private actualPage = 0;
  private search$ = new Subject<string>();
  private readonly fallbackRoles = ['admin', 'support', 'user', 'gestor'];

  constructor(
    private _authService: AuthService,
    private _globalService: GlobalService,
    public dialog: MatDialog
  ) {
    // Busca inteligente: debounce evita uma requisição por tecla.
    this.search$
      .pipe(debounceTime(350), distinctUntilChanged())
      .subscribe(() => this.fetch(0));
  }

  ngOnInit() {
    this.loadRoles();
    this.fetch(0);
  }

  getDisplayName(fullName: string): string {
    if (!fullName) return '';
    const parts = fullName.trim().split(' ');
    const first = parts[0];
    const last = parts[parts.length - 1];
    return first === last ? first : `${first} ${last}`;
  }

  toggleSearch() {
    this.searchOpen.update((v) => !v);
    if (this.searchOpen()) {
      setTimeout(() => this.searchInput?.nativeElement?.focus(), 0);
    } else if (this.filterName()) {
      this.filterName.set('');
      this.fetch(0);
    }
  }

  onSearchChange(value: string) {
    this.filterName.set(value ?? '');
    this.search$.next(this.filterName());
  }

  clearSearch() {
    this.filterName.set('');
    this.fetch(0);
  }

  private loadRoles() {
    this._authService.getAllRoles().subscribe({
      next: (res: any) => {
        const list = res?.object ?? res?.Object ?? [];
        const names = Array.isArray(list)
          ? list.map((r: any) => r?.name ?? r?.Name).filter((x: any) => !!x)
          : [];
        this.roles.set(names.length > 0 ? names : this.fallbackRoles);
      },
      error: () => this.roles.set(this.fallbackRoles)
    });
  }

  private fetch(page: number) {
    this.actualPage = page;
    if (page === 0) {
      this.loadingList.set(true);
    } else {
      this.loadingMore.set(true);
    }

    this._authService.getAllUsers(page, 6, this.filterName()).subscribe({
      next: (res: any) => {
        const data = res?.object ?? res?.Object ?? {};
        const elements = data.elements ?? [];
        this.users.set(page === 0 ? elements : [...this.users(), ...elements]);
        this.stillFetchable.set(!!data.stillFetchable);
        this.total.set(data.total ?? this.users().length);
        this.loadingList.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loadingList.set(false);
        this.loadingMore.set(false);
        this._globalService.sendAlertError('Erro ao carregar usuários', 'OK');
      }
    });
  }

  morePage() {
    this.fetch(this.actualPage + 1);
  }

  openCreate() {
    const ref = this.dialog.open(UserFormDialogComponent, {
      width: '520px',
      data: { mode: 'create', roles: this.roles() }
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.fetch(0);
    });
  }

  openEdit(user: any) {
    const ref = this.dialog.open(UserFormDialogComponent, {
      width: '520px',
      data: { mode: 'edit', user, roles: this.roles() }
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.fetch(0);
    });
  }

  openServices(user: any) {
    this.dialog.open(UserServicesDialogComponent, {
      width: '620px',
      data: { user }
    });
  }

  generateMyApiKey() {
    this.apiKeyLoading.set(true);
    this._authService.generateApiKey().subscribe({
      next: (res: any) => {
        this.apiKeyLoading.set(false);
        const data = res?.object ?? res?.Object ?? {};
        const apiKey = data.apiKey ?? data.ApiKey;
        if (!apiKey) {
          this._globalService.sendAlertError('Não foi possível gerar a API Key', 'OK');
          return;
        }
        this.dialog.open(ApiKeyDialogComponent, {
          width: '560px',
          data: { apiKey, user: data.user, roles: data.roles }
        });
      },
      error: (err) => {
        this.apiKeyLoading.set(false);
        const msg = err?.error?.message || err?.error?.Message || 'Erro ao gerar API Key';
        this._globalService.sendAlertError(msg, 'OK');
      }
    });
  }

  activeToogle(user: any) {
    const isActive = !user.active;
    this.togglingId.set(user.id);

    this._authService.activeToggle(user.id, isActive).subscribe({
      next: (res: any) => {
        this.togglingId.set(null);
        const data = res?.object ?? res?.Object ?? {};
        this.users.update((list) =>
          list.map((u) => (u.id === user.id ? { ...u, active: data.active ?? isActive } : u))
        );
        this._globalService.sendAlert(isActive ? 'Usuário ativado' : 'Usuário desativado', 'OK');
      },
      error: () => {
        this.togglingId.set(null);
        this._globalService.sendAlertError('Erro ao alterar status do usuário', 'OK');
      }
    });
  }
}
