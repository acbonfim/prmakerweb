import { Component, computed, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ArchitectureProject } from '../../../services/architecture.service';
import { ConnectionSentence, buildConnections, friendlyName } from './kb-friendly';
import { KbGlossComponent } from './kb-gloss.component';

/**
 * "Com quem conversa" (0038, modo Simples): as ligações do projeto em frases por tipo — "Avisa X quando algo
 * acontece", "Y chama este sistema diretamente". O detalhe técnico (evento, fila, tabela, evidência) fica no tooltip.
 */
@Component({
  selector: 'app-kb-connections',
  standalone: true,
  imports: [NgTemplateOutlet, MatIconModule, MatTooltipModule, KbGlossComponent],
  template: `
    @if (data().count) {
      <section class="cx" aria-label="Com quem conversa">
        <button type="button" class="cx__head" (click)="open.set(!open())" [attr.aria-expanded]="open()">
          <mat-icon>{{ open() ? 'expand_more' : 'chevron_right' }}</mat-icon>
          <strong>Com quem conversa</strong>
          <span class="cx__muted">{{ data().count }} {{ data().count === 1 ? 'sistema' : 'sistemas' }}</span>
          <span class="cx__spacer"></span>
          <span class="cx__map" role="link" tabindex="0" (click)="$event.stopPropagation(); openMap.emit()" (keydown.enter)="$event.stopPropagation(); openMap.emit()">
            <mat-icon>hub</mat-icon>ver no mapa
          </span>
        </button>
        @if (open()) {
          <div class="cx__body">
            @if (data().out.length) {
              <h4>O que {{ name() }} faz</h4>
              @for (s of data().out; track s.kind) { <ng-container [ngTemplateOutlet]="sentence" [ngTemplateOutletContext]="{ $implicit: s, dir: 'out' }"></ng-container> }
            }
            @if (data().in.length) {
              <h4>Quem conversa com {{ name() }}</h4>
              @for (s of data().in; track s.kind) { <ng-container [ngTemplateOutlet]="sentence" [ngTemplateOutletContext]="{ $implicit: s, dir: 'in' }"></ng-container> }
            }
            <div class="cx__hint"><mat-icon>info</mat-icon>Passe o mouse sobre um nome para ver o detalhe técnico da ligação.</div>
          </div>
        }
      </section>
    }

    <ng-template #sentence let-s let-dir="dir">
      <p class="cx__line">
        <mat-icon [style.color]="s.color">{{ s.icon }}</mat-icon>
        <span>
          {{ s.pre }}@for (t of visible(s, dir); track t.key; let i = $index; let last = $last) {@if (i > 0) {<ng-container>{{ last && !hidden(s, dir) ? ' e ' : ', ' }}</ng-container>}@if (t.mapped) {<button type="button" class="cx__name" [matTooltip]="t.tip" matTooltipClass="kb-gloss-tip" (click)="openProject.emit(t.key)">{{ t.name }}</button>} @else {<strong class="cx__ext" [matTooltip]="t.tip" matTooltipClass="kb-gloss-tip" tabindex="0">{{ t.name }}</strong>}}@if (hidden(s, dir)) { e <button type="button" class="cx__more" (click)="expand(s, dir)">mais {{ hidden(s, dir) }}</button>}{{ s.post }}@if (s.tag) { <span class="cx__tag">(<app-kb-gloss [text]="s.tag"></app-kb-gloss>)</span>}
        </span>
      </p>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .cx { margin: 12px 0 6px; border-radius: 10px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.02); }
    .cx__head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: none; background: transparent; color: inherit;
      font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
    .cx__muted { font-size: 12px; opacity: .65; }
    .cx__spacer { flex: 1 1 auto; }
    .cx__map { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--mat-sys-primary); cursor: pointer; }
    .cx__map mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .cx__body { padding: 0 14px 12px; }
    h4 { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; margin: 8px 0 4px; opacity: .65; font-weight: 700; }
    .cx__line { display: flex; align-items: flex-start; gap: 8px; margin: 6px 0; font-size: 14px; line-height: 1.55; }
    .cx__line mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; margin-top: 2px; }
    .cx__name { border: none; background: transparent; padding: 0; color: var(--mat-sys-primary); font: inherit; font-weight: 600; cursor: pointer; }
    .cx__name:hover { text-decoration: underline; }
    .cx__ext { font-weight: 600; cursor: help; }
    .cx__more { border: none; background: rgba(255,255,255,.07); border-radius: 9px; padding: 0 7px; color: var(--mat-sys-primary); font: inherit; font-size: 12.5px; cursor: pointer; }
    .cx__tag { font-size: 12.5px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .cx__hint { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; opacity: .55; }
    .cx__hint mat-icon { font-size: 15px; width: 15px; height: 15px; }
  `]
})
export class KbConnectionsComponent {
  readonly project = input<ArchitectureProject | null>(null);
  readonly projects = input<ArchitectureProject[]>([]);
  readonly openProject = output<string>();
  readonly openMap = output<void>();

  readonly open = signal(true);
  private readonly expanded = signal<Set<string>>(new Set());
  private readonly limit = 6;

  readonly data = computed(() => buildConnections(this.project(), this.projects()));
  readonly name = computed(() => friendlyName(this.project()));

  visible(s: ConnectionSentence, dir: string) {
    return this.expanded().has(dir + s.kind) ? s.targets : s.targets.slice(0, this.limit);
  }

  hidden(s: ConnectionSentence, dir: string): number {
    return this.expanded().has(dir + s.kind) ? 0 : Math.max(0, s.targets.length - this.limit);
  }

  expand(s: ConnectionSentence, dir: string): void {
    this.expanded.update(set => new Set(set).add(dir + s.kind));
  }
}
