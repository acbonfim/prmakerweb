import { EventEmitter, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { CardAssistantService, CardSuggestion } from '../../services/card-assistant.service';
import { WsService } from '../../services/ws.service';
import { CardAssistantLauncherComponent } from './card-assistant-launcher.component';
import { CardAssistantComponent } from './card-assistant.component';

class FakeWs {
  handlers = new Map<string, ((p: any) => void)[]>();
  _resynced = new EventEmitter<void>();
  startConnection() {}
  on(event: string, h: (p: any) => void) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]); }
  off() {}
  addToGroup() {}
  removeFromGroup() {}
  emit(event: string, payload: any) { (this.handlers.get(event) ?? []).forEach(h => h(payload)); }
}

function sug(id: string, extra: Partial<CardSuggestion> = {}): CardSuggestion {
  return {
    id, planId: 'p1', kind: 'log-hours', title: `Lançar 1h (${id})`, text: '*Montar análise* concluída.',
    actions: [{ key: '1h', label: 'Lançar 1h', primary: true }, { key: 'skip', label: 'Agora não', primary: false }],
    status: 'open', chosenAction: null, result: null, resolvedBy: null, createdAt: new Date().toISOString(), resolvedAt: null, ...extra,
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

describe('CardAssistantLauncherComponent (sugestões na barra de horas)', () => {
  let f: ComponentFixture<CardAssistantLauncherComponent>;
  let http: HttpTestingController;
  let ws: FakeWs;
  let snack: { open: jasmine.Spy };
  let action: Subject<void>;
  const el = () => f.nativeElement as HTMLElement;
  const button = () => el().querySelector<HTMLButtonElement>('button.al')!;
  const popover = () => document.querySelector<HTMLElement>('.al-pop');

  async function render(list: CardSuggestion[]): Promise<void> {
    f = TestBed.createComponent(CardAssistantLauncherComponent);
    f.componentRef.setInput('cardNumber', '75999');
    await settle(f);
    http.match(isSuggestions).forEach(r => r.flush(list));
    await settle(f);
  }

  async function flushSuggestions(list: CardSuggestion[]): Promise<void> {
    await settle(f);
    http.match(isSuggestions).forEach(r => r.flush(list));
    await settle(f);
  }

  beforeEach(() => {
    ws = new FakeWs();
    action = new Subject<void>();
    snack = { open: jasmine.createSpy('open').and.returnValue({ onAction: () => action.asObservable() }) };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
        { provide: WsService, useValue: ws },
        { provide: MatSnackBar, useValue: snack },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(CardAssistantService).debounceMs = 0;
  });

  afterEach(() => {
    f?.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach(c => (c.innerHTML = ''));
  });

  it('sem sugestão aberta: botão quieto, sem contador', async () => {
    await render([sug('s1', { status: 'done', resolvedAt: new Date().toISOString() })]);
    expect(button()).toBeTruthy();
    expect(button().classList).not.toContain('al--on');
    expect(el().querySelector('.al__badge')).toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Sugestões do PRMake (nada pendente)');
  });

  it('com sugestão aberta: pisca/mexe (al--on) e mostra o contador', async () => {
    await render([sug('s1'), sug('s2'), sug('s3', { status: 'dismissed' })]);
    expect(button().classList).toContain('al--on');
    expect(el().querySelector('.al__badge')!.textContent!.trim()).toBe('2');
    expect(button().getAttribute('aria-label')).toBe('O PRMake tem 2 sugestões — clique para ver');
  });

  it('clique abre o popover com tudo do assistente (todas as abertas, ações, respondidas) e o fechar volta', async () => {
    const list = [sug('s1'), sug('s2'), sug('s3'), sug('s4', { status: 'done', chosenAction: '1h', result: 'ok', resolvedAt: new Date().toISOString() })];
    await render(list);
    button().click();
    await flushSuggestions(list);

    const pop = popover()!;
    expect(pop).toBeTruthy();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(pop.querySelectorAll('.msg').length).toBe(3); // no popover não corta em 2
    expect(pop.querySelector('.as__more')).toBeNull();
    expect(pop.querySelector('app-card-hours')).toBeNull();
    expect(pop.querySelector('.as__hist-toggle')!.textContent).toContain('Respondidas (1)');
    expect(pop.querySelector('.msg__btn--primary')!.textContent!.trim()).toBe('Lançar 1h');

    pop.querySelector<HTMLButtonElement>('.as__close')!.click();
    await new Promise(r => setTimeout(r, 300));
    await settle(f);
    expect(popover()).toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('sugestão nova pelo tempo real: o botão avisa (uma vez) e o "Ver" abre o popover', async () => {
    await render([]);
    // Um bloco do assistente na mesma tela (o do plano) não avisa de novo: o botão é dono do aviso.
    const block = TestBed.createComponent(CardAssistantComponent);
    block.componentRef.setInput('cardNumber', '75999');
    await settle(block);
    http.match(r => r.url.endsWith('Skills/config')).forEach(r => r.flush({ settings: {} }));
    http.match(r => r.url.endsWith('Azure/card/75999/effort')).forEach(r => r.flush({ originalEstimate: 6, completedWork: 1, remainingWork: 5 }));
    http.match(isSuggestions).forEach(r => r.flush([]));

    ws.emit('executionPlanUpdated', { cardNumber: '75999', planId: 'p1', action: 'suggestion' });
    await flushSuggestions([sug('s9', { title: 'Registrar a estimativa?' })]);
    await settle(block);

    expect(snack.open).toHaveBeenCalledTimes(1);
    expect(snack.open).toHaveBeenCalledWith('O PRMake tem uma sugestão: Registrar a estimativa?', 'Ver', jasmine.anything());
    expect(button().classList).toContain('al--on');

    action.next();
    await flushSuggestions([sug('s9', { title: 'Registrar a estimativa?' })]);
    expect(popover()).toBeTruthy();
    expect(popover()!.querySelector('[data-suggestion="s9"]')).toBeTruthy();
    block.destroy();
  });
});
