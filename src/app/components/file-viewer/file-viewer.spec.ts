import { fileViewKind, highlightSql } from './file-viewer.component';

describe('visualizador de arquivo — tipo de prévia', () => {
  it('SQL e código com destaque; markdown, JSON, texto e imagem; binário sem prévia', () => {
    expect(fileViewKind('00_consulta.sql', 'application/octet-stream', 100)).toBe('code');
    expect(fileViewKind('analise-us.md', 'text/markdown', 100)).toBe('markdown');
    expect(fileViewKind('dados.json', null, 100)).toBe('json');
    expect(fileViewKind('log.txt', null, 100)).toBe('text');
    expect(fileViewKind('ev01-descricao-image.png', null, 100)).toBe('image');
    expect(fileViewKind('arquivo.zip', 'application/zip', 100)).toBe('none');
    expect(fileViewKind('chamado', null, 100, 'ticket')).toBe('markdown');
    expect(fileViewKind('grande.sql', null, 3 * 1024 * 1024)).toBe('none');
  });

  it('destaca palavras-chave, strings, números e comentários do SQL', () => {
    const html = highlightSql("SELECT id FROM t WHERE x = 'a' AND n > 10 -- fim");
    expect(html).toContain('<span class="k">SELECT</span>');
    expect(html).toContain('<span class="s">\'a\'</span>');
    expect(html).toContain('<span class="n">10</span>');
    expect(html).toContain('<span class="c">-- fim</span>');
  });
});
