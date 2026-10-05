import { Component, OnChanges, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PopoverModule } from 'primeng/popover';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { ReverseEngineeringService, ReverseTrap } from '../../../services/reverse-engineering.service';

/**
 * Armadilhas do módulo (0054): o que já deu errado (sintoma, causa, diagnóstico, cards), ligado aos itens da engenharia
 * reversa. As vindas das análises/migração ficam "a conferir" até um aprovador conferir. As análises recebem junto com o item.
 */
@Component({
  selector: 'app-re-traps',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, PopoverModule, PlanMarkdownPipe],
  template: `
    <button mat-stroked-button type="button" class="traps-btn" [class.traps-btn--review]="toReview() > 0" (click)="pop.toggle($event)"
            matTooltip="O que já deu errado neste módulo, ligado aos itens">
      <mat-icon>report</mat-icon>Armadilhas ({{ traps().length }}){{ toReview() ? ' · ' + toReview() + ' a conferir' : '' }}
    </button>
    <p-popover #pop appendTo="body" styleClass="re-popover">
      <ng-template #content>
        <div class="re-popover__body traps">
          <h3><mat-icon>report</mat-icon>Armadilhas ({{ traps().length }}){{ toReview() ? ' · ' + toReview() + ' a conferir' : '' }}
            @if (migratedAt()) { <span class="muted">· antigas migradas em {{ date(migratedAt()) }}</span> }</h3>
          <p class="muted">O que já deu errado neste módulo, ligado aos itens. As análises de bug recebem a armadilha junto com o item; as marcadas "a conferir"
            vieram de análises ou da migração automática das antigas.</p>
          @for (t of traps(); track t.id) {
            <div class="trap" [class.trap--review]="t.needsReview">
              <div class="trap__head">
                <b>{{ t.title }}</b>
                @if (t.needsReview) { <span class="chip chip--warn">a conferir</span> }
                @for (i of t.items; track i) { <button type="button" class="chip chip--link" (click)="pop.hide(); goTo.emit(i)">{{ i }}</button> }
                @for (c of t.cards; track c) { <span class="chip">card {{ c }}</span> }
                <span class="spacer"></span>
                @if (canApprove() && t.needsReview) { <button type="button" class="act" (click)="confirm(t)">Conferir</button> }
                @if (canApprove()) { <button type="button" class="act act--warn" (click)="remove(t)" matTooltip="Remover"><mat-icon>delete</mat-icon></button> }
              </div>
              <div class="md" [innerHTML]="t.text | planMarkdown"></div>
              <div class="muted">{{ originLabel(t.origin) }} · {{ t.createdBy }} · {{ date(t.createdAt) }}{{ t.reviewedBy ? ' · conferida por ' + t.reviewedBy : '' }}</div>
            </div>
          } @empty { <div class="muted">Nenhuma armadilha registrada ainda.</div> }
        </div>
      </ng-template>
    </p-popover>
  `,
  styles: [`
    .traps-btn mat-icon, .traps h3 mat-icon { color: #f85149; }
    .traps-btn--review { border-color: rgba(210,153,34,.6); }
    .traps { font-size: 13px; }
    .traps h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; font-size: 14.5px; }
    .traps h3 mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .muted { font-size: 12px; opacity: .65; }
    .trap { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
    .trap--review { border-left: 3px solid #d29922; padding-left: 8px; }
    .trap__head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .spacer { flex: 1; }
    .chip { font-size: 11px; padding: 1px 7px; border-radius: 8px; background: rgba(255,255,255,.07); }
    .chip--warn { color: #d29922; background: rgba(210,153,34,.14); }
    .chip--link { border: none; cursor: pointer; color: var(--mat-sys-primary); font-family: 'JetBrains Mono', monospace; }
    .act { border: 1px solid rgba(255,255,255,.2); background: transparent; color: inherit; border-radius: 12px; padding: 1px 10px; cursor: pointer; font-size: 12px;
      display: inline-flex; align-items: center; }
    .act--warn { border: none; opacity: .6; }
    .act mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .md { font-size: 13px; line-height: 1.5; margin: 4px 0; }
  `]
})
export class ReTrapsComponent implements OnChanges {
  private api = inject(ReverseEngineeringService);
  private snack = inject(MatSnackBar);
  moduleKey = input.required<string>();
  canApprove = input(false);
  migratedAt = input<string | null | undefined>(null);
  stamp = input<number | undefined>(0);
  changed = output<void>();
  goTo = output<string>();
  traps = signal<ReverseTrap[]>([]);
  toReview = () => this.traps().filter(t => t.needsReview).length;

  ngOnChanges() { this.load(); }

  load() { this.api.traps(this.moduleKey()).subscribe({ next: t => this.traps.set(t) }); }

  confirm(t: ReverseTrap) {
    this.api.updateTrap(t.id, { confirm: true }).subscribe({ next: () => { this.load(); this.changed.emit(); }, error: e => this.toast(e) });
  }

  remove(t: ReverseTrap) {
    if (!confirm(`Remover a armadilha "${t.title}"?`)) return;
    this.api.deleteTrap(t.id).subscribe({ next: () => { this.load(); this.changed.emit(); }, error: e => this.toast(e) });
  }

  originLabel(o: string) { return ({ migrated: 'migrada da base antiga', suggestion: 'de uma sugestão', learning: 'de uma análise', manual: 'manual' } as any)[o] ?? o; }
  date(at?: string | null) { return at ? new Date(at).toLocaleDateString('pt-BR') : ''; }
  private toast(e: any) { this.snack.open(e?.error?.error ?? 'Não foi possível concluir.', 'OK', { duration: 6000 }); }
}
