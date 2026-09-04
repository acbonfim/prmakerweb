import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Avatar reutilizável: mostra a imagem se houver; senão, iniciais (1º + último nome)
// com cor determinística a partir do nome.
@Component({
  selector: 'app-user-avatar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="avatar" [style.width.px]="size" [style.height.px]="size"
         [style.fontSize.px]="size * 0.4"
         [style.background]="imageUrl ? 'transparent' : color()">
      @if (imageUrl) {
        <img [src]="imageUrl" [alt]="name" (error)="onImgError()">
      } @else {
        <span>{{ initials() }}</span>
      }
    </div>
  `,
  styles: [`
    .avatar {
      border-radius: 50%;
      overflow: hidden;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 600;
      text-transform: uppercase;
      line-height: 1;
      flex-shrink: 0;
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
  `]
})
export class UserAvatarComponent {
  @Input() name: string = '';
  @Input() imageUrl: string | null | undefined = null;
  @Input() size: number = 40;

  onImgError() {
    // Se a imagem falhar, cai para as iniciais.
    this.imageUrl = null;
  }

  initials(): string {
    const n = (this.name || '').trim();
    if (!n) return '?';
    const parts = n.split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  color(): string {
    const n = this.name || '';
    let hash = 0;
    for (let i = 0; i < n.length; i++) {
      hash = n.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 45%, 45%)`;
  }
}
