import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { StorageService } from '../../../services/storage.service';
import { VacationService } from '../../../services/vacation.service';
import { VacationBalance } from '../vacations/models/vacation.model';

interface QuickAccessCard {
  title: string;
  description: string;
  icon: string;
  route: string;
  color: string;
  bgColor: string;
  adminOnly?: boolean;
  badge?: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
  ],
})
export class HomeComponent implements OnInit {
  private router = inject(Router);
  private storageService = inject(StorageService);
  private vacationService = inject(VacationService);
  private cdr = inject(ChangeDetectorRef);

  currentUser: any = null;
  isManager = false;
  greeting = '';
  currentDate = '';
  activeBalances: VacationBalance[] = [];
  isLoadingBalance = false;

  readonly allCards: QuickAccessCard[] = [
    {
      title: 'Pull Requests',
      description: 'Gere descrições completas de PR com análise de causa raiz e integração com IA.',
      icon: 'merge_type',
      route: '/auth/register',
      color: '#1565c0',
      bgColor: '#e3f2fd',
    },
    {
      title: 'Ambientes Clientes',
      description: 'Visualize e gerencie ambientes de implantação e acessos dos clientes.',
      icon: 'cloud',
      route: '/auth/client-access',
      color: '#00695c',
      bgColor: '#e0f2f1',
    },
    {
      title: 'Férias',
      description: 'Solicite férias, acompanhe o calendário da equipe e gerencie períodos.',
      icon: 'beach_access',
      route: '/auth/vacations',
      color: '#e65100',
      bgColor: '#fff3e0',
    },
    {
      title: 'Meus Períodos',
      description: 'Consulte seus períodos aquisitivos, dias disponíveis e utilizados.',
      icon: 'event_available',
      route: '/auth/vacation-balances',
      color: '#2e7d32',
      bgColor: '#e8f5e9',
    },
    {
      title: 'Plugins',
      description: 'Instale e configure plugins para ampliar as capacidades da plataforma.',
      icon: 'extension',
      route: '/auth/plugin-manager',
      color: '#4527a0',
      bgColor: '#ede7f6',
    },
    {
      title: 'Aprovar Férias',
      description: 'Revise, aprove e autorize solicitações de férias da sua equipe.',
      icon: 'verified',
      route: '/auth/vacation-approvals',
      color: '#6a1b9a',
      bgColor: '#f3e5f5',
      adminOnly: true,
    },
    {
      title: 'Gestão de Usuários',
      description: 'Gerencie usuários, atribua roles e controle permissões de acesso.',
      icon: 'manage_accounts',
      route: '/auth/user/manager',
      color: '#37474f',
      bgColor: '#eceff1',
      adminOnly: true,
    },
  ];

  get visibleCards(): QuickAccessCard[] {
    return this.allCards.filter(c => !c.adminOnly || this.isManager);
  }

  get totalAvailable(): number {
    return this.activeBalances.reduce((s, b) => s + b.availableDays, 0);
  }

  get totalUsed(): number {
    return this.activeBalances.reduce((s, b) => s + b.usedDays, 0);
  }

  get totalRemaining(): number {
    return this.activeBalances.reduce((s, b) => s + b.remainingDays, 0);
  }

  ngOnInit() {
    this.currentUser = this.storageService.getAccess()?.user;
    this.checkRole();
    this.buildGreeting();
    this.loadVacationBalance();
  }

  private checkRole() {
    const token = this.storageService.getItem('apiKey');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const roles = Array.isArray(payload.role) ? payload.role : [payload.role];
        this.isManager = roles.includes('gestor') || roles.includes('admin');
      } catch {}
    }
  }

  private buildGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) this.greeting = 'Bom dia';
    else if (hour < 18) this.greeting = 'Boa tarde';
    else this.greeting = 'Boa noite';

    this.currentDate = new Date().toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    // capitalize first letter
    this.currentDate = this.currentDate.charAt(0).toUpperCase() + this.currentDate.slice(1);
  }

  private loadVacationBalance() {
    this.isLoadingBalance = true;
    this.vacationService.getMyBalances().subscribe({
      next: (balances) => {
        this.activeBalances = balances.filter(b => b.isActive);
        this.isLoadingBalance = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoadingBalance = false;
      },
    });
  }

  navigate(route: string) {
    this.router.navigateByUrl(route);
  }

  get firstName(): string {
    const full: string = this.currentUser?.fullName || this.currentUser?.fullName || '';
    return full.split(' ')[0] || 'usuário';
  }
}
