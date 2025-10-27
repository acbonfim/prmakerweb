import { Routes } from '@angular/router';
import RegisterComponent from './pages/register/register.component';
import { HomeComponent } from './pages/home/home.component';
import { ClientAccessComponent } from './pages/client-access/client-access.component';

export const routes: Routes = [
  {
    path: 'register', component: RegisterComponent
  },
  {
    path: '', redirectTo: 'register', pathMatch: 'full'
  },
  {
    path: 'home', component: HomeComponent
  },
  {
    path: 'client-access', component: ClientAccessComponent
  },
];
