import { highlightLine, highlightLines, normalizeLanguage } from './code-highlight';

/** Texto visível do HTML gerado (desfaz o escape) — tem que ser igual ao código original. */
function textOf(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
}

/** Só <span class="hl-*"> pode sair como tag. */
function onlySpans(html: string): boolean {
  const div = document.createElement('div');
  div.innerHTML = html;
  return [...div.querySelectorAll('*')].every(el => el.tagName === 'SPAN' && /^hl-[a-z]$/.test(el.className));
}

describe('code-highlight (0075/F2)', () => {
  it('escapa HTML: <script> no código nunca vira tag (em todas as linguagens)', () => {
    const evil = `<script>alert("x")</script><img src=x onerror=alert(1)> & 'q'`;
    for (const lang of ['csharp', 'typescript', 'javascript', 'html', 'asp', 'sql', 'css', 'json', 'java', 'python', 'bash', 'vb', 'plain']) {
      const html = highlightLine(evil, lang);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img');
      expect(onlySpans(html)).withContext(lang).toBeTrue();
      expect(textOf(html)).withContext(lang).toBe(evil);
    }
  });

  it('mantém o texto exato (só acrescenta spans)', () => {
    const lines = [
      'public async Task<int> Run(string name = "a\\"b") { // comentário',
      '  var x = 0x1F + 3.5e2; /* bloco',
      '  ainda no bloco */ return x;',
      '}',
    ];
    const html = highlightLines(lines, 'csharp');
    expect(html.map(textOf)).toEqual(lines);
  });

  it('destaca palavras-chave, strings, números e comentários', () => {
    const html = highlightLine('if (x == 10) return "ok"; // fim', 'typescript');
    expect(html).toContain('<span class="hl-k">if</span>');
    expect(html).toContain('<span class="hl-k">return</span>');
    expect(html).toContain('<span class="hl-n">10</span>');
    expect(html).toContain('<span class="hl-s">&quot;ok&quot;</span>');
    expect(html).toContain('<span class="hl-c">// fim</span>');
  });

  it('comentário de bloco passa para a linha seguinte', () => {
    const [a, b, c] = highlightLines(['x = 1; /* começa', 'meio if return', 'fim */ if'], 'javascript');
    expect(a).toContain('<span class="hl-c">/*');
    expect(b).toBe('<span class="hl-c">meio if return</span>');
    expect(c).toContain('<span class="hl-c">fim */</span>');
    expect(c).toContain('<span class="hl-k">if</span>');
  });

  it('SQL: sem diferenciar maiúsculas, -- comentário e aspas dobradas', () => {
    const html = highlightLine("SELECT nome FROM t WHERE x = 'it''s' -- obs", 'sql');
    expect(html).toContain('<span class="hl-k">SELECT</span>');
    expect(html).toContain('<span class="hl-k">WHERE</span>');
    expect(html).toContain('<span class="hl-s">&#39;it&#39;&#39;s&#39;</span>');
    expect(html).toContain('<span class="hl-c">-- obs</span>');
  });

  it('ASP: HTML fora, VBScript dentro de <% %> (inclusive em atributo)', () => {
    const line = `<input value="<%= Request("q") %>"> <% If x Then ' nota %>`;
    const html = highlightLine(line, 'asp');
    expect(textOf(html)).toBe(line);
    expect(html).toContain('<span class="hl-t">&lt;input</span>');
    expect(html).toContain('<span class="hl-d">&lt;%=</span>');
    expect(html).toContain('<span class="hl-k">Request</span>');
    expect(html).toContain('<span class="hl-k">If</span>');
    expect(html).toContain('<span class="hl-c">&#39; nota </span>');
    expect(onlySpans(html)).toBeTrue();
  });

  it('HTML: tag aberta em uma linha continua na outra', () => {
    const [a, b] = highlightLines(['<div class="a"', '     id="b">texto</div>'], 'html');
    expect(a).toContain('<span class="hl-a">class</span>');
    expect(b).toContain('<span class="hl-a">id</span>');
    expect(textOf(b)).toBe('     id="b">texto</div>');
  });

  it('HTML/ASP: JS dentro de <script> e CSS dentro de <style> também ganham destaque', () => {
    const lines = ['<script type="text/javascript">', '  if (x) { return "a"; } // nota', '</script><style>', 'a { color: red; }', '</style>'];
    const html = highlightLines(lines, 'asp');
    expect(html.map(textOf)).toEqual(lines);
    expect(html[1]).toContain('<span class="hl-k">if</span>');
    expect(html[1]).toContain('<span class="hl-c">// nota</span>');
    expect(html[2]).toContain('<span class="hl-t">&lt;/script</span>');
    expect(html[3]).toContain('<span class="hl-a">color</span>');
    // depois do </script> volta a ser HTML: "if" não é palavra-chave
    expect(highlightLines(['<script>', '</script>', 'if'], 'html')[2]).toBe('if');
  });

  it('linguagem pelo nome ou pela extensão', () => {
    expect(normalizeLanguage('csharp')).toBe('csharp');
    expect(normalizeLanguage(null, 'a/b/sa3_busca_a3.asp')).toBe('asp');
    expect(normalizeLanguage('', 'x/loadSelectOptions.class.js')).toBe('javascript');
    expect(normalizeLanguage('vbnet')).toBe('vb');
    expect(normalizeLanguage(undefined, 'README')).toBe('plain');
  });
});
