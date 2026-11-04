import { Component, DestroyRef, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { CliipboardService } from '../../services/cliipboard.service';
import { serverMessage } from '../../services/card-assistant.service';
import { ExecutionPlanService } from '../../services/execution-plan.service';
import { CardSituationService, shortDateTime, situationAgo, situationDate } from '../card-situation/card-situation.service';
import type { CardFull } from '../card-details-dialog/card-full.model';
import type { TimelineEntry } from '../card-timeline/timeline.model';
import { CodeRefHostDirective } from '../code-ref/code-ref-host.directive';
import type { ExecutionArtifact, ExecutionPlan, PlanPhase } from '../execution-plan/execution-plan.model';
import { isGeneratedText } from '../generated-texts/generated-texts.model';
import {
  AiContextId, AiContextPart, HandoverTexts, RegisterTexts, SentRecord, TEXT_GROUPS, TextGroup, TextItem,
  buildRegeneratePrompt, buildTextItems, normText, sendLabel, sendStateLabel,
} from './text-center.model';
import { TextCenterService, cardContext, discussionContext } from './text-center.service';

export interface TextCenterDialogData {
  card: string;
  /** Plano em tela (lista viva — arquivos novos/regravados aparecem com o diálogo aberto). */
  plan: Signal<ExecutionPlan | null>;
  /** Dupla análise ↔ correção (o outro plano é carregado aqui). */
  pair?: Signal<{ analysisId: string | null; correctionId: string | null } | null>;
  /** Texto a abrir já selecionado (`a:<id>`, `summary`, `situation`, `root-cause`…). */
  selectKey?: string | null;
}

type Mode = 'view' | 'edit' | 'ai';
type Load<T> = { status: 'loading' | 'ready' | 'error'; value: T | null; error?: string | null };

const QUICK_ASKS = ['Deixe mais curto', 'Foque no cliente, sem termos técnicos', 'Escreva em inglês', 'Mais técnico e objetivo', 'Organize em tópicos'];

/**
 * Central de textos do card (0077) — "Textos": tudo o que o Claude/PRMake escreveu no card num lugar só,
 * agrupado (Para o cliente · DevOps · Análise · Correção · Handover), com origem, quando, **onde está**
 * (Timeline, discussion, campo Root Cause, só no PRMake) e o estado de envio (Não enviado · Enviado em X por
 * Y · Editado depois do envio). Editar e salvar no PRMake, **gerar de novo com a IA da pessoa** (instruções +
 * contexto marcado; nunca salva sozinho), **enviar/atualizar no DevOps** (o mesmo comentário/campo) ou na
 * Timeline, e copiar (texto e formatado).
 */
@Component({
  selector: 'app-text-center-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, CodeRefHostDirective],
  templateUrl: './text-center-dialog.component.html',
  styleUrl: './text-center-dialog.component.css',
})
export class TextCenterDialogComponent {
  readonly data = inject<TextCenterDialogData>(MAT_DIALOG_DATA);
  private ref = inject<MatDialogRef<TextCenterDialogComponent>>(MatDialogRef);
  private api = inject(TextCenterService);
  private plans = inject(ExecutionPlanService);
  private situations = inject(CardSituationService);
  private clipboard = inject(CliipboardService);

  readonly card = this.data.card;
  readonly groups = TEXT_GROUPS;
  readonly quickAsks = QUICK_ASKS;

  // ── Fontes ────────────────────────────────────────────────────────────────────────────────────

  private readonly other = signal<ExecutionPlan | null>(null);
  /** Artefatos gravados aqui (a resposta do PUT chega antes do plano recarregar). */
  private readonly savedArtifacts = signal<Record<string, ExecutionArtifact>>({});
  private readonly contents = signal<Record<string, string>>({});
  private readonly contentErrors = signal<Record<string, true>>({});
  readonly register = signal<Load<RegisterTexts>>({ status: 'loading', value: null });
  readonly handover = signal<Load<HandoverTexts>>({ status: 'loading', value: null });
  readonly timeline = signal<Load<TimelineEntry[]>>({ status: 'loading', value: null });
  readonly situationDraft = signal<string | null>(this.api.situationDraft(this.card));
  readonly rootCauseSent = signal<SentRecord | null>(this.api.rootCauseSent(this.card));
  readonly situation = this.situations.situationOf(this.card);

  private readonly otherId = computed(() => {
    const p = this.data.plan();
    const pair = this.data.pair?.() ?? null;
    if (!p || !pair) return null;
    const id = pair.analysisId === p.id ? pair.correctionId : pair.analysisId;
    return id && id !== p.id ? id : null;
  });

  /** Os `.md` dos planos do card (com a versão gravada aqui quando é mais nova). */
  private readonly artifacts = computed(() => {
    const saved = this.savedArtifacts();
    const out: { planId: string; phase: PlanPhase | null; artifact: ExecutionArtifact }[] = [];
    const other = this.other();
    for (const p of [this.data.plan(), other && other.id === this.otherId() ? other : null]) {
      if (!p) continue;
      for (const a of p.artifacts ?? []) {
        if (!isGeneratedText(a)) continue;
        const mine = saved[a.id];
        const art = mine && stamp(mine) >= stamp(a) ? mine : a;
        out.push({ planId: p.id, phase: (p.phase ?? 'analysis') as PlanPhase, artifact: art });
      }
    }
    return out;
  });

  readonly items = computed<TextItem[]>(() => {
    const contents = this.contents();
    return buildTextItems({
      artifacts: this.artifacts().map(x => ({ ...x, content: contents[versionKey(x.artifact)] ?? null })),
      situation: this.situation(),
      situationDraft: this.situationDraft(),
      register: this.register().value,
      handover: this.handover().value,
      timeline: this.timeline().status === 'ready' ? this.timeline().value : null,
      rootCauseSent: this.rootCauseSent(),
    });
  });
  readonly grouped = computed(() => this.groups
    .map(g => ({ ...g, items: this.items().filter(i => i.group === g.id) }))
    .filter(g => g.items.length));
  readonly loadingSources = computed(() => this.register().status === 'loading' || this.handover().status === 'loading');

  // ── Seleção e modos ───────────────────────────────────────────────────────────────────────────

  readonly selectedKey = signal<string | null>(this.data.selectKey ?? null);
  readonly selected = computed(() => {
    const items = this.items();
    return items.find(i => i.key === this.selectedKey()) ?? (this.selectedKey() ? null : items[0] ?? null);
  });
  /** Só a chave (muda apenas quando troca de item — o objeto muda a cada recarga). */
  private readonly currentKey = computed(() => this.selected()?.key ?? null);
  /** Celular: a lista ou o texto (um por vez). */
  readonly narrow = signal(window.matchMedia?.('(max-width: 720px)').matches ?? false);
  readonly showDetail = signal(!!this.data.selectKey);
  readonly mode = signal<Mode>('view');
  readonly previewOnPhone = signal(false);
  /** Textos em edição (por item) — sobrevivem a trocar de item com o diálogo aberto. */
  readonly drafts = signal<Record<string, string>>({});
  readonly busy = signal<'save' | 'send' | 'ai' | null>(null);
  readonly confirmSend = signal(false);
  readonly confirmClose = signal(false);
  readonly message = signal<{ ok: boolean; text: string } | null>(null);
  readonly copied = signal(false);
  readonly now = signal(Date.now());

  readonly draft = computed(() => {
    const s = this.selected();
    return s ? this.drafts()[s.key] ?? null : null;
  });
  readonly dirty = computed(() => {
    const s = this.selected();
    const d = this.draft();
    return !!s && d !== null && normText(d) !== normText(s.markdown);
  });
  readonly anyDirty = computed(() => {
    const drafts = this.drafts();
    return this.items().some(i => drafts[i.key] !== undefined && normText(drafts[i.key]) !== normText(i.markdown));
  });
  /** O texto que vale agora (o rascunho, se houver). */
  readonly text = computed(() => this.draft() ?? this.selected()?.markdown ?? '');
  readonly html = computed(() => {
    const s = this.selected();
    return s ? renderMarkdown(this.text(), { codeRefs: s.saveTarget === 'artifact', reRefs: s.saveTarget === 'artifact' }) : '';
  });
  readonly sendText = computed(() => {
    const s = this.selected();
    return s ? sendLabel(s) : null;
  });

  // ── IA ────────────────────────────────────────────────────────────────────────────────────────

  readonly instructions = signal('');
  readonly aiChecks = signal<Partial<Record<AiContextId, boolean>>>({});
  readonly cardFull = signal<Load<CardFull>>({ status: 'loading', value: null });
  readonly aiResult = signal<string | null>(null);
  readonly aiError = signal<string | null>(null);
  readonly showPrompt = signal(false);
  readonly aiParts = computed<AiContextPart[]>(() => {
    const s = this.selected();
    if (!s) return [];
    const full = this.cardFull();
    const fullMissing = full.status === 'error' ? full.error ?? 'indisponível sem o DevOps' : full.status === 'loading' ? 'carregando…' : null;
    const analysisItem = this.items().find(i => i.saveTarget === 'artifact' && /^Análise$/.test(i.label));
    const analysis = analysisItem && analysisItem.key !== s.key ? analysisItem : null;
    const sit = this.situation();
    const desc = this.register().value?.description;
    return [
      { id: 'current', label: 'Texto atual', text: this.text() || null, unavailable: this.text() ? null : 'vazio' },
      { id: 'card', label: 'Card: título e passos para reproduzir', text: full.value ? cardContext(full.value) : null, unavailable: fullMissing },
      { id: 'discussion', label: 'Discussion do DevOps', text: full.value ? discussionContext(full.value) : null, unavailable: fullMissing },
      { id: 'analysis', label: 'Análise', text: analysis?.markdown ?? null, unavailable: analysis ? (analysis.markdown === null ? 'carregando…' : null) : analysisItem ? 'é o texto atual' : 'o card não tem análise' },
      { id: 'situation', label: 'Situação atual', text: sit?.markdown && sit.kind !== 'none' ? sit.markdown : null, unavailable: sit?.markdown && sit.kind !== 'none' ? null : 'nada aguardado agora' },
      { id: 'prDescription', label: 'Descrição do PR', text: desc?.trim() ? desc : null, unavailable: desc?.trim() ? null : 'sem descrição salva' },
    ];
  });
  readonly prompt = computed(() => {
    const s = this.selected();
    if (!s) return '';
    const checks = this.aiChecks();
    return buildRegeneratePrompt(this.card, s, this.instructions(), this.aiParts().filter(p => checks[p.id] && p.text));
  });

  constructor() {
    this.ref.disableClose = true;
    this.ref.backdropClick().subscribe(() => this.close());
    this.ref.keydownEvents().subscribe(e => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } });

    void this.loadRegister();
    void this.loadHandover();
    void this.loadTimeline();
    if (!this.situation()) this.situations.load(this.card).catch(() => undefined);

    effect(() => {
      const id = this.otherId();
      untracked(() => this.loadOther(id));
    });
    // Conteúdo dos `.md` (pequenos): carrega cada versão uma vez.
    effect(() => {
      const list = this.artifacts();
      untracked(() => { for (const x of list) void this.loadContent(x.artifact, x.planId); });
    });
    // Trocou de item: volta para a leitura e zera o que era do anterior.
    effect(() => {
      this.currentKey();
      untracked(() => {
        this.mode.set('view');
        this.confirmSend.set(false);
        this.aiResult.set(null);
        this.aiError.set(null);
        this.message.set(null);
        this.previewOnPhone.set(false);
      });
    });

    const media = window.matchMedia?.('(max-width: 720px)');
    const onMedia = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
    media?.addEventListener?.('change', onMedia);
    const clock = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => { clearInterval(clock); media?.removeEventListener?.('change', onMedia); });
  }

  // ── Lista ─────────────────────────────────────────────────────────────────────────────────────

  select(item: TextItem): void {
    this.selectedKey.set(item.key);
    this.showDetail.set(true);
  }

  back(): void {
    this.showDetail.set(false);
  }

  stateLabel(item: TextItem): string {
    return sendStateLabel(item);
  }

  isDirty(item: TextItem): boolean {
    const d = this.drafts()[item.key];
    return d !== undefined && normText(d) !== normText(item.markdown);
  }

  ago(iso: string | null | undefined): string {
    return situationAgo(iso, this.now());
  }

  date(iso: string | null | undefined): string {
    return situationDate(iso);
  }

  when(iso: string | null | undefined): string {
    return shortDateTime(iso);
  }

  // ── Editar ────────────────────────────────────────────────────────────────────────────────────

  edit(): void {
    const s = this.selected();
    if (!s || s.markdown === null) return;
    if (this.drafts()[s.key] === undefined) this.setDraft(s.key, s.markdown);
    this.confirmSend.set(false);
    this.mode.set('edit');
  }

  onDraft(value: string): void {
    const s = this.selected();
    if (s) this.setDraft(s.key, value);
  }

  cancelEdit(): void {
    const s = this.selected();
    if (s) this.setDraft(s.key, null);
    this.mode.set('view');
  }

  saveLabel(item: TextItem): string {
    return item.saveTarget === 'situation-draft' ? 'Guardar rascunho' : 'Salvar no PRMake';
  }

  async save(): Promise<boolean> {
    const s = this.selected();
    const text = this.draft();
    if (!s || text === null || this.busy()) return false;
    if (!text.trim()) { this.message.set({ ok: false, text: 'O texto não pode ficar vazio.' }); return false; }
    this.busy.set('save');
    this.message.set(null);
    try {
      await this.persist(s, text);
      this.setDraft(s.key, null);
      this.mode.set('view');
      this.message.set({ ok: true, text: s.saveTarget === 'situation-draft'
        ? 'Rascunho guardado neste navegador — publique para levar à discussion.'
        : s.sendTarget ? 'Salvo no PRMake. O que já foi enviado não muda até você enviar de novo.' : 'Salvo no PRMake.' });
      return true;
    } catch (err) {
      this.message.set({ ok: false, text: serverMessage(err, 'Não foi possível salvar o texto.') });
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  /** Grava no destino do PRMake (sem enviar a lugar nenhum). */
  private async persist(s: TextItem, text: string): Promise<void> {
    switch (s.saveTarget) {
      case 'artifact': {
        const res = await this.api.saveArtifactText(s.planId!, s.artifactId!, text);
        const art = { ...res, planId: res?.planId || s.planId! } as ExecutionArtifact;
        this.contents.update(m => ({ ...m, [versionKey(art)]: text.replace(/\r\n/g, '\n') }));
        this.savedArtifacts.update(m => ({ ...m, [art.id]: art }));
        return;
      }
      case 'summary': {
        const reg = await this.api.saveSummary(this.card, text, false);
        this.mergeRegister(reg);
        return;
      }
      case 'register-root-cause':
        this.mergeRegister(await this.api.saveRegister(this.card, { rootCause: text }));
        return;
      case 'register-description':
        this.mergeRegister(await this.api.saveRegister(this.card, { description: text }));
        return;
      case 'situation-draft':
        this.api.setSituationDraft(this.card, normText(text) === normText(this.situation()?.markdown) ? null : text);
        this.situationDraft.set(this.api.situationDraft(this.card));
        return;
      case 'handover': {
        const saved = await this.api.saveHandover(this.card, text);
        this.handover.set({ status: 'ready', value: { ...(this.handover().value ?? {}), ...(saved ?? {}), content: text } });
        return;
      }
    }
  }

  // ── Enviar ────────────────────────────────────────────────────────────────────────────────────

  /** Para onde vai e quem lê (o texto da confirmação). */
  sendWhere(item: TextItem): string {
    switch (item.sendTarget) {
      case 'summary': return item.sendState === 'none'
        ? 'Criar o comentário do resumo na discussion do card no DevOps. A discussion é lida pelo cliente.'
        : 'Atualizar o mesmo comentário do resumo na discussion do card no DevOps. A discussion é lida pelo cliente.';
      case 'situation': return item.sendState === 'none'
        ? 'Publicar o resumo da situação na discussion do card no DevOps. A discussion é lida pelo cliente.'
        : 'Atualizar o mesmo comentário da situação na discussion do card no DevOps. A discussion é lida pelo cliente.';
      case 'root-cause': return 'Gravar este texto no campo Root Cause do card no DevOps (substitui o que está lá). O cliente pode ver o card.';
      case 'timeline': return item.timelineEntryId
        ? 'Atualizar a entrada da Timeline do card que publicou este texto (a equipe lê a Timeline no PRMake; o cliente lê a discussion, que não muda).'
        : 'Publicar este texto como uma entrada nova na Timeline do card (a equipe lê a Timeline no PRMake; o cliente lê a discussion, que não muda).';
      default: return '';
    }
  }

  askSend(): void {
    this.message.set(null);
    this.confirmSend.set(true);
  }

  async send(): Promise<void> {
    const s = this.selected();
    if (!s || !s.sendTarget || this.busy()) return;
    const text = this.text();
    if (!text.trim()) return;
    this.busy.set('send');
    this.message.set(null);
    try {
      // Rascunho não salvo de um texto do PRMake: salva antes (o PRMake e o destino ficam iguais).
      if (this.dirty() && s.saveTarget !== 'situation-draft' && s.saveTarget !== 'summary') await this.persist(s, text);
      switch (s.sendTarget) {
        case 'summary':
          this.mergeRegister(await this.api.saveSummary(this.card, text, true));
          break;
        case 'situation':
          await this.situations.publish(this.card, normText(text) === normText(this.situation()?.markdown) ? null : text);
          this.api.setSituationDraft(this.card, null);
          this.situationDraft.set(null);
          await this.situations.load(this.card, { force: true }).catch(() => undefined);
          break;
        case 'root-cause':
          this.rootCauseSent.set(await this.api.sendRootCause(this.card, text));
          break;
        case 'timeline':
          await this.api.publishTimeline(this.card, text, s.timelineEntryId ?? null);
          await this.loadTimeline();
          break;
      }
      this.setDraft(s.key, null);
      this.mode.set('view');
      this.confirmSend.set(false);
      this.message.set({ ok: true, text: SENT_MESSAGE[s.sendTarget] });
    } catch (err) {
      this.message.set({ ok: false, text: friendlySendError(err, s.sendTarget) });
    } finally {
      this.busy.set(null);
    }
  }

  // ── IA ────────────────────────────────────────────────────────────────────────────────────────

  openAi(): void {
    const s = this.selected();
    if (!s) return;
    this.mode.set('ai');
    this.confirmSend.set(false);
    this.aiResult.set(null);
    this.aiError.set(null);
    const g = s.group;
    this.aiChecks.set({
      current: true, card: true, analysis: g !== 'analysis' || !/Análise/.test(s.label), situation: g === 'client',
      discussion: g === 'client', prDescription: g === 'correction' || g === 'devops',
    });
    if (this.cardFull().status !== 'ready') void this.loadCardFull();
  }

  addAsk(text: string): void {
    const cur = this.instructions().trim();
    this.instructions.set(cur ? `${cur}. ${text}` : text);
  }

  toggleCheck(id: AiContextId, on: boolean): void {
    this.aiChecks.update(m => ({ ...m, [id]: on }));
  }

  async generate(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('ai');
    this.aiError.set(null);
    this.aiResult.set(null);
    try {
      const out = await this.api.generate(this.prompt());
      if (!out.trim()) throw { error: { error: 'A IA respondeu vazio.' } };
      this.aiResult.set(out);
    } catch (err) {
      const msg = serverMessage(err, 'a IA não respondeu');
      this.aiError.set(/[.!?]$/.test(msg) ? msg : `${msg}.`);
    } finally {
      this.busy.set(null);
    }
  }

  /** Leva o texto da IA para o editor — não salva sozinho. */
  useAi(): void {
    const s = this.selected();
    const out = this.aiResult();
    if (!s || !out) return;
    this.setDraft(s.key, out);
    this.aiResult.set(null);
    this.mode.set('edit');
  }

  aiHtml(text: string | null): string {
    return text ? renderMarkdown(text, { codeRefs: false }) : '';
  }

  // ── Copiar e fechar ───────────────────────────────────────────────────────────────────────────

  copy(): void {
    const text = this.text();
    if (!text) return;
    void this.clipboard.copyRichToClipboard(renderMarkdown(text, { codeRefs: false }), text);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }

  close(force = false): void {
    if (!force && this.anyDirty()) { this.confirmClose.set(true); return; }
    this.ref.close();
  }

  retry(what: 'register' | 'handover' | 'timeline'): void {
    if (what === 'register') void this.loadRegister();
    else if (what === 'handover') void this.loadHandover();
    else void this.loadTimeline();
  }

  // ── Cargas ────────────────────────────────────────────────────────────────────────────────────

  private async loadRegister(): Promise<void> {
    this.register.set({ status: 'loading', value: this.register().value });
    try { this.register.set({ status: 'ready', value: await this.api.register(this.card) }); }
    catch (err) { this.register.set({ status: 'error', value: null, error: serverMessage(err, 'Registro do card indisponível.') }); }
  }

  private async loadHandover(): Promise<void> {
    try { this.handover.set({ status: 'ready', value: await this.api.handover(this.card) }); }
    catch (err: any) {
      // 404/204 = o card não tem handover.
      this.handover.set(err?.status === 404 ? { status: 'ready', value: null } : { status: 'error', value: null, error: serverMessage(err, 'Handover indisponível.') });
    }
  }

  private async loadTimeline(): Promise<void> {
    try { this.timeline.set({ status: 'ready', value: await this.api.timeline(this.card) }); }
    catch (err) { this.timeline.set({ status: 'error', value: null, error: serverMessage(err, 'Timeline indisponível.') }); }
  }

  private async loadCardFull(): Promise<void> {
    this.cardFull.set({ status: 'loading', value: null });
    try { this.cardFull.set({ status: 'ready', value: await this.api.cardFull(this.card) }); }
    catch (err: any) { this.cardFull.set({ status: 'error', value: null, error: friendlyCardError(err) }); }
  }

  private loadOther(id: string | null): void {
    if (!id) { this.other.set(null); return; }
    this.plans.get(id).subscribe({ next: p => this.other.set(p), error: () => this.other.set(null) });
  }

  private readonly loading = new Set<string>();

  private async loadContent(a: ExecutionArtifact, planId: string): Promise<void> {
    const key = versionKey(a);
    if (this.contents()[key] !== undefined || this.loading.has(key)) return;
    this.loading.add(key);
    try {
      const text = await this.api.artifactText(a, planId);
      this.contents.update(m => ({ ...m, [key]: text }));
    } catch {
      this.contentErrors.update(m => ({ ...m, [a.id]: true }));
      this.contents.update(m => ({ ...m, [key]: '' }));
    } finally {
      this.loading.delete(key);
    }
  }

  contentFailed(item: TextItem): boolean {
    return !!item.artifactId && !!this.contentErrors()[item.artifactId];
  }

  private mergeRegister(reg: RegisterTexts | null): void {
    if (!reg) { void this.loadRegister(); return; }
    this.register.set({ status: 'ready', value: { ...(this.register().value ?? {}), ...reg } });
  }

  private setDraft(key: string, value: string | null): void {
    this.drafts.update(m => {
      const next = { ...m };
      if (value === null) delete next[key]; else next[key] = value;
      return next;
    });
  }
}

const SENT_MESSAGE: Record<string, string> = {
  summary: 'Resumo enviado — o comentário da discussion está atualizado.',
  situation: 'Resumo da situação publicado na discussion do card.',
  'root-cause': 'Root Cause gravado no card do DevOps.',
  timeline: 'Texto publicado na Timeline do card.',
};

function friendlySendError(err: any, target: string): string {
  const msg = serverMessage(err, '');
  const where = target === 'timeline' ? 'na Timeline' : 'no DevOps';
  if (!msg) return `Não foi possível enviar ${where}: o servidor não respondeu. Nada foi alterado lá — tente de novo.`;
  const hint = target !== 'timeline' && /plugin|integra|configur|token|credencia/i.test(msg) ? ' (confira a integração do DevOps em Minhas integrações)' : '';
  return `Não foi possível enviar ${where}: ${msg.replace(/\.$/, '')}${hint}. Nada foi alterado lá; o texto continua aqui.`;
}

/** Card do DevOps indisponível (contexto da IA): curto, sem a URL nem o stack. */
function friendlyCardError(err: any): string {
  const msg = serverMessage(err, '');
  if (!msg || /plugin|integra|configur|token|credencia/i.test(msg) || (err?.status ?? 0) >= 500 || err?.status === 0) return 'indisponível sem a integração do DevOps';
  return msg.length > 70 ? msg.slice(0, 67) + '…' : msg;
}

function stamp(a: Pick<ExecutionArtifact, 'updatedAt' | 'createdAt'>): number {
  const t = new Date(a.updatedAt || a.createdAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function versionKey(a: Pick<ExecutionArtifact, 'id' | 'updatedAt' | 'createdAt' | 'sha256'>): string {
  return `${a.id}@${a.updatedAt || a.createdAt || ''}@${a.sha256 ?? ''}`;
}

/** Abre a central (grande; no celular o MobileDialogsService a deixa em tela cheia). */
export function openTextCenter(dialog: MatDialog, data: TextCenterDialogData) {
  return dialog.open(TextCenterDialogComponent, {
    data,
    width: 'min(1200px, 96vw)',
    maxWidth: '96vw',
    height: 'min(880px, 92vh)',
    panelClass: ['plan-files-dialog-panel', 'text-center-panel'],
    autoFocus: false,
  });
}
