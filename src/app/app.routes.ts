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
