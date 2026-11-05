import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { SettingChange, SettingField, SettingsSaveResult } from './plugin-settings.model';
import { settingsFixture } from './plugin-settings.fixture';
import { PluginSettingsService } from './plugin-settings.service';
import { ADVANCED_SECTION, PluginSettingsStore } from './plugin-settings.store';

class FakeApi {
  catalog = settingsFixture();
  sent: SettingChange[][] = [];
  next: SettingsSaveResult | null = null;
  getSettings() { return of(this.catalog); }
  patch(changes: SettingChange[]): Observable<SettingsSaveResult> {
    this.sent.push(changes);
    return of(this.next ?? { kind: 'ok', response: { plugins: [], fields: [] } });
  }
  history() { return of([]); }
}

describe('PluginSettingsStore (0086)', () => {
  let store: PluginSettingsStore;
  let api: FakeApi;

  const f = (key: string): SettingField => [...store.fieldById().values()].find(x => x.key === key)!;

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), PluginSettingsStore, { provide: PluginSettingsService, useValue: api }],
    });
    store = TestBed.inject(PluginSettingsStore);
    store.load().subscribe();
  });

  it('carrega o catálogo, ativa a 1ª seção e acrescenta "Plugins (avançado)" com as chaves fora do catálogo', () => {
    expect(store.activeSection()).toBe('devops');
    const adv = store.sections().find(s => s.key === ADVANCED_SECTION)!;
    expect(adv.groups[0].fields.map(x => x.key)).toEqual(['TicketSystem', 'LegacyToken']);
    expect(adv.groups[0].fields[1].type).toBe('secret');
    expect(store.missingCount()).toBe(1); // SituationPostToDevOps (o de plugin inexistente não conta)
  });

  it('edição vira pendência; voltar ao valor lido tira a pendência', () => {
    store.setValue(f('Organization'), 'outra');
    expect(store.pendingCount()).toBe(1);
    expect(store.valueOf(f('Organization'))).toBe('outra');
    store.setValue(f('Organization'), 'solvace');
    expect(store.pendingCount()).toBe(0);
  });

  it('segredo vazio não muda; plugin inexistente não edita', () => {
    store.setValue(f('PersonalAccessToken'), 'novo');
    expect(store.isDirty(f('PersonalAccessToken').id)).toBeTrue();
    store.setValue(f('PersonalAccessToken'), '');
    expect(store.isDirty(f('PersonalAccessToken').id)).toBeFalse();
    store.setValue(f('Model'), 'gpt-5');
    expect(store.pendingCount()).toBe(0);
  });

  it('pendências e erros contam por seção', () => {
    store.setValue(f('Organization'), 'x');
    store.setValue(f('BugReadyForQaState'), 'y');
    store.setValue(f('BranchNamePattern'), 'feature/{card}');
    store.setInvalid(f('WorkItemSlots').id, 'Máximo 10.');
    expect(store.pendingBySection()).toEqual({ devops: 2, branches: 1 });
    expect(store.errorsBySection()).toEqual({ executor: 1 });
    expect(store.errorCount()).toBe(1);
    store.setInvalid(f('WorkItemSlots').id, null);
    expect(store.errorCount()).toBe(0);
  });

  it('descartar a seção tira só as pendências dela', () => {
    store.setValue(f('Organization'), 'x');
    store.setValue(f('BranchNamePattern'), 'feature/{card}');
    store.discardSection('devops');
    expect(Object.keys(store.pending())).toEqual([f('BranchNamePattern').id]);
  });

  it('busca em todas as seções, agrupada, pelo valor em edição', () => {
    store.search.set('padrao de nome');
    expect(store.searchResults().length).toBe(0);
    store.search.set('model');
    const keys = store.searchResults().flatMap(r => r.groups.flatMap(g => g.fields.map(x => x.key)));
    expect(keys).toContain('ExecutorAnalysisModel');
    expect(keys).toContain('Model');
    store.setValue(f('Project'), 'ProjetoZeta');
    store.search.set('zeta');
    expect(store.searchResults().map(r => r.section.key)).toEqual(['devops']);
    expect(store.searchCount()).toBe(1);
  });

  it('obsoletas só aparecem com "mostrar obsoletas"', () => {
    store.search.set('ExecutorNoteDelaySeconds');
    expect(store.searchCount()).toBe(0);
    store.showObsolete.set(true);
    expect(store.searchCount()).toBe(1);
  });

  it('etapas conhecidas usam o valor EDITADO das listas de etapas', () => {
    const gate = f('CodeRefGateSteps');
    expect(store.stepOptionsFor(gate).map(s => s.key)).toContain('montar-analise');
    store.setValue(f('AnalysisDefaultSteps'), JSON.stringify([{ key: 'nova-etapa', title: 'Nova' }]));
    const keys = store.stepOptionsFor(gate).map(s => s.key);
    expect(keys).toContain('nova-etapa');
    expect(keys).not.toContain('montar-analise');
    expect(keys).toContain('entender-us'); // da outra fonte
  });

  it('PATCH da seção leva expected = valor lido e 200 aplica os campos devolvidos', () => {
    const org = f('Organization');
    store.setValue(org, 'nova');
    store.setValue(f('BranchNamePattern'), 'feature/{card}');
    const changes = store.sectionChanges('devops');
    expect(changes).toEqual([{ pluginId: 8, key: 'Organization', value: 'nova', expected: 'solvace', remove: false }]);
    api.next = { kind: 'ok', response: { plugins: [{ id: 8, version: '4712' }], fields: [{ ...org, value: 'nova' }] } };
    store.save('devops', changes).subscribe();
    expect(api.sent.length).toBe(1);
    expect(f('Organization').value).toBe('nova');
    expect(store.isDirty(org.id)).toBeFalse();
    expect(store.isDirty(f('BranchNamePattern').id)).toBeTrue();
    expect(store.catalog()!.plugins.find(p => p.id === 8)!.version).toBe('4712');
  });

  it('400 marca os campos; editar o campo limpa o erro do servidor', () => {
    const slots = f('WorkItemSlots');
    store.setValue(slots, '50');
    api.next = { kind: 'invalid', errors: [{ id: slots.id, message: 'Máximo 10.' }] };
    store.save('executor', store.sectionChanges('executor')).subscribe();
    expect(store.errorOf(slots.id)).toBe('Máximo 10.');
    expect(store.isDirty(slots.id)).toBeTrue();
    store.setValue(slots, '5');
    expect(store.errorOf(slots.id)).toBeNull();
  });

  it('409: sobrescrever refaz com expected = atual; recarregar descarta só os campos em conflito', () => {
    store.setValue(f('Organization'), 'minha');
    store.setValue(f('Project'), 'Meu');
    const changes = store.sectionChanges('devops');
    const conflicts = [{ id: '8:Organization', key: 'Organization', pluginId: 8, current: 'deles', expected: 'solvace' }];
    const again = store.overwriteChanges(changes, conflicts);
    expect(again.find(c => c.key === 'Organization')!.expected).toBe('deles');
    expect(again.find(c => c.key === 'Project')!.expected).toBe('Solvace');

    store.dropConflicting(conflicts);
    expect(store.isDirty('8:Organization')).toBeFalse();
    expect(store.isDirty('8:Project')).toBeTrue();
  });

  it('recarregar o catálogo mantém as pendências', () => {
    store.setValue(f('Organization'), 'minha');
    store.reload().subscribe();
    expect(store.valueOf(f('Organization'))).toBe('minha');
  });

  it('gravar padrão (chave inexistente) e remover (obsoleta) viram pendência', () => {
    store.writeDefault(f('SituationPostToDevOps'));
    store.markRemove(f('ExecutorNoteDelaySeconds'));
    expect(store.sectionChanges('devops')).toEqual([
      { pluginId: 10, key: 'SituationPostToDevOps', value: 'true', expected: null, remove: false },
    ]);
    expect(store.sectionChanges('executor')[0]).toEqual(
      { pluginId: 10, key: 'ExecutorNoteDelaySeconds', value: null, expected: '120', remove: true });
    expect(store.isVisible(f('ExecutorNoteDelaySeconds'))).toBeTrue();
  });
});
