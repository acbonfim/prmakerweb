import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then(m => m.Login)
  },
  {
    path: 'auth',
    loadChildren: () => import('./pages/authenticated/authenticated.routes').then(m => m.AUTHENTICATED_ROUTES)
  },
  {
    // Link público (somente leitura) da passagem de conhecimento, acessível sem login.
    // Tela cheia, sem menus/topbar. A URL termina com o número do card.
    path: 'handover/:cardNumber',
    loadComponent: () => import('./pages/public/handover-view/handover-view.component').then(m => m.HandoverViewComponent)
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: 'auth/dashboard',
    pathMatch: 'full'
  }
];
