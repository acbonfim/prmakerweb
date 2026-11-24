import { Component, ViewEncapsulation, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DevOpsService } from '../../services/devops.service';
import { htmlToMd, mdToHtml } from '../../helpers/markdown';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { fold } from './board.logic';
import { displayValue, inputKind } from './card-edit.logic';
import {
  DevOpsClassificationNode, DevOpsFieldDef, DevOpsPerson, identityImage, identityName
} from './devops.model';
import { DV_FORM_STYLES } from './devops.styles';

/** Quantas opções o autocomplete mostra de uma vez (as listas de área/pessoas passam de mil). */
const MAX_OPTIONS = 80;

/**
 * 0099 (Mesa de gestão): um campo do card do DevOps com o controle do tipo — picklist com autocomplete quando há
 * `allowedValues`, Área/Iteração pela árvore (autocomplete do caminho), pessoas com autocomplete e avatar, número,
 * data, sim/não, texto, texto longo e HTML (editado como texto simples — markdown — com prévia). Campo somente
 * leitura só mostra o valor.
 */
@Component({
  selector: 'app-devops-field-input',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, MatAutocompleteModule, MatIconModule, MatTooltipModule, UserAvatarComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @let f = field();
    @let k = kind();
    @if (readOnly()) {
      <div class="dv-ro">{{ shown() }}</div>
    } @else {
      @switch (k) {
        @case ('picklist') {
          <input class="dv-input" [class.dv-input--warn]="outOfList()" [ngModel]="text()" (ngModelChange)="onText($event)"
                 (focus)="query.set('')" (blur)="commitPick()" [matAutocomplete]="pickAuto" [disabled]="disabled()"
                 [placeholder]="placeholder()" [attr.aria-label]="f.name" autocomplete="off">
          <mat-autocomplete #pickAuto="matAutocomplete" class="dv-panel" (optionSelected)="setValue($event.option.value)">
            <mat-option value=""><span class="dv-opt__name dv-hint">(vazio)</span></mat-option>
            @for (o of pickOptions(); track o) { <mat-option [value]="o"><span class="dv-opt__name">{{ o }}</span></mat-option> }
          </mat-autocomplete>
          @if (outOfList()) { <span class="dv-hint dv-hint--warn">Valor fora da lista do DevOps</span> }
        }
        @case ('area') { <ng-container *ngTemplateOutlet="tree" /> }
        @case ('iteration') { <ng-container *ngTemplateOutlet="tree" /> }
        @case ('identity') {
          <div class="dv-line">
            @if (value()) { <app-user-avatar [name]="shown()" [imageUrl]="avatar()" [size]="22" /> }
            <input class="dv-input" [ngModel]="text()" (ngModelChange)="onText($event)" (focus)="loadPeople(); query.set('')"
                   (blur)="commitIdentity()" [matAutocomplete]="peopleAuto" [disabled]="disabled()"
                   [placeholder]="placeholder() || 'Sem responsável'" [attr.aria-label]="f.name" autocomplete="off">
          </div>
          <mat-autocomplete #peopleAuto="matAutocomplete" class="dv-panel" [displayWith]="personLabel" (optionSelected)="pickPerson($event.option.value)">
            <mat-option [value]="null"><span class="dv-opt__name dv-hint">(ninguém)</span></mat-option>
            @for (p of peopleOptions(); track p.uniqueName) {
              <mat-option [value]="p">
                <app-user-avatar [name]="p.displayName" [imageUrl]="p.imageUrl" [size]="20" />
                <span class="dv-opt__name">{{ p.displayName }}</span>
                <span class="dv-opt__hint">{{ p.uniqueName }}</span>
              </mat-option>
            }
            @if (loading()) { <mat-option class="dv-opt--status" disabled>Carregando as pessoas…</mat-option> }
            @else if (loadError()) { <mat-option class="dv-opt--status" disabled>{{ loadError() }}</mat-option> }
          </mat-autocomplete>
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
            <input type="checkbox" [ngModel]="!!value()" (ngModelChange)="setValue(!!$event)" [disabled]="disabled()">
            {{ value() ? 'Sim' : 'Não' }}
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
      <input class="dv-input" [class.dv-input--warn]="outOfList()" [ngModel]="text()" (ngModelChange)="onText($event)"
             (focus)="loadNodes(); query.set('')" (blur)="commitPick()" [matAutocomplete]="treeAuto" [disabled]="disabled()"
             [placeholder]="placeholder() || (kind() === 'area' ? 'Área' : 'Iteração')" [attr.aria-label]="field().name" autocomplete="off">
      <mat-autocomplete #treeAuto="matAutocomplete" class="dv-panel" (optionSelected)="setValue($event.option.value)">
        @for (n of nodeOptions(); track n.path) {
          <mat-option [value]="n.path" [matTooltip]="n.path" matTooltipShowDelay="600">
            <span class="dv-opt__name" [style.padding-left.px]="query() ? 0 : n.depth * 12">{{ query() ? n.path : n.name }}</span>
          </mat-option>
        }
        @if (loading()) { <mat-option class="dv-opt--status" disabled>Carregando…</mat-option> }
        @else if (loadError()) { <mat-option class="dv-opt--status" disabled>{{ loadError() }}</mat-option> }
        @else if (!nodeOptions().length) { <mat-option class="dv-opt--status" disabled>Nenhum caminho com esse texto</mat-option> }
      </mat-autocomplete>
      @if (outOfList()) { <span class="dv-hint dv-hint--warn">Caminho não encontrado no projeto</span> }
    </ng-template>
  `,
  styles: [DV_FORM_STYLES]
})
export class DevOpsFieldInputComponent {
  private api = inject(DevOpsService);

  readonly field = input.required<DevOpsFieldDef>();
  readonly value = model<unknown>(null);
  readonly disabled = input(false);
  readonly placeholder = input<string>('');

  readonly kind = computed(() => inputKind(this.field()));
  readonly readOnly = computed(() => this.field().readOnly);
  readonly shown = computed(() => {
    const v = this.value();
    return this.kind() === 'identity' ? identityName(v) : displayValue(this.field(), v);
  });
  readonly avatar = computed(() => identityImage(this.value()));

  /** Texto do campo (picklist/árvore/pessoa/texto) — separado do valor para digitar livremente. */
  readonly text = signal('');
  readonly query = signal('');
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  private people = signal<DevOpsPerson[] | null>(null);
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

  readonly pickOptions = computed(() => {
    const q = fold(this.query());
    const all = this.field().allowedValues ?? [];
    return (q ? all.filter((o) => fold(o).includes(q)) : all).slice(0, 200);
  });

  readonly nodeOptions = computed(() => {
    const q = fold(this.query());
    const all = this.nodes() ?? [];
    return (q ? all.filter((n) => fold(n.path).includes(q)) : all).slice(0, MAX_OPTIONS * 3);
  });

  readonly peopleOptions = computed(() => {
    const q = fold(this.query());
    const all = this.people() ?? [];
    return (q ? all.filter((p) => fold(`${p.displayName} ${p.uniqueName}`).includes(q)) : all).slice(0, MAX_OPTIONS);
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

  /** O autocomplete mostra o nome da pessoa escolhida (e o texto digitado como está). */
  readonly personLabel = (p: DevOpsPerson | string | null) => (typeof p === 'string' ? p : p ? p.displayName : '');

  constructor() {
    // O texto acompanha o valor vindo de fora (carregar o card, desfazer).
    effect(() => {
      const v = this.value();
      const k = this.kind();
      untracked(() => {
        const t = k === 'identity' ? identityName(v) : v == null ? '' : `${v}`;
        if (t !== this.text()) this.text.set(t);
      });
    });
  }

  setValue(v: unknown): void {
    this.value.set(v);
  }

  onText(v: unknown): void {
    if (v != null && typeof v !== 'string') return; // opção escolhida no autocomplete
    const s = v ?? '';
    this.text.set(s);
    this.query.set(s);
    if (this.kind() === 'picklist' || this.kind() === 'area' || this.kind() === 'iteration') {
      if (!s.trim()) this.value.set(null);
    } else if (this.kind() === 'identity') {
      if (!s.trim()) this.value.set(null);
    }
  }

  /** Ao sair do campo: aceita o texto digitado (o DevOps valida; fora da lista fica o aviso). */
  commitPick(): void {
    const t = this.text().trim();
    const cur = `${this.value() ?? ''}`;
    if (t === cur) return;
    if (!t) { this.value.set(null); return; }
    const k = this.kind();
    if (k === 'picklist') {
      const exact = (this.field().allowedValues ?? []).find((o) => o.toLowerCase() === t.toLowerCase());
      this.value.set(exact ?? t);
    } else {
      const node = (this.nodes() ?? []).find((n) => n.path.toLowerCase() === t.toLowerCase());
      this.value.set(node?.path ?? t);
    }
  }

  // ── Pessoas ──

  loadPeople(): void {
    if (this.people() || this.loading()) return;
    this.loading.set(true);
    this.loadError.set(null);
    this.api.people().subscribe({
      next: (p) => { this.people.set(p); this.loading.set(false); },
      error: () => { this.loadError.set('Não foi possível carregar as pessoas — digite o e-mail.'); this.loading.set(false); }
    });
  }

  pickPerson(p: DevOpsPerson | null): void {
    this.query.set('');
    if (!p) { this.value.set(null); this.text.set(''); return; }
    this.value.set({ displayName: p.displayName, uniqueName: p.uniqueName, imageUrl: p.imageUrl ?? null });
    this.text.set(p.displayName);
  }

  /** Texto livre de pessoa: e-mail vira o valor; outro texto volta ao nome atual. */
  commitIdentity(): void {
    // Espera o optionSelected (que vem depois do blur) antes de decidir.
    setTimeout(() => {
      const t = this.text().trim();
      const cur = this.value();
      if (!t) { if (cur) this.value.set(null); return; }
      if (t === identityName(cur)) return;
      const match = (this.people() ?? []).find((p) => p.uniqueName.toLowerCase() === t.toLowerCase()
        || p.displayName.toLowerCase() === t.toLowerCase());
      if (match) { this.pickPerson(match); return; }
      if (/@/.test(t)) { this.value.set(t); return; }
      this.text.set(identityName(cur));
    }, 150);
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
