import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, shareReplay, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AwsCardState, AwsDeployConfig, AwsRefresh } from '../components/aws-deploy/aws-deploy.model';

/** Erro da API da aba AWS com a mensagem para a tela; `noExecutor` = 409 NO_EXECUTOR (mostrar o comando manual). */
export class AwsDeployError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
  }
  get noExecutor(): boolean {
    return this.status === 409 && this.code === 'NO_EXECUTOR';
  }
}

/**
 * 0100: aba AWS da Bancada (`api/v1/AwsDeploy`). A API não fala com a AWS: ela guarda o retrato que a máquina coleta
 * (CLI da AWS, somente leitura) e enfileira o pedido de coleta para o executor de quem clicou em "Atualizar".
 */
@Injectable({ providedIn: 'root' })
export class AwsDeployService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}AwsDeploy`;
  private config$?: Observable<AwsDeployConfig>;

  /** Retrato do card + pedido de coleta ativo + se o executor de quem lê está ligado. */
  card(card: string | number): Observable<AwsCardState> {
    return this.http.get<AwsCardState>(`${this.apiUrl}/card/${this.key(card)}`)
      .pipe(this.fail('Não foi possível ler o retrato da AWS do card.'));
  }

  /** Pede a coleta ao executor de quem clicou; 409 NO_EXECUTOR → `AwsDeployError.noExecutor`. */
  refresh(card: string | number): Observable<AwsRefresh> {
    return this.http.post<AwsRefresh>(`${this.apiUrl}/card/${this.key(card)}/refresh`, {})
      .pipe(this.fail('Não foi possível pedir a coleta da AWS.'));
  }

  /** Ambientes configurados (ordem e rótulos); lido uma vez por sessão. */
  config(): Observable<AwsDeployConfig> {
    this.config$ ??= this.http.get<AwsDeployConfig>(`${this.apiUrl}/config`).pipe(
      this.fail('Não foi possível ler a configuração da aba AWS.'),
      catchError((err) => { this.config$ = undefined; return throwError(() => err); }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.config$;
  }

  private key(card: string | number): string {
    return encodeURIComponent(`${card}`.trim().replace(/^#/, ''));
  }

  private fail<T>(fallback: string) {
    return catchError<T, Observable<never>>((err) => throwError(() => toAwsDeployError(err, fallback)));
  }
}

export function toAwsDeployError(err: unknown, fallback: string): AwsDeployError {
  if (err instanceof AwsDeployError) return err;
  const http = err instanceof HttpErrorResponse ? err : null;
  const status = http?.status ?? 0;
  const body: any = http?.error;
  const code: string | null = body?.code ?? body?.extensions?.code ?? null;
  const text: string | null = (typeof body === 'string' && body) || body?.error || body?.message || body?.detail || null;
  if (status === 409 && code === 'NO_EXECUTOR') {
    return new AwsDeployError(text || 'Seu executor do PRMake não está ligado — rode a coleta pelo terminal.', status, code);
  }
  if (status === 0) return new AwsDeployError('Sem conexão com o PRMake.', status, code);
  return new AwsDeployError(text || fallback, status, code);
}
