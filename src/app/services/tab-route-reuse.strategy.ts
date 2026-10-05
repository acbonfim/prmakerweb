import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';
import { PageContainerComponent } from '../components/page-container/page-container.component';
import { TabsService } from './tabs.service';

/**
 * Guarda e reanexa a tela de cada aba (feature 0065). Só age na "tela da aba" (o componente filho direto do
 * PageContainer) e só durante uma troca de aba (`TabsService.switching`): navegar dentro da aba (menu lateral)
 * continua destruindo a tela, como sempre. Duas abas na mesma rota (dois cards) têm instâncias separadas porque a
 * tela guardada é indexada pela aba, não pela URL.
 */
@Injectable()
export class TabRouteReuseStrategy implements RouteReuseStrategy {
  private readonly tabs = inject(TabsService);

  private isTabScreen(route: ActivatedRouteSnapshot): boolean {
    if (!route.component || route.component === PageContainerComponent) return false;
    let parent = route.parent;
    while (parent && !parent.component) parent = parent.parent;
    return parent?.component === PageContainerComponent;
  }

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    const sw = this.tabs.switching;
    return !!sw?.from && this.isTabScreen(route);
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const sw = this.tabs.switching;
    if (!sw) return;
    if (handle) {
      if (sw.from) this.tabs.stashScreen(sw.from, route.routeConfig, handle);
    } else {
      // O roteador acabou de reanexar a tela da aba de destino.
      this.tabs.releaseScreen(sw.to);
    }
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const sw = this.tabs.switching;
    return !!sw && this.isTabScreen(route) && this.tabs.hasScreen(sw.to, route.routeConfig);
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const sw = this.tabs.switching;
    return sw && this.isTabScreen(route) ? this.tabs.screenOf(sw.to) : null;
  }

  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    // Troca de aba: a tela nunca é "a mesma" (outra aba pode estar na mesma rota com outro card).
    if (this.tabs.switching && this.isTabScreen(future) && this.isTabScreen(curr)) return false;
    return future.routeConfig === curr.routeConfig;
  }
}
