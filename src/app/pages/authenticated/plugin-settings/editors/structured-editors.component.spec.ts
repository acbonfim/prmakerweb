import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SettingField } from '../plugin-settings.model';
import { JsonEditorComponent } from './json-editor.component';
import { MapEditorComponent } from './map-editor.component';
import { PromptEditorComponent } from './prompt-editor.component';
import { TableEditorComponent } from './table-editor.component';

function field(partial: Partial<SettingField>): SettingField {
  return {
    id: '1:X', pluginId: 1, pluginName: 'Skills Configurations', key: 'X', label: 'X', type: 'json',
    value: null, hasValue: true, exists: true, isDefault: false, ...partial,
  };
}

/** Monta o editor com `field`/`value` e acompanha o `invalid` e o `value` gravado. */
async function mount<T extends { invalid: { subscribe(fn: (v: string | null) => void): unknown } }>(
  type: new (...args: any[]) => T, f: SettingField, value: string,
): Promise<{ fixture: ComponentFixture<T>; el: HTMLElement; invalid: (string | null)[]; values: string[] }> {
  const fixture = TestBed.createComponent(type);
  const invalid: (string | null)[] = [];
  const values: string[] = [];
  fixture.componentInstance.invalid.subscribe(v => invalid.push(v));
  (fixture.componentInstance as any).value.subscribe((v: string) => values.push(v));
  fixture.componentRef.setInput('field', f);
  fixture.componentRef.setInput('value', value);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, invalid, values };
}

function type(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

describe('editores estruturados (0086/FB)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideNoopAnimations()] });
  });

  it('json: aponta linha/coluna, formata e oferece converter literal JS', async () => {
    const f = field({ default: '[\n  { "label": "Dev" }\n]' });
    const { fixture, el, invalid, values } = await mount(JsonEditorComponent, f, "[{label:'Dev'},]");
    expect(invalid.at(-1)).toContain('JSON inválido');
    const convert = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Converter para JSON'));
    expect(convert).toBeTruthy();
    convert!.click();
    await fixture.whenStable();
    expect(values.at(-1)).toBe('[{"label":"Dev"}]');
    expect(invalid.at(-1)).toBeNull();

    fixture.componentInstance.format();
    await fixture.whenStable();
    expect(values.at(-1)).toBe('[\n  {\n    "label": "Dev"\n  }\n]');

    fixture.componentInstance.showDiff.set(true);
    await fixture.whenStable();
    expect(el.querySelector('.se__diff')).toBeTruthy();
  });

  it('json: raiz que não é objeto/lista é erro; vazio é aceito', async () => {
    const { fixture, invalid } = await mount(JsonEditorComponent, field({}), '42');
    expect(invalid.at(-1)).toContain('objeto');
    fixture.componentRef.setInput('value', '');
    await fixture.whenStable();
    expect(invalid.at(-1)).toBeNull();
  });

  it('table: edita célula preservando propriedades extras e acusa obrigatório vazio', async () => {
    const f = field({
      type: 'table',
      columns: [
        { key: 'key', label: 'Chave', type: 'text', required: true },
        { key: 'title', label: 'Título', type: 'text', required: true },
        { key: 'description', label: 'Descrição', type: 'textarea' },
      ],
    });
    const original = '[{"key":"a","title":"A","kind":"x"}]';
    const { fixture, el, invalid, values } = await mount(TableEditorComponent, f, original);
    expect(invalid.at(-1)).toBeNull();
    expect(values.length).toBe(0); // abrir não grava nada

    const inputs = el.querySelectorAll<HTMLInputElement>('.se__row input.se__input');
    type(inputs[1], 'Título novo');
    await fixture.whenStable();
    expect(JSON.parse(values.at(-1)!)).toEqual([{ key: 'a', title: 'Título novo', kind: 'x' }]);

    type(inputs[0], '');
    await fixture.whenStable();
    expect(invalid.at(-1)).toBe('Linha 1: preencha "Chave".');

    fixture.componentInstance.add();
    await fixture.whenStable();
    expect(fixture.componentInstance.rows().length).toBe(2);
    expect(el.querySelector('.se__row-extra textarea')).toBeTruthy(); // linha nova abre o texto longo
  });

  it('table: valor ilegível cai no modo JSON com o erro', async () => {
    const f = field({ type: 'table', columns: [{ key: 'a', label: 'A', type: 'text' }] });
    const { fixture, el, invalid } = await mount(TableEditorComponent, f, '{"nao":"lista"}');
    expect(fixture.componentInstance.mode()).toBe('json');
    expect(el.querySelector('app-setting-json-editor')).toBeTruthy();
    expect(invalid.at(-1)).toContain('lista');
  });

  it('map: pares com lista e chave repetida', async () => {
    const f = field({ type: 'map', mapKeyLabel: 'Seção', mapValueType: 'list' });
    const { fixture, el, invalid, values } = await mount(MapEditorComponent, f, '{"a":["x","y"]}');
    const inputs = el.querySelectorAll<HTMLInputElement>('.se__row input.se__input');
    expect(inputs[1].value).toBe('x, y');
    type(inputs[1], 'x, z');
    await fixture.whenStable();
    expect(values.at(-1)).toBe('{"a":["x","z"]}');

    fixture.componentInstance.add();
    await fixture.whenStable();
    expect(invalid.at(-1)).toBe('Linha 2: preencha "Seção".');
  });

  it('prompt/pattern: insere variável no cursor, avisa desconhecida e mostra a prévia', async () => {
    const f = field({
      type: 'pattern',
      variables: [{ name: 'card', description: 'número do card', example: '77434' }],
    });
    const { fixture, el, invalid, values } = await mount(PromptEditorComponent, f, 'hotfix/ {x}');
    expect(invalid.at(-1)).toBeNull();
    expect(el.querySelector('.se__msg--warn')?.textContent).toContain('{x}');

    const input = el.querySelector<HTMLInputElement>('input.se__input')!;
    input.focus();
    input.setSelectionRange(7, 7);
    el.querySelector<HTMLButtonElement>('.se__var')!.click();
    await fixture.whenStable();
    expect(values.at(-1)).toBe('hotfix/{card} {x}');
    expect(el.querySelector('.se__preview')?.textContent).toContain('hotfix/77434');
  });
});
