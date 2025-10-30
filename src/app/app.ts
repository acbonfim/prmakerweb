import { Component, signal } from '@angular/core';
import {RouterModule, RouterOutlet} from '@angular/router';
import {PageContainerComponent} from './components/page-container/page-container.component';

@Component({
  selector: 'app-root',
  imports: [ PageContainerComponent, RouterModule],
  standalone: true,
  template: `<router-outlet></router-outlet>`,
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('prform-app');
}
