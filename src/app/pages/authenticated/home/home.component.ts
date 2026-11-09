import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { StorageService } from '../../../services/storage.service';
import { HomeCardsComponent } from '../../../components/home-cards/home-cards.component';

/**
 * Home: saudação + aviso da tela de PR desativada + "Meus cards na Bancada" em destaque (0088) + "Seus últimos cards" e
 * "Cards que você participou" (0051). Os atalhos de acesso rápido e o saldo de férias saíram — o menu lateral já leva a essas telas.
 */
@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  standalone: true,
  imports: [MatButtonModule, MatIconModule, RouterLink, HomeCardsComponent],
})
export class HomeComponent implements OnInit {
  private storageService = inject(StorageService);

  currentUser: any = null;
  greeting = '';
  currentDate = '';

  // Visibilidade de cada lista: quando uma fica vazia, a outra ocupa 100% da largura.
  workbenchVisible = signal(true);
  mineVisible = signal(true);
  participatedVisible = signal(true);

  ngOnInit() {
    this.currentUser = this.storageService.getAccess()?.user;
    this.buildGreeting();
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

  get firstName(): string {
    const full: string = this.currentUser?.fullName || '';
    return full.split(' ')[0] || 'usuário';
  }
}
