import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ReverseEngineeringService, ReverseIndexHit, ReverseModuleSummary } from '../../../services/reverse-engineering.service';

/**
 * Glossário de todos os módulos (0053): os itens GLO publicados, com os sinônimos (que também valem na busca: "RCA" acha
 * "A3"), o módulo (legado × revamp) e o significado; filtro por termo, sinônimo ou módulo.
 */
@Component({
  selector: 'app-re-glossary',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="bar">
      <input type="search" placeholder="Termo, sigla ou sinônimo (ex.: RCA, A3, SA3)…" [ngModel]="filter()" (ngModelChange)="filter.set($event)">
      <select [ngModel]="module()" (ngModelChange)="module.set($event)">
        <option value="">Todos os módulos</option>
        @for (m of modulesWithTerms(); track m.key) { <option [value]="m.key">{{ m.displayName || m.name }} ({{ m.world }})</option> }
      </select>
      <span class="muted">{{ shown().length }} termos</span>
    </div>
    @if (loading()) { <div class="state"><mat-spinner diameter="22"></mat-spinner></div> }
    <div class="terms">
      @for (t of shown(); track t.ref) {
        <div class="term">
          <div class="term__head">
            <b>{{ t.title }}</b>
            <button type="button" class="mod" (click)="goTo.emit({ module: t.moduleKey, doc: t.docType, item: t.itemId })">{{ t.moduleName || t.moduleKey }} · {{ t.itemId }}</button>
          </div>
          @if (t.synonyms?.length) {
            <div class="syn">@for (s of t.synonyms; track s) { <span class="chip">{{ s }}</span> }</div>
          }
          @if (t.snippet) { <div class="muted">{{ t.snippet }}</div> }
        </div>
      } @empty {
        @if (!loading()) { <div class="muted">Nenhum termo publicado ainda — o glossário nasce no levantamento funcional de cada módulo.</div> }
      }
    </div>
  `,
  styles: [`
    .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
    .bar input { flex: 1 1 260px; padding: 8px 10px; border-radius: 8px; background: rgba(0,0,0,.3); color: inherit; border: 1px solid rgba(255,255,255,.15); font: inherit; }
    .bar select { padding: 6px 8px; border-radius: 6px; background: rgba(0,0,0,.3); color: inherit; border: 1px solid rgba(255,255,255,.15); font: inherit; font-size: 12.5px; }
    .muted { font-size: 12px; opacity: .65; }
    .state { display: flex; justify-content: center; padding: 12px; }
    .terms { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; }
    .term { padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,.03); display: flex; flex-direction: column; gap: 4px; }
    .term__head { display: flex; align-items: baseline; gap: 8px; justify-content: space-between; }
    .mod { border: none; background: transparent; color: var(--mat-sys-primary); cursor: pointer; font: inherit; font-size: 11.5px; white-space: nowrap; }
    .syn { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { font-size: 11.5px; padding: 1px 7px; border-radius: 8px; background: rgba(255,255,255,.08); }
  `]
})
export class ReGlossaryComponent implements OnInit {
  private api = inject(ReverseEngineeringService);
  modules = input<ReverseModuleSummary[]>([]);
  goTo = output<{ module: string; doc: string; item?: string }>();
  terms = signal<ReverseIndexHit[]>([]);
  loading = signal(true);
  filter = signal('');
  module = signal('');

  modulesWithTerms = computed(() => {
    const keys = new Set(this.terms().map(t => t.moduleKey));
    return this.modules().filter(m => keys.has(m.key));
  });
  shown = computed(() => {
    const f = norm(this.filter());
    const m = this.module();
    return this.terms()
      .filter(t => !m || t.moduleKey === m)
      .filter(t => !f || norm(`${t.title} ${(t.synonyms ?? []).join(' ')} ${t.moduleName ?? ''} ${t.snippet}`).includes(f))
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  });

  ngOnInit() {
    this.api.search('', { kind: 'GLO', limit: 2000 }).subscribe({
      next: t => { this.terms.set(t); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }
}

const norm = (v: string) => (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
