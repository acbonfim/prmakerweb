import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { RouteReuseStrategy, provideRouter } from '@angular/router';
import {TabRouteReuseStrategy} from './services/tab-route-reuse.strategy';

import { routes } from './app.routes';
import {HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi} from '@angular/common/http';
import {provideAnimationsAsync} from '@angular/platform-browser/animations/async';
import {providePrimeNG} from 'primeng/config';

import Aura from '@primeuix/themes/aura';
import {AuthInterceptor} from './auth/auth.interceptor';
import {PersonalIntegrationInterceptor} from './auth/personal-integration.interceptor';
import {AiUsageInterceptor} from './auth/ai-usage.interceptor';
import {provideServiceWorker} from '@angular/service-worker';
import {MAT_TOOLTIP_DEFAULT_OPTIONS, MatTooltipDefaultOptions} from '@angular/material/tooltip';
import {MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig} from '@angular/material/dialog';
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // Abas internas (0065): guarda/reanexa a tela de cada aba.
    { provide: RouteReuseStrategy, useClass: TabRouteReuseStrategy },
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura
      }
    }),
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true,
    },
    {
      // 403 de integração pessoal pendente → aviso + "Minhas integrações" (feature 0002).
      provide: HTTP_INTERCEPTORS,
      useClass: PersonalIntegrationInterceptor,
      multi: true
    },
    {
      // Resposta com X-AI-Usage → aviso com os tokens e o custo estimado da ação de IA (0042).
      provide: HTTP_INTERCEPTORS,
      useClass: AiUsageInterceptor,
      multi: true
    },
    {
      // Celular (0043): o tooltip com gestos de toque põe `touch-action: none` no elemento e trava a
      // rolagem quando o dedo começa em cima dele (ex.: as etapas do plano). No toque não há tooltip;
      // o conteúdo dele fica acessível na própria tela (ex.: abrir a etapa).
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      useValue: {showDelay: 0, hideDelay: 0, touchendHideDelay: 1500, touchGestures: 'off'} satisfies MatTooltipDefaultOptions
    },
    {
      // 0043: o voltar do sistema fecha só o diálogo do topo (BackNavigationService), não todos.
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: {...new MatDialogConfig(), closeOnNavigation: false}
    },
    // PWA (feature 0019): app instalável e aviso de versão nova; desligado no `ng serve`.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ]
};
