import {Component, EventEmitter, inject, Input, OnInit, Output} from '@angular/core';
import {CommonModule} from '@angular/common';
import {MatListModule} from '@angular/material/list';
import {MatIconModule} from '@angular/material/icon';
import {NavigationEnd, Router, RouterLink} from '@angular/router';
import {MatDialog} from '@angular/material/dialog';
import {filter} from 'rxjs';

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

  currentRoute: string = '';

  menu = [
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
  }


  isActiveRoute(link: string): boolean {
    return this.currentRoute === ('/' + link) || this.currentRoute.startsWith(link + '/');
  }

  navigateTo(link: string) {
    this.router.navigate([link]);
  }
}
