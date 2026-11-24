import { Component, computed, inject, input, model, signal } from '@angular/core';
import { DevOpsService } from '../../services/devops.service';
import { PmComboComponent, PmComboOption } from '../pm-combo/pm-combo.component';
import { mergeDistinct } from '../pm-combo/pm-combo.logic';
import { normalizeTag } from './tags.logic';

/**
 * 0099 (Mesa de gestão): tags do card como no DevOps — chips, busca nas tags do projeto (ignora caixa e acento) e
 * "Criar tag «x»" quando a tag não existe. Enter/vírgula/`;` incluem o texto; Backspace no campo vazio tira a última.
 *
 * Ajustes 1: montado no `app-pm-combo` (painel do PRMake). `suggest` acrescenta sugestões de fora do DevOps (ex.: as
 * tags usadas nos épicos), que aparecem primeiro com a dica `suggestHint`.
 */
@Component({
  selector: 'app-devops-tags-input',
  standalone: true,
  imports: [PmComboComponent],
  template: `
    <app-pm-combo [multiple]="true" [options]="options()" [values]="tags()" (valuesChange)="tags.set($event)" (opened)="load()"
                  createLabel="Criar tag" [acceptCustom]="clean" separators=",;" [markNew]="isNew" [newTitle]="newTitle()"
                  [loading]="loading()" [error]="error()" loadingText="Carregando as tags do projeto…"
                  noOptionsText="Digite para buscar ou criar" emptyText="Nenhuma tag com esse texto"
                  [disabled]="disabled()" [placeholder]="placeholder() || 'Adicionar tag'" ariaLabel="Tags" />
  `,
})
export class DevOpsTagsInputComponent {
  private api = inject(DevOpsService);

  readonly tags = model<string[]>([]);
  readonly disabled = input(false);
  readonly placeholder = input<string | null>(null);
  /** Sugestões extras (aparecem antes das do projeto). */
  readonly suggest = input<readonly string[]>([]);
  readonly suggestHint = input<string | null>(null);
  readonly newTitle = input('Tag nova — será criada ao salvar');

  readonly all = signal<string[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private loaded = signal(false);

  readonly options = computed<PmComboOption[]>(() => {
    const extra = mergeDistinct(this.suggest());
    const hint = this.suggestHint();
    const project = [...this.all()].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    return mergeDistinct(extra, project).map((t, i) => ({ value: t, label: t, hint: i < extra.length ? hint : null }));
  });

  /** Tag limpa (sem `;` e espaços sobrando); vazia não entra. */
  readonly clean = (t: string): string | null => normalizeTag(t) || null;

  /** Tag que não existe no projeto nem nas sugestões (só depois de carregar as do projeto). */
  readonly isNew = (t: string): boolean => {
    if (!this.loaded()) return false;
    const k = t.toLowerCase();
    return !this.all().some((a) => a.toLowerCase() === k) && !this.suggest().some((a) => a.toLowerCase() === k);
  };

  /** Tags do projeto (cache curto no serviço); carrega no primeiro foco. */
  load(): void {
    if (this.loaded() || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.tags().subscribe({
      next: (t) => { this.all.set(t); this.loaded.set(true); this.loading.set(false); },
      error: () => { this.error.set('Não foi possível carregar as tags — digite e tecle Enter.'); this.loading.set(false); }
    });
  }
}
