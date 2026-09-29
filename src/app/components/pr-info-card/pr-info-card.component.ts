import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';

/** Etiqueta do resumo do card (0026): ícone + valor curto; o rótulo e os detalhes vão no tooltip. */
export interface InfoFact {
  icon: string;
  label: string;
  value: string;
  /** ok (verde), warn (âmbar), info (azul), muted (apagado) — padrão: neutro. */
  tone?: 'ok' | 'warn' | 'info' | 'muted';
  tooltip?: string;
}

/**
 * Card compacto do topo da tela do card: quem abriu e as datas numa linha, e um resumo do card em
 * etiquetas (estado, ambiente, módulo, produção/release, prioridade, responsável, PRs, plano, resumo não
 * técnico — feature 0026) que antes ficavam escondidos em modais. Botões de ação entram por `[info-actions]`.
 */
@Component({
  selector: 'app-pr-info-card',
  standalone: true,
  imports: [DatePipe, MatIconModule, MatTooltipModule, UserAvatarComponent],
  template: `
    <div class="pr-info">
      @if (loading()) {
        <!-- Skeleton durante a busca do card (mesmo shimmer da linha do tempo) -->
        <div class="pr-info__author" aria-hidden="true">
          <div class="cime-skeleton sk-avatar"></div>
          <div class="pr-info__col sk-col">
            <div class="cime-skeleton sk-label"></div>
            <div class="cime-skeleton sk-value"></div>
          </div>
        </div>
        <div class="pr-info__facts" aria-hidden="true">
          @for (s of [1, 2, 3, 4]; track s) { <div class="cime-skeleton sk-chip"></div> }
        </div>
      } @else {
        <div class="pr-info__author">
          <app-user-avatar [name]="userName()" [imageUrl]="userPhoto()" [size]="34"></app-user-avatar>
          <div class="pr-info__col">
            <span class="pr-info__label">{{ authorLabel() }}</span>
            <strong class="pr-info__value">{{ userName() || '—' }}</strong>
            @if (openedAt() || updatedAt()) {
              <span class="pr-info__dates">
                @if (openedAt()) {
                  <span [matTooltip]="openedLabel() + ' ' + (openedAt() | date:'dd/MM/yyyy HH:mm')">
                    <mat-icon>event</mat-icon>{{ openedAt() | date:'dd/MM HH:mm' }}
                  </span>
                }
                @if (updatedAt()) {
                  <span [matTooltip]="'Última atualização ' + (updatedAt() | date:'dd/MM/yyyy HH:mm')">
                    <mat-icon>update</mat-icon>{{ updatedAt() | date:'dd/MM HH:mm' }}
                  </span>
                }
              </span>
            }
          </div>
        </div>

        @if (facts().length) {
          <div class="pr-info__facts">
            @for (f of facts(); track f.label) {
              <span class="pr-fact pr-fact--{{ f.tone || 'neutral' }}"
                    [matTooltip]="f.label + (f.tooltip ? '\n' + f.tooltip : '')" matTooltipClass="pr-fact-tooltip">
                <mat-icon>{{ f.icon }}</mat-icon>
                <span class="pr-fact__value">{{ f.value }}</span>
              </span>
            }
          </div>
        } @else {
          <span class="pr-info__empty">Busque um card para ver o resumo.</span>
        }
      }
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
      padding: 8px 12px;
    }
    .pr-info { display: flex; align-items: center; gap: 10px 18px; width: 100%; min-height: 44px; }
    .pr-info__author { display: flex; align-items: center; gap: 10px; flex: none; }
    .pr-info__col { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
    .pr-info__label { font-size: 10.5px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .pr-info__value { font-size: 13px; font-weight: 600; white-space: nowrap; }
    .pr-info__dates { display: flex; gap: 10px; margin-top: 2px; font-size: 11px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .pr-info__dates > span { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
    .pr-info__dates .mat-icon { font-size: 13px; width: 13px; height: 13px; color: var(--mat-sys-primary); }

    .pr-info__facts { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      padding-left: 14px; border-left: 1px solid rgba(255, 255, 255, 0.08); }
    .pr-info__empty { flex: 1; font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 45%, transparent); }

    .pr-fact {
      --fact-c: color-mix(in srgb, var(--mat-sys-on-surface) 75%, transparent);
      display: inline-flex; align-items: center; gap: 4px; max-width: 260px;
      height: 24px; padding: 0 9px 0 7px; border-radius: 12px;
      font-size: 11.5px; font-weight: 500; color: var(--fact-c);
      background: color-mix(in srgb, var(--fact-c) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--fact-c) 22%, transparent);
      cursor: default;
    }
    .pr-fact .mat-icon { font-size: 14px; width: 14px; height: 14px; flex: none; }
    .pr-fact__value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pr-fact--ok { --fact-c: #3fb950; }
    .pr-fact--warn { --fact-c: #d29922; }
    .pr-fact--info { --fact-c: var(--mat-sys-primary); }
    .pr-fact--muted { --fact-c: color-mix(in srgb, var(--mat-sys-on-surface) 45%, transparent); }

    .pr-info__actions { display: flex; align-items: center; gap: 4px; flex: none; margin-left: auto; }
    .pr-info__actions:empty { display: none; }
    .sk-avatar { width: 34px; height: 34px; border-radius: 50%; }
    .sk-col { gap: 6px; }
    .sk-label { width: 70px; height: 9px; }
    .sk-value { width: 110px; height: 12px; }
    .sk-chip { width: 96px; height: 24px; border-radius: 12px; }

    @media (max-width: 900px) {
      .pr-info { flex-wrap: wrap; }
      .pr-info__facts { flex-basis: 100%; padding-left: 0; border-left: none; }
    }
  `]
})
export class PrInfoCardComponent {
  readonly userName = input<string>('');
  readonly userPhoto = input<string | null>(null);
  readonly openedAt = input<string | null>(null);
  readonly updatedAt = input<string | null>(null);
  readonly authorLabel = input('Aberto por');
  readonly openedLabel = input('Aberto em');
  /** Resumo do card em etiquetas (0026). */
  readonly facts = input<InfoFact[]>([]);
  /** Mostra o skeleton no lugar de autor/resumo (os botões de ação continuam visíveis). */
  readonly loading = input(false);
}
