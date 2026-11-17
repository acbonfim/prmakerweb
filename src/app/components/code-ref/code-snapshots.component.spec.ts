import { codeRefIds } from './code-snapshots.component';

describe('codeRefIds (card 78505)', () => {
  it('lista as fotografias citadas, na ordem e sem repetir', () => {
    const md = 'Fluxo: [login.ts:10-20](ref:Login-Cookie) e [auth.ts:5](ref:auth-exp).\n\nDe novo [x](ref:login-cookie).';
    expect(codeRefIds(md)).toEqual(['login-cookie', 'auth-exp']);
  });

  it('ignora links que não são ref: e texto vazio', () => {
    expect(codeRefIds('[site](https://x.com) `ref:nada`')).toEqual([]);
    expect(codeRefIds(null)).toEqual([]);
  });
});
