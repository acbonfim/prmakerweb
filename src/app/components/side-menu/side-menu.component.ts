import {Component, EventEmitter, inject, Input, Output} from '@angular/core';
import {CommonModule} from '@angular/common';
import {MatListModule} from '@angular/material/list';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {NavigationEnd, Router, RouterLink} from '@angular/router';
import {MatDialog} from '@angular/material/dialog';
import {filter} from 'rxjs';
import {RoleService} from '../../services/role.service';
import {RoleAccess} from '../../services/role.logic';

@Component({
  selector: 'app-side-menu',
  templateUrl: './side-menu.component.html',
  styleUrls: ['./side-menu.component.css'],
  imports: [CommonModule, MatListModule, MatIconModule, MatTooltipModule],
  standalone: true,
})
export class SideMenuComponent {

  @Input() isCollapsed: boolean = false;
  @Output() toggleSidebar = new EventEmitter<void>();
  readonly router = inject(Router);
  private roles = inject(RoleService);

  currentRoute: string = '';
  // allowedRoles = precisa de um destes papéis; access = regra nomeada do RoleService (0099 ajustes 2).
  menu: { label: string; icon: string; link: string; allowedRoles?: string[]; access?: RoleAccess }[] = [
    {
      label: 'Início',
      icon: 'home',
      link: 'auth/dashboard',
      // Management sem papel de dev começa na Mesa (a rota redireciona).
      access: 'not-management-only'
    },
    {
      label: 'Bancada',
      icon: 'handyman',
      link: 'auth/workbench',
      // 0099 (ajustes 2): management sem papel de dev não acessa a Bancada.
      access: 'workbench'
    },
    {
      // 0099: Mesa de gestão — épicos, tarefas administrativas e os cards do DevOps (par da Bancada).
      label: 'Gestão',
      icon: 'space_dashboard',
      link: 'auth/desk',
      // 0099 (ajustes 2): só admin ou management.
      access: 'desk'
    },
    // Tela de Pull Request desativada (o card é tratado na Bancada) — reativar junto com a rota em authenticated.routes.
    // {
    //   label: 'Pull Requests',
    //   icon: 'merge',
    //   link: 'auth/register'
    // },
    {
      label: 'Promoção de PRs',
      icon: 'rocket_launch',
      link: 'auth/promotions',
      allowedRoles: ['admin', 'support']
    },
    {
      label: 'Base Solvace',
      icon: 'account_tree',
      link: 'auth/architecture'
    },
    {
      label: 'Engenharia reversa',
      icon: 'biotech',
      // 0097: todos leem a engenharia reversa (gerar e aprovar continuam restritos dentro da tela).
      link: 'auth/reverse-engineering'
    },
    {
      label: 'Gestão de usuários',
      icon: 'manage_accounts',
      link: 'auth/user/manager',
      allowedRoles: ['admin']
    },
    {
      label: 'Análise de uso',
      icon: 'insights',
      link: 'auth/user/usage',
      allowedRoles: ['admin']
    },
    {
      // 0098: governança do PRMake (trilha, métricas, regras, hooks).
      label: 'Governança',
      icon: 'policy',
      link: 'auth/governance',
      allowedRoles: ['admin']
    },
    {
      label: 'Serviços',
      icon: 'lan',
      link: 'auth/services',
      allowedRoles: ['admin']
    },
    {
      label: 'Configurações',
      icon: 'tune',
      link: 'auth/plugin-manager',
      allowedRoles: ['admin']
    },
    // ── Férias (DESATIVADO) — itens e rotas escondidos. Para reativar, descomente aqui e as rotas em authenticated.routes.ts:
    // { label: 'Férias', icon: 'beach_access', link: 'auth/vacations' },
    // { label: 'Meus Períodos', icon: 'event_available', link: 'auth/vacation-balances' },
    // { label: 'Aprovar Férias', icon: 'assignment_turned_in', link: 'auth/vacation-approvals', allowedRoles: ['admin', 'gestor'] },
  ]

  constructor() {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.currentRoute = event.url;
      });

    this.currentRoute = this.router.url;
  }

  isMenuItemVisible(item: { allowedRoles?: string[]; access?: RoleAccess }): boolean {
    if (item.access && !this.roles.allows(item.access)) return false;
    if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
    return this.roles.has(...item.allowedRoles);
  }


  isActiveRoute(link: string): boolean {
    // Sem a query (a tela de PR guarda o card na URL, 0043).
    const path = this.currentRoute.split(/[?#]/)[0];
    return path === ('/' + link) || path.startsWith('/' + link + '/');
  }

  navigateTo(link: string) {
    this.router.navigate([link]);
  }
}
