import { workItemTypeIcon, workItemTypeLabel, workItemTypeOf } from './work-item-type-icons';

describe('work-item-type-icons (0085/F1)', () => {
  it('"User Story" vira user-story (sem diferenciar maiúsculas/espaços)', () => {
    expect(workItemTypeOf('User Story')).toBe('user-story');
    expect(workItemTypeOf(' user story ')).toBe('user-story');
  });

  it('qualquer outro tipo (ou vazio) vira bug', () => {
    expect(workItemTypeOf('Bug')).toBe('bug');
    expect(workItemTypeOf('Task')).toBe('bug');
    expect(workItemTypeOf('')).toBe('bug');
    expect(workItemTypeOf(undefined)).toBe('bug');
    expect(workItemTypeOf(null)).toBe('bug');
  });

  it('ícone e rótulo seguem o tipo', () => {
    expect(workItemTypeIcon('user-story')).toBe('wi-us');
    expect(workItemTypeIcon('bug')).toBe('wi-bug');
    expect(workItemTypeLabel('user-story')).toBe('User Story');
    expect(workItemTypeLabel('bug')).toBe('Bug');
  });
});
