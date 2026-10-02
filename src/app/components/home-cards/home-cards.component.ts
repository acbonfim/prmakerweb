import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StorageService } from '../../services/storage.service';
import { AuthService } from '../../services/auth.service';
import { WsService } from '../../services/ws.service';
import { UserPendingService } from '../../services/user-pending.service';
import {
  DevOpsCardSummary,
  HomeCard,
  HomeCardPullRequest,
  HomeCardRole,
  HomeCardsScope,
  HomeCardsService
} from '../../services/home-cards.service';
import { AvatarStackComponent, AvatarStackPerson } from '../avatar-stack/avatar-stack.component';

/** Tempo real das listas de recentes da home (PullRequestRealTimeEvents no backend, 0021). */
const RECENT_GROUP = 'pullrequest-recent';
const RECENT_EVENT = 'pullRequestRecentUpdated';
/** Plano e Timeline não avisam o grupo de recentes: com a aba visível, confere de tempos em tempos (sem skeleton). */
const POLL_MS = 120_000;
const TAKE = 10;

type PanelFocus = 'plan' | 'timeline' | 'prs';

/** Fotos por externalId, compartilhadas entre as duas listas da home (uma consulta por pessoa). */
const photoCache = new Map<string, string>();

const ROLE_LABELS: Record<HomeCardRole, string> = {
  register: 'Atualizou o card',
  pr: 'Abriu PR',
  timeline: 'Escreveu na Timeline',
  plan: 'Interagiu no plano',
  handover: 'Salvou o handover',
};

const PLAN_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Pendente', tone: 'neutral' },
  running: { label: 'Em andamento', tone: 'info' },
  paused: { label: 'Pausado', tone: 'warn' },
  completed: { label: 'Concluído', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'error' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
};

/**
 * Lista de cards da home (0051): "Seus últimos cards" (scope=mine) e "Cards que você participou" (scope=participated).
 * Cada cartão mostra quem está envolvido (avatares sobrepostos), estado no DevOps, plano de execução, PRs, última
 * entrada da Timeline e último comentário do plano, com atalhos direto para cada painel da tela do card.
 */
@Component({
  selector: 'app-home-cards',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, AvatarStackComponent],
  templateUrl: './home-cards.component.html',
  styleUrls: ['./home-cards.component.css'],
})
export class HomeCardsComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private storage = inject(StorageService);
  private auth = inject(AuthService);
  private api = inject(HomeCardsService);
  private ws = inject(WsService);
  private cdr = inject(ChangeDetectorRef);
  /** Pendências dos planos por card (0037) — selo "Aguardando você". */
  readonly pending = inject(UserPendingService);

  @Input() scope: HomeCardsScope = 'mine';
  @Input() title = '';
  @Input() icon = 'history';
  @Input() emptyText = '';

  /** Emite se a seção tem conteúdo (carregando ou com itens): o pai dá 100% da largura ao outro bloco quando este fica vazio. */
  @Output() visibilityChange = new EventEmitter<boolean>();

  readonly cards = signal<HomeCard[]>([]);
  readonly loading = signal(false);
  readonly devops = signal<Map<string, DevOpsCardSummary>>(new Map());
  readonly skeletons = Array.from({ length: 3 });
  private photos = signal<Map<string, string>>(new Map(photoCache));

  private enabled = false;
  private myId = '';
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private resyncSub?: Subscription;

  ngOnInit() {
    this.myId = `${this.storage.getAccess()?.user?.externalId ?? ''}`.toLowerCase();
    this.enabled = !!this.myId;
    if (!this.enabled) {
      this.visibilityChange.emit(false);
      return;
    }
    this.load();
    this.ws.startConnection();
    this.ws.addToGroup(RECENT_GROUP);
    this.ws.on(RECENT_EVENT, this.onRecentUpdated);
    this.resyncSub = this.ws._resynced.subscribe(() => this.schedule());
    this.poll = setInterval(() => { if (!document.hidden) this.load(true); }, POLL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy() {
    if (!this.enabled) return;
    clearTimeout(this.reloadTimer);
    clearInterval(this.poll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.ws.off(RECENT_EVENT, this.onRecentUpdated);
    this.ws.removeFromGroup(RECENT_GROUP);
    this.resyncSub?.unsubscribe();
  }

  /** Card salvo, PR aberto ou handover salvo (por qualquer pessoa): várias mudanças seguidas viram uma recarga só. */
  private onRecentUpdated = (): void => this.schedule();

  private onVisibility = (): void => {
    if (!document.hidden) this.schedule();
  };

  private schedule() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.load(true), 600);
  }

  private load(silent = false) {
    if (!silent) this.loading.set(true);
    this.emitVisibility();
    this.api.getCards(this.scope, TAKE).subscribe({
      next: (cards) => {
        this.cards.set(cards ?? []);
        this.loading.set(false);
        this.emitVisibility();
        this.loadDevOps();
        this.loadPhotos();
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading.set(false);
        this.emitVisibility();
        this.cdr.detectChanges();
      },
    });
  }

  private emitVisibility() {
    this.visibilityChange.emit(this.loading() || this.cards().length > 0);
  }

  /** Título/estado do DevOps chegam depois (uma chamada para a lista toda); sem integração o cartão segue sem eles. */
  private loadDevOps() {
    const numbers = this.cards().map((c) => c.cardNumber).filter((n) => /^\d+$/.test(n));
    this.api.getDevOpsSummary(numbers).subscribe((list) => {
      const next = new Map(this.devops());
      for (const item of list ?? []) next.set(`${item.id}`, item);
      this.devops.set(next);
      this.cdr.detectChanges();
    });
  }

  private loadPhotos() {
    const ids = new Set<string>();
    for (const c of this.cards()) {
      c.participants.forEach((p) => p.userId && ids.add(p.userId.toLowerCase()));
    }
    const missing = [...ids].filter((id) => !photoCache.has(id));
    if (!missing.length) return;
    this.auth.getPhotosByExternalIds(missing).subscribe({
      next: (res: any) => {
        const list = res?.object ?? res?.Object ?? [];
        for (const u of list) {
          const ext = (u.externalId || u.ExternalId || '').toLowerCase();
          if (ext) photoCache.set(ext, u.imageUrl || u.ImageUrl || '');
        }
        // Quem não veio na resposta não é consultado de novo.
        missing.forEach((id) => photoCache.has(id) || photoCache.set(id, ''));
        this.photos.set(new Map(photoCache));
        this.cdr.detectChanges();
      },
      error: () => {},
    });
  }

  // ── Navegação ──

  /** Abre o card na tela de PR; com `focus`, já no painel (plano, Timeline ou PRs). */
  open(card: HomeCard, focus?: PanelFocus, event?: Event) {
    event?.stopPropagation();
    this.router.navigate(['/auth/register'], {
      queryParams: {
        card: card.cardNumber,
        repositoryId: card.repositoryId ?? undefined,
        focus: focus ?? undefined,
      },
    });
  }

  stop(event: Event) {
    event.stopPropagation();
  }

  // ── Dados do cartão ──

  people(card: HomeCard): AvatarStackPerson[] {
    const photos = this.photos();
    return card.participants.map((p) => ({
      name: p.name || 'Sem nome',
      imageUrl: p.userId ? photos.get(p.userId.toLowerCase()) || null : null,
    }));
  }

  devopsOf(card: HomeCard): DevOpsCardSummary | undefined {
    return this.devops().get(card.cardNumber);
  }

  roleLabel(role: HomeCardRole): string {
    return ROLE_LABELS[role] ?? role;
  }

  phaseLabel(phase: string): string {
    return phase === 'correction' ? 'correção' : 'análise';
  }

  planStatus(status: string): { label: string; tone: string } {
    return PLAN_STATUS[status] ?? { label: status, tone: 'neutral' };
  }

  progress(done: number, total: number): number {
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  prTone(pr: HomeCardPullRequest): string {
    if (pr.status === 'MERGED') return 'merged';
    if (pr.status === 'CLOSED') return 'closed';
    return pr.isDraft ? 'draft' : 'open';
  }

  prLabel(pr: HomeCardPullRequest): string {
    if (pr.status === 'MERGED') return 'Mesclado';
    if (pr.status === 'CLOSED') return 'Fechado';
    return pr.isDraft ? 'Rascunho' : 'Aberto';
  }

  openPrs(card: HomeCard): number {
    return card.pullRequests.filter((p) => p.status === 'OPEN').length;
  }

  /** Cor do estado do DevOps pelo nome (os estados variam por processo do projeto). */
  stateTone(state?: string | null): string {
    const s = (state || '').toLowerCase();
    if (!s) return 'neutral';
    if (/(closed|done|conclu|fechad)/.test(s)) return 'ok';
    if (/(removed|cancel|rejeit)/.test(s)) return 'error';
    if (/(resolved|qa|test|review|valida)/.test(s)) return 'warn';
    if (/(active|progress|doing|committed|andamento|dev)/.test(s)) return 'info';
    return 'neutral';
  }

  /** Rodapé: a última coisa que aconteceu no card (sem repetir o texto da Timeline, que já aparece acima). */
  lastText(card: HomeCard): string {
    const a = card.lastActivity;
    if (!a) return '';
    const text = a.kind === 'timeline' ? 'Escreveu na Timeline' : a.text;
    const who = a.userId && a.userId.toLowerCase() === this.myId ? 'Você' : this.firstName(a.userName);
    return who ? `${who} · ${text}` : text;
  }

  firstName(name?: string | null): string {
    return (name || '').trim().split(/\s+/)[0] || '';
  }

  hasDetails(card: HomeCard): boolean {
    return !!(card.plan || card.pullRequests.length || card.timeline.last || card.notes.last);
  }

  /** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias" ou a data. */
  ago(iso?: string | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'agora';
    if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
    const days = Math.floor(diff / 86400);
    if (days === 1) return 'ontem';
    if (days < 7) return `há ${days} dias`;
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  fullDate(iso?: string | null): string {
    return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  }
}
