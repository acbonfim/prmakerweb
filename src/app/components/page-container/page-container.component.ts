import {afterNextRender, Component, DestroyRef, ElementRef, HostListener, inject, signal, viewChild} from '@angular/core';
import {SideMenuComponent} from '../side-menu/side-menu.component';
import {NavigationEnd, Router, RouterModule, RouterOutlet} from '@angular/router';
import {TopMenuComponent} from '../top-menu/top-menu.component';
import {CommonModule} from '@angular/common';
import {filter} from 'rxjs';
import {BackNavigationService} from '../../services/back-navigation.service';
import {TabsService} from '../../services/tabs.service';
import {TabBarComponent} from '../tab-bar/tab-bar.component';

/** Até aqui o menu é uma gaveta por cima do conteúdo (0043); acima, a coluna lateral de sempre. */
const COMPACT_QUERY = '(max-width: 768px)';

@Component({
  selector: 'app-page-container',
  templateUrl: './page-container.component.html',
  styleUrls: ['./page-container.component.css'],
  standalone: true,
  imports: [SideMenuComponent,
    RouterModule,
    RouterOutlet,
    TopMenuComponent,
    CommonModule,
    TabBarComponent,
  ]
})
export class PageContainerComponent {
  private readonly back = inject(BackNavigationService);
  private readonly tabs = inject(TabsService);
  private readonly media = window.matchMedia(COMPACT_QUERY);
  private readonly contentArea = viewChild<ElementRef<HTMLElement>>('contentArea');

  /** Desktop: menu recolhido (trilho de ícones) ou expandido. */
  isSidebarCollapsed = true;
  readonly compact = signal(this.media.matches);
  readonly drawerOpen = signal(false);
  private releaseDrawer?: () => void;

  constructor() {
    // Abas internas (0065): restaura/sincroniza as abas do usuário a cada navegação da área logada.
    this.tabs.start(inject(DestroyRef));
    afterNextRender(() => this.tabs.registerScrollHost(this.contentArea()?.nativeElement));

    const onMedia = (e: MediaQueryListEvent) => {
      this.compact.set(e.matches);
      if (!e.matches) this.closeDrawer();
    };
    this.media.addEventListener('change', onMedia);

    // Escolheu uma tela no menu (ou veio de outro lugar): a gaveta recolhe sozinha.
    const sub = inject(Router).events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.closeDrawer());

    inject(DestroyRef).onDestroy(() => {
      this.media.removeEventListener('change', onMedia);
      sub.unsubscribe();
      this.closeDrawer();
    });
  }

  toggleSidebar() {
    if (!this.compact()) {
      this.isSidebarCollapsed = !this.isSidebarCollapsed;
    } else if (this.drawerOpen()) {
      this.closeDrawer();
    } else {
      this.drawerOpen.set(true);
      this.releaseDrawer = this.back.push(() => this.closeDrawer());
    }
  }

  setSidebarState(collapsed: boolean) {
    this.isSidebarCollapsed = collapsed;
  }

  closeDrawer() {
    if (!this.drawerOpen()) return;
    this.drawerOpen.set(false);
    this.releaseDrawer?.();
    this.releaseDrawer = undefined;
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeDrawer();
  }
}
