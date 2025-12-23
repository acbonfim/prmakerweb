import { Routes } from '@angular/router';
import {Component} from '@angular/core';
import {AuthGuard} from '../../../auth/auth.guard';
import {PageContainerComponent} from '../../../components/page-container/page-container.component';

export const USER_ROUTES: Routes = [

      {
        path: 'user',
        canActivate: [AuthGuard],
        loadComponent: () => import('./user.component').then(m => m.UserComponent)
      },
      {
        path: 'manager',
        canActivate: [AuthGuard],
        loadComponent: () => import('./manager/manager.component').then(m => m.ManagerComponent)
      },
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      }

];
