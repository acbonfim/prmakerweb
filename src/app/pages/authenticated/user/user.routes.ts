import { Routes } from '@angular/router';
import {Component} from '@angular/core';
import {AuthGuard} from '../../../auth/auth.guard';
import {AdminGuard} from '../../../auth/admin.guard';
import {PageContainerComponent} from '../../../components/page-container/page-container.component';

export const USER_ROUTES: Routes = [

      {
        path: 'user',
        canActivate: [AuthGuard],
        loadComponent: () => import('./user.component').then(m => m.UserComponent)
      },
      {
        path: 'manager',
        canActivate: [AuthGuard, AdminGuard],
        loadComponent: () => import('./manager/manager.component').then(m => m.ManagerComponent)
      },
      {
        // Dados de uso (0079): quem está online, indicadores, gráficos e tabelas de logins/sessões/eventos.
        path: 'usage',
        data: { tab: { title: 'Análise de uso', icon: 'insights' } },
        canActivate: [AuthGuard, AdminGuard],
        loadComponent: () => import('./usage/usage-analytics.component').then(m => m.UsageAnalyticsComponent)
      },
      {
        path: '',
        // Absoluto (0043): relativo ia para /auth/user/dashboard, que não existe.
        redirectTo: '/auth/dashboard',
        pathMatch: 'full'
      }

];
