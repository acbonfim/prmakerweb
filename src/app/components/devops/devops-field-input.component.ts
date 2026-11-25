import { Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DevOpsService } from '../../services/devops.service';
import { htmlToMd, mdToHtml } from '../../helpers/markdown';
import { PmComboComponent, PmComboOption } from '../pm-combo/pm-combo.component';
import { booleanValue, displayValue, inputKind } from './card-edit.logic';
import {
  DevOpsClassificationNode, DevOpsFieldDef, DevOpsPerson, identityImage, identityKey, identityName
} from './devops.model';
import { DV_FORM_STYLES } from './devops.styles';

/** Quantas pessoas a busca pede ao servidor de uma vez. */
const PEOPLE_TOP = 50;
/** Qualquer texto vale (o DevOps valida; fora da lista fica o aviso). */
const ANY_TEXT = (t: string): string | null => t;
/** Pessoa fora da lista: só e-mail. */
const EMAIL_ONLY = (t: string): string | null => (/@/.test(t) ? t : null);

/**
 * 0099 (Mesa de gestão): um campo do card do DevOps com o controle do tipo — picklist quando há `allowedValues`,
 * Área/Iteração pela árvore, pessoas com avatar, número, data, sim/não, texto, texto longo e HTML (editado como texto
 * simples — markdown — com prévia). Campo somente leitura só mostra o valor.
 *
 * Ajustes 1: picklist, árvore e pessoas no `app-pm-combo` (digitação que filtra, teclado, painel do PRMake); pessoas
 * com busca no servidor (`GET DevOps/meta/people?q=`, debounce de 250 ms) — acha quem não é membro de time.
 */
@Component({
  selector: 'app-devops-field-input',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, PmComboComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @let f = field();
    @let k = kind();
    @if (readOnly()) {
      <div class="dv-ro">{{ shown() }}</div>
    } @else {
      @switch (k) {
        @case ('picklist') {
          <app-pm-combo [options]="pickOptions()" [value]="strValue()" (valueChange)="setValue($event)" [allowEmpty]="true"
                        [acceptCustom]="anyText" [warn]="outOfList()" [disabled]="disabled()" [placeholder]="placeholder()"
                        [ariaLabel]="f.name" noOptionsText="Sem opções na lista do DevOps" />
          @if (outOfList()) { <span class="dv-hint dv-hint--warn">Valor fora da lista do DevOps</span> }
        }
        @case ('area') { <ng-container *ngTemplateOutlet="tree" /> }
        @case ('iteration') { <ng-container *ngTemplateOutlet="tree" /> }
        @case ('identity') {
          <app-pm-combo [options]="peopleOptions()" [value]="personKey()" (valueChange)="pickPerson($event)" [displayText]="shown()"
                        [remote]="true" [debounceMs]="250" (queryChange)="searchPeople($event)" [loading]="loading()" [error]="loadError()"
                        loadingText="Buscando…" emptyText="Ninguém com esse nome" noOptionsText="Digite o nome ou o e-mail"
                        [allowEmpty]="true" emptyLabel="(ninguém)" [acceptCustom]="emailOnly" icon="person_outline"
                        [disabled]="disabled()" [placeholder]="placeholder() || 'Sem responsável'" [ariaLabel]="f.name" />
        }
        @case ('number') {
          <input class="dv-input" type="number" [ngModel]="value()" (ngModelChange)="setValue($event === '' || $event == null ? null : +$event)"
                 [disabled]="disabled()" [placeholder]="placeholder()" [attr.aria-label]="f.name"
                 [attr.step]="f.type === 'double' ? 'any' : 1">
        }
        @case ('date') {
          <input class="dv-input" type="date" [ngModel]="dateText()" (ngModelChange)="setValue($event || null)"
                 [disabled]="disabled()" [attr.aria-label]="f.name">
        }
        @case ('boolean') {
          <label class="dv-check">
            <input type="checkbox" [ngModel]="isOn()" (ngModelChange)="setValue(!!$event)" [disabled]="disabled()">
            {{ isOn() ? 'Sim' : 'Não' }}
          </label>
        }
        @case ('html') {
          @if (editing()) {
            <textarea class="dv-textarea" [ngModel]="md()" (ngModelChange)="onMarkdown($event)" [disabled]="disabled()"
                      [attr.aria-label]="f.name" rows="6" placeholder="Texto simples (aceita markdown: **negrito**, listas com -, tabelas…)"></textarea>
            <span class="dv-hint">Prévia</span>
            <div class="dv-html" [innerHTML]="htmlText()"></div>
            <span class="dv-line">
              <button type="button" class="dv-linkbtn" (click)="editing.set(false)">Fechar edição</button>
              @if (htmlEdited()) { <button type="button" class="dv-linkbtn" (click)="undoHtml()">Desfazer</button> }
            </span>
          } @else {
            <div class="dv-html" [innerHTML]="htmlText()"></div>
            @if (!disabled()) {
              <span class="dv-line">
                <button type="button" class="dv-linkbtn" (click)="startHtml()">Editar como texto</button>
                @if (htmlEdited()) { <button type="button" class="dv-linkbtn" (click)="undoHtml()">Desfazer</button> }
              </span>
            }
          }
        }
        @case ('multiline') {
          <textarea class="dv-textarea" [ngModel]="text()" (ngModelChange)="setValue($event)" [disabled]="disabled()"
                    [placeholder]="placeholder()" [attr.aria-label]="f.name" rows="4"></textarea>
        }
        @default {
          <input class="dv-input" [ngModel]="text()" (ngModelChange)="setValue($event)" [disabled]="disabled()"
                 [placeholder]="placeholder()" [attr.aria-label]="f.name">
        }
      }
    }

    <ng-template #tree>
      <app-pm-combo [options]="nodeOptions()" [value]="strValue()" (valueChange)="setValue($event)" (opened)="loadNodes()"
                    [acceptCustom]="anyText" [warn]="outOfList()" [loading]="loading()" [error]="loadError()" [limit]="400"
                    [icon]="kind() === 'area' ? 'account_tree' : 'event_repeat'" emptyText="Nenhum caminho com esse texto"
                    [disabled]="disabled()" [placeholder]="placeholder() || (kind() === 'area' ? 'Área' : 'Iteração')"
                    [ariaLabel]="field().name" />
      @if (outOfList()) { <span class="dv-hint dv-hint--warn">Caminho não encontrado no projeto</span> }
    </ng-template>
  `,
  styles: [DV_FORM_STYLES]
})
export class DevOpsFieldInputComponent {
  private api = inject(DevOpsService);
  private destroyRef = inject(DestroyRef);

  readonly field = input.required<DevOpsFieldDef>();
  readonly value = model<unknown>(null);
  /** Booleano do DevOps (o padrão chega como "0"/"1"). */
  readonly isOn = computed(() => booleanValue(this.value()));
  readonly disabled = input(false);
  readonly placeholder = input<string>('');

  readonly kind = computed(() => inputKind(this.field()));
  readonly readOnly = computed(() => this.field().readOnly);
  readonly shown = computed(() => {
    const v = this.value();
    return this.kind() === 'identity' ? identityName(v) : displayValue(this.field(), v);
  });
  readonly avatar = computed(() => identityImage(this.value()));
  /** Valor como texto (picklist/árvore). */
  readonly strValue = computed(() => {
    const v = this.value();
    return v == null || v === '' ? null : `${v}`;
  });
  /** uniqueName da pessoa escolhida (chave do combo). */
  readonly personKey = computed(() => identityKey(this.value()) || null);
  readonly anyText = ANY_TEXT;
  readonly emailOnly = EMAIL_ONLY;

  /** Texto dos campos simples (texto/texto longo) — separado do valor para digitar livremente. */
  readonly text = signal('');
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  /** Pessoas da última busca no servidor e o texto buscado. */
  private people = signal<DevOpsPerson[]>([]);
  private peopleQuery = signal('');
  private peopleSub: Subscription | null = null;
  private nodes = signal<DevOpsClassificationNode[] | null>(null);

  // HTML editado como texto simples (markdown) com prévia.
  readonly editing = signal(false);
  readonly md = signal('');
  private htmlOriginal: unknown = undefined;
  readonly htmlEdited = signal(false);

  readonly dateText = computed(() => {
    const v = this.value();
    return v ? `${v}`.slice(0, 10) : '';
  });
  readonly htmlText = computed(() => `${this.value() ?? ''}`);

  readonly pickOptions = computed<PmComboOption[]>(() =>
    (this.field().allowedValues ?? []).map((o) => ({ value: o, label: o })));

  /** Árvore: sem busca mostra o nome do nó com recuo; com busca, o caminho inteiro. */
  readonly nodeOptions = computed<PmComboOption[]>(() =>
    (this.nodes() ?? []).map((n) => ({ value: n.path, label: n.path, short: n.name, depth: n.depth })));

  /** Pessoas da busca; sem texto, a escolhida aparece no topo (o avatar dela vai para o campo). */
  readonly peopleOptions = computed<PmComboOption[]>(() => {
    const list = this.people().map(personOption);
    const cur = this.value();
    const key = identityKey(cur);
    if (key && !this.peopleQuery() && !list.some((o) => o.value.toLowerCase() === key.toLowerCase())) {
      list.unshift(personOption({ displayName: identityName(cur) || key, uniqueName: key, imageUrl: identityImage(cur) }));
    }
    return list;
  });

  /** Valor digitado que não está na lista (picklist) ou na árvore (área/iteração). */
  readonly outOfList = computed(() => {
    const v = `${this.value() ?? ''}`.trim();
    if (!v) return false;
    const k = this.kind();
    if (k === 'picklist') return !(this.field().allowedValues ?? []).some((o) => o === v);
    if (k === 'area' || k === 'iteration') {
      const nodes = this.nodes();
      return !!nodes && !nodes.some((n) => n.path.toLowerCase() === v.toLowerCase());
    }
    return false;
  });

  constructor() {
    // O texto acompanha o valor vindo de fora (carregar o card, desfazer).
    effect(() => {
      const v = this.value();
      untracked(() => {
        const t = v == null ? '' : `${v}`;
        if (t !== this.text()) this.text.set(t);
      });
    });
    this.destroyRef.onDestroy(() => this.peopleSub?.unsubscribe());
  }

  setValue(v: unknown): void {
    this.value.set(v);
  }

  // ── Pessoas ──

  /** Busca no servidor (o combo já espera 250 ms entre teclas); a resposta antiga não sobrescreve a nova. */
  searchPeople(q: string): void {
    const query = (q ?? '').trim();
    this.peopleQuery.set(query);
    this.peopleSub?.unsubscribe();
    this.loading.set(true);
    this.loadError.set(null);
    this.peopleSub = this.api.people(query, PEOPLE_TOP).subscribe({
      next: (p) => { this.people.set(p); this.loading.set(false); },
      error: () => {
        this.people.set([]);
        this.loadError.set('Não foi possível buscar as pessoas — digite o e-mail.');
        this.loading.set(false);
      }
    });
  }

  /** Pessoa escolhida no combo (pelo uniqueName); e-mail digitado vale como está; vazio limpa. */
  pickPerson(key: string | null): void {
    if (!key) { this.value.set(null); return; }
    if (key.toLowerCase() === identityKey(this.value()).toLowerCase()) return;
    const p = this.people().find((x) => x.uniqueName.toLowerCase() === key.toLowerCase());
    this.value.set(p ? { displayName: p.displayName, uniqueName: p.uniqueName, imageUrl: p.imageUrl ?? null } : key);
  }

  // ── Área / Iteração ──

  loadNodes(): void {
    if (this.nodes() || this.loading()) return;
    this.loading.set(true);
    this.loadError.set(null);
    const src = this.kind() === 'iteration' ? this.api.iterations() : this.api.areas();
    src.subscribe({
      next: (n) => { this.nodes.set(n ?? []); this.loading.set(false); },
      error: () => { this.loadError.set('Não foi possível carregar a árvore — digite o caminho.'); this.loading.set(false); }
    });
  }

  // ── HTML ──

  startHtml(): void {
    if (this.htmlOriginal === undefined) this.htmlOriginal = this.value();
    this.md.set(htmlToMd(`${this.value() ?? ''}`));
    this.editing.set(true);
  }

  onMarkdown(md: string): void {
    this.md.set(md ?? '');
    this.value.set(md?.trim() ? mdToHtml(md) : '');
    this.htmlEdited.set(true);
  }

  undoHtml(): void {
    if (this.htmlOriginal !== undefined) this.value.set(this.htmlOriginal);
    this.md.set(htmlToMd(`${this.value() ?? ''}`));
    this.htmlEdited.set(false);
  }
}

function personOption(p: DevOpsPerson): PmComboOption {
  return {
    value: p.uniqueName,
    label: p.displayName || p.uniqueName,
    hint: p.uniqueName && p.uniqueName !== p.displayName ? p.uniqueName : null,
    avatar: { name: p.displayName || p.uniqueName, imageUrl: p.imageUrl ?? null },
    data: p,
  };
}
