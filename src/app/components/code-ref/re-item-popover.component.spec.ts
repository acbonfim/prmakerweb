import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CliipboardService } from '../../services/cliipboard.service';
import { ReItemPopoverComponent, reKindTone } from './re-item-popover.component';
import { ReItem, ReItemResult, ReItemService } from './re-item.service';

export function fakeReItem(extra: Partial<ReItem> = {}): ReItem {
  return {
    ref: 'revamp-kaizen#UC-121', moduleKey: 'revamp-kaizen', moduleName: 'Kaizen', docType: 'funcional', itemId: 'UC-121',
    kind: 'uc', kindLabel: 'Caso de uso', title: 'Registrar melhoria com aprovação do gestor',
    body: '**Ator:** colaborador\n\n1. Abre a tela TELA-004\n2. Salva — vale RN-012',
    refs: ['TELA-004', 'RN-012'], evidence: ['src/kaizen/save.ts:40-88'], referencedBy: ['revamp-kaizen#RN-012', 'revamp-kaizen#TELA-004'],
    sectionVersion: 3, removed: false,
    traps: [{ title: 'Aprovação some ao trocar o gestor', text: 'O fluxo **perde** o aprovador.', needsReview: true, cards: ['75812'] }],
    ...extra,
  };
}

class FakeReItems {
  results = new Map<string, ReItemResult | 'throw'>();
  calls: { card: string; ref: string }[] = [];
  async get(card: string, ref: string): Promise<ReItemResult> {
    this.calls.push({ card, ref });
    const r = this.results.get(ref) ?? { status: 'missing' };
    if (r === 'throw') throw new Error('rede');
    return r;
  }
}

async function settle(f: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise(r => setTimeout(r, 0));
  }
}

describe('ReItemPopoverComponent (0076)', () => {
  let svc: FakeReItems;
  let f: ComponentFixture<ReItemPopoverComponent>;
  const el = () => f.nativeElement as HTMLElement;

  async function render(ref: string): Promise<void> {
    f = TestBed.createComponent(ReItemPopoverComponent);
    f.componentRef.setInput('card', '75812');
    f.componentRef.setInput('ref', ref);
    await settle(f);
  }

  beforeEach(() => {
    svc = new FakeReItems();
    TestBed.configureTestingModule({
      imports: [ReItemPopoverComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ReItemService, useValue: svc },
        { provide: CliipboardService, useValue: jasmine.createSpyObj('CliipboardService', ['copyFullDescriptionToClipboard']) },
      ],
    });
  });

  it('ok: selo do tipo, id + módulo, título, texto com links de itens, armadilhas e "Citado por"', async () => {
    svc.results.set('UC-121', { status: 'ok', item: fakeReItem() });
    await render('UC-121');
    expect(svc.calls[0]).toEqual({ card: '75812', ref: 'UC-121' });
    expect(el().querySelector('.rei__kind')!.textContent).toContain('Caso de uso');
    expect(el().querySelector('.rei__id')!.textContent).toBe('UC-121');
    expect(el().querySelector('.rei__module')!.textContent).toBe('Kaizen');
    expect(el().querySelector('.rei__title')!.textContent).toContain('Registrar melhoria');
    const links = [...el().querySelectorAll<HTMLAnchorElement>('.rei__md a.re-ref')].map(a => a.textContent);
    expect(links).toEqual(['TELA-004', 'RN-012']);
    expect(el().querySelector('.rei-trap__title')!.textContent).toContain('Aprovação some');
    expect(el().querySelector('.rei-trap__review')).not.toBeNull();
    expect(el().querySelector('.rei-trap__text strong')!.textContent).toBe('perde');
    expect([...el().querySelectorAll('.rei__chip--ref')].map(b => b.textContent)).toEqual(['RN-012', 'TELA-004']);
    expect(el().querySelector('.rei__foot')!.textContent).toContain('versão 3');
  });

  it('"Citado por" e links do texto navegam no próprio popover, com voltar', async () => {
    svc.results.set('UC-121', { status: 'ok', item: fakeReItem() });
    svc.results.set('revamp-kaizen#RN-012', { status: 'ok', item: fakeReItem({ ref: 'revamp-kaizen#RN-012', itemId: 'RN-012', kindLabel: 'Regra de negócio', title: 'Só o gestor aprova', traps: [], referencedBy: [] }) });
    svc.results.set('RN-012', { status: 'ok', item: fakeReItem({ ref: 'revamp-kaizen#RN-012', itemId: 'RN-012', kindLabel: 'Regra de negócio', title: 'Só o gestor aprova', traps: [], referencedBy: [] }) });
    await render('UC-121');
    el().querySelector<HTMLButtonElement>('.rei__chip--ref')!.click();
    await settle(f);
    expect(el().querySelector('.rei__kind')!.textContent).toContain('Regra de negócio');
    expect(el().querySelector('.rei__back')).not.toBeNull();
    el().querySelector<HTMLButtonElement>('.rei__back')!.click();
    await settle(f);
    expect(el().querySelector('.rei__id')!.textContent).toBe('UC-121');
    // link RN-012 dentro do texto
    [...el().querySelectorAll<HTMLAnchorElement>('.rei__md a.re-ref')].find(a => a.textContent === 'RN-012')!.click();
    await settle(f);
    expect(el().querySelector('.rei__title')!.textContent).toContain('Só o gestor aprova');
  });

  it('403: só administradores', async () => {
    svc.results.set('UC-121', { status: 'forbidden' });
    await render('UC-121');
    expect(el().querySelector('.rei__state--locked')!.textContent).toContain('visíveis só para administradores');
    expect(el().querySelector('.rei__id')!.textContent).toBe('UC-121');
  });

  it('ambíguo: mostra a mensagem com os módulos; 404: não encontrado', async () => {
    svc.results.set('UC-121', { status: 'ambiguous', message: 'UC-121 existe em revamp-kaizen e revamp-users — use modulo#UC-121.' });
    await render('UC-121');
    expect(el().querySelector('.rei__state--warn')!.textContent).toContain('revamp-kaizen e revamp-users');
    f.destroy();
    await render('UC-999');
    expect(el().querySelector('.rei__state')!.textContent).toContain('não foi encontrado');
  });

  it('erro de rede: "Tentar de novo" carrega de novo', async () => {
    svc.results.set('UC-121', 'throw');
    await render('UC-121');
    expect(el().querySelector('.rei__state--error')).not.toBeNull();
    svc.results.set('UC-121', { status: 'ok', item: fakeReItem() });
    el().querySelector<HTMLButtonElement>('.rei__state--error button')!.click();
    await settle(f);
    expect(el().querySelector('.rei__title')).not.toBeNull();
  });

  it('Esc fecha', async () => {
    svc.results.set('UC-121', { status: 'ok', item: fakeReItem() });
    await render('UC-121');
    let closed = 0;
    f.componentInstance.closed.subscribe(() => closed++);
    el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(1);
  });

  it('cor do selo pelo prefixo', () => {
    expect(reKindTone('UC-1')).toBe('#58a6ff');
    expect(reKindTone('revamp-x#RN-2')).toBe('#d29922');
    expect(reKindTone('XYZ-1')).toBe('#8b9bb4');
  });
});

describe('ReItemService (0076)', () => {
  it('mapeia 403/404/400 e guarda em cache por card + ref', async () => {
    const { provideHttpClient } = await import('@angular/common/http');
    const { HttpTestingController, provideHttpClientTesting } = await import('@angular/common/http/testing');
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    const svc = TestBed.inject(ReItemService);
    const http = TestBed.inject(HttpTestingController);

    const ok = svc.get('75812', 'revamp-kaizen#UC-121');
    http.expectOne(r => r.url.endsWith('ReverseEngineering/card/75812/items/revamp-kaizen%23UC-121')).flush(fakeReItem({ traps: undefined as never }));
    const r1 = await ok;
    expect(r1.status).toBe('ok');
    expect(r1.status === 'ok' && r1.item.traps).toEqual([]);
    await svc.get('75812', 'revamp-kaizen#UC-121');
    http.expectNone(() => true);

    const forbidden = svc.get('75812', 'UC-1');
    http.expectOne(r => r.url.endsWith('/items/UC-1')).flush({ error: 'x' }, { status: 403, statusText: 'Forbidden' });
    expect((await forbidden).status).toBe('forbidden');

    const amb = svc.get('75812', 'UC-2');
    http.expectOne(r => r.url.endsWith('/items/UC-2')).flush({ error: 'UC-2 existe em a e b' }, { status: 400, statusText: 'Bad Request' });
    expect(await amb).toEqual({ status: 'ambiguous', message: 'UC-2 existe em a e b' });

    const missing = svc.get('75812', 'UC-3');
    http.expectOne(r => r.url.endsWith('/items/UC-3')).flush(null, { status: 404, statusText: 'Not Found' });
    expect((await missing).status).toBe('missing');

    const fail = svc.get('75812', 'UC-4');
    http.expectOne(r => r.url.endsWith('/items/UC-4')).flush(null, { status: 500, statusText: 'Erro' });
    await expectAsync(fail).toBeRejected();
    // erro de rede não fica em cache
    svc.get('75812', 'UC-4');
    http.expectOne(r => r.url.endsWith('/items/UC-4')).flush(fakeReItem());
  });
});
