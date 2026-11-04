import { EventEmitter, WritableSignal, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { CliipboardService } from '../../services/cliipboard.service';
import { StorageService } from '../../services/storage.service';
import { AuthService } from '../../services/auth.service';
import { HomeCard, HomeCardsService } from '../../services/home-cards.service';
import { TabsService } from '../../services/tabs.service';
import { UserPendingService } from '../../services/user-pending.service';
import { WsService } from '../../services/ws.service';
import { CodeRefService } from '../code-ref/code-ref.service';
import { HomeCardsComponent } from '../home-cards/home-cards.component';
import { CardSituationComponent } from './card-situation.component';
import { CardSituation, CardSituationService, SituationPostSettings } from './card-situation.service';
import { MatDialog } from '@angular/material/dialog';

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 86_400_000;

function situation(extra: Partial<CardSituation>): CardSituation {
  return {
    cardNumber: '75812', kind: 'none', title: '', icon: '', since: null, alsoWaiting: [], planId: 'p1', phase: 'correction',
    planTitle: 'Corrigir SA3', planStatus: 'running', stepKey: null, stepTitle: null, done: [], pullRequests: [], tickets: [],
    questions: [], userSteps: [], devTestInQaAt: null, devTestInQaError: null, qaChecklist: null, devOpsState: null,
    devOpsColumn: null, handoff: null, handoffAt: null, handoffBy: null, next: null, markdown: '', autoPost: false,
    publishedAt: null, publishedBy: null, publishedMarkdown: null, publishPending: false, ...extra,
  };
}

class FakeSituations {
  state = new Map<string, WritableSignal<CardSituation | null>>();
  next: CardSituation | null = null;
  fail = false;
  loads: { card: string; opts: any }[] = [];
  watched: string[] = [];
  published: string[] = [];
  readonly postSettings = signal<SituationPostSettings | null>(null);
  saved: (boolean | null)[] = [];
  settings: SituationPostSettings = { autoPost: null, globalDefault: true, effective: true };
  situationOf(card: string) {
    if (!this.state.has(card)) this.state.set(card, signal<CardSituation | null>(null));
    return this.state.get(card)!;
  }
  async load(card: string, opts: any) {
    this.loads.push({ card, opts });
    if (this.fail) throw { error: { error: 'falhou' } };
    this.situationOf(card).set(this.next);
    return this.next;
  }
  watch(card: string) { this.watched.push(card); }
  unwatch(card: string) { this.watched = this.watched.filter(c => c !== card); }
  async publish(card: string) { this.published.push(card); return { commentId: 1 }; }
  async loadPostSettings() { this.postSettings.set(this.settings); return this.settings; }
  async savePostSettings(autoPost: boolean | null) {
    this.saved.push(autoPost);
    this.settings = { autoPost, globalDefault: this.settings.globalDefault, effective: autoPost ?? this.settings.globalDefault };
    this.postSettings.set(this.settings);
    return this.settings;
  }
}

class FakeCodeRefs {
  readonly changes = signal(null);
  async loadHeads() { return []; }
  watch() {}
  unwatch() {}
  async attachment(): Promise<Blob> { throw new Error('404'); }
}

async function settle(f: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise(r => setTimeout(r, 0));
  }
}

describe('CardSituationComponent (0075/F4)', () => {
  let svc: FakeSituations;
  let clip: jasmine.SpyObj<CliipboardService>;
  let f: ComponentFixture<CardSituationComponent>;
  let el: HTMLElement;
  let dialog: jasmine.SpyObj<MatDialog>;

  async function render(s: CardSituation | null): Promise<void> {
    svc.next = s;
    f = TestBed.createComponent(CardSituationComponent);
    f.componentRef.setInput('cardNumber', '75812');
    await settle(f);
    el = f.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    try { localStorage.removeItem('prmake.situation-collapsed'); } catch { /* sem storage */ }
    svc = new FakeSituations();
    clip = jasmine.createSpyObj<CliipboardService>('CliipboardService', ['copyRichToClipboard']);
    clip.copyRichToClipboard.and.resolveTo();
    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    TestBed.configureTestingModule({
      imports: [CardSituationComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CardSituationService, useValue: svc },
        { provide: CodeRefService, useValue: new FakeCodeRefs() },
        { provide: CliipboardService, useValue: clip },
        { provide: MatDialog, useValue: dialog },
      ],
    });
  });

  it('carrega com o DevOps na 1ª vez e entra no tempo real do card', async () => {
    await render(situation({ kind: 'none' }));
    expect(svc.loads[0]).toEqual({ card: '75812', opts: { devops: true, force: true } });
    expect(svc.watched).toEqual(['75812']);
    // nada aguardado: não mostra o cartão
    expect(el.querySelector('.sit')).toBeNull();
    f.destroy();
    expect(svc.watched).toEqual([]);
  });

  it('ticket: chamado com link, aberto por/há, arquivos e próximo passo', async () => {
    await render(situation({
      kind: 'ticket', title: 'Aguardando chamado', icon: '🎫', since: ago(3 * DAY), stepKey: 'chamado', stepTitle: 'Chamado: ajustar filtros',
      tickets: [{ url: 'https://fs/t/4321', title: '#4321 ajustar filtros', status: 'open', stepTitle: 'Chamado: ajustar filtros',
        openedAt: ago(3 * DAY), openedBy: 'Alex', files: ['01_ajuste.sql', 'chamado-ajuste.md'] }],
      next: 'Quando resolver: marque *Resolvido*', markdown: '🎫 **Situação**',
      devOpsState: 'Active', devOpsColumn: 'Doing',
    }));
    expect(el.querySelector('.sit--ticket')).not.toBeNull();
    expect(el.querySelector('.sit__title')!.textContent).toContain('Aguardando chamado');
    expect(el.querySelector('.sit__since')!.textContent).toContain('há 3 d');
    const link = el.querySelector<HTMLAnchorElement>('.sit-ticket__link')!;
    expect(link.href).toBe('https://fs/t/4321');
    expect(el.querySelector('.sit-ticket__meta')!.textContent).toContain('aberto por Alex há 3 d');
    expect([...el.querySelectorAll('.sit__file')].map(x => x.textContent)).toEqual(['01_ajuste.sql', 'chamado-ajuste.md']);
    expect(el.querySelector('.sit__meta')!.textContent).toContain('Active · Doing');
    expect(el.querySelector('.sit__next em')!.textContent).toBe('Resolvido');
  });

  it('pr-review: PRs com destino, aprovações, alterações pedidas, revisores e CI', async () => {
    await render(situation({
      kind: 'pr-review', title: 'Aguardando aprovação e merge', icon: '🔀', since: ago(2 * DAY), alsoWaiting: ['Aguardando resposta'],
      pullRequests: [
        { repository: 'edv-solvace', number: 101, url: 'https://gh/101', title: 'PR 101', targetBranch: 'development', status: 'open', isQa: false,
          checks: 'success', approvals: 1, changesRequested: 2, reviewersPending: 'ana', openedAt: ago(2 * DAY), mergedAt: null },
        { repository: 'edv-solvace', number: 102, url: 'https://gh/102', title: 'PR 102', targetBranch: 'qa', status: 'open', isQa: true,
          checks: 'failure', approvals: 0, changesRequested: 0, reviewersPending: null, openedAt: ago(DAY), mergedAt: null },
      ],
      markdown: 'x',
    }));
    const rows = [...el.querySelectorAll<HTMLElement>('.sit-pr')];
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('a')!.textContent).toBe('#101');
    expect(rows[0].textContent).toContain('edv-solvace → development');
    expect(rows[0].textContent).toContain('1 aprovação');
    expect(rows[0].textContent).toContain('2 alterações pedidas');
    expect(rows[0].textContent).not.toMatch(/[✔✋⏳✅❌]/);
    expect(rows[0].textContent).toContain('revisores: ana');
    expect(rows[0].querySelector('.sit-pr__ci--success')!.textContent).toBe('check_circle');
    expect(rows[1].querySelector('.sit__badge--qa')).not.toBeNull();
    expect(rows[1].textContent).toContain('sem aprovação');
    expect(rows[1].querySelector('.sit-pr__ci--failure')!.textContent).toBe('cancel');
    expect(el.querySelector('.sit__chip')!.textContent).toContain('Aguardando resposta');
  });

  it('qa-validation: PR de QA mesclado, aviso de Dev Test in QA, roteiro, handoff com link de código e "Já feito"', async () => {
    await render(situation({
      kind: 'qa-validation', title: 'Validar em QA', icon: '🧪', since: ago(3_600_000), stepKey: 'validar-qa', stepTitle: 'Validar em QA',
      pullRequests: [{ repository: 'edv-solvace', number: 102, url: 'https://gh/102', title: null, targetBranch: 'qa', status: 'merged', isQa: true,
        checks: null, approvals: null, changesRequested: null, reviewersPending: null, openedAt: ago(DAY), mergedAt: ago(3_600_000) }],
      devTestInQaError: 'Estado/coluna de Dev Test in QA não configurados',
      qaChecklist: '- SA3 Busca de A3: filtro de datas',
      handoff: 'Mudou só no SA3 ([sa3_busca_a3.asp:239-289](ref:sa3-init)).', handoffBy: 'Alex Teste', handoffAt: ago(1_800_000),
      done: ['Impacto na base', 'PRs (edv-solvace)'],
      next: 'Valide e conclua *Validar em QA*.', markdown: '🧪 **Situação: Validar em QA**',
    }));
    expect(el.querySelector('.sit--qa-validation')).not.toBeNull();
    expect(el.querySelector('.sit-pr__state--merged')!.textContent).toContain('mesclado há 1 h');
    expect(el.querySelector('.sit__line--warn')!.textContent).toContain('Dev Test in QA');
    expect(el.querySelector('.sit__line--warn')!.textContent).toContain('não configurados');
    expect([...el.querySelectorAll('.sit__md li')].map(li => li.textContent)).toContain('SA3 Busca de A3: filtro de datas');
    const ref = el.querySelector<HTMLAnchorElement>('.sit__handoff a.code-ref')!;
    expect(ref.getAttribute('href')).toBe('#ref/sa3-init');
    expect(el.querySelector('.sit__handoff .sit__by')!.textContent).toContain('Alex Teste');
    // "Já feito" recolhido
    expect(el.querySelector('.sit__done-list')).toBeNull();
    el.querySelector<HTMLButtonElement>('.sit__done .sit__link')!.click();
    await settle(f);
    expect(el.querySelectorAll('.sit__done-list li').length).toBe(2);
  });

  it('dev test in QA feito: mostra desde quando', async () => {
    await render(situation({ kind: 'qa-validation', title: 'Validar em QA', icon: '🧪', devTestInQaAt: ago(2 * DAY), markdown: 'x' }));
    expect(el.querySelector('.sit__line--ok')!.textContent).toContain('Dev Test in QA');
    expect(el.querySelector('.sit__line--ok')!.textContent).toContain('há 2 d');
  });

  it('copiar resumo grava HTML + markdown; publicar pede confirmação e envia sem HTML (o servidor monta)', async () => {
    await render(situation({ kind: 'pr-review', title: 'Aguardando aprovação e merge', icon: '🔀',
      markdown: '🔀 **Situação** ver [x](ref:sa3-init)' }));
    const buttons = el.querySelectorAll<HTMLButtonElement>('.sit__head button');
    buttons[0].click();
    expect(clip.copyRichToClipboard).toHaveBeenCalled();
    const [html, text] = clip.copyRichToClipboard.calls.mostRecent().args;
    expect(text).toBe('🔀 **Situação** ver [x](ref:sa3-init)');
    expect(html).toContain('<strong>Situação</strong>');

    buttons[1].click();
    await settle(f);
    expect(el.querySelector('.sit__confirm')!.textContent).toContain('lida pelo cliente');
    expect(svc.published.length).toBe(0);
    el.querySelector<HTMLButtonElement>('.sit__confirm-actions button[color="primary"]')!.click();
    await settle(f);
    expect(svc.published).toEqual(['75812']);
    expect(el.querySelector('.sit__result')!.textContent).toContain('publicado');
    // depois de publicar, recarrega a situação (o status "publicado em" vem do servidor)
    expect(svc.loads.at(-1)).toEqual({ card: '75812', opts: { force: true } });
  });

  it('0076: ícone mat-icon pelo tipo (ignora o emoji do back)', async () => {
    await render(situation({ kind: 'ticket', title: 'Aguardando chamado', icon: '🎫', markdown: 'x' }));
    expect(el.querySelector('.sit__icon mat-icon')!.textContent).toBe('confirmation_number');
    expect(el.querySelector('.sit__head')!.textContent).not.toContain('🎫');
  });

  it('0076: publicado — quando, por quem e "Ver o que foi publicado" abre o texto publicado', async () => {
    dialog.open.calls.reset();
    await render(situation({ kind: 'pr-review', title: 'Aguardando aprovação e merge', markdown: 'atual',
      publishedAt: '2026-11-04T11:58:00', publishedBy: 'Fulano', publishedMarkdown: '**Publicado** antes', autoPost: true }));
    const status = el.querySelector('.sit__post-status')!.textContent!;
    expect(status).toContain('Publicado na discussion em 04/11 às 11:58');
    expect(status).toContain('por Fulano');
    expect(el.querySelector('.sit__pending')).toBeNull();
    el.querySelector<HTMLButtonElement>('.sit__post-view')!.click();
    expect(dialog.open).toHaveBeenCalled();
    const data = dialog.open.calls.mostRecent().args[1]!.data as { markdown: string; title: string };
    expect(data.markdown).toBe('**Publicado** antes');
    expect(data.title).toContain('Publicado');
  });

  it('0076: sem publicação e resumo pronto (manual) — faixa "pronto para a discussion" com Ver e Publicar', async () => {
    dialog.open.calls.reset();
    await render(situation({ kind: 'ticket', title: 'Aguardando chamado', markdown: 'novo resumo', publishPending: true, autoPost: false }));
    expect(el.querySelector('.sit__post-status--none')!.textContent).toContain('Ainda não publicado na discussion');
    const strip = el.querySelector('.sit__pending')!;
    expect(strip.textContent).toContain('O resumo mudou e está pronto para a discussion');
    const [ver, publicar] = [...strip.querySelectorAll<HTMLButtonElement>('button')];
    ver.click();
    expect((dialog.open.calls.mostRecent().args[1]!.data as { markdown: string }).markdown).toBe('novo resumo');
    publicar.click();
    await settle(f);
    expect(el.querySelector('.sit__confirm')!.textContent).toContain('lida pelo cliente');
    expect(el.querySelector('.sit__pending')).toBeNull();
  });

  it('0076: pendente com publicação automática — sem faixa, "a atualização sai sozinha"', async () => {
    await render(situation({ kind: 'ticket', title: 'Aguardando chamado', markdown: 'x', publishPending: true, autoPost: true,
      publishedAt: '2026-11-04T11:58:00', publishedMarkdown: 'y' }));
    expect(el.querySelector('.sit__pending')).toBeNull();
    expect(el.querySelector('.sit__post-soon')!.textContent).toContain('sai sozinha');
  });

  it('0076: toggle "Publicar automaticamente" grava a preferência (PUT) e recarrega a situação', async () => {
    svc.settings = { autoPost: null, globalDefault: true, effective: true };
    await render(situation({ kind: 'ticket', title: 'Aguardando chamado', markdown: 'x', autoPost: true }));
    expect(el.querySelector('.sit__post-help')!.textContent).toContain('Seguindo o padrão (ligado)');
    const input = el.querySelector<HTMLButtonElement>('.sit__auto button[role="switch"]')!;
    expect(input.getAttribute('aria-checked')).toBe('true');
    const loadsBefore = svc.loads.length;
    input.click();
    await settle(f);
    expect(svc.saved).toEqual([false]);
    expect(svc.loads.length).toBe(loadsBefore + 1);
    expect(svc.loads.at(-1)!.opts).toEqual({ force: true });
    expect(el.querySelector('.sit__post-help')!.textContent).toContain('Sua preferência');
    // "Usar o padrão" volta a seguir o padrão (null)
    [...el.querySelectorAll<HTMLButtonElement>('.sit__post-help .sit__link')].find(b => b.textContent!.includes('Usar o padrão'))!.click();
    await settle(f);
    expect(svc.saved).toEqual([false, null]);
  });

  it('erro na carga: aviso discreto com "Tentar de novo"', async () => {
    svc.fail = true;
    await render(null);
    expect(el.querySelector('.sit-error-line')!.textContent).toContain('falhou');
    svc.fail = false;
    svc.next = situation({ kind: 'user', title: 'Aguardando você', icon: '⚠️', userSteps: ['Aprovar o script'], markdown: 'x' });
    el.querySelector<HTMLButtonElement>('.sit-error-line button')!.click();
    await settle(f);
    expect(el.querySelector('.sit--user')).not.toBeNull();
    expect(el.querySelector('.sit__bullets')!.textContent).toContain('Aprovar o script');
  });
});

describe('HomeCardsComponent — chip da situação (0075/F4)', () => {
  function card(situationKind: string | null, situationAt: string | null): HomeCard {
    return {
      cardNumber: '75812', repositoryId: null, ownerUserId: null, isMine: true, registered: true, hasDescription: false,
      hasRootCause: false, summaryPublished: false, myRoles: [], myLastActivityAt: null, lastActivity: null, participants: [],
      participantsCount: 0, pullRequests: [], timeline: { count: 0, last: null }, notes: { count: 0, last: null }, handover: null,
      plan: { id: 'p', phase: 'correction', title: 'Plano', status: 'running', stepsDone: 5, stepsTotal: 8, currentStep: null,
        currentStepStatus: null, waitingOn: null, waitingReason: null, openQuestions: 0, phases: [], updatedAt: ago(0),
        situationKind, situationAt },
    };
  }

  async function renderHome(cards: HomeCard[]): Promise<{ icon: string; text: string } | null> {
    TestBed.configureTestingModule({
      imports: [HomeCardsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: TabsService, useValue: {} },
        { provide: StorageService, useValue: { getAccess: () => ({ user: { externalId: 'me' } }) } },
        { provide: AuthService, useValue: { getPhotosByExternalIds: () => of({ object: [] }) } },
        { provide: HomeCardsService, useValue: { getCards: () => of(cards), getDevOpsSummary: () => of([]) } },
        { provide: WsService, useValue: { startConnection() {}, addToGroup() {}, removeFromGroup() {}, on() {}, off() {}, _resynced: new EventEmitter<void>() } },
        { provide: UserPendingService, useValue: { byCard: signal(new Map()) } },
      ],
    });
    const f = TestBed.createComponent(HomeCardsComponent);
    await settle(f);
    const chip = (f.nativeElement as HTMLElement).querySelector('.chip-situation');
    const icon = chip?.querySelector('mat-icon')?.textContent?.trim() ?? '';
    const text = chip ? chip.textContent!.replace(icon, '').trim() : null;
    f.destroy();
    return text === null ? null : { icon, text };
  }

  it('mostra ícone (mat-icon, sem emoji) + rótulo curto + "há X" e some sem situação', async () => {
    expect(await renderHome([card('ticket', ago(3 * DAY + 60_000))])).toEqual({ icon: 'confirmation_number', text: 'chamado · há 3 d' });
  });

  it('sem espera (none/null): sem chip', async () => {
    expect(await renderHome([card('none', null)])).toBeNull();
  });
});
