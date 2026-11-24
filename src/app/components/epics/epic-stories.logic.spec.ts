import {
  DEFAULT_SEVERITIES, EpicStory, buildSaveStory, canConvertStory, convertWarnings, countByStoryFilter, emptyStoryDraft, filterStories,
  identityText, isStoryEditable, normalizePriority, normalizeStoryFields, openStoryCount, parseStoryFilter, severityValues,
  sortStories, storyApiError, storyBoardColumns, storyCardId, storyFieldText, storyStatusLook, storyToDraft, storyTypeLook,
  validateStory
} from './epic-stories.logic';

function story(p: Partial<EpicStory>): EpicStory {
  return {
    id: `id-${p.number ?? 1}`, number: 1, type: 'user-story', title: 'Título', tags: [], fields: {}, status: 'draft',
    createdAt: '2026-11-20T10:00:00', updatedAt: '2026-11-20T10:00:00', ...p
  };
}

describe('epic-stories.logic (0099 ajustes 2)', () => {
  it('rótulos de tipo e situação (com padrão)', () => {
    expect(storyTypeLook('bug').label).toBe('Bug');
    expect(storyTypeLook('bug').icon).toBe('bug_report');
    expect(storyTypeLook('bug').devOpsType).toBe('Bug');
    expect(storyTypeLook('user-story').icon).toBe('menu_book');
    expect(storyTypeLook('user-story').devOpsType).toBe('User Story');
    expect(storyTypeLook('xyz').key).toBe('user-story');
    expect(storyStatusLook('ready').label).toBe('Pronta');
    expect(storyStatusLook('converted').label).toBe('Convertida');
    expect(storyStatusLook(null).key).toBe('draft');
  });

  it('ordem: rascunhos, prontas, convertidas, descartadas; mais recente primeiro', () => {
    const list = [
      story({ number: 1, status: 'discarded', updatedAt: '2026-11-24T10:00:00' }),
      story({ number: 2, status: 'ready', updatedAt: '2026-11-20T10:00:00' }),
      story({ number: 3, status: 'draft', updatedAt: '2026-11-19T10:00:00' }),
      story({ number: 4, status: 'draft', updatedAt: '2026-11-22T10:00:00' }),
      story({ number: 5, status: 'converted', updatedAt: '2026-11-23T10:00:00' })
    ];
    expect(sortStories(list).map((s) => s.number)).toEqual([4, 3, 2, 5, 1]);
  });

  it('filtro por situação e contagens', () => {
    const list = [
      story({ number: 1, status: 'draft' }), story({ number: 2, status: 'ready' }), story({ number: 3, status: 'converted' }),
      story({ number: 4, status: 'discarded' }), story({ number: 5, status: 'draft' })
    ];
    expect(filterStories(list, 'all').length).toBe(5);
    expect(filterStories(list, 'draft').map((s) => s.number).sort()).toEqual([1, 5]);
    expect(filterStories(list, 'discarded').map((s) => s.number)).toEqual([4]);
    expect(countByStoryFilter(list)).toEqual({ all: 5, draft: 2, ready: 1, converted: 1, discarded: 1 });
    expect(openStoryCount(list)).toBe(3);
    expect(parseStoryFilter('ready')).toBe('ready');
    expect(parseStoryFilter('nada')).toBe('all');
  });

  it('convertida é só leitura e não converte de novo', () => {
    expect(isStoryEditable(story({ status: 'converted' }))).toBeFalse();
    expect(isStoryEditable(story({ status: 'discarded' }))).toBeTrue();
    expect(canConvertStory(story({ status: 'ready' }))).toBeTrue();
    expect(canConvertStory(story({ status: 'draft' }))).toBeTrue();
    expect(canConvertStory(story({ status: 'converted', cardId: 123 }))).toBeFalse();
    expect(canConvertStory(story({ status: 'ready', cardId: '77' }))).toBeFalse();
    expect(canConvertStory(story({ status: 'discarded' }))).toBeFalse();
    expect(canConvertStory(story({ status: 'ready', title: '  ' }))).toBeFalse();
    expect(storyCardId(story({ cardId: 78123 }))).toBe('78123');
    expect(storyCardId(story({ cardId: '#78123' }))).toBe('78123');
    expect(storyCardId(story({ cardId: null }))).toBeNull();
  });

  it('validação: título obrigatório; História recomenda critérios; Bug pede passos (erro só quando pronto)', () => {
    const us = emptyStoryDraft('user-story');
    expect(validateStory(us).ok).toBeFalse();
    expect(validateStory(us).errors[0]).toContain('título');
    expect(validateStory({ ...us, title: 'x'.repeat(301) }).ok).toBeFalse();

    const usOk = { ...us, title: 'Exportar PDF' };
    expect(validateStory(usOk).ok).toBeTrue();
    expect(validateStory(usOk).warnings.join(' ')).toContain('critérios de aceite');
    expect(validateStory({ ...usOk, acceptanceCriteria: '- ok' }).warnings).toEqual([]);

    const bug = { ...emptyStoryDraft('bug'), title: 'Erro ao salvar' };
    expect(validateStory(bug).ok).toBeTrue();
    expect(validateStory(bug).warnings.join(' ')).toContain('passos de reprodução');
    expect(validateStory({ ...bug, status: 'ready' }).ok).toBeFalse();
    expect(validateStory({ ...bug, status: 'ready', reproSteps: '1. abrir' }).ok).toBeTrue();
    expect(validateStory({ ...bug, status: 'ready', reproSteps: '1. abrir' }).warnings).toEqual([]);
  });

  it('corpo do salvar: só o texto do tipo, sem vazios, tags únicas e pessoa como "Nome <email>"', () => {
    const body = buildSaveStory({
      ...emptyStoryDraft('bug'), title: '  Erro  ', description: ' ', acceptanceCriteria: 'não vai', reproSteps: ' 1. abrir ',
      priority: 2, severity: '2 - High', tags: ['a', 'A', ' b '], status: 'ready',
      fields: {
        'System.AreaPath': ' Proj\\Time ', 'System.IterationPath': '',
        'System.AssignedTo': { displayName: 'Alex Carlos', uniqueName: 'alex@x.com' }
      }
    });
    expect(body).toEqual({
      type: 'bug', title: 'Erro', description: null, acceptanceCriteria: null, reproSteps: '1. abrir', priority: 2,
      severity: '2 - High', tags: ['a', 'b'], status: 'ready',
      fields: { 'System.AreaPath': 'Proj\\Time', 'System.AssignedTo': 'Alex Carlos <alex@x.com>' }
    });
    const us = buildSaveStory({ ...emptyStoryDraft('user-story'), title: 'US', reproSteps: 'x', severity: '1 - Critical', acceptanceCriteria: '- a', priority: 9 });
    expect(us.reproSteps).toBeNull();
    expect(us.severity).toBeNull();
    expect(us.acceptanceCriteria).toBe('- a');
    expect(us.priority).toBeNull();
    expect(us.status).toBe('draft');
  });

  it('história → rascunho do editor (descartada volta como rascunho)', () => {
    const d = storyToDraft(story({ type: 'bug', status: 'discarded', priority: 3, severity: '3 - Medium', reproSteps: 'p', tags: ['t'] }));
    expect(d.type).toBe('bug');
    expect(d.status).toBe('draft');
    expect(d.priority).toBe(3);
    expect(d.reproSteps).toBe('p');
    expect(storyToDraft(story({ status: 'ready' })).status).toBe('ready');
  });

  it('pessoa e campos', () => {
    expect(identityText({ displayName: 'Ana', uniqueName: 'ana@x.com' })).toBe('Ana <ana@x.com>');
    expect(identityText('ana@x.com')).toBe('ana@x.com');
    expect(identityText('Ana <ana@x.com>')).toBe('Ana <ana@x.com>');
    expect(identityText(null)).toBeNull();
    expect(normalizeStoryFields({ 'System.AssignedTo': null, '': 'x', 'Custom.N': 3 })).toEqual({ 'Custom.N': 3 });
    expect(storyFieldText('System.AssignedTo', 'Ana <ana@x.com>')).toBe('Ana');
    expect(storyFieldText('System.AreaPath', 'P\\A')).toBe('P\\A');
  });

  it('prioridade e severidade', () => {
    expect(normalizePriority('2')).toBe(2);
    expect(normalizePriority(0)).toBeNull();
    expect(normalizePriority(5)).toBeNull();
    expect(normalizePriority('')).toBeNull();
    expect(normalizePriority(null)).toBeNull();
    expect(severityValues(null)).toEqual([...DEFAULT_SEVERITIES]);
    expect(severityValues([{ referenceName: 'Microsoft.VSTS.Common.Severity', allowedValues: ['A', 'B'] }])).toEqual(['A', 'B']);
    expect(severityValues([{ referenceName: 'Microsoft.VSTS.Common.Severity', allowedValues: [] }])).toEqual([...DEFAULT_SEVERITIES]);
  });

  it('conversão: colunas que aceitam o tipo (nenhuma → todas) e avisos', () => {
    const cols: { name: string; stateMappings: Record<string, string> }[] = [
      { name: 'New', stateMappings: { 'User Story': 'New', Bug: 'New' } },
      { name: 'Dev', stateMappings: { 'User Story': 'Active' } },
      { name: 'Done', stateMappings: {} }
    ];
    expect(storyBoardColumns(cols, 'Bug').map((c) => c.name)).toEqual(['New']);
    expect(storyBoardColumns(cols, 'User Story').map((c) => c.name)).toEqual(['New', 'Dev']);
    expect(storyBoardColumns(cols, 'Task').map((c) => c.name)).toEqual(['New', 'Dev', 'Done']);
    expect(convertWarnings(story({ type: 'bug', status: 'ready', description: 'd' }))).toEqual(['O bug está sem passos de reprodução.']);
    expect(convertWarnings(story({ status: 'ready', description: 'd', acceptanceCriteria: '- a' }))).toEqual([]);
    expect(convertWarnings(story({ status: 'draft' })).length).toBe(3);
  });

  it('erros da API (409 conhecidos)', () => {
    const already = storyApiError({ status: 409, error: { code: 'alreadyConverted', cardId: 78123 } }, 'x');
    expect(already.code).toBe('alreadyConverted');
    expect(already.cardId).toBe('78123');
    expect(already.message).toContain('#78123');
    expect(storyApiError({ status: 409, error: { code: 'notEditable' } }, 'x').message).toContain('não se edita');
    expect(storyApiError({ status: 400, error: { message: 'Título obrigatório' } }, 'x').message).toBe('Título obrigatório');
    expect(storyApiError({ status: 500, error: 'falhou' }, 'x').message).toBe('falhou');
    expect(storyApiError({ status: 0 }, 'x').message).toContain('Sem conexão');
    expect(storyApiError(null, 'padrão').message).toBe('padrão');
  });
});
