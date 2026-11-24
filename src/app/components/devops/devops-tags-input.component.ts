import { Component, ViewEncapsulation, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { DevOpsService } from '../../services/devops.service';
import { DV_FORM_STYLES } from './devops.styles';
import { addTag, normalizeTag, removeTag, suggestTags } from './tags.logic';

interface TagOption { tag: string; create: boolean; }

/**
 * 0099 (Mesa de gestão): tags do card como no DevOps — chips, busca nas tags do projeto (autocomplete que ignora
 * caixa e acento) e "Criar tag «x»" quando a tag não existe. Enter/vírgula/`;` incluem o texto; Backspace no campo
 * vazio tira a última.
 */
@Component({
  selector: 'app-devops-tags-input',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatIconModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="dv-chips" [class.dv-chips--disabled]="disabled()" (click)="focusInput(box)">
      @for (t of tags(); track t) {
        <span class="dv-chip" [class.dv-chip--new]="isNew(t)" [attr.title]="isNew(t) ? 'Tag nova — será criada ao salvar' : t">
          <span>{{ t }}</span>
          @if (!disabled()) {
            <button type="button" (click)="remove(t); $event.stopPropagation()" [attr.aria-label]="'Remover a tag ' + t">
              <mat-icon>close</mat-icon>
            </button>
          }
        </span>
      }
      <input #box class="dv-chips__input" [ngModel]="query()" (ngModelChange)="onType($event)" [disabled]="disabled()"
             [matAutocomplete]="auto" [placeholder]="tags().length ? '' : (placeholder() || 'Adicionar tag')"
             (keydown)="onKey($event)" (focus)="load()" autocomplete="off" aria-label="Tags">
    </div>
    <mat-autocomplete #auto="matAutocomplete" class="dv-panel" [displayWith]="blank" (optionSelected)="pick($event.option.value, box)">
      @if (suggestions().create; as c) {
        <mat-option [value]="{ tag: c, create: true }" class="dv-opt__create">
          <mat-icon>add</mat-icon><span class="dv-opt__name">Criar tag «{{ c }}»</span>
        </mat-option>
      }
      @for (t of suggestions().options; track t) {
        <mat-option [value]="{ tag: t, create: false }"><span class="dv-opt__name">{{ t }}</span></mat-option>
      }
      @if (loading()) { <mat-option class="dv-opt--status" disabled>Carregando as tags do projeto…</mat-option> }
      @else if (error()) { <mat-option class="dv-opt--status" disabled>{{ error() }}</mat-option> }
      @else if (!suggestions().options.length && !suggestions().create) {
        <mat-option class="dv-opt--status" disabled>{{ query() ? 'Nenhuma tag com esse texto' : 'Digite para buscar ou criar' }}</mat-option>
      }
    </mat-autocomplete>
  `,
  styles: [DV_FORM_STYLES]
})
export class DevOpsTagsInputComponent {
  private api = inject(DevOpsService);

  readonly tags = model<string[]>([]);
  readonly disabled = input(false);
  readonly placeholder = input<string | null>(null);

  readonly query = signal('');
  readonly all = signal<string[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private loaded = false;

  private trigger = viewChild(MatAutocompleteTrigger);

  readonly suggestions = computed(() => suggestTags(this.all(), this.tags(), this.query()));

  /** Tags do projeto (cache curto no serviço); carrega no primeiro foco. */
  load(): void {
    if (this.loaded || this.loading()) return;
    this.loading.set(true);
    this.api.tags().subscribe({
      next: (t) => { this.all.set(t); this.loaded = true; this.loading.set(false); },
      error: () => { this.error.set('Não foi possível carregar as tags — digite e tecle Enter.'); this.loading.set(false); }
    });
  }

  isNew(t: string): boolean {
    return this.loaded && !this.all().some((a) => a.toLowerCase() === t.toLowerCase());
  }

  focusInput(el: HTMLInputElement): void {
    if (!this.disabled()) el.focus();
  }

  /** O autocomplete não escreve o objeto da opção no campo. */
  readonly blank = (v: unknown) => (typeof v === 'string' ? v : '');

  onType(v: unknown): void {
    if (v != null && typeof v !== 'string') return; // opção escolhida: quem trata é o pick()
    const s = v ?? '';
    // Vírgula/; digitados (ou colados) fecham a tag, como no DevOps.
    if (/[;,]/.test(s)) {
      const parts = s.split(/[;,]/);
      const rest = parts.pop() ?? '';
      let list = this.tags();
      for (const p of parts) list = addTag(list, p, this.all());
      this.tags.set(list);
      this.query.set(rest);
      return;
    }
    this.query.set(s);
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      if (this.trigger()?.activeOption) return; // o autocomplete escolhe a opção destacada
      e.preventDefault();
      this.commitTyped();
    } else if (e.key === 'Backspace' && !this.query() && this.tags().length) {
      this.tags.set(this.tags().slice(0, -1));
    }
  }

  private commitTyped(): void {
    const q = normalizeTag(this.query());
    if (!q) return;
    this.tags.set(addTag(this.tags(), q, this.all()));
    this.query.set('');
  }

  pick(opt: TagOption, box: HTMLInputElement): void {
    this.tags.set(addTag(this.tags(), opt.tag, this.all()));
    this.query.set('');
    box.value = '';
    // Continua no campo para incluir a próxima.
    setTimeout(() => this.trigger()?.openPanel());
  }

  remove(t: string): void {
    this.tags.set(removeTag(this.tags(), t));
  }
}
