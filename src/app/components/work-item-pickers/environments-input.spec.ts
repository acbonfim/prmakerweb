import { addEnvironments, customEnvironments, environmentLabel, hasEnvironment, joinEnvironments, splitEnvironments, toggleEnvironment } from './environments-input';

describe('0092 — campo de ambientes', () => {
  it('divide por vírgula/ponto-e-vírgula, sem vazios nem repetidos', () => {
    expect(splitEnvironments(' dev, qa;; DEV ,https://x.solvacelabs.com ')).toEqual(['dev', 'qa', 'https://x.solvacelabs.com']);
    expect(splitEnvironments(null)).toEqual([]);
    expect(joinEnvironments(['dev', ' qa ', 'dev'])).toBe('dev, qa');
  });

  it('liga e desliga mantendo a ordem', () => {
    expect(toggleEnvironment('dev', 'qa')).toBe('dev, qa');
    expect(toggleEnvironment('dev, qa, demo', 'QA')).toBe('dev, demo');
    expect(toggleEnvironment('', 'dev')).toBe('dev');
    expect(hasEnvironment('dev, qa', 'Qa')).toBeTrue();
    expect(hasEnvironment('dev', '')).toBeFalse();
  });

  it('acrescenta valor livre (nome ou URL)', () => {
    expect(addEnvironments('dev', 'https://gerdau.solvacelabs.com/, dev')).toBe('dev, https://gerdau.solvacelabs.com/');
    expect(addEnvironments('dev', '  ')).toBe('dev');
  });

  it('separa o que não é opção do catálogo e acha o rótulo', () => {
    const options = [{ value: 'dev', label: 'Desenvolvimento · devsp.solvacelabs.com' }, { value: 'qa', label: '' }];
    expect(customEnvironments('dev, sandboxrt, qa', options)).toEqual(['sandboxrt']);
    expect(environmentLabel('DEV', options)).toBe('Desenvolvimento · devsp.solvacelabs.com');
    expect(environmentLabel('qa', options)).toBe('qa');
    expect(environmentLabel('outro', options)).toBe('outro');
  });
});
