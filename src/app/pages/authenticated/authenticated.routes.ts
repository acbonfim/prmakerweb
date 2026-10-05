import { Routes } from '@angular/router';
import {PageContainerComponent} from '../../components/page-container/page-container.component';
import {Component} from '@angular/core';
import {AuthGuard} from '../../auth/auth.guard';
import {AdminGuard} from '../../auth/admin.guard';

export const AUTHENTICATED_ROUTES: Routes = [
  {
    path: '',
    component: PageContainerComponent,
    children: [
      {
        path: 'dashboard',
        data: { tab: { title: 'Início', icon: 'home' } },
        canActivate: [AuthGuard],
        loadComponent: () => import('./home/home.component').then(m => m.HomeComponent)
      },
      {
        path: 'register',
        data: { tab: { title: 'Pull Request', icon: 'merge', card: true } },
        canActivate: [AuthGuard],
        loadComponent: () => import('./register/register.component').then(m => m.RegisterComponent)
      },
      {
        path: 'client-access',
        data: { tab: { title: 'Acesso de clientes', icon: 'vpn_key' } },
        canActivate: [AuthGuard],
        loadComponent: () => import('./client-access/client-access.component').then(m => m.ClientAccessComponent)
      },
      {
        path: 'user',
        data: { tab: { title: 'Usuários', icon: 'manage_accounts' } },
        loadChildren: () => import('./user/user.routes').then(m => m.USER_ROUTES)
      },
      {
        path: 'services',
        data: { tab: { title: 'Serviços', icon: 'lan' } },
        canActivate: [AuthGuard, AdminGuard],
        loadComponent: () => import('./services/services.component').then(m => m.ServicesComponent)
      },
      {
        path: 'plugin-manager',
        data: { tab: { title: 'Plugins', icon: 'hub' } },
        canActivate: [AuthGuard, AdminGuard],
        loadComponent: () => import('./plugin/plugin.component').then(m => m.PluginComponent)
      },
      {
        path: 'reverse-engineering',
        data: { tab: { title: 'Engenharia reversa', icon: 'biotech' } },
        canActivate: [AuthGuard],
        loadComponent: () => import('./reverse-engineering/reverse-engineering.component').then(m => m.ReverseEngineeringComponent)
      },
      {
        path: 'architecture',
        data: { tab: { title: 'Base Solvace', icon: 'account_tree' } },
        canActivate: [AuthGuard],
        loadComponent: () => import('./architecture/architecture.component').then(m => m.ArchitectureComponent)
      },
      {
        path: 'vacations',
        data: { tab: { title: 'Férias', icon: 'beach_access' } },
        canActivate: [AuthGuard],
        loadComponent: () => import('./vacations/vacations.component').then(m => m.VacationsComponent)
      },
      {
        path: 'vacation-balances',
        data: { tab: { title: 'Meus períodos', icon: 'event_available' } },
        canActivate: [AuthGuard],
        loadComponent: () => import('./vacations/vacation-balances.component').then(m => m.VacationBalancesComponent)
      },
      {
        path: 'vacation-approvals',
        data: { tab: { title: 'Aprovar férias', icon: 'assignment_turned_in' } },
        canActivate: [AuthGuard],
        loadComponent: () => import('./vacations/vacation-approvals.component').then(m => m.VacationApprovalsComponent)
      },
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      }
    ],
  }

];
