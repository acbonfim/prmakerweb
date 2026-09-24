import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';

/**
 * Card compacto com quem abriu e as datas (mesmo visual dos painéis). Botões de ação
 * entram por `[info-actions]`, à direita.
 */
@Component({
  selector: 'app-pr-info-card',
  standalone: true,
  imports: [DatePipe, MatIconModule, UserAvatarComponent],
  template: `
    <div class="pr-info">
      <div class="pr-info__author">
        <app-user-avatar [name]="userName()" [imageUrl]="userPhoto()" [size]="36"></app-user-avatar>
        <div class="pr-info__col">
          <span class="pr-info__label">{{ authorLabel() }}</span>
          <strong class="pr-info__value">{{ userName() || '—' }}</strong>
        </div>
      </div>

      <div class="pr-info__meta">
        <div class="pr-info__item">
          <mat-icon>event</mat-icon>
          <div class="pr-info__col">
            <span class="pr-info__label">{{ openedLabel() }}</span>
            <strong class="pr-info__value">{{ openedAt() ? (openedAt() | date:'dd/MM/yyyy HH:mm') : '—' }}</strong>
          </div>
        </div>
        <div class="pr-info__item">
          <mat-icon>update</mat-icon>
          <div class="pr-info__col">
            <span class="pr-info__label">Última atualização</span>
            <strong class="pr-info__value">{{ updatedAt() ? (updatedAt() | date:'dd/MM/yyyy HH:mm') : '—' }}</strong>
          </div>
        </div>
      </div>

      <div class="pr-info__actions">
        <ng-content select="[info-actions]"></ng-content>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background-color: var(--surface-1, #2a2a2a);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 10px 14px;
    }

    .pr-info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px 24px;
      width: 100%;
    }

    .pr-info__author { display: flex; align-items: center; gap: 10px; }

    .pr-info__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 24px;
    }

    .pr-info__item { display: flex; align-items: center; gap: 8px; }

    .pr-info__item mat-icon {
      color: var(--mat-sys-primary);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .pr-info__col { display: flex; flex-direction: column; line-height: 1.2; }

    .pr-info__label {
      font-size: 11px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent);
    }

    .pr-info__value { font-size: 13px; font-weight: 600; }

    .pr-info__actions { display: flex; align-items: center; gap: 4px; }
    .pr-info__actions:empty { display: none; }
  `]
})
export class PrInfoCardComponent {
  readonly userName = input<string>('');
  readonly userPhoto = input<string | null>(null);
  readonly openedAt = input<string | null>(null);
  readonly updatedAt = input<string | null>(null);
  readonly authorLabel = input('Aberto por');
  readonly openedLabel = input('Aberto em');
}
