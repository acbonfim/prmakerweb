import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GovernanceStore, STANDARDS_VIEWS, StandardsView } from '../governance.store';
import { GovStandardsCatalogComponent } from './gov-standards-catalog.component';
import { GovStandardsImportComponent } from './gov-standards-import.component';

/**
 * Padrões de banco e de aplicação (0101): convenções que a análise e a correção seguem ao escrever SQL, migrações e
 * código — diferente das regras (guardrails de ação). Três vistas (`?vista=`): catálogo, importar (wiki / engenharia
 * reversa, com rascunho e aprovação) e aderência (achados da trilha).
 */
@Component({
  selector: 'app-gov-standards',
  standalone: true,
  imports: [MatIconModule, GovStandardsCatalogComponent, GovStandardsImportComponent],
  template: `
    <div class="std-nav">
      <div class="seg" role="tablist" aria-label="Vistas dos padrões">
        @for (v of views; track v.key) {
          <button type="button" role="tab" class="seg__item" [class.on]="store.standardsView() === v.key" [attr.aria-selected]="store.standardsView() === v.key"
                  (click)="setView(v.key)"><mat-icon>{{ v.icon }}</mat-icon>{{ v.label }}</button>
        }
      </div>
      <span class="muted">Padrões são convenções que a análise e a correção seguem ao escrever SQL, migrações e código; as regras barram ações.</span>
    </div>
    @switch (store.standardsView()) {
      @case ('importar') { <app-gov-standards-import></app-gov-standards-import> }
      @default { <app-gov-standards-catalog></app-gov-standards-catalog> }
    }
  `,
  styleUrls: ['../governance-shared.css'],
  styles: [`
    .std-nav { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .seg__item { display: inline-flex; align-items: center; gap: 6px; }
    .seg__item mat-icon { font-size: 17px; width: 17px; height: 17px; }
  `],
})
export class GovStandardsComponent {
  readonly store = inject(GovernanceStore);
  readonly views = STANDARDS_VIEWS;

  setView(v: StandardsView): void {
    if (v === this.store.standardsView()) return;
    this.store.select('vista', v === 'catalogo' ? null : v);
  }
}
