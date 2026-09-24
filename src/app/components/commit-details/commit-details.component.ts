import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { getCommitAuthor, getCommitDate, getCommitDescription, getCommitSha, getCommitTitle } from '../../helpers/commit';

/** Autor, data, SHA e mensagem de um commit (visual do passo "Commit" da geração com IA). */
@Component({
  selector: 'app-commit-details',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="commit-detail-row">
      <mat-icon class="commit-detail-icon">person</mat-icon>
      <span class="commit-detail-label">Autor:</span>
      <span class="commit-detail-value">{{ author() }}</span>
    </div>
    <div class="commit-detail-row">
      <mat-icon class="commit-detail-icon">schedule</mat-icon>
      <span class="commit-detail-label">Data:</span>
      <span class="commit-detail-value">{{ date() }}</span>
    </div>
    <div class="commit-detail-row">
      <mat-icon class="commit-detail-icon">tag</mat-icon>
      <span class="commit-detail-label">SHA:</span>
      <span class="commit-detail-value commit-sha-full">{{ sha().substring(0, 12) }}</span>
    </div>
    <div class="commit-message-text">{{ title() }}</div>
    @if (body()) {
      <div class="commit-body-text">{{ body() }}</div>
    }
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: var(--surface-1, #2a2a2a);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 16px;
    }

    .commit-detail-row {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-on-surface);
      font-size: 14px;
    }

    .commit-detail-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent);
    }

    .commit-detail-label { color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); font-weight: 500; }
    .commit-detail-value { color: var(--mat-sys-on-surface); }
    .commit-sha-full { font-family: 'Courier New', monospace; font-size: 12px; color: var(--mat-sys-primary); }

    .commit-message-text {
      color: var(--mat-sys-on-surface);
      font-size: 14px;
      font-weight: 500;
      padding-left: 22px;
      margin-top: 4px;
    }

    .commit-body-text {
      color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent);
      font-size: 13px;
      padding-left: 22px;
      white-space: pre-wrap;
    }
  `]
})
export class CommitDetailsComponent {
  readonly commit = input<any>(null);

  readonly author = computed(() => getCommitAuthor(this.commit()));
  readonly date = computed(() => getCommitDate(this.commit()));
  readonly sha = computed(() => getCommitSha(this.commit()));
  readonly title = computed(() => getCommitTitle(this.commit()));
  readonly body = computed(() => getCommitDescription(this.commit()));
}
