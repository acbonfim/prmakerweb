import { addTag, diffTags, normalizeTag, parseTags, removeTag, suggestTags } from './tags.logic';

describe('tags.logic (0099)', () => {
  const all = ['Cliente', 'Urgente', 'Relatório', 'regressão', 'Gerdau', 'UX'];

  it('limpa a tag (espaços e ";")', () => {
    expect(normalizeTag('  a;b   c ')).toBe('a b c');
    expect(normalizeTag(null)).toBe('');
  });

  it('sugere primeiro as que começam com o texto, depois as que contêm, sem acento e sem as escolhidas', () => {
    expect(suggestTags(all, [], 'r').options).toEqual(['regressão', 'Relatório', 'Gerdau', 'Urgente']);
    expect(suggestTags(all, ['Relatório'], 'r').options).toEqual(['regressão', 'Gerdau', 'Urgente']);
    expect(suggestTags(all, [], 'relatorio').options).toEqual(['Relatório']);
    expect(suggestTags(all, [], '').options.length).toBe(all.length);
    expect(suggestTags(all, [], '', 2).options.length).toBe(2);
  });

  it('oferece "Criar tag" só quando não existe no projeto nem entre as escolhidas', () => {
    expect(suggestTags(all, [], 'Nova tag').create).toBe('Nova tag');
    expect(suggestTags(all, [], 'cliente').create).toBeNull();
    expect(suggestTags(all, ['Minha'], 'minha').create).toBeNull();
    expect(suggestTags(all, [], '   ').create).toBeNull();
  });

  it('inclui sem duplicar e com a grafia do projeto', () => {
    expect(addTag([], 'cliente', all)).toEqual(['Cliente']);
    expect(addTag(['Cliente'], 'CLIENTE', all)).toEqual(['Cliente']);
    expect(addTag(['Cliente'], ' nova ', all)).toEqual(['Cliente', 'nova']);
    expect(addTag(['Cliente'], ';', all)).toEqual(['Cliente']);
  });

  it('remove ignorando caixa', () => {
    expect(removeTag(['Cliente', 'UX'], 'ux')).toEqual(['Cliente']);
  });

  it('diferença adicionar/remover ignora caixa', () => {
    expect(diffTags(['Cliente', 'UX'], ['cliente', 'Nova'])).toEqual({ addTags: ['Nova'], removeTags: ['UX'] });
    expect(diffTags([], [])).toEqual({ addTags: [], removeTags: [] });
  });

  it('lê System.Tags em texto ou lista', () => {
    expect(parseTags('a; b ;; c')).toEqual(['a', 'b', 'c']);
    expect(parseTags(['x', ' y '])).toEqual(['x', 'y']);
    expect(parseTags(null)).toEqual([]);
  });
});
