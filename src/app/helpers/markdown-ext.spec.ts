import { Marked } from 'marked';
import {
  badgeKind, findCitations, findReRefs, hasCitation, hasReRef, normalizeLegacyEmojis, parseAttachmentHref, parseCitation,
  parseReHref, parseRefHref, renderMarkdown,
} from './markdown-ext';

const on = (t: string) => renderMarkdown(t, { codeRefs: true });
const off = (t: string) => renderMarkdown(t, { codeRefs: false });
const plain = new Marked({ gfm: true, breaks: true, async: false });

describe('markdown-ext (0075/F1)', () => {
  describe('parseCitation', () => {
    it('reconhece caminho com faixa e com linha única', () => {
      expect(parseCitation('solvace-asp/systems/sa3/sa3_busca_a3.asp:239-289'))
        .toEqual({ path: 'solvace-asp/systems/sa3/sa3_busca_a3.asp', start: 239, end: 289 });
      expect(parseCitation('a/b/daterangepicker.js:325')).toEqual({ path: 'a/b/daterangepicker.js', start: 325, end: 325 });
      expect(parseCitation('Program.cs:12')).toEqual({ path: 'Program.cs', start: 12, end: 12 });
    });

    it('recusa o que não é arquivo de código', () => {
      expect(parseCitation('10:30')).toBeNull();
      expect(parseCitation('04/11:30')).toBeNull();
      expect(parseCitation('versao.2:3')).toBeNull();
      expect(parseCitation('www.site.com/a.js:3')).toBeNull();
      expect(parseCitation('a/b.js')).toBeNull();
      expect(parseCitation('a/b.js:0')).toBeNull();
    });

    it('acha várias citações num texto e ignora URLs', () => {
      const found = findCitations('ver a/b.js:1-2 e https://github.com/x/y.js:12 e c.cs:3');
      expect(found.map(c => c.path)).toEqual(['a/b.js', 'c.cs']);
      expect(hasCitation('nada aqui 10:30')).toBeFalse();
    });

    it('ids de ref e anexos', () => {
      expect(parseRefHref('ref:SA3-Init')).toBe('sa3-init');
      expect(parseRefHref('ref:"x')).toBeNull();
      expect(parseRefHref('ref:-x')).toBeNull();
      expect(parseRefHref('ref:' + 'a'.repeat(61))).toBeNull();
      expect(parseAttachmentHref('anexo:mock-depois.png')).toBe('mock-depois.png');
      expect(parseAttachmentHref('http://x/y.png')).toBeNull();
    });
  });

  describe('callouts', () => {
    it('converte os seis tipos com o título em português', () => {
      const pairs: [string, string][] = [
        ['SUMMARY', 'Resumo'], ['note', 'Nota'], ['Tip', 'Dica'],
        ['IMPORTANT', 'Importante'], ['WARNING', 'Atenção'], ['CAUTION', 'Cuidado'],
      ];
      for (const [kind, title] of pairs) {
        const html = on(`> [!${kind}]\n> **Problema:** x`);
        expect(html).toContain(`<div class="md-callout md-callout--${kind.toLowerCase()}">`);
        expect(html).toContain(`<p class="md-callout__title">${title}</p>`);
        expect(html).toContain('<strong>Problema:</strong> x');
        expect(html).not.toContain('<blockquote>');
        expect(html).not.toContain('[!');
      }
    });

    it('citação comum continua blockquote e o callout vale também sem codeRefs', () => {
      expect(on('> só uma citação')).toContain('<blockquote>');
      expect(on('> [!FOO]\n> x')).toContain('<blockquote>');
      expect(off('> [!WARNING]\n> cuidado')).toContain('md-callout--warning');
    });
  });

  describe('links ref:', () => {
    it('vira a.code-ref mantendo o código inline', () => {
      const html = on('| 1 | [`sa3_busca_a3.asp:239-289`](ref:sa3-init) |\n|---|---|');
      expect(html).toContain(
        '<a class="code-ref" href="#ref/sa3-init" title="Ver o código"><code>sa3_busca_a3.asp:239-289</code></a>');
      expect(html).not.toContain('code-cite'); // citação dentro do link não vira outro link
    });

    it('id em maiúsculas é normalizado e id inválido vira só o texto', () => {
      expect(on('[x](ref:SA3-Init)')).toContain('href="#ref/sa3-init"');
      const bad = on('[texto](ref:"onmouseover=alert(1))');
      expect(bad).toBe('<p>texto</p>\n');
    });

    it('sem codeRefs vira <code> com o texto', () => {
      expect(off('[`a.asp:1`](ref:sa3-init)')).toBe('<p><code>a.asp:1</code></p>\n');
      expect(off('[ver o **init**](ref:sa3-init)')).toBe('<p><code>ver o init</code></p>\n');
    });
  });

  describe('citações automáticas', () => {
    const exemplo = [
      'Pontos suspeitos / de alteração',
      'solvace-asp/systems/sa3/sa3_busca_a3.asp:239-289 — ordem da inicialização.',
      'solvace-core/view_shared/wwwroot/js/loadSelectOptions.class.js:336-353 — restauração de data sem formato (compartilhado).',
      'solvace-core/view_shared/wwwroot/templates/limitlessfull/js/plugins/pickers/daterangepicker.js:325 — construtor sem isValid() (biblioteca, 36 páginas a carregam).',
    ].join('\n');

    it('os três casos do item 1.6 (texto puro, um por linha) viram links', () => {
      const html = on(exemplo);
      expect(html).toContain(
        '<a class="code-cite" href="#cite/solvace-asp%2Fsystems%2Fsa3%2Fsa3_busca_a3.asp:239-289" title="Ver o código">'
        + 'solvace-asp/systems/sa3/sa3_busca_a3.asp:239-289</a> — ordem da inicialização.');
      expect(html).toContain(
        '<a class="code-cite" href="#cite/solvace-core%2Fview_shared%2Fwwwroot%2Fjs%2FloadSelectOptions.class.js:336-353" title="Ver o código">'
        + 'solvace-core/view_shared/wwwroot/js/loadSelectOptions.class.js:336-353</a>');
      expect(html).toContain(
        'href="#cite/solvace-core%2Fview_shared%2Fwwwroot%2Ftemplates%2Flimitlessfull%2Fjs%2Fplugins%2Fpickers%2Fdaterangepicker.js:325-325"');
      expect(html).toContain('daterangepicker.js:325</a> — construtor sem isValid()');
      expect((html.match(/class="code-cite"/g) ?? []).length).toBe(3);
    });

    it('também em lista e com __ no nome (sem virar negrito)', () => {
      const html = on('- a/__init__.py:3\n- foo__bar__/x.cs:4-9');
      expect(html).toContain('href="#cite/a%2F__init__.py:3-3"');
      expect(html).toContain('>a/__init__.py:3</a>');
      expect(html).toContain('href="#cite/foo__bar__%2Fx.cs:4-9"');
      expect(html).not.toContain('<strong>');
    });

    it('código inline com a citação vira link mantendo o <code>', () => {
      const html = on('veja `solvace-core/x/loadSelectOptions.class.js:336-353` e `Program.cs:12` e `x y`');
      expect(html).toContain(
        '<a class="code-cite" href="#cite/solvace-core%2Fx%2FloadSelectOptions.class.js:336-353" title="Ver o código">'
        + '<code>solvace-core/x/loadSelectOptions.class.js:336-353</code></a>');
      expect(html).toContain('<a class="code-cite" href="#cite/Program.cs:12-12" title="Ver o código"><code>Program.cs:12</code></a>');
      expect(html).toContain('<code>x y</code>');
    });

    it('não linka em bloco de código, URL, link existente nem código com mais coisa', () => {
      const html = on([
        '```',
        'a/b.js:12',
        '```',
        'https://github.com/x/y.js:12 e [l](http://a/b.js:3) e [a/b.js:4](http://x) e `a/b.js:5 (main)`',
      ].join('\n'));
      expect(html).not.toContain('code-cite');
      expect(html).toContain('<pre><code>a/b.js:12\n</code></pre>');
      expect(html).toContain('<a href="https://github.com/x/y.js:12">');
      expect(html).toContain('<a href="http://x">a/b.js:4</a>');
    });

    it('parágrafo longo com muitos _ e * ainda acha a citação do fim (e sem pedaço de palavra)', () => {
      const texto = 'nome_com_underscore e *x* '.repeat(400) + 'fim em solvace-asp/a_b/c_d.asp:7';
      const html = on(texto);
      expect((html.match(/class="code-cite"/g) ?? []).length).toBe(1);
      expect(html).toContain('href="#cite/solvace-asp%2Fa_b%2Fc_d.asp:7-7"');
    });

    it('sem codeRefs a citação fica texto', () => {
      const html = off(exemplo);
      expect(html).not.toContain('<a');
      expect(html).toContain('solvace-asp/systems/sa3/sa3_busca_a3.asp:239-289 — ordem');
    });
  });

  describe('imagens anexo:', () => {
    it('vira img.md-attachment sem src real', () => {
      expect(on('![Depois](anexo:mock-depois.png)')).toBe(
        '<p><img class="md-attachment" alt="Depois" title="anexo:mock-depois.png" src=""></p>\n');
    });

    it('duas ou mais no mesmo parágrafo ficam numa galeria', () => {
      const html = on('![Antes](anexo:a.png) ![Depois](anexo:b.png)\nSimulação a partir do código');
      expect(html).toContain('<span class="md-gallery"><img class="md-attachment" alt="Antes" title="anexo:a.png" src="">'
        + '<img class="md-attachment" alt="Depois" title="anexo:b.png" src=""></span><br>Simulação');
      expect(on('![A](anexo:a.png)\n![B](anexo:b.png)')).toContain('md-gallery');
      expect(on('![A](anexo:a.png)\n\ntexto\n\n![B](anexo:b.png)')).not.toContain('md-gallery');
    });

    it('sem codeRefs vira só o texto alternativo em itálico', () => {
      expect(off('![Depois — filtro mantido](anexo:mock-depois.png)')).toBe('<p><em>Depois — filtro mantido</em></p>\n');
    });
  });

  describe('segurança', () => {
    it('anexo com "><script> fica escapado no atributo', () => {
      const html = on('![x" onerror="alert(1)](anexo:"><script>alert(1)</script>)');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('" onerror="');
      expect(html).toContain('title="anexo:&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    });

    it('ref: com aspas não injeta atributo', () => {
      const html = on('[x](ref:a"onclick="alert(1))');
      expect(html).not.toContain('onclick');
      expect(html).not.toContain('code-ref');
    });

    it('link javascript: vira só o texto', () => {
      expect(on('[clique](javascript:alert(1))')).toBe('<p>clique</p>\n');
      expect(off('[clique](JavaScript:alert(1))')).toBe('<p>clique</p>\n');
    });
  });

  describe('regressão', () => {
    it('texto antigo sem citações renderiza igual ao marked puro (gfm + breaks)', () => {
      const antigo = [
        '# Análise do card 75812',
        '',
        '**Problema:** o filtro some ao voltar.  Linha com _ênfase_ e ~~tachado~~.',
        'Segunda linha (quebra simples) com `codigo()` e [link](https://dev.azure.com/x) e www.solvace.com.',
        '',
        '- item 1',
        '- item 2 com __negrito__',
        '',
        '1. passo',
        '2. passo',
        '',
        '> citação comum',
        '',
        '| A | B |',
        '|---|---|',
        '| 1 | 10:30 |',
        '',
        '```sql',
        'select * from t where a = 1;',
        '```',
        '',
        '![logo](https://x.com/logo.png "Logo")',
        '',
        '---',
        'Fim às 10:30 de 04/11.',
      ].join('\n');
      // 0076: a tabela vai num contêiner (.md-table) — o resto é igual ao marked puro
      const unwrap = (h: string) => h.replace(/<div class="md-table[^"]*">/g, '').replace(/<\/table><\/div>/g, '</table>');
      expect(on(antigo)).toContain('<div class="md-table md-table--num"><table>');
      expect(unwrap(on(antigo))).toBe(plain.parse(antigo) as string);
      expect(unwrap(off(antigo))).toBe(plain.parse(antigo) as string);
    });

    it('não altera as opções globais do marked', async () => {
      const { marked } = await import('marked');
      const before = { ...marked.defaults };
      on('> [!NOTE]\n> x a/b.js:1');
      expect(marked.defaults.gfm).toBe(before.gfm);
      expect(marked.defaults.breaks).toBe(before.breaks);
      expect(marked.defaults.extensions).toBe(before.extensions);
    });

    it('texto vazio', () => {
      expect(on('')).toBe('');
      expect(off(null as unknown as string)).toBe('');
    });
  });
});

describe('markdown-ext (0076: selos, tabelas, itens da engenharia reversa)', () => {
  const card = (t: string) => renderMarkdown(t, { codeRefs: true, reRefs: true });
  const doc = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

  describe('selos', () => {
    it('rótulos em negrito viram selos (com e sem ":")', () => {
      const d = doc(on('**Alterar** a função · **Criar** · **Remover** · **Suspeito** · **Só leitura** · **Leitura** · '
        + '**Confirmado:** sim · **Hipótese:** talvez · **Descartado** · **Recomendada**'));
      const badges = [...d.querySelectorAll('.md-badge')].map(b => [b.className.replace('md-badge md-badge--', ''), b.textContent]);
      expect(badges).toEqual([
        ['change', 'Alterar'], ['create', 'Criar'], ['remove', 'Remover'], ['suspect', 'Suspeito'], ['read', 'Só leitura'],
        ['read', 'Leitura'], ['confirmed', 'Confirmado'], ['hypothesis', 'Hipótese'], ['discarded', 'Descartado'],
        ['recommended', 'Recomendada'],
      ]);
      expect(d.querySelector('strong')).toBeNull();
    });

    it('negrito comum continua negrito', () => {
      expect(on('**Problema:** x')).toContain('<strong>Problema:</strong>');
      expect(on('**alterar o filtro**')).toContain('<strong>alterar o filtro</strong>');
      expect(badgeKind(' Confirmado: ')).toBe('confirmed');
      expect(badgeKind('Só  leitura')).toBe('read');
      expect(badgeKind('Problema')).toBeNull();
    });

    it('emojis antigos no começo da célula viram o mesmo selo (com e sem rótulo)', () => {
      const md = [
        '| # | Onde | Mudança | Por quê |',
        '|---|---|---|---|',
        '| 1 | `a/b.js:10` | ✏️ alterar | x |',
        '| 2 | `a/c.js:3` | ➕ criar | y |',
        '| 3 | `a/d.js:5` | 🗑️ | z |',
        '| 4 | `a/e.js:7` | 👁️ só leitura | w |',
        '| 5 | `a/f.js:9` | ⚠️ | v |',
      ].join('\n');
      const d = doc(on(md));
      const cells = [...d.querySelectorAll('tbody tr td:nth-child(3)')];
      expect(cells.map(c => c.querySelector('.md-badge')?.className.replace('md-badge md-badge--', ''))).toEqual(
        ['change', 'create', 'remove', 'read', 'suspect']);
      expect(cells.map(c => c.querySelector('.md-badge')!.textContent)).toEqual(['Alterar', 'Criar', 'Remover', 'Só leitura', 'Suspeito']);
      expect(d.textContent).not.toMatch(/[\u270F\u2795\u26A0]|\u{1F5D1}|\u{1F441}/u);
    });

    it('emoji antes do rótulo (Causa raiz): ✅ **Confirmado:** / ❓ Hipótese: / **✅ Confirmado:**', () => {
      const d = doc(on('- ✅ **Confirmado:** o filtro zera\n- ❓ Hipótese: cache antigo\n- **✅ Confirmado:** outro'));
      const badges = [...d.querySelectorAll('li .md-badge')].map(b => b.textContent);
      expect(badges).toEqual(['Confirmado', 'Hipótese', 'Confirmado']);
      expect(d.textContent).not.toContain('✅');
      expect(d.textContent).not.toContain('❓');
      expect(d.querySelectorAll('li')[1].textContent).toBe('Hipótese cache antigo');
    });

    it('não mexe em emoji dentro de código', () => {
      expect(normalizeLegacyEmojis('<pre><code>✏️ alterar</code></pre>')).toBe('<pre><code>✏️ alterar</code></pre>');
      expect(on('`✅ Confirmado`')).toContain('<code>✅ Confirmado</code>');
      expect(on('⚠️ atenção ao deploy')).toContain('⚠️ atenção');
    });
  });

  describe('tabelas', () => {
    it('contêiner .md-table; coluna numérica só quando a 1ª coluna é só número', () => {
      expect(on('| # | A |\n|---|---|\n| 1 | x |\n| 2 | y |')).toContain('<div class="md-table md-table--num"><table>');
      expect(on('| A | B |\n|---|---|\n| x | 1 |')).toContain('<div class="md-table"><table>');
    });
  });

  describe('itens da engenharia reversa', () => {
    it('UC-121 e modulo#RN-012 viram link #re/ (o # do módulo codificado)', () => {
      const d = doc(card('Ver UC-121 e revamp-kaizen#RN-012, também `API-004`.'));
      const links = [...d.querySelectorAll<HTMLAnchorElement>('a.re-ref')];
      expect(links.map(a => a.getAttribute('href'))).toEqual(['#re/UC-121', '#re/revamp-kaizen%23RN-012', '#re/API-004']);
      expect(links.map(a => a.textContent)).toEqual(['UC-121', 'revamp-kaizen#RN-012', 'API-004']);
      expect(links[2].querySelector('code')).not.toBeNull();
      expect(parseReHref('#re/revamp-kaizen%23RN-012')).toBe('revamp-kaizen#RN-012');
      expect(parseReHref('#re/UC-121')).toBe('UC-121');
      expect(parseReHref('#ref/x')).toBeNull();
    });

    it('não linka em URL, bloco de código, link existente, palavra maior nem sem a opção', () => {
      const md = [
        'https://dev.azure.com/x/UC-121 e www.x.com/a?q=RN-012',
        '[UC-121](https://x.com) e XUC-121 e UC-12345 e uc-121 e #UC-121',
        '```',
        'UC-121',
        '```',
      ].join('\n');
      const d = doc(card(md));
      expect(d.querySelectorAll('a.re-ref').length).toBe(0);
      expect(on('UC-121')).not.toContain('re-ref');
      expect(card('**UC-121**')).toContain('<strong><a class="re-ref" href="#re/UC-121"');
    });

    it('linka dentro de tabelas e no meio do texto', () => {
      const d = doc(card('| Regra | Nota |\n|---|---|\n| RN-012 | ver TELA-3 |'));
      expect([...d.querySelectorAll('a.re-ref')].map(a => a.textContent)).toEqual(['RN-012', 'TELA-3']);
    });

    it('findReRefs/hasReRef', () => {
      expect(findReRefs('UC-1, revamp-x#RN-2 e https://a/UC-3')).toEqual(['UC-1', 'revamp-x#RN-2']);
      expect(hasReRef('ver GAP-7')).toBeTrue();
      expect(hasReRef('sem item')).toBeFalse();
    });
  });
});
