import { ChangeDetectorRef, Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';

interface RecentHandover {
  id: number;
  cardNumber: string;
  repositoryId: string | null;
  userId: string | null;
  createdAt: string;
}

/**
 * Atalho da home: últimos handovers criados pelo time. Cada card mostra quem
 * criou (foto + nome, resolvidos pelo externalId), o número do card e a data.
 */
@Component({
  selector: 'app-recent-handovers',
  standalone: true,
  imports: [CommonModule, MatIconModule, UserAvatarComponent],
  templateUrl: './recent-handovers.component.html',
  styleUrls: ['./recent-handovers.component.css'],
})
export class RecentHandoversComponent implements OnInit {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  private urlBase = environment.apiUrl;

  /** Emite se a seção tem conteúdo (carregando ou com itens). O pai usa para
   *  colapsar o layout e dar 100% da largura ao outro bloco quando este fica vazio. */
  @Output() visibilityChange = new EventEmitter<boolean>();

  items: RecentHandover[] = [];
  isLoading = false;
  private photos: Record<string, string> = {};
  private names: Record<string, string> = {};
  readonly skeletons = Array.from({ length: 6 });

  private get isVisible(): boolean {
    return this.isLoading || this.items.length > 0;
  }

  ngOnInit() {
    this.isLoading = true;
    this.http.get<RecentHandover[]>(`${this.urlBase}Handover/GetRecent?take=10`).subscribe({
      next: (list) => {
        this.items = list ?? [];
        this.isLoading = false;
        this.visibilityChange.emit(this.isVisible);
        this.resolveAuthors();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.visibilityChange.emit(this.isVisible);
        this.cdr.detectChanges();
      },
    });
  }

  /** Resolve foto + nome dos autores (por externalId) em uma única chamada. */
  private resolveAuthors() {
    const ids = Array.from(
      new Set(
        this.items
          .map((i) => i.userId)
          .filter((x): x is string => !!x)
          .map((x) => x.toLowerCase())
      )
    );
    if (!ids.length) return;

    this.authService.getPhotosByExternalIds(ids).subscribe({
      next: (res: any) => {
        const list = res?.object ?? res?.Object ?? [];
        for (const u of list) {
          const ext = (u.externalId || u.ExternalId || '').toLowerCase();
          if (!ext) continue;
          this.photos[ext] = u.imageUrl || u.ImageUrl || '';
          this.names[ext] = u.fullName || u.FullName || '';
        }
        this.cdr.detectChanges();
      },
      error: () => {},
    });
  }

  /** Abre o card no register (mesmo comportamento dos "últimos cards"). */
  open(h: RecentHandover) {
    this.router.navigate(['/auth/register'], {
      queryParams: {
        card: h.cardNumber,
        repositoryId: h.repositoryId ?? undefined,
      },
    });
  }

  photoFor(userId?: string | null): string | null {
    return userId ? this.photos[userId.toLowerCase()] || null : null;
  }

  nameFor(userId?: string | null): string {
    return userId ? this.names[userId.toLowerCase()] || '' : '';
  }
}
