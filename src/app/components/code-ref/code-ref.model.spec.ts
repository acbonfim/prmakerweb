import { citationHref } from '../../helpers/markdown-ext';
import { CodeRefHead, citationMatches, matchCitation, noteMarker, parseCodeHref } from './code-ref.model';

const head = (ref: string, path: string, startLine: number, endLine: number, repository: string | null = null): CodeRefHead => ({
  id: ref, planId: 'p', ref, repository, path, startLine, endLine, change: 'change', title: null, commitSha: null,
  hasProposal: false, hasImplemented: false, updatedAt: '2026-11-04T00:00:00Z',
});

describe('code-ref.model (0075/F2)', () => {
  describe('citationMatches (mesma regra do back)', () => {
    const h = head('sa3-init', 'systems/sa3/sa3_busca_a3.asp', 239, 289, 'solvace-asp');

    it('caminho igual, fim do caminho ou repositório/caminho — sem diferenciar maiúsculas', () => {
      expect(citationMatches(h, 'systems/sa3/sa3_busca_a3.asp', 239, 289)).toBeTrue();
      expect(citationMatches(h, 'sa3_busca_a3.asp', 250, 250)).toBeTrue();
      expect(citationMatches(h, 'SA3/SA3_BUSCA_A3.ASP', 250, 260)).toBeTrue();
      expect(citationMatches(h, 'solvace-asp/systems/sa3/sa3_busca_a3.asp', 239, 289)).toBeTrue();
      expect(citationMatches(h, '/systems/sa3/sa3_busca_a3.asp', 239, 239)).toBeTrue();
    });

    it('pedaço de nome não casa; linhas sem sobreposição não casam', () => {
      expect(citationMatches(h, 'busca_a3.asp', 250, 250)).toBeFalse();
      expect(citationMatches(h, 'sa3_busca_a3.asp', 290, 300)).toBeFalse();
      expect(citationMatches(h, 'sa3_busca_a3.asp', 1, 238)).toBeFalse();
      expect(citationMatches(h, 'sa3_busca_a3.asp', 1, 239)).toBeTrue();
      expect(citationMatches(h, 'outro-repo/systems/sa3/sa3_busca_a3.asp', 239, 289)).toBeFalse();
    });
  });

  describe('matchCitation', () => {
    it('prefere a ref de foco mais próximo/menor', () => {
      const heads = [
        head('largo', 'js/loadSelectOptions.class.js', 300, 400),
        head('restore-date', 'js/loadSelectOptions.class.js', 336, 353),
        head('outro', 'js/other.js', 336, 353),
      ];
      expect(matchCitation(heads, 'loadSelectOptions.class.js', 336, 353)?.ref).toBe('restore-date');
      expect(matchCitation(heads, 'loadSelectOptions.class.js', 380, 390)?.ref).toBe('largo');
      expect(matchCitation(heads, 'loadSelectOptions.class.js', 10, 20)).toBeNull();
      expect(matchCitation([], 'x.js', 1, 1)).toBeNull();
      expect(matchCitation(null, 'x.js', 1, 1)).toBeNull();
    });

    it('os três exemplos do item 1.6', () => {
      const heads = [
        head('sa3-init', 'systems/sa3/sa3_busca_a3.asp', 239, 289, 'solvace-asp'),
        head('restore-date', 'view_shared/wwwroot/js/loadSelectOptions.class.js', 336, 353, 'solvace-core'),
        head('drp-ctor', 'view_shared/wwwroot/templates/limitlessfull/js/plugins/pickers/daterangepicker.js', 320, 330, 'solvace-core'),
      ];
      expect(matchCitation(heads, 'solvace-asp/systems/sa3/sa3_busca_a3.asp', 239, 289)?.ref).toBe('sa3-init');
      expect(matchCitation(heads, 'solvace-core/view_shared/wwwroot/js/loadSelectOptions.class.js', 336, 353)?.ref).toBe('restore-date');
      expect(matchCitation(heads, 'solvace-core/view_shared/wwwroot/templates/limitlessfull/js/plugins/pickers/daterangepicker.js', 325, 325)?.ref)
        .toBe('drp-ctor');
    });
  });

  describe('parseCodeHref', () => {
    it('ref e citação (o mesmo href que a F1 gera)', () => {
      expect(parseCodeHref('#ref/sa3-init')).toEqual({ kind: 'ref', id: 'sa3-init' });
      const href = citationHref({ path: 'solvace-core/a b/x.js', start: 336, end: 353 });
      expect(parseCodeHref(href)).toEqual({ kind: 'cite', path: 'solvace-core/a b/x.js', start: 336, end: 353 });
      expect(parseCodeHref('#cite/x.js:9')).toEqual({ kind: 'cite', path: 'x.js', start: 9, end: 9 });
      expect(parseCodeHref('https://x.com')).toBeNull();
      expect(parseCodeHref('#cite/semlinha')).toBeNull();
    });
  });

  it('marcadores ①②… e depois (21)', () => {
    expect(noteMarker(0)).toBe('①');
    expect(noteMarker(2)).toBe('③');
    expect(noteMarker(19)).toBe('⑳');
    expect(noteMarker(20)).toBe('(21)');
  });
});
