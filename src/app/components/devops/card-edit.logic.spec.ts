import {
  booleanValue, buildCreate, buildPatch, changedFields, createFields, defaultFieldValue, displayValue, groupFields, inputKind, missingRequired,
  outgoingValue, sameValue, describeChanges, changesLabel
} from './card-edit.logic';
import { DevOpsFieldDef } from './devops.model';

function def(referenceName: string, type: string, extra: Partial<DevOpsFieldDef> = {}): DevOpsFieldDef {
  return { referenceName, name: referenceName.split('.').pop()!, type, required: false, readOnly: false, allowedValues: [], ...extra };
}

const DEFS: DevOpsFieldDef[] = [
  def('System.Title', 'string', { required: true }),
  def('System.State', 'string', { allowedValues: ['New', 'Active'] }),
  def('System.AssignedTo', 'identity'),
  def('System.AreaPath', 'treePath'),
  def('System.IterationPath', 'treePath'),
  def('Microsoft.VSTS.Common.Priority', 'integer', { allowedValues: ['1', '2', '3', '4'] }),
  def('Microsoft.VSTS.Common.Severity', 'string', { allowedValues: ['1 - Critical', '2 - High'] }),
  def('Custom.BugType', 'string', { allowedValues: ['Code', 'Data'] }),
  def('System.Description', 'html'),
  def('Microsoft.VSTS.TCM.ReproSteps', 'html'),
  def('Custom.Notes', 'plainText'),
  def('Custom.Client', 'string', { required: true }),
  def('Custom.Hours', 'double'),
  def('Custom.Blocked', 'boolean'),
  def('Custom.Due', 'dateTime'),
  def('System.CreatedDate', 'dateTime', { readOnly: true }),
  def('System.ChangedBy', 'identity', { readOnly: true }),
  def('WEF_ABC_Kanban.Column', 'string'),
];
const byRef = (r: string) => DEFS.find((d) => d.referenceName === r)!;

describe('card-edit.logic (0099)', () => {
  it('controle por tipo de campo', () => {
    expect(inputKind(byRef('System.AssignedTo'))).toBe('identity');
    expect(inputKind(byRef('System.AreaPath'))).toBe('area');
    expect(inputKind(byRef('System.IterationPath'))).toBe('iteration');
    expect(inputKind(byRef('Microsoft.VSTS.Common.Priority'))).toBe('picklist');
    expect(inputKind(byRef('Custom.Hours'))).toBe('number');
    expect(inputKind(byRef('Custom.Due'))).toBe('date');
    expect(inputKind(byRef('Custom.Blocked'))).toBe('boolean');
    expect(inputKind(byRef('System.Description'))).toBe('html');
    expect(inputKind(byRef('Custom.Notes'))).toBe('multiline');
    expect(inputKind(byRef('Custom.Client'))).toBe('text');
  });

  it('agrupa: principais primeiro (com as picklists), textos, outros e somente leitura; esconde os do sistema', () => {
    const g = groupFields(DEFS, { 'System.CreatedDate': '2026-11-20T10:00:00', 'Custom.Hours': 3 });
    expect(g.main.map((f) => f.referenceName)).toEqual([
      'System.AssignedTo', 'System.AreaPath', 'System.IterationPath', 'Microsoft.VSTS.Common.Priority',
      'Microsoft.VSTS.Common.Severity', 'Custom.BugType',
    ]);
    expect(g.texts.map((f) => f.referenceName)).toEqual(['System.Description', 'Microsoft.VSTS.TCM.ReproSteps']);
    expect(g.others.map((f) => f.referenceName)).toEqual(['Custom.Client', 'Custom.Hours']);
    expect(g.readOnly.map((f) => f.referenceName)).toEqual(['System.CreatedDate']);
    const all = groupFields(DEFS, {}, true);
    expect(all.others.map((f) => f.referenceName)).toEqual(['Custom.Blocked', 'Custom.Client', 'Custom.Due', 'Custom.Hours']);
    expect(all.texts.map((f) => f.referenceName)).toContain('Custom.Notes');
  });

  it('campos do criar: comuns + obrigatórios, textos por último', () => {
    expect(createFields(DEFS).map((f) => f.referenceName)).toEqual([
      'System.AssignedTo', 'System.AreaPath', 'System.IterationPath', 'Microsoft.VSTS.Common.Priority', 'Custom.Client',
      'System.Description', 'Microsoft.VSTS.TCM.ReproSteps',
    ]);
  });

  it('compara valores pelo sentido do campo', () => {
    const who = byRef('System.AssignedTo');
    expect(sameValue(who, { displayName: 'Ana', uniqueName: 'ana@x.com' }, 'Ana <ANA@x.com>')).toBeTrue();
    expect(sameValue(who, { uniqueName: 'ana@x.com' }, 'bia@x.com')).toBeFalse();
    expect(sameValue(byRef('Custom.Hours'), 3, '3')).toBeTrue();
    expect(sameValue(byRef('Custom.Client'), null, '')).toBeTrue();
    expect(sameValue(byRef('Custom.Client'), null, 'x')).toBeFalse();
    expect(sameValue(byRef('Custom.Due'), '2026-11-20T00:00:00Z', '2026-11-20')).toBeTrue();
  });

  it('valor de saída: vazio limpa, identidade pelo uniqueName, número', () => {
    expect(outgoingValue(byRef('Custom.Client'), '  ')).toBeNull();
    expect(outgoingValue(byRef('System.AssignedTo'), { displayName: 'Ana', uniqueName: 'ana@x.com' })).toBe('ana@x.com');
    expect(outgoingValue(byRef('Custom.Hours'), '2.5')).toBe(2.5);
    expect(outgoingValue(byRef('Custom.Blocked'), 1)).toBeTrue();
  });

  it('PATCH só com o que mudou (campos, título, tags, comentário)', () => {
    const original = {
      title: 'Erro ao exportar',
      tags: ['Cliente', 'UX'],
      fields: {
        'System.AssignedTo': { displayName: 'Ana', uniqueName: 'ana@x.com' },
        'Microsoft.VSTS.Common.Priority': 2,
        'Custom.Client': 'Gerdau',
        'System.CreatedDate': '2026-11-20',
      } as Record<string, unknown>,
    };
    const values: Record<string, unknown> = {
      'System.AssignedTo': 'Ana <ana@x.com>',
      'Microsoft.VSTS.Common.Priority': '1',
      'Custom.Client': '',
      'System.CreatedDate': '2026-11-21',
    };
    const patch = buildPatch(original, DEFS, values, ' Erro ao exportar o PDF ', ['cliente', 'Nova'], ' veja ');
    expect(patch).toEqual({
      fields: { 'Microsoft.VSTS.Common.Priority': 1, 'Custom.Client': null, 'System.Title': 'Erro ao exportar o PDF' },
      addTags: ['Nova'],
      removeTags: ['UX'],
      comment: 'veja',
    });
    expect(buildPatch(original, DEFS, { 'Custom.Client': 'Gerdau' }, 'Erro ao exportar', ['Cliente', 'UX'])).toBeNull();
    expect([...changedFields(original, DEFS, values)].sort()).toEqual(
      ['Custom.Client', 'Microsoft.VSTS.Common.Priority']);
  });

  it('POST de criar só com os preenchidos', () => {
    const body = buildCreate('Bug', ' Falha ', DEFS, { 'Custom.Client': 'Gerdau', 'System.AreaPath': '', 'Microsoft.VSTS.Common.Priority': '2' },
      ['Cliente'], { epic: 12, parentId: null });
    expect(body).toEqual({
      type: 'Bug', title: 'Falha', epic: 12, parentId: null,
      fields: { 'Custom.Client': 'Gerdau', 'Microsoft.VSTS.Common.Priority': 2 }, tags: ['Cliente'],
    });
    expect(missingRequired(DEFS, { 'Custom.Client': ' ' })).toEqual(['Client']);
  });

  it('valor somente leitura para exibir', () => {
    expect(displayValue(byRef('System.ChangedBy'), { displayName: 'Ana', uniqueName: 'a@x' })).toBe('Ana');
    expect(displayValue(byRef('Custom.Blocked'), false)).toBe('Não');
    expect(displayValue(byRef('System.Description'), '<p>Oi&nbsp;<b>você</b></p>')).toBe('Oi você');
    expect(displayValue(byRef('Custom.Client'), null)).toBe('—');
  });
});

describe('describeChanges (0099 ajustes 3)', () => {
  const defs = [
    { referenceName: 'System.State', name: 'State', type: 'string', required: true, readOnly: false, allowedValues: ['New', 'Active'] },
    { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', type: 'integer', required: false, readOnly: false, allowedValues: [] },
    { referenceName: 'System.Description', name: 'Description', type: 'html', required: false, readOnly: false, allowedValues: [] },
    { referenceName: 'System.CreatedDate', name: 'Created Date', type: 'dateTime', required: false, readOnly: true, allowedValues: [] },
  ];
  const original = {
    title: 'Velho', tags: ['A'],
    fields: { 'System.State': 'New', 'Microsoft.VSTS.Common.Priority': 2, 'System.Description': '<p>antes</p>', 'System.CreatedDate': '2026-01-01' },
  };

  it('lista título, campos (antes × depois, HTML como texto) e tags, na ordem dos campos', () => {
    const values = { ...original.fields, 'System.State': 'Active', 'System.Description': '<p>depois</p>', 'System.CreatedDate': 'x' };
    const list = describeChanges(original, defs, values, 'Novo', ['A', 'B']);
    expect(list.map((c) => c.label)).toEqual(['Título', 'Estado', 'Description', 'Tags']);
    expect(list[1]).toEqual(jasmine.objectContaining({ before: 'New', after: 'Active' }));
    expect(list[2]).toEqual(jasmine.objectContaining({ before: 'antes', after: 'depois' }));
    expect(list[3].after).toBe('A, B');
    expect(changesLabel(list)).toBe('Alterado: 3 campos, tags');
  });

  it('sem mudança → lista vazia', () => {
    expect(describeChanges(original, defs, { ...original.fields }, 'Velho', ['A'])).toEqual([]);
    expect(changesLabel([])).toBe('');
  });
});

describe('criar card: User Story do projeto Solvace (E1093)', () => {
  // Obrigatórios reais da User Story: Module sem padrão; booleanos com padrão "0".
  const defs: DevOpsFieldDef[] = [
    def('System.Title', 'string', { required: true }),
    def('System.AreaId', 'integer', { required: true }),
    def('Custom.Module', 'picklistString', { name: 'Module', required: true, allowedValues: ['Checklist', 'Login'] }),
    def('Custom.APPROVED', 'boolean', { name: 'APPROVED', required: true, defaultValue: '0' }),
    def('Custom.Specified', 'boolean', { name: 'Specified', required: true, defaultValue: '0' }),
    def('Microsoft.VSTS.CMMI.RequirementType', 'string', { name: 'Requirement Type', required: true, allowedValues: ['Business', 'RCA'], defaultValue: 'Business' }),
  ];

  it('mostra Module e bloqueia o Criar até escolher; o sistema (AreaId) fica de fora', () => {
    const shown = createFields(defs);
    expect(shown.map((d) => d.referenceName)).toContain('Custom.Module');
    expect(shown.map((d) => d.referenceName)).not.toContain('System.AreaId');
    const values: Record<string, unknown> = {};
    for (const f of shown) if (defaultFieldValue(f) !== undefined) values[f.referenceName] = defaultFieldValue(f);
    expect(missingRequired(shown, values)).toEqual(['Module']);
    expect(missingRequired(shown, { ...values, 'Custom.Module': 'Login' })).toEqual([]);
  });

  it('booleano com padrão "0" sai como false (antes !!"0" mandava true)', () => {
    const shown = createFields(defs);
    const values: Record<string, unknown> = { 'Custom.Module': 'Login' };
    for (const f of shown) if (defaultFieldValue(f) !== undefined) values[f.referenceName] = defaultFieldValue(f);
    const body = buildCreate('User Story', 'x', shown, values, []);
    expect(body.fields?.['Custom.APPROVED']).toBeFalse();
    expect(body.fields?.['Custom.Specified']).toBeFalse();
    expect(body.fields?.['Microsoft.VSTS.CMMI.RequirementType']).toBe('Business');
    expect(booleanValue('1')).toBeTrue();
    expect(booleanValue('false')).toBeFalse();
    expect(sameValue(defs[3], '0', false)).toBeTrue();
  });
});
