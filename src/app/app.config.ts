import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import {HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi} from '@angular/common/http';
import {provideAnimationsAsync} from '@angular/platform-browser/animations/async';
import {providePrimeNG} from 'primeng/config';

import Aura from '@primeuix/themes/aura';
import {AuthInterceptor} from './auth/auth.interceptor';
import {PersonalIntegrationInterceptor} from './auth/personal-integration.interceptor';
import {provideServiceWorker} from '@angular/service-worker';
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
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
    // PWA (feature 0019): app instalável e aviso de versão nova; desligado no `ng serve`.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ]
};
