import { Component, ElementRef, ViewEncapsulation, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, map, switchMap } from 'rxjs/operators';
import { mdToHtml } from '../../helpers/markdown';
import { DevOpsService } from '../../services/devops.service';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { MentionTrigger, activeMentions, insertMention, mentionTrigger } from './comment-compose.logic';
import { DevOpsAttachmentImagesDirective } from './devops-attachment-images.directive';
import { DevOpsComment, DevOpsMention, F, devOpsErrorMessage } from './devops.model';

const SNACK = { horizontalPosition: 'right', verticalPosition: 'top' } as const;
const SUGGEST_TOP = 8;

interface Suggestion {
  kind: 'person' | 'card';
  key: string;
  label: string;
  hint: string;
  image?: string | null;
  person?: DevOpsMention;
}

/**
 * 0099 ajustes 3: aba "Discussion" do modal do card — os comentários do DevOps (mais novos primeiro, imagens pelo
 * PRMake) e a caixa de comentário com `@` (marca uma pessoa do DevOps — vira menção de verdade, com aviso para ela) e `#`
 * (cita outro card — vira link do card no DevOps). "Enviar" publica na hora, separado do "Salvar" dos campos.
 */
@Component({
  selector: 'app-devops-card-discussion',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, UserAvatarComponent, DevOpsAttachmentImagesDirective],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="dvd">
      <div class="dvd__compose">
        <div class="dvd__box">
          <textarea #box class="dv-textarea dvd__input" rows="3" [value]="text()" (input)="onInput(box)" (click)="onCaret(box)"
                    (keydown)="onKey($event, box)" (blur)="closeSuggest()" [disabled]="sending()"
                    placeholder="Adicionar um comentário — @ marca uma pessoa, # cita um card (aceita markdown)" aria-label="Novo comentário"></textarea>
          @if (trigger(); as t) {
            <div class="dvd__suggest" role="listbox" [attr.aria-label]="t.kind === 'person' ? 'Marcar pessoa' : 'Citar card'">
              @if (searching()) { <div class="dvd__suggest-note">Buscando…</div> }
              @else if (!suggestions().length) {
                <div class="dvd__suggest-note">{{ t.kind === 'person' ? (t.query.length < 2 ? 'Digite o nome da pessoa' : 'Ninguém com esse nome') : (t.query ? 'Nenhum card encontrado' : 'Digite o número ou parte do título') }}</div>
              }
              @for (s of suggestions(); track s.key; let i = $index) {
                <button type="button" role="option" [class.dvd__opt--on]="i === active()" [attr.aria-selected]="i === active()"
                        (mousedown)="$event.preventDefault(); pick(s, box)" (mouseenter)="active.set(i)">
                  @if (s.kind === 'person') { <app-user-avatar [name]="s.label" [imageUrl]="s.image" [size]="22" /> }
                  @else { <mat-icon class="dvd__opt-icon">tag</mat-icon> }
                  <span class="dvd__opt-label">{{ s.label }}</span><span class="dvd__opt-hint">{{ s.hint }}</span>
                </button>
              }
            </div>
          }
        </div>
        <div class="dvd__bar">
          <span class="dv-hint">Enter quebra a linha · Ctrl/⌘ + Enter envia</span>
          <span class="dvd__spacer"></span>
          @if (text().trim()) { <button mat-button type="button" (click)="text.set(''); picked.set([])" [disabled]="sending()">Limpar</button> }
          <button mat-flat-button color="primary" type="button" class="dvd__send" (click)="send()" [disabled]="!text().trim() || sending()">
            <mat-icon>send</mat-icon>{{ sending() ? 'Enviando…' : 'Enviar comentário' }}
          </button>
        </div>
      </div>

      @if (loading()) { <mat-progress-bar mode="indeterminate" class="dvd__progress" /> }
      @if (error(); as e) {
        <div class="dvd__err"><mat-icon>error_outline</mat-icon><span>{{ e }}</span><button type="button" class="dv-linkbtn" (click)="load()">Tentar de novo</button></div>
      }
      @if (!loading() && !error() && !comments().length) { <div class="dv-hint dvd__empty">Nenhum comentário ainda.</div> }

      <ol class="dvd__list" [dvAttachmentImages]="card()">
        @for (c of comments(); track c.id) {
          <li class="dvd__item">
            <app-user-avatar [name]="c.author?.displayName || '?'" [imageUrl]="c.author?.imageUrl" [size]="30" />
            <div class="dvd__bubble">
              <div class="dvd__meta">
                <b>{{ c.author?.displayName || 'Alguém' }}</b>
                <span [title]="(c.createdDate | date: 'dd/MM/yyyy HH:mm') ?? ''">{{ ago(c.createdDate) }}</span>
                @if (c.edited) { <span class="dvd__edited">(editado)</span> }
              </div>
              <div class="dv-html dvd__html" [innerHTML]="c.html"></div>
            </div>
          </li>
        }
      </ol>
    </div>
  `,
  styles: [`
    app-devops-card-discussion { display: block; }
    .dvd { display: flex; flex-direction: column; gap: 12px; max-width: 980px; }
    .dvd__compose { display: flex; flex-direction: column; gap: 6px; }
    .dvd__box { position: relative; }
    .dvd__input { min-height: 84px; }
    .dvd__bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .dvd__spacer { flex: 1; }
    .dvd__send mat-icon { margin-right: 4px; }
    .dvd__suggest { position: absolute; left: 8px; top: calc(100% + 2px); z-index: 8; min-width: 260px; max-width: min(460px, 90%); padding: 4px;
      display: flex; flex-direction: column; border-radius: 10px; background: var(--surface-3, #3a3f48); border: 1px solid rgba(255,255,255,.08);
      box-shadow: 0 8px 24px rgba(0,0,0,.35); }
    .dvd__suggest button { display: flex; align-items: center; gap: 8px; text-align: left; border: 0; background: transparent; color: inherit;
      font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 6px; cursor: pointer; min-width: 0; }
    .dvd__suggest button.dvd__opt--on { background: rgba(142,108,240,.2); }
    .dvd__opt-icon { font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-2); flex: none; }
    .dvd__opt-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .dvd__opt-hint { margin-left: auto; padding-left: 8px; font-size: 11.5px; color: var(--cc-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
    .dvd__suggest-note { padding: 6px 8px; font-size: 12px; color: var(--cc-text-3); }
    .dvd__progress { height: 2px; }
    .dvd__err { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; font-size: 12.5px;
      background: rgba(248,81,73,.08); border: 1px solid rgba(248,81,73,.35); }
    .dvd__empty { padding: 8px 2px; }
    .dvd__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .dvd__item { display: flex; gap: 10px; align-items: flex-start; }
    .dvd__bubble { flex: 1; min-width: 0; border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); border-radius: 10px; padding: 8px 12px;
      background: color-mix(in srgb, var(--surface-2, #2e343f) 70%, transparent); }
    .dvd__meta { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: var(--cc-text-3); margin-bottom: 4px; }
    .dvd__meta b { color: var(--cc-text-1); font-weight: 600; font-size: 13px; }
    .dvd__edited { font-style: italic; }
    .dvd__html.dv-html { max-height: none; border: 0; padding: 0; background: transparent; }
    .dvd__html a[data-vss-mention] { color: var(--mat-sys-primary); text-decoration: none; font-weight: 500; }
  `]
})
export class DevOpsCardDiscussionComponent {
  private api = inject(DevOpsService);
  private snack = inject(MatSnackBar);

  readonly card = input<string | null>(null);
  /** Quantos comentários o card tem (para o rótulo da aba). */
  readonly countChange = output<number>();
  /** Comentário publicado (a página recarrega o que depende disso). */
  readonly posted = output<void>();

  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');

  readonly comments = signal<DevOpsComment[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly sending = signal(false);
  readonly text = signal('');
  readonly picked = signal<DevOpsMention[]>([]);

  readonly trigger = signal<MentionTrigger | null>(null);
  readonly suggestions = signal<Suggestion[]>([]);
  readonly searching = signal(false);
  readonly active = signal(0);
  private search$ = new Subject<MentionTrigger>();
  private loadSeq = 0;

  readonly mentions = computed(() => activeMentions(this.text(), this.picked()));

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => {
        this.comments.set([]);
        this.text.set('');
        this.picked.set([]);
        this.trigger.set(null);
        if (card) this.load();
      });
    });

    this.search$.pipe(
      debounceTime(200),
      switchMap((t) => {
        this.searching.set(true);
        if (t.kind === 'person') {
          if (t.query.length < 2) return of<Suggestion[]>([]);
          return this.api.people(t.query, SUGGEST_TOP).pipe(
            map((list) => list.map<Suggestion>((p) => ({
              kind: 'person', key: p.uniqueName || p.displayName, label: p.displayName, hint: p.uniqueName, image: p.imageUrl,
              person: { displayName: p.displayName, uniqueName: p.uniqueName, id: p.id ?? null },
            }))),
            catchError(() => of<Suggestion[]>([])));
        }
        if (!t.query) return of<Suggestion[]>([]);
        return this.api.query({ filter: { text: t.query }, fields: [F.title, F.workItemType, F.state], top: SUGGEST_TOP }).pipe(
          map((r) => r.items.map<Suggestion>((i) => ({
            kind: 'card', key: `${i.id}`, label: `#${i.id} ${i.fields[F.title] ?? ''}`.trim(),
            hint: [i.fields[F.workItemType], i.fields[F.state]].filter(Boolean).join(' · '),
          }))),
          catchError(() => of<Suggestion[]>([])));
      }),
    ).subscribe((list) => {
      this.searching.set(false);
      this.suggestions.set(list);
      this.active.set(0);
    });
  }

  load(): void {
    const card = this.card();
    if (!card) return;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.api.comments(card).subscribe({
      next: (r) => {
        if (seq !== this.loadSeq) return;
        this.comments.set(r.comments);
        this.countChange.emit(r.count);
        this.loading.set(false);
      },
      error: (e) => {
        if (seq !== this.loadSeq) return;
        this.error.set(devOpsErrorMessage(e, 'Não foi possível ler a discussion do card.'));
        this.loading.set(false);
      }
    });
  }

  /** Foca a caixa (a aba acabou de abrir pelo "n comentários" do cabeçalho). */
  focus(): void {
    setTimeout(() => this.box()?.nativeElement.focus(), 0);
  }

  onInput(box: HTMLTextAreaElement): void {
    this.text.set(box.value);
    this.onCaret(box);
  }

  onCaret(box: HTMLTextAreaElement): void {
    const t = mentionTrigger(box.value, box.selectionStart ?? box.value.length);
    const prev = this.trigger();
    this.trigger.set(t);
    if (!t) { this.suggestions.set([]); return; }
    if (!prev || prev.kind !== t.kind || prev.query !== t.query) {
      this.searching.set(t.kind === 'person' ? t.query.length >= 2 : !!t.query);
      this.search$.next(t);
    }
  }

  onKey(event: KeyboardEvent, box: HTMLTextAreaElement): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.send();
      return;
    }
    const list = this.suggestions();
    if (!this.trigger()) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeSuggest(); return; }
    if (!list.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); this.active.set((this.active() + 1) % list.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.active.set((this.active() - 1 + list.length) % list.length); }
    else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); this.pick(list[this.active()] ?? list[0], box); }
  }

  closeSuggest(): void {
    this.trigger.set(null);
    this.suggestions.set([]);
  }

  pick(s: Suggestion, box: HTMLTextAreaElement): void {
    const t = this.trigger();
    if (!t) return;
    const token = s.kind === 'person' ? `@${s.label}` : `#${s.key}`;
    const r = insertMention(box.value, t.start, box.selectionStart ?? box.value.length, token);
    this.text.set(r.text);
    box.value = r.text;
    box.setSelectionRange(r.caret, r.caret);
    box.focus();
    if (s.person) this.picked.update((p) => [...p, s.person!]);
    this.closeSuggest();
  }

  send(): void {
    const card = this.card();
    const text = this.text().trim();
    if (!card || !text || this.sending()) return;
    this.sending.set(true);
    this.api.comment(card, text, this.mentions()).subscribe({
      next: () => {
        this.sending.set(false);
        // Otimista: aparece no topo na hora; a leitura do DevOps confirma em seguida.
        this.comments.update((list) => [{
          id: -Date.now(), html: mdToHtml(text), author: { displayName: 'Você', uniqueName: '' }, createdDate: new Date().toISOString(),
          modifiedDate: null, edited: false,
        }, ...list]);
        this.text.set('');
        this.picked.set([]);
        this.posted.emit();
        this.snack.open(`Comentário publicado no card ${card}`, 'Ok', { ...SNACK, duration: 3000 });
        this.load();
      },
      error: (e) => {
        this.sending.set(false);
        this.snack.open(devOpsErrorMessage(e, 'O DevOps não aceitou o comentário.'), 'Ok', { ...SNACK, duration: 8000 });
      }
    });
  }

  /** "há 5 min", "há 3 h", "ontem", "12/11". */
  ago(date: string | null): string {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const days = Math.round(h / 24);
    if (days === 1) return 'ontem';
    if (days < 7) return `há ${days} dias`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: d.getFullYear() === new Date().getFullYear() ? undefined : '2-digit' });
  }
}
