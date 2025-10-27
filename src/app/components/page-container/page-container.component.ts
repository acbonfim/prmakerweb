import { Component, OnInit } from '@angular/core';
import {SideMenuComponent} from '../side-menu/side-menu.component';
import {Router, RouterModule, RouterOutlet} from '@angular/router';
import {TopMenuComponent} from '../top-menu/top-menu.component';
import {CommonModule} from '@angular/common';

@Component({
  selector: 'app-page-container',
  templateUrl: './page-container.component.html',
  styleUrls: ['./page-container.component.css'],
  imports: [SideMenuComponent,
    RouterModule,
    RouterOutlet,
    TopMenuComponent,
    CommonModule,
  ]
})
export class PageContainerComponent implements OnInit {
  isSidebarCollapsed = true;
  constructor() { }

  ngOnInit() {
  }

  toggleSidebar() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }

  setSidebarState(collapsed: boolean) {
    this.isSidebarCollapsed = collapsed;
  }



}
