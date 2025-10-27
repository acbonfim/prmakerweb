import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {PageContainerComponent} from './components/page-container/page-container.component';

@Component({
  selector: 'app-root',
  imports: [ PageContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('prform-app');
}
