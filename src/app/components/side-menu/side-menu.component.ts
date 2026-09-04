import {Component, EventEmitter, inject, Input, OnInit, Output} from '@angular/core';
import {CommonModule} from '@angular/common';
import {MatListModule} from '@angular/material/list';
import {MatIconModule} from '@angular/material/icon';
import {NavigationEnd, Router, RouterLink} from '@angular/router';
import {MatDialog} from '@angular/material/dialog';
import {filter} from 'rxjs';
import {StorageService} from '../../services/storage.service';

@Component({
  selector: 'app-side-menu',
  templateUrl: './side-menu.component.html',
  styleUrls: ['./side-menu.component.css'],
  imports: [CommonModule, MatListModule, MatIconModule],
  standalone: true,
})
export class SideMenuComponent implements OnInit {

  @Input() isCollapsed: boolean = false;
  @Output() toggleSidebar = new EventEmitter<void>();
  readonly router = inject(Router);
  private storageService = inject(StorageService);

  currentRoute: string = '';
  private userRoles: string[] = [];

  menu: { label: string; icon: string; link: string; allowedRoles?: string[] }[] = [
    {
      label: 'Início',
      icon: 'home',
      link: 'auth/home'
    },
    {
      label: 'Pull Requests',
      icon: 'merge',
      link: 'auth/register'
    },
    {
      label: 'Ambientes clientes',
      icon: 'language',
      link: 'auth/client-access'
    },
    {
      label: 'Gestão de usuários',
      icon: 'manage_accounts',
      link: 'auth/user/manager'
    },
    {
      label: 'Serviços',
      icon: 'lan',
      link: 'auth/services'
    },
    {
      label: 'Plugins',
      icon: 'hub',
      link: 'auth/plugin-manager'
    },
    {
      label: 'Férias',
      icon: 'beach_access',
      link: 'auth/vacations'
    },
    {
      label: 'Meus Períodos',
      icon: 'event_available',
      link: 'auth/vacation-balances'
    },
    {
      label: 'Aprovar Férias',
      icon: 'assignment_turned_in',
      link: 'auth/vacation-approvals',
      allowedRoles: ['admin', 'gestor']
    },
  ]

  constructor() {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.currentRoute = event.url;
      });

    this.currentRoute = this.router.url;
  }

  ngOnInit() {
    this.loadUserRoles();
  }

  private loadUserRoles() {
    const token = this.storageService.getItem('apiKey');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const roleKey = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';
        const rawRoles = payload[roleKey] ?? payload['role'];
        this.userRoles = Array.isArray(rawRoles) ? rawRoles : (rawRoles ? [rawRoles] : []);
      } catch {
        this.userRoles = [];
      }
    }
  }

  isMenuItemVisible(item: { allowedRoles?: string[] }): boolean {
    if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
    return item.allowedRoles.some(role => this.userRoles.includes(role));
  }


  isActiveRoute(link: string): boolean {
    return this.currentRoute === ('/' + link) || this.currentRoute.startsWith(link + '/');
  }

  navigateTo(link: string) {
    this.router.navigate([link]);
  }
}
