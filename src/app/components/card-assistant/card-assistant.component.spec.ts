import { EventEmitter, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { CardAssistantService, CardSuggestion } from '../../services/card-assistant.service';
import { WsService } from '../../services/ws.service';
import { CardAssistantComponent } from './card-assistant.component';
import { CardHoursComponent } from './card-hours.component';

class FakeWs {
  handlers = new Map<string, ((p: any) => void)[]>();
  groups: string[] = [];
  _resynced = new EventEmitter<void>();
  startConnection() {}
  on(event: string, h: (p: any) => void) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]); }
  off() {}
  addToGroup(g: string) { this.groups.push(g); }
  removeFromGroup(g: string) { this.groups = this.groups.filter(x => x !== g); }
  emit(event: string, payload: any) { (this.handlers.get(event) ?? []).forEach(h => h(payload)); }
}

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function sug(id: string, extra: Partial<CardSuggestion> = {}): CardSuggestion {
  return {
    id, planId: 'p1', kind: 'log-hours', title: 'Lançar 1h em Completed?', text: '*Montar análise* concluída.',
    actions: [{ key: '1h', label: 'Lançar 1h', primary: true }, { key: '2h', label: 'Lançar 2h', primary: false }, { key: 'skip', label: 'Agora não', primary: false }],
    status: 'open', chosenAction: null, result: null, resolvedBy: null, createdAt: ago(120_000), resolvedAt: null, ...extra,
  };
}

async function settle(f: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise(r => setTimeout(r, 0));
  }
}

const isSuggestions = (r: { url: string; method: string }) => r.method === 'GET' && r.url.endsWith('ExecutionPlan/card/75999/suggestions');
const isEffort = (r: { url: string; method: string }) => r.method === 'GET' && r.url.endsWith('Azure/card/75999/effort');
const isConfig = (r: { url: string }) => r.url.endsWith('Skills/config');

describe('CardAssistantComponent (0077)', () => {
  let f: ComponentFixture<CardAssistantComponent>;
  let http: HttpTestingController;
  let ws: FakeWs;
  let snack: { open: jasmine.Spy; action: Subject<void> };
  const el = () => f.nativeElement as HTMLElement;

  /** Responde as cargas iniciais (sugestões, horas, média do time). */
  async function render(list: CardSuggestion[], effort: any = { originalEstimate: 6, completedWork: 1, remainingWork: 5 }): Promise<void> {
    f = TestBed.createComponent(CardAssistantComponent);
    f.componentRef.setInput('cardNumber', '75999');
    await settle(f);
    http.expectOne(isSuggestions).flush(list);
    http.expectOne(isConfig).flush({ settings: { AssistantAverageHours: '3', AssistantHoursPerStep: '1' } });
    http.expectOne(isEffort).flush(effort);
    await settle(f);
  }

  beforeEach(() => {
    try { localStorage.removeItem('prmake.assistant-collapsed'); } catch { /* sem storage */ }
    ws = new FakeWs();
    const action = new Subject<void>();
    snack = { open: jasmine.createSpy('open').and.returnValue({ onAction: () => action.asObservable() }), action };
    TestBed.configureTestingModule({
      imports: [CardAssistantComponent],
      providers: [
        provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
        { provide: WsService, useValue: ws },
        { provide: MatSnackBar, useValue: snack },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(CardAssistantService).debounceMs = 0;
  });

  it('renderiza as abertas como mensagens (primária em destaque, Dispensar) e as respondidas no histórico recolhido', async () => {
    await render([
      sug('s1'),
      sug('s0', { kind: 'situation-auto-post', title: 'Publicar os resumos de espera na discussion?', status: 'done', chosenAction: 'card',
        actions: [{ key: 'card', label: 'Sim, neste card', primary: true }], result: 'Publico sozinho neste card.', resolvedBy: 'Alex', resolvedAt: ago(60_000) }),
    ]);
    expect(ws.groups).toEqual(['execplan:75999']);
    expect(el().querySelector('.as__count')!.textContent).toContain('1 sugestão');
    const msgs = el().querySelectorAll('.msg');
    expect(msgs.length).toBe(1);
    expect(msgs[0].querySelector('.msg__title')!.textContent).toContain('Lançar 1h em Completed?');
    expect(msgs[0].querySelector('.msg__text em')!.textContent).toBe('Montar análise');
    const btns = [...msgs[0].querySelectorAll<HTMLButtonElement>('.msg__btn')];
    expect(btns.map(b => b.textContent!.trim())).toEqual(['Lançar 1h', 'Lançar 2h', 'Agora não']);
    expect(btns[0].classList).toContain('msg__btn--primary');
    expect(btns[1].classList).not.toContain('msg__btn--primary');
    expect(msgs[0].querySelector('.msg__dismiss')).not.toBeNull();

    expect(el().querySelector('.as__hist-list')).toBeNull();
    el().querySelector<HTMLButtonElement>('.as__hist-toggle')!.click();
    await settle(f);
    const hist = el().querySelector('.hist')!.textContent!;
    expect(hist).toContain('Sim, neste card: Publico sozinho neste card.');
    expect(hist).toContain('Feito por Alex');
  });

  it('act: POST com a ação; feito vai para o histórico e as horas recarregam (log-hours)', async () => {
    await render([sug('s1')]);
    el().querySelector<HTMLButtonElement>('.msg__btn--primary')!.click();
    await settle(f);
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('ExecutionPlan/suggestions/s1/act'));
    expect(req.request.body).toEqual({ action: '1h' });
    req.flush(sug('s1', { status: 'done', chosenAction: '1h', result: 'Horas lançadas: +1h — Completed 1 → 2', resolvedBy: 'Alex', resolvedAt: ago(0) }));
    await settle(f);
    http.expectOne(isEffort).flush({ originalEstimate: 6, completedWork: 2, remainingWork: 4 });
    await settle(f);
    expect(el().querySelectorAll('.msg').length).toBe(0);
    expect(el().querySelector('.as__quiet')!.textContent).toContain('nada pendente');
    expect(snack.open).toHaveBeenCalledWith('Horas lançadas: +1h — Completed 1 → 2', 'Ok', jasmine.anything());
    expect(el().querySelector('app-card-hours')!.textContent).toContain('Completed 2h');
  });

  it('dismiss: POST dismiss e a mensagem some', async () => {
    await render([sug('s1')]);
    el().querySelector<HTMLButtonElement>('.msg__dismiss')!.click();
    await settle(f);
    http.expectOne(r => r.method === 'POST' && r.url.endsWith('ExecutionPlan/suggestions/s1/dismiss'))
      .flush(sug('s1', { status: 'dismissed', resolvedBy: 'Alex', resolvedAt: ago(0) }));
    await settle(f);
    expect(el().querySelectorAll('.msg').length).toBe(0);
  });

  it('failed: mostra o erro do DevOps e "Tentar de novo" repete a ação escolhida', async () => {
    await render([sug('s1', { kind: 'initial-estimate', title: 'Registrar a estimativa inicial?', status: 'failed', chosenAction: 'apply',
      actions: [{ key: 'apply', label: 'Registrar estimativa', primary: true }, { key: 'skip', label: 'Agora não', primary: false }],
      result: 'Integração com o DevOps indisponível.' })]);
    const msg = el().querySelector('.msg')!;
    expect(msg.classList).toContain('msg--failed');
    expect(msg.querySelector('.msg__fail')!.textContent).toContain('Integração com o DevOps indisponível.');
    const buttons = [...msg.querySelectorAll<HTMLButtonElement>('.msg__btn')].map(b => b.textContent!.trim());
    expect(buttons).toEqual(['Tentar de novo', 'Agora não']);
    msg.querySelector<HTMLButtonElement>('.msg__btn--primary')!.click();
    await settle(f);
    const req = http.expectOne(r => r.url.endsWith('suggestions/s1/act'));
    expect(req.request.body).toEqual({ action: 'apply' });
    req.flush(sug('s1', { kind: 'initial-estimate', status: 'failed', chosenAction: 'apply', result: 'O DevOps recusou (401).' }));
    await settle(f);
    http.match(isEffort).forEach((r: TestRequest) => r.flush({ originalEstimate: 6, completedWork: 0, remainingWork: 6 }));
    await settle(f);
    expect(el().querySelector('.msg__fail')!.textContent).toContain('O DevOps recusou (401).');
  });

  it('tempo real: sugestão nova → recarrega e avisa discretamente ("O PRMake tem uma sugestão: X · Ver")', async () => {
    await render([]);
    expect(el().querySelectorAll('.msg').length).toBe(0);
    ws.emit('executionPlanUpdated', { cardNumber: '75999', planId: 'p1', action: 'step' });
    await settle(f);
    http.expectNone(isSuggestions);
    ws.emit('executionPlanUpdated', { cardNumber: '75999', planId: 'p1', action: 'suggestion' });
    await settle(f);
    http.expectOne(isSuggestions).flush([sug('s9', { title: 'Lançar 1h em Completed?' })]);
    await settle(f);
    expect(el().querySelectorAll('.msg').length).toBe(1);
    expect(el().querySelector('.msg--flash')).not.toBeNull();
    expect(snack.open).toHaveBeenCalledWith('O PRMake tem uma sugestão: Lançar 1h em Completed?', 'Ver', jasmine.anything());
  });

  it('erro 500 no act (middleware genérico): mostra só a mensagem, sem stack, e a sugestão continua aberta', async () => {
    await render([sug('s1')]);
    el().querySelector<HTMLButtonElement>('.msg__btn--primary')!.click();
    await settle(f);
    http.expectOne(r => r.url.endsWith('suggestions/s1/act'))
      .flush({ StatusCode: 500, Error: { Message: "Plugin 'AzureDevOps Configurations' não encontrado", StackTrace: 'at x.y()' } }, { status: 500, statusText: 'x' });
    await settle(f);
    const fail = el().querySelector('.msg .msg__fail')!.textContent!;
    expect(fail).toContain("Plugin 'AzureDevOps Configurations' não encontrado");
    expect(fail).not.toContain('at x.y()');
    expect(el().querySelectorAll('.msg').length).toBe(1);
  });

  it('compacto: mostra 2 abertas e "Mais N sugestões" abre o resto', async () => {
    await render([sug('s1'), sug('s2'), sug('s3'), sug('s4')]);
    expect(el().querySelectorAll('.msg').length).toBe(2);
    expect(el().querySelector('.as__more')!.textContent).toContain('Mais 2 sugestões');
    el().querySelector<HTMLButtonElement>('.as__more')!.click();
    await settle(f);
    expect(el().querySelectorAll('.msg').length).toBe(4);
    expect(el().querySelector('.as__more')).toBeNull();
  });

  it('recolhido: só o cabeçalho com o contador e a última sugestão', async () => {
    await render([sug('s1')]);
    el().querySelector<HTMLButtonElement>('.as__toggle')!.click();
    await settle(f);
    expect(el().querySelector('.as__msgs')).toBeNull();
    expect(el().querySelector('.as__latest')!.textContent).toContain('Lançar 1h em Completed?');
    expect(localStorage.getItem('prmake.assistant-collapsed')).toBe('1');
  });
});

describe('CardHoursComponent (0077)', () => {
  let f: ComponentFixture<CardHoursComponent>;
  let http: HttpTestingController;
  const el = () => f.nativeElement as HTMLElement;

  async function render(effort: any, status = 200): Promise<void> {
    f = TestBed.createComponent(CardHoursComponent);
    f.componentRef.setInput('cardNumber', '75999');
    await settle(f);
    http.expectOne(isConfig).flush({ settings: { AssistantAverageHours: '3' } });
    const r = http.expectOne(isEffort);
    if (status === 200) r.flush(effort); else r.flush(effort, { status, statusText: 'x' });
    await settle(f);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CardHoursComponent],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: WsService, useValue: new FakeWs() }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('linha de horas com a média do time e barra; +1h confirma, chama log-hours e recarrega', async () => {
    await render({ originalEstimate: 6, completedWork: 2, remainingWork: 4 });
    const text = el().textContent!;
    expect(text).toContain('Original 6h');
    expect(text).toContain('Completed 2h');
    expect(text).toContain('Remaining 4h');
    expect(text).toContain('média do time 3h');
    expect(el().querySelector<HTMLElement>('.hr__bar-fill')!.style.width).toBe('33%');
    expect(el().querySelector<HTMLElement>('.hr__bar-avg')!.style.left).toBe('50%');

    const plus = [...el().querySelectorAll<HTMLButtonElement>('.hr__btn')].find(b => b.textContent!.includes('+1h'))!;
    plus.click();
    await settle(f);
    expect(el().querySelector('.hr__confirm')!.textContent).toContain('2h → 3h');
    http.expectNone(r => r.url.endsWith('log-hours'));
    el().querySelector<HTMLButtonElement>('.hr__btn--primary')!.click();
    await settle(f);
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('Azure/card/75999/actions/log-hours'));
    expect(req.request.body).toEqual({ hours: 1 });
    req.flush({ rev: 7, message: 'Horas lançadas: Completed 2 → 3, Remaining 4 → 3.' });
    await settle(f);
    http.expectOne(isEffort).flush({ originalEstimate: 6, completedWork: 3, remainingWork: 3 });
    await settle(f);
    expect(el().querySelector('.hr__msg')!.textContent).toContain('Completed 2 → 3');
    expect(el().textContent).toContain('Completed 3h');
  });

  it('409 no log-hours: mostra o erro e mantém a linha', async () => {
    await render({ originalEstimate: 6, completedWork: 2, remainingWork: 4 });
    [...el().querySelectorAll<HTMLButtonElement>('.hr__btn')].find(b => b.textContent!.includes('+1h'))!.click();
    await settle(f);
    el().querySelector<HTMLButtonElement>('.hr__btn--primary')!.click();
    await settle(f);
    http.expectOne(r => r.url.endsWith('log-hours')).flush({ error: 'O card está fechado.' }, { status: 409, statusText: 'Conflict' });
    await settle(f);
    http.match(isEffort).forEach(r => r.flush({ originalEstimate: 6, completedWork: 2, remainingWork: 4 }));
    await settle(f);
    expect(el().querySelector('.hr__msg--error')!.textContent).toContain('O card está fechado.');
  });

  it('sem DevOps: "Horas indisponíveis — sem integração do DevOps" com Tentar de novo', async () => {
    await render({ error: 'Configure a integração do Azure DevOps.' }, 400);
    expect(el().textContent).toContain('Horas indisponíveis — sem integração do DevOps');
    el().querySelector<HTMLButtonElement>('.hr__link')!.click();
    await settle(f);
    http.expectOne(isEffort).flush({ originalEstimate: 6, completedWork: 0, remainingWork: 6 });
    await settle(f);
    expect(el().textContent).toContain('Original 6h');
  });

  it('sem estimativa: "Registrar estimativa inicial" chama initial-estimate', async () => {
    await render({ originalEstimate: null, completedWork: null, remainingWork: null });
    const btn = el().querySelector<HTMLButtonElement>('.hr__btn')!;
    expect(btn.textContent).toContain('Registrar estimativa inicial');
    btn.click();
    await settle(f);
    http.expectOne(r => r.method === 'POST' && r.url.endsWith('Azure/card/75999/actions/initial-estimate')).flush({ rev: 2, message: 'Estimativa registrada: 6h.' });
    await settle(f);
    http.expectOne(isEffort).flush({ originalEstimate: 6, completedWork: 0, remainingWork: 6 });
    await settle(f);
    expect(el().querySelector('.hr__msg')!.textContent).toContain('Estimativa registrada: 6h.');
    expect(el().textContent).toContain('Original 6h');
  });
});
