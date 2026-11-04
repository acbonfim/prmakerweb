import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, finalize, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { UsageTrackerService } from '../services/usage/usage-tracker.service';
import { describeEndpoint } from '../services/usage/usage-helpers';

/** Em andamento há mais que isto = "executando" na presença. */
const BUSY_AFTER_MS = 1_500;
/** Leitura que passa disto vira evento `slow`. */
const SLOW_READ_MS = 3_000;
const IGNORE = /\/(Usage|RealTime)\/|oauth\/login|RefreshToken|refresh-token/i;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Dados de uso (0079): ações (chamadas que alteram dados), erros e leituras lentas para a API e para a auth viram
 * eventos do lote; requisição demorada marca a aba como "executando" (com a área: IA, Plano de execução...). Não lê
 * corpo de requisição nem de resposta.
 */
@Injectable({ providedIn: 'root' })
export class UsageInterceptor implements HttpInterceptor {
  private readonly tracker = inject(UsageTrackerService);
  private readonly bases = [environment.apiUrl, environment.urlApiAuth].filter(Boolean) as string[];

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (IGNORE.test(req.url) || !this.bases.some((b) => req.url.startsWith(b))) return next.handle(req);

    const started = performance.now();
    const method = req.method.toUpperCase();
    const { area, name } = describeEndpoint(method, req.url, this.bases);
    let release: (() => void) | null = null;
    const busyTimer = setTimeout(() => {
      release = this.tracker.busy(`${area} (${method === 'GET' ? 'carregando' : 'processando'})`);
    }, BUSY_AFTER_MS);
    let status: number | null = null;
    let failed = false;

    return next.handle(req).pipe(
      tap({
        next: (event) => {
          if (event instanceof HttpResponse) status = event.status;
        },
        error: (err) => {
          failed = true;
          status = err instanceof HttpErrorResponse ? err.status : 0;
        },
      }),
      finalize(() => {
        clearTimeout(busyTimer);
        const release2 = release as (() => void) | null;
        release2?.();
        const duration = performance.now() - started;
        try {
          if (failed || (status != null && status >= 400)) {
            this.tracker.record('error', name, area, status, duration);
          } else if (MUTATING.has(method)) {
            this.tracker.record('action', name, area, status, duration);
          } else if (duration >= SLOW_READ_MS) {
            this.tracker.record('slow', name, area, status, duration);
          }
        } catch {
          /* telemetria nunca quebra a tela */
        }
      })
    );
  }
}
