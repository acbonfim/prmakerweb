import { DEFAULT_ITEM_TYPES, defaultItemType, itemTypeLook, itemTypes, offeredItemTypes } from './work-item-types';
import { WI_BUG_ICON, WI_US_ICON } from '../../helpers/work-item-type-icons';

describe('0085 r4 — tipos do item de trabalho', () => {
  it('reserva: os 12 tipos semeados (0092: validation) quando o catálogo não traz', () => {
    expect(DEFAULT_ITEM_TYPES.length).toBe(12);
    expect(itemTypes(null).map((t) => t.key)).toEqual([
      'task', 'pull-request', 'review', 'analysis', 'fix', 'implementation', 'adjustment', 'closing', 'data', 'ticket', 'text', 'validation'
    ]);
    expect(itemTypes({ itemTypes: [] }).length).toBe(12);
  });

  it('catálogo manda (e o rótulo vazio vira a chave)', () => {
    const c = { itemTypes: [{ key: 'task', label: 'Tarefa' }, { key: 'deploy', label: '' }, { key: ' ', label: 'x' }] };
    expect(itemTypes(c).map((t) => `${t.key}:${t.label}`)).toEqual(['task:Tarefa', 'deploy:deploy']);
  });

  it('bug/user-story não são oferecidos ao criar', () => {
    const c = { itemTypes: [{ key: 'task', label: 'Tarefa' }, { key: 'bug', label: 'Bug' }, { key: 'user-story', label: 'US' }] };
    expect(offeredItemTypes(c).map((t) => t.key)).toEqual(['task']);
  });

  it('padrão: o tipo do modelo (se oferecido), senão task', () => {
    expect(defaultItemType('pull-request', null)).toBe('pull-request');
    expect(defaultItemType('bug', null)).toBe('task');
    expect(defaultItemType(null, null)).toBe('task');
    expect(defaultItemType('nao-existe', null)).toBe('task');
    expect(defaultItemType(null, { itemTypes: [{ key: 'review', label: 'Revisão' }] })).toBe('review');
  });

  it('aparência: legados com SVG; novos com ícone e cor do tipo', () => {
    expect(itemTypeLook('bug').svg).toBe(WI_BUG_ICON);
    expect(itemTypeLook('user-story').svg).toBe(WI_US_ICON);
    const pr = itemTypeLook('pull-request');
    expect(pr.svg).toBeNull();
    expect(pr.icon).toBe('merge');
    expect(pr.label).toBe('Pull request');
    expect(pr.color).toBeTruthy();
    const custom = itemTypeLook('deploy', { itemTypes: [{ key: 'deploy', label: 'Deploy', icon: 'cloud_upload', color: '#123456' }] });
    expect(custom).toEqual({ key: 'deploy', label: 'Deploy', svg: null, icon: 'cloud_upload', color: '#123456' });
    expect(itemTypeLook('desconhecido').icon).toBe('task_alt');
  });
});
