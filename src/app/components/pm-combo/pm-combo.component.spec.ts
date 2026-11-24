import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PmComboComponent, PmComboOption } from './pm-combo.component';

const OPTIONS: PmComboOption[] = [
  { value: 'New', label: 'New', color: '#8b949e' },
  { value: 'Active', label: 'Active', color: '#58a6ff' },
  { value: 'Em análise', label: 'Em análise' },
  { value: 'Closed', label: 'Closed' },
];

const tick = () => new Promise((r) => setTimeout(r));

describe('PmComboComponent (0099 ajustes 1)', () => {
  let fixture: ComponentFixture<PmComboComponent>;
  let input: HTMLInputElement;

  async function create(setup: (f: ComponentFixture<PmComboComponent>) => void = () => undefined) {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideNoopAnimations()] });
    fixture = TestBed.createComponent(PmComboComponent);
    fixture.componentRef.setInput('options', OPTIONS);
    setup(fixture);
    fixture.detectChanges();
    await fixture.whenStable();
    input = fixture.nativeElement.querySelector('input');
  }

  async function type(text: string) {
    input.focus();
    input.dispatchEvent(new Event('focusin'));
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    await tick();
    fixture.detectChanges();
  }

  const panelOptions = () => [...document.querySelectorAll('.pm-combo-panel mat-option:not(.pmc-opt--status)')] as HTMLElement[];

  afterEach(() => fixture?.destroy());

  it('mostra o rótulo do valor e filtra sem acento ao digitar, com o trecho em destaque', async () => {
    await create((f) => f.componentRef.setInput('value', 'Active'));
    expect(input.value).toBe('Active');
    await type('analise');
    const opts = panelOptions();
    expect(opts.map((o) => o.textContent?.trim())).toEqual(['Em análise']);
    expect(opts[0].querySelector('mark')?.textContent).toBe('análise');
  });

  it('escolher a opção grava o valor e o texto vira o rótulo', async () => {
    await create();
    await type('clo');
    panelOptions()[0].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('Closed');
    expect(input.value).toBe('Closed');
  });

  it('Enter sem opção destacada aceita o texto livre quando permitido', async () => {
    await create((f) => f.componentRef.setInput('acceptCustom', (t: string) => (/@/.test(t) ? t : null)));
    await type('ze@x.com');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('ze@x.com');
  });

  it('múltiplo: chips, "Criar «x»", separador e Backspace tira o último', async () => {
    await create((f) => {
      f.componentRef.setInput('multiple', true);
      f.componentRef.setInput('createLabel', 'Criar tag');
      f.componentRef.setInput('separators', ',;');
    });
    const cmp = fixture.componentInstance;
    await type('act');
    // "Criar tag «act»" vem primeiro; a opção da lista vem depois.
    panelOptions().find((o) => o.querySelector('.pmc-opt__label')?.textContent?.trim() === 'Active')!.click();
    fixture.detectChanges();
    expect(cmp.values()).toEqual(['Active']);

    await type('Nova');
    expect(document.querySelector('.pm-combo-panel .pmc-opt--create')?.textContent).toContain('Criar tag «Nova»');
    await type('Nova, Outra;');
    expect(cmp.values()).toEqual(['Active', 'Nova', 'Outra']);
    expect(fixture.nativeElement.querySelectorAll('.pmc-chip').length).toBe(3);

    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    fixture.detectChanges();
    expect(cmp.values()).toEqual(['Active', 'Nova']);
  });

  it('busca no servidor: emite o texto com debounce e não filtra a lista aqui', async () => {
    await create((f) => {
      f.componentRef.setInput('remote', true);
      f.componentRef.setInput('debounceMs', 20);
    });
    const queries: string[] = [];
    fixture.componentInstance.queryChange.subscribe((q) => queries.push(q));
    await type('al');
    await type('ale');
    await new Promise((r) => setTimeout(r, 40));
    expect(queries.filter(Boolean)).toEqual(['ale']); // o foco pede a lista sem texto
    expect(panelOptions().length).toBe(OPTIONS.length);
  });
});
