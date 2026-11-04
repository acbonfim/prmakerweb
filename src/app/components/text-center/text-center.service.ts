import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { htmlToText } from '../../helpers/summary-context';
import { DevOpsActionsService } from '../../services/devops-actions.service';
import { ExecutionPlanService } from '../../services/execution-plan.service';
import { StorageService } from '../../services/storage.service';
import { TimelineService } from '../../services/timeline.service';
import type { CardFull } from '../card-details-dialog/card-full.model';
import type { TimelineEntry } from '../card-timeline/timeline.model';
import type { ExecutionArtifact } from '../execution-plan/execution-plan.model';
import { HandoverTexts, RegisterTexts, SentRecord, textHash } from './text-center.model';

const DRAFT_KEY = (card: string) => `prmake.situation-draft:${card}`;
const SENT_KEY = (card: string) => `prmake.root-cause-sent:${card}`;

/**
 * Dados e gravações da central de textos (0078) — tudo pelos endpoints do PRMake: arquivos do plano
 * (PUT text), resumo não técnico (summary), registro do card (root cause / descrição), Root Cause no
 * DevOps, Timeline, handover e a IA da própria pessoa (`AI/generate`).
 */
@Injectable({ providedIn: 'root' })
export class TextCenterService {
  private http = inject(HttpClient);
  private plans = inject(ExecutionPlanService);
  private timelineApi = inject(TimelineService);
  private devops = inject(DevOpsActionsService);
  private storage = inject(StorageService);
  private base = environment.apiUrl;

  // ── Leitura ───────────────────────────────────────────────────────────────────────────────────

  async artifactText(a: Pick<ExecutionArtifact, 'id' | 'planId'>, planId: string): Promise<string> {
    const blob = await firstValueFrom(this.plans.content(a.planId || planId, a.id));
    return blob.text();
  }

  register(card: string): Promise<RegisterTexts | null> {
    return firstValueFrom(this.http.get<RegisterTexts | null>(`${this.base}PullRequest/GetByCardNumber?cardNumber=${encodeURIComponent(card)}`))
      .then(r => r ?? null);
  }

  handover(card: string): Promise<HandoverTexts | null> {
    return firstValueFrom(this.http.get<HandoverTexts | null>(`${this.base}Handover/GetByCardNumber?cardNumber=${encodeURIComponent(card)}`))
      .then(r => r ?? null);
  }

  timeline(card: string): Promise<TimelineEntry[]> {
    return firstValueFrom(this.timelineApi.getByCardNumber(card)).then(r => r ?? []);
  }

  /** Card completo (título, repro steps, discussion) — contexto da IA. */
  cardFull(card: string): Promise<CardFull> {
    return firstValueFrom(this.http.get<CardFull>(`${this.base}Azure/card/${encodeURIComponent(card)}/full`)).then(c => {
      if (!c || c.error) throw new Error(c?.error || 'Card indisponível no DevOps.');
      return c;
    });
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────

  saveArtifactText(planId: string, artifactId: string, content: string): Promise<ExecutionArtifact> {
    return firstValueFrom(this.http.put<ExecutionArtifact>(`${this.base}ExecutionPlan/${planId}/artifacts/${artifactId}/text`, { content }));
  }

  /** Resumo não técnico: grava no PRMake; com `publish`, publica/atualiza o mesmo comentário na discussion. */
  saveSummary(card: string, markdown: string, publish: boolean): Promise<RegisterTexts> {
    return this.devops.saveSummary(card, markdown, publish, publish ? toHtml(markdown) : undefined);
  }

  /** Root cause / descrição no registro do card (o registro já existe — o upsert só troca o texto). */
  saveRegister(card: string, changes: { rootCause?: string; description?: string }): Promise<RegisterTexts> {
    const userId = this.storage.getAccess()?.user?.externalId ?? null;
    return firstValueFrom(this.http.post<RegisterTexts>(`${this.base}PullRequest`, {
      cardNumber: card, userId, formId: 0, rootCause: changes.rootCause ?? null, description: changes.description ?? null,
    }));
  }

  /** Grava no campo Root Cause do card no DevOps (HTML) e lembra do envio (o PRMake não registra). */
  async sendRootCause(card: string, markdown: string): Promise<SentRecord> {
    const res = await firstValueFrom(this.http.post<any>(`${this.base}Azure/card/${encodeURIComponent(card)}/rootcause`, { rootCause: toHtml(markdown) }));
    if (!res) throw new Error('O DevOps não confirmou a gravação do Root Cause.');
    const record: SentRecord = { at: new Date().toISOString(), by: this.userName(), hash: textHash(markdown) };
    try { localStorage.setItem(SENT_KEY(card), JSON.stringify(record)); } catch { /* sem storage */ }
    return record;
  }

  rootCauseSent(card: string): SentRecord | null {
    try {
      const raw = localStorage.getItem(SENT_KEY(card));
      return raw ? JSON.parse(raw) as SentRecord : null;
    } catch { return null; }
  }

  publishTimeline(card: string, markdown: string, entryId: number | null): Promise<TimelineEntry> {
    return firstValueFrom(entryId
      ? this.timelineApi.update(entryId, { description: markdown })
      // userName só vale quando a chave não identifica o usuário (o servidor usa o logado quando há).
      : this.timelineApi.create({ cardNumber: card, description: markdown, userName: this.userName() ?? undefined }));
  }

  saveHandover(card: string, content: string): Promise<HandoverTexts> {
    return firstValueFrom(this.http.post<HandoverTexts>(`${this.base}Handover`, {
      cardNumber: card, content, repositoryId: null, userId: this.storage.getAccess()?.user?.externalId ?? null,
    }));
  }

  // ── Rascunho da situação (até publicar) ───────────────────────────────────────────────────────

  situationDraft(card: string): string | null {
    try { return localStorage.getItem(DRAFT_KEY(card)); } catch { return null; }
  }

  setSituationDraft(card: string, markdown: string | null): void {
    try {
      if (markdown) localStorage.setItem(DRAFT_KEY(card), markdown);
      else localStorage.removeItem(DRAFT_KEY(card));
    } catch { /* sem storage */ }
  }

  // ── IA (chave da própria pessoa) ──────────────────────────────────────────────────────────────

  generate(prompt: string): Promise<string> {
    return this.devops.generate(prompt, 'texts:regenerate');
  }

  userName(): string | null {
    const user = this.storage.getAccess()?.user as any;
    return user?.name ?? user?.userName ?? user?.email ?? null;
  }
}

export function toHtml(markdown: string): string {
  return renderMarkdown(markdown, { codeRefs: false });
}

/** "Título" + repro steps do card (texto puro). */
export function cardContext(card: CardFull, reproField = 'Microsoft.VSTS.TCM.ReproSteps'): string {
  const f = card.fields ?? {};
  const repro = htmlToText(f[reproField] ?? f['System.Description']) || '—';
  return [`Título: ${f['System.Title'] ?? '—'}`, `Tipo: ${f['System.WorkItemType'] ?? '—'} · Estado: ${f['System.State'] ?? '—'}`, '', 'Passos para reproduzir / descrição:', repro].join('\n');
}

/** Discussion do card (últimos 20 comentários, texto puro). */
export function discussionContext(card: CardFull): string {
  const list = (card.comments ?? []).slice(-20)
    .map(c => `- ${c.createdByName ?? '—'} (${c.createdDate ? new Date(c.createdDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}): ${htmlToText(c.text) || '—'}`);
  return list.join('\n') || '(sem comentários)';
}
