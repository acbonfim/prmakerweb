import { EventEmitter, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WsService } from '../../services/ws.service';
import { CardSituation, CardSituationService, situationAgo, situationChip } from './card-situation.service';

class FakeWs {
  handlers = new Map<string, ((p: any) => void)[]>();
  groups: string[] = [];
  _resynced = new EventEmitter<void>();
  startConnection() {}
  on(event: string, h: (p: any) => void) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]); }
  addToGroup(g: string) { this.groups.push(g); }
  removeFromGroup(g: string) { this.groups = this.groups.filter(x => x !== g); }
  emit(event: string, payload: any) { (this.handlers.get(event) ?? []).forEach(h => h(payload)); }
}

const base = (extra: Partial<CardSituation> = {}): Partial<CardSituation> => ({
  cardNumber: '75812', kind: 'pr-review', title: 'Aguardando aprovação e merge', icon: '🔀', since: '2026-11-02T10:00:00Z',
  markdown: '🔀 **Situação**', devOpsState: 'Active', devOpsColumn: 'Code Review', ...extra,
});

describe('CardSituationService (0075/F4)', () => {
  let svc: CardSituationService;
  let http: HttpTestingController;
  let ws: FakeWs;
  const url = (devops: boolean) => (r: { url: string; params: { get(k: string): string | null } }) =>
    r.url.endsWith('ExecutionPlan/card/75812/situation') && r.params.get('devops') === `${devops}`;

  beforeEach(() => {
    ws = new FakeWs();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: WsService, useValue: ws }],
    });
    svc = TestBed.inject(CardSituationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => jasmine.clock().uninstall());

  it('carrega uma vez e serve do cache; force busca de novo', async () => {
    const p = svc.load('75812', { devops: true });
    http.expectOne(url(true)).flush(base());
    const s = await p;
    expect(s?.kind).toBe('pr-review');
    expect(svc.situationOf('75812')()?.title).toBe('Aguardando aprovação e merge');
    // listas ausentes no JSON viram []
    expect(s?.pullRequests).toEqual([]);

    await svc.load('75812');
    http.expectNone(url(false));

    const again = svc.load('75812', { force: true });
    http.expectOne(url(false)).flush(base({ devOpsState: null, devOpsColumn: null, title: 'Outro' }));
    const s2 = await again;
    // devops=false não traz o DevOps: mantém o que veio da carga completa
    expect(s2?.devOpsState).toBe('Active');
    expect(s2?.devOpsColumn).toBe('Code Review');
    expect(svc.situationOf('75812')()?.title).toBe('Outro');
  });

  it('erro propaga e não grava no cache', async () => {
    const p = svc.load('75812', { devops: true });
    http.expectOne(url(true)).flush({ error: 'x' }, { status: 500, statusText: 'err' });
    await expectAsync(p).toBeRejected();
    expect(svc.situationOf('75812')()).toBeNull();
  });

  it('tempo real: junta a rajada num GET só (debounce ~1 s, devops=false) e só para cards em watch', () => {
    jasmine.clock().install();
    svc.watch('75812');
    expect(ws.groups).toContain('execplan:75812');

    ws.emit('executionPlanUpdated', { cardNumber: '75812', action: 'situation' });
    jasmine.clock().tick(500);
    ws.emit('executionPlanUpdated', { cardNumber: '75812', action: 'step' });
    ws.emit('executionPlanUpdated', { cardNumber: '75812', action: 'log' }); // log não muda a situação
    jasmine.clock().tick(900);
    http.expectNone(url(false));
    jasmine.clock().tick(200);
    http.expectOne(url(false)).flush(base());

    // card fora do watch: ignora
    ws.emit('executionPlanUpdated', { cardNumber: '99999', action: 'situation' });
    jasmine.clock().tick(1500);
    http.expectNone(() => true);

    // PR do card mudou (pullRequestCardUpdated) também recarrega
    ws.emit('pullRequestCardUpdated', { cardNumber: '75812', action: 'github-pr-status' });
    jasmine.clock().tick(1100);
    http.expectOne(url(false)).flush(base());

    // saiu do watch: o timer pendente não dispara
    ws.emit('executionPlanUpdated', { cardNumber: '75812', action: 'situation' });
    svc.unwatch('75812');
    jasmine.clock().tick(2000);
    http.expectNone(() => true);
    expect(ws.groups).not.toContain('execplan:75812');
  });

  it('publish envia corpo vazio (0076: o servidor monta o HTML)', async () => {
    const p = svc.publish('75812');
    const req = http.expectOne(r => r.url.endsWith('ExecutionPlan/card/75812/situation/publish'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ commentId: 7 });
    expect((await p).commentId).toBe(7);
  });

  it('0076: campos de publicação normalizados (autoPost, publishPending, publicado)', async () => {
    const p = svc.load('75812', { devops: true });
    http.expectOne(url(true)).flush(base({ autoPost: true, publishPending: true, publishedAt: '2026-11-04T11:58:00Z',
      publishedBy: 'Fulano', publishedMarkdown: '**x**' }));
    const s = await p;
    expect(s).toEqual(jasmine.objectContaining({ autoPost: true, publishPending: true, publishedBy: 'Fulano', publishedMarkdown: '**x**' }));
    const q = svc.load('75812', { force: true });
    http.expectOne(url(false)).flush(base());
    const s2 = await q;
    expect(s2).toEqual(jasmine.objectContaining({ autoPost: false, publishPending: false, publishedAt: null }));
  });

  it('0076: preferência de publicação automática — GET uma vez, PUT grava (null = padrão)', async () => {
    const g = svc.loadPostSettings();
    http.expectOne(r => r.method === 'GET' && r.url.endsWith('ExecutionPlan/settings/situation-post'))
      .flush({ autoPost: null, globalDefault: true, effective: true });
    expect(await g).toEqual({ autoPost: null, globalDefault: true, effective: true });
    expect(svc.postSettings()?.effective).toBeTrue();
    await svc.loadPostSettings();
    http.expectNone(r => r.method === 'GET');

    const put = svc.savePostSettings(false);
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('ExecutionPlan/settings/situation-post'));
    expect(req.request.body).toEqual({ autoPost: false });
    req.flush({ autoPost: false, globalDefault: true, effective: false });
    expect((await put).effective).toBeFalse();
    expect(svc.postSettings()).toEqual({ autoPost: false, globalDefault: true, effective: false });

    const reset = svc.savePostSettings(null);
    const req2 = http.expectOne(r => r.method === 'PUT');
    expect(req2.request.body).toEqual({ autoPost: null });
    req2.flush({ autoPost: null, globalDefault: true, effective: true });
    expect((await reset).autoPost).toBeNull();
  });

  it('0078: publish com o texto editado manda { markdown }; auto-post só do card (PUT) atualiza o cache', async () => {
    const pub = svc.publish('75812', '**editado**');
    const req = http.expectOne(r => r.url.endsWith('ExecutionPlan/card/75812/situation/publish'));
    expect(req.request.body).toEqual({ markdown: '**editado**' });
    req.flush({ commentId: 9 });
    await pub;

    const loaded = svc.load('75812', { devops: true });
    http.expectOne(url(true)).flush(base({ autoPost: false, autoPostSource: 'global' } as Partial<CardSituation>));
    await loaded;
    expect(svc.situationOf('75812')()?.autoPostSource).toBe('global');

    const put = svc.setCardAutoPost('75812', true);
    const r2 = http.expectOne(r => r.url.endsWith('ExecutionPlan/card/75812/situation/auto-post'));
    expect(r2.request.method).toBe('PUT');
    expect(r2.request.body).toEqual({ autoPost: true });
    r2.flush(base({ autoPost: true, autoPostSource: 'card', devOpsState: null } as Partial<CardSituation>));
    const s = await put;
    expect(s.autoPostSource).toBe('card');
    expect(svc.situationOf('75812')()?.autoPost).toBeTrue();
    // o PUT não traz o DevOps: mantém o estado que já veio
    expect(svc.situationOf('75812')()?.devOpsState).toBe('Active');

    const back = svc.setCardAutoPost('75812', null);
    const r3 = http.expectOne(r => r.url.endsWith('situation/auto-post'));
    expect(r3.request.body).toEqual({ autoPost: null });
    r3.flush(base({ autoPostSource: 'user' } as Partial<CardSituation>));
    expect((await back).autoPostSource).toBe('user');
  });

  it('"há X" e chip da Home', () => {
    const now = Date.parse('2026-11-04T12:00:00Z');
    expect(situationAgo('2026-11-04T11:59:30Z', now)).toBe('agora');
    expect(situationAgo('2026-11-04T11:30:00Z', now)).toBe('há 30 min');
    expect(situationAgo('2026-11-04T09:00:00Z', now)).toBe('há 3 h');
    expect(situationAgo('2026-11-02T10:00:00Z', now)).toBe('há 2 d');

    expect(situationChip('ticket', '2026-11-01T12:00:00Z', now)).toEqual(jasmine.objectContaining({ icon: 'confirmation_number', label: 'chamado · há 3 d' }));
    expect(situationChip('ticket-open', null, now)).toEqual(jasmine.objectContaining({ icon: 'confirmation_number', label: 'abrir chamado', tone: 'pending', tooltip: 'Situação atual: Aguardando abrir chamado' }));
    expect(situationChip('pr-review', null, now)).toEqual(jasmine.objectContaining({ icon: 'call_merge', label: 'aprovação/merge' }));
    expect(situationChip('qa-validation', '2026-11-04T11:00:00Z', now)).toEqual(jasmine.objectContaining({ icon: 'science', label: 'validar em QA · há 1 h', tone: 'pending' }));
    expect(situationChip('answer', null, now)).toEqual(jasmine.objectContaining({ icon: 'help_outline', label: 'resposta' }));
    expect(situationChip('user', null, now)).toEqual(jasmine.objectContaining({ icon: 'person', label: 'com você' }));
    expect(situationChip('qa-validation', null, now)?.tooltip).toContain('Validar em QA');
    expect(situationChip('none', null, now)).toBeNull();
    expect(situationChip(null, null, now)).toBeNull();
  });
});
