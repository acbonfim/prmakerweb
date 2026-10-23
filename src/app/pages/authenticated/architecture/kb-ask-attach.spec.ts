import { DEFAULT_ATTACH_LIMITS, PendingAttachment, prepareAttachments, toRequest } from './kb-ask-attach';

const file = (content: BlobPart, name: string, type: string) => new File([content], name, { type });
const limits = { ...DEFAULT_ATTACH_LIMITS };

describe('kb-ask-attach (0072)', () => {
  it('arquivo de texto entra em base64 como text/plain, mesmo sem tipo informado (log)', async () => {
    const { added, errors } = await prepareAttachments([file('2026-10-23 ERRO timeout', 'app.log', '')], [], limits);
    expect(errors).toEqual([]);
    expect(added.length).toBe(1);
    expect(added[0].kind).toBe('text');
    expect(added[0].mediaType).toBe('text/plain');
    expect(atob(added[0].data)).toBe('2026-10-23 ERRO timeout');
    expect(toRequest(added[0])).toEqual({ name: 'app.log', mediaType: 'text/plain', data: added[0].data });
  });

  it('texto maior que o limite é cortado no começo, com aviso', async () => {
    const big = 'a'.repeat(limits.maxTextBytes + 500);
    const { added } = await prepareAttachments([file(big, 'grande.txt', 'text/plain')], [], limits);
    expect(added[0].size).toBe(limits.maxTextBytes);
    expect(added[0].note).toContain('primeiros');
  });

  it('PDF entra; PDF grande é recusado com o motivo', async () => {
    const ok = await prepareAttachments([file('%PDF-1.4 x', 'a.pdf', 'application/pdf')], [], limits);
    expect(ok.added[0].kind).toBe('pdf');
    expect(ok.added[0].mediaType).toBe('application/pdf');
    const tiny = { ...limits, maxPdfBytes: 4 };
    const bad = await prepareAttachments([file('%PDF-1.4 x', 'a.pdf', 'application/pdf')], [], tiny);
    expect(bad.added.length).toBe(0);
    expect(bad.errors[0]).toContain('PDF passa de');
  });

  it('tipo não aceito é recusado e o resto segue', async () => {
    const { added, errors } = await prepareAttachments([file('MZ', 'app.exe', 'application/x-msdownload'), file('ok', 'a.txt', 'text/plain'), file('<svg/>', 'a.svg', 'image/svg+xml')], [], limits);
    expect(added.map(a => a.name)).toEqual(['a.txt']);
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain('app.exe');
  });

  it('respeita o máximo de arquivos contando os já anexados', async () => {
    const current = Array.from({ length: limits.maxFiles - 1 }, (_, i) => ({ id: `${i}`, name: `${i}.txt`, mediaType: 'text/plain', kind: 'text', size: 1, data: 'eA==' } as PendingAttachment));
    const { added, errors } = await prepareAttachments([file('a', 'a.txt', 'text/plain'), file('b', 'b.txt', 'text/plain')], current, limits);
    expect(added.length).toBe(1);
    expect(errors[0]).toContain(`no máximo ${limits.maxFiles}`);
  });

  it('respeita o total de bytes', async () => {
    const small = { ...limits, maxTotalBytes: 10 };
    const { added, errors } = await prepareAttachments([file('123456', 'a.txt', 'text/plain'), file('123456', 'b.txt', 'text/plain')], [], small);
    expect(added.length).toBe(1);
    expect(errors[0]).toContain('no total');
  });

  it('imagem pequena segue como está; print colado ("image.png") ganha nome com hora', async () => {
    // PNG 1x1
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const { added, errors } = await prepareAttachments([file(png, 'image.png', 'image/png')], [], limits);
    expect(errors).toEqual([]);
    expect(added[0].kind).toBe('image');
    expect(added[0].mediaType).toBe('image/png');
    expect(added[0].name).toMatch(/^print-\d{6}\.png$/);
    expect(added[0].preview).toContain('blob:');
  });

  it('imagem grande (print 4K) é reduzida para JPEG com lado maior ≤ 1.500 px', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000; canvas.height = 1800;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#336'; ctx.fillRect(0, 0, 3000, 1800);
    ctx.fillStyle = '#fc0'; for (let i = 0; i < 60; i++) ctx.fillRect(i * 50, (i * 37) % 1700, 40, 90); // ruído para o PNG não ficar minúsculo
    const png = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
    const { added, errors } = await prepareAttachments([new File([png], 'tela.png', { type: 'image/png' })], [], limits);
    expect(errors).toEqual([]);
    expect(added[0].mediaType).toBe('image/jpeg');
    const bitmap = await createImageBitmap(await (await fetch(added[0].preview!)).blob());
    expect(Math.max(bitmap.width, bitmap.height)).toBe(1500);
    expect(bitmap.height).toBe(900);
  });
});
