import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SettingField } from '../plugin-settings.model';
import { settingsFixture } from '../plugin-settings.fixture';
import { SettingListEditorComponent } from './list-editor.component';
import { SettingBoolEditorComponent } from './bool-editor.component';
import { SettingNumberEditorComponent } from './number-editor.component';
import { SettingStepsEditorComponent } from './steps-editor.component';

function fieldOf(key: string): SettingField {
  return settingsFixture().sections.flatMap(s => s.groups.flatMap(g => g.fields)).find(x => x.key === key)!;
}

function mount<T>(type: new (...a: any[]) => T, field: SettingField, value: string) {
  const fixture = TestBed.createComponent(type);
  fixture.componentRef.setInput('field', field);
  fixture.componentRef.setInput('value', value);
  const emitted: string[] = [];
  const invalid: (string | null)[] = [];
  const c = fixture.componentInstance as any;
  c.value.subscribe((v: string) => emitted.push(v));
  c.invalid.subscribe((v: string | null) => invalid.push(v));
  fixture.detectChanges();
  return { fixture, c, emitted, invalid };
}

describe('editores simples (0086) — formato gravado', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideNoopAnimations()] });
  });

  it('list csv: incluir/remover grava "a,b" sem espaço e sem repetir', () => {
    const { c, emitted } = mount(SettingListEditorComponent, fieldOf('QaBranchPattern'), 'qa,qa-*');
    c.add(' release , qa ');
    expect(emitted.at(-1)).toBe('qa,qa-*,release');
    c.remove('qa-*');
    expect(emitted.at(-1)).toBe('qa,release');
  });

  it('list json: grava array JSON compacto e acusa JSON inválido', () => {
    const { c, emitted, fixture, invalid } = mount(SettingListEditorComponent, fieldOf('ReverseEngineeringGlossaryExclusions'), '["id","nome"]');
    c.add('data');
    expect(emitted.at(-1)).toBe('["id","nome","data"]');
    fixture.componentRef.setInput('value', '["id",');
    fixture.detectChanges();
    expect(invalid.at(-1)).toContain('JSON');
  });

  it('bool: grava "true"/"false"', () => {
    const { c, emitted } = mount(SettingBoolEditorComponent, fieldOf('AutoDevTestInQa'), 'True');
    expect(c.on()).toBeTrue();
    c.value.set(c.format(false));
    expect(emitted.at(-1)).toBe('false');
  });

  it('number: vírgula vira ponto; fora da faixa acusa erro', () => {
    const { c, emitted, fixture, invalid } = mount(SettingNumberEditorComponent, fieldOf('WorkItemSlots'), '2');
    c.onInput('3');
    expect(emitted.at(-1)).toBe('3');
    c.onInput('1,5');
    expect(emitted.at(-1)).toBe('1.5');
    c.onInput('11');
    fixture.detectChanges();
    expect(invalid.at(-1)).toBe('Máximo 10.');
    c.onInput('');
    fixture.detectChanges();
    expect(emitted.at(-1)).toBe('');
    expect(invalid.at(-1)).toBeNull();
  });

  it('steps: aceita prefixo-* e avisa etapa desconhecida', () => {
    const { c, fixture } = mount(SettingStepsEditorComponent, fieldOf('AssistantHoursSteps'), 'montar-analise,corrigir-*,xpto');
    fixture.componentRef.setInput('steps', [{ key: 'montar-analise', title: 'Montar' }, { key: 'corrigir-back', title: 'Back' }]);
    fixture.detectChanges();
    expect(c.unknown()).toEqual(['xpto']);
    expect(c.known('corrigir-*')).toBeTrue();
  });
});
