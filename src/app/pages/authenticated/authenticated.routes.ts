import { Routes } from '@angular/router';
import {PageContainerComponent} from '../../components/page-container/page-container.component';
import {Component} from '@angular/core';
import {AuthGuard} from '../../auth/auth.guard';

export const AUTHENTICATED_ROUTES: Routes = [
  {
    path: '',
    component: PageContainerComponent,
    children: [
      {
        path: 'dashboard',
        canActivate: [AuthGuard],
        loadComponent: () => import('./home/home.component').then(m => m.HomeComponent)
      },
      {
        path: 'register',
        canActivate: [AuthGuard],
        loadComponent: () => import('./register/register.component').then(m => m.RegisterComponent)
      },
      {
        path: 'client-access',
        canActivate: [AuthGuard],
        loadComponent: () => import('./client-access/client-access.component').then(m => m.ClientAccessComponent)
      },
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      }
    ],
  }

];
