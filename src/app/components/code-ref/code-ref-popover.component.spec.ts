import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CodeRefPopoverComponent } from './code-ref-popover.component';
import { CodeRef, CodeRefHead, matchCitation } from './code-ref.model';
import { CodeRefService } from './code-ref.service';

/** Ref de exemplo (o item 1.6 da spec): ASP com foco 5–7, proposta e anotações dos dois lados. */
export function fakeRef(extra: Partial<CodeRef> = {}): CodeRef {
  return {
    id: '1', planId: 'p1', cardNumber: '75812', ref: 'sa3-init', repository: 'solvace-asp',
    path: 'systems/sa3/sa3_busca_a3.asp', startLine: 5, endLine: 7, change: 'change',
    title: 'Ordem da inicialização do filtro de data', commitSha: '0123456789abcdef', branch: 'master',
    hasProposal: true, hasImplemented: false, updatedAt: '2026-11-04T10:00:00Z', language: 'asp',
    why: 'O `restoreFilters()` roda **antes** do daterangepicker existir — a data salva é perdida.',
    firstLine: 3,
    snapshot: [
      '<%',
      'Dim filtro',
      'restoreFilters()',
      '<script>alert("x")</script>',
      'initDatePicker()',
      'Response.Write "ok"',
      '%>',
    ].join('\n'),
    proposal: [
      '--- a/systems/sa3/sa3_busca_a3.asp',
      '+++ b/systems/sa3/sa3_busca_a3.asp',
      '@@ -4,4 +4,4 @@',
      ' Dim filtro',
      '-restoreFilters()',
      ' <script>alert("x")</script>',
      '-initDatePicker()',
      '+initDatePicker()',
      '+restoreFilters()',
      '',
    ].join('\n'),
    implemented: null,
    annotations: [
      { side: 'old', from: 5, to: 5, text: 'Restaura o filtro cedo demais.' },
      { side: 'new', from: 7, to: 7, text: 'Agora depois do seletor.' },
    ],
    createdBy: 'Claude',
    ...extra,
  };
}

class FakeCodeRefService {
  readonly changes = signal<{ card: string; kind: 'codeRef' | 'artifact' | 'all'; at: number } | null>(null);
  refs = new Map<string, CodeRef>();
  heads: CodeRefHead[] = [];
  gets = 0;
  fail = false;
  async get(_card: string, ref: string): Promise<CodeRef | null> {
    this.gets++;
    if (this.fail) throw new Error('rede');
    return this.refs.get(ref) ?? null;
  }
  async match(_card: string, path: string, start: number, end: number): Promise<CodeRefHead | null> {
    return matchCitation(this.heads, path, start, end);
  }
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await new Promise(r => setTimeout(r, 0));
    fixture.detectChanges();
  }
}

describe('CodeRefPopoverComponent (0075/F2)', () => {
  let svc: FakeCodeRefService;

  function create(target: unknown, ref: CodeRef | null = fakeRef()) {
    svc = new FakeCodeRefService();
    if (ref) { svc.refs.set(ref.ref, ref); svc.heads = [ref]; }
    TestBed.configureTestingModule({
      imports: [CodeRefPopoverComponent],
      providers: [provideZonelessChangeDetection(), { provide: CodeRefService, useValue: svc }],
    });
    const fixture = TestBed.createComponent(CodeRefPopoverComponent);
    fixture.componentRef.setInput('card', '75812');
    fixture.componentRef.setInput('target', target);
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
  const rows = (f: ComponentFixture<unknown>) => [...el(f).querySelectorAll<HTMLElement>('.cr-row')];
  const clickTab = (f: ComponentFixture<unknown>, label: string) =>
    [...el(f).querySelectorAll<HTMLButtonElement>('.cr__tab')].find(b => b.textContent!.includes(label))!.click();

  it('cabeçalho, por quê e abre na Proposta (diff com números antigo/novo)', async () => {
    const f = create({ kind: 'ref', id: 'sa3-init' });
    await settle(f);
    const root = el(f);
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.querySelector('.cr__badge')!.textContent).toContain('Alterar');
    expect(root.querySelector('.cr__path')!.textContent).toBe('systems/sa3/sa3_busca_a3.asp');
    expect(root.querySelector('.cr__lines')!.textContent).toBe('L5–7');
    expect(root.querySelector('.cr__sha')!.textContent).toContain('0123456');
    expect(root.querySelector('.cr__why-text strong')!.textContent).toBe('antes');
    expect(root.querySelector('.cr__tab--on')!.textContent).toContain('Proposta');

    const diff = rows(f);
    const del = diff.filter(r => r.classList.contains('cr-row--deletion'));
    const add = diff.filter(r => r.classList.contains('cr-row--addition'));
    expect(del.length).toBe(2);
    expect(add.length).toBe(2);
    const nums = (r: HTMLElement) => [...r.querySelectorAll('.cr-row__num')].map(n => n.textContent!.trim());
    expect(nums(del[0])).toEqual(['5', '']);
    expect(nums(add[1])).toEqual(['', '7']);
    // nota do lado novo marcada na linha nova 7
    expect(add[1].querySelector('.cr-row__mark')!.textContent).toBe('②');
    // nota do lado antigo na linha antiga 5
    expect(del[0].querySelector('.cr-row__mark')!.textContent).toBe('①');
  });

  it('Código atual: números a partir de firstLine, foco 5–7 destacado, o resto esmaecido', async () => {
    const f = create({ kind: 'ref', id: 'sa3-init' });
    await settle(f);
    clickTab(f, 'Código atual');
    await settle(f);
    const r = rows(f);
    expect(r.length).toBe(7);
    expect(r.map(x => x.querySelector('.cr-row__num')!.textContent!.trim())).toEqual(['3', '4', '5', '6', '7', '8', '9']);
    expect(r.map(x => x.classList.contains('is-focus'))).toEqual([false, false, true, true, true, false, false]);
    // só uma coluna de números no código atual
    expect(r[0].querySelectorAll('.cr-row__num').length).toBe(1);
    // ① na linha 5 (lado antigo); a nota do lado novo não aparece aqui
    expect(r[2].querySelector('.cr-row__mark')!.textContent).toBe('①');
    expect(r.filter(x => x.querySelector('.cr-row__mark')!.textContent).length).toBe(1);
    const off = el(f).querySelectorAll('.cr-note.is-off');
    expect(off.length).toBe(1);
  });

  it('o código vira texto: <script> do snapshot não vira elemento', async () => {
    const f = create({ kind: 'ref', id: 'sa3-init' });
    await settle(f);
    clickTab(f, 'Código atual');
    await settle(f);
    expect(el(f).querySelector('.cr__code script')).toBeNull();
    expect(rows(f)[3].querySelector('.cr-row__code')!.textContent).toBe('<script>alert("x")</script>');
  });

  it('passar o mouse na nota destaca as linhas dela e vice-versa', async () => {
    const f = create({ kind: 'ref', id: 'sa3-init' });
    await settle(f);
    clickTab(f, 'Código atual');
    await settle(f);
    const note = el(f).querySelector<HTMLElement>('.cr-note')!;
    note.dispatchEvent(new MouseEvent('mouseenter'));
    await settle(f);
    expect(rows(f).filter(r => r.classList.contains('is-active')).length).toBe(1);
    expect(rows(f)[2].classList.contains('is-active')).toBeTrue();
    note.dispatchEvent(new MouseEvent('mouseleave'));
    rows(f)[2].dispatchEvent(new MouseEvent('mouseenter'));
    await settle(f);
    expect(el(f).querySelector('.cr-note')!.classList.contains('is-active')).toBeTrue();
  });

  it('citação casa com a ref do card pelo fim do caminho', async () => {
    const f = create({ kind: 'cite', path: 'solvace-asp/systems/sa3/sa3_busca_a3.asp', start: 6, end: 6 });
    await settle(f);
    expect(el(f).querySelector('.cr__title')!.textContent).toContain('Ordem da inicialização');
  });

  it('citação sem fotografia: caminho, copiar e o aviso', async () => {
    const f = create({ kind: 'cite', path: 'a/b/outro.js', start: 10, end: 12 });
    await settle(f);
    const root = el(f);
    expect(root.querySelector('.cr__cite')!.textContent).toBe('a/b/outro.js:10-12');
    expect(root.textContent).toContain('Este trecho ainda não tem fotografia no card');
    expect(svc.gets).toBe(0);
  });

  it('erro de rede mostra "tentar de novo"; sem proposta abre no Código atual', async () => {
    const f = create({ kind: 'ref', id: 'sa3-init' });
    svc.fail = true;
    f.componentInstance.reload();
    await settle(f);
    expect(el(f).querySelector('.cr__state--error')).not.toBeNull();

    svc.fail = false;
    svc.refs.set('sa3-init', fakeRef({ proposal: null, change: 'read', annotations: [] }));
    f.componentInstance.reload();
    await settle(f);
    expect(el(f).querySelector('.cr__tabs')).toBeNull(); // só uma visão: sem abas
    expect(rows(f).length).toBe(7);
    expect(el(f).querySelector('.cr__badge')!.textContent).toContain('Só leitura');
  });
});
