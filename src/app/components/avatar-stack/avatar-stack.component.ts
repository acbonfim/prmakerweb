import { Component, Input } from '@angular/core';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';

export interface AvatarStackPerson {
  name: string;
  imageUrl?: string | null;
}

/**
 * Avatares sobrepostos (0051), no estilo das redes sociais: cada um aparece pela metade por cima do anterior, com
 * um anel da cor do fundo separando. Uma pessoa só = avatar inteiro; acima de `max`, o último vira "+N".
 */
@Component({
  selector: 'app-avatar-stack',
  standalone: true,
  imports: [UserAvatarComponent],
  template: `
    <div class="stack" [title]="tooltip()" [style.--size.px]="size" [style.--overlap.px]="overlap()">
      @for (p of visible(); track $index) {
        <!-- O primeiro (dono) fica por cima: os seguintes entram por baixo dele. -->
        <app-user-avatar class="stack-item" [style.zIndex]="visible().length - $index" [name]="p.name" [imageUrl]="p.imageUrl" [size]="size"></app-user-avatar>
      }
      @if (extra() > 0) {
        <span class="stack-item stack-more" [style.fontSize.px]="size * 0.36">+{{ extra() }}</span>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; flex-shrink: 0; }
    .stack { display: inline-flex; align-items: center; }
    .stack-item {
      position: relative;
      display: inline-flex;
      border-radius: 50%;
      box-shadow: 0 0 0 2px var(--ring, var(--surface-1, #262b33));
    }
    .stack-item + .stack-item { margin-left: calc(var(--overlap) * -1); }
    /* "+N" por cima de todos: sempre legível. */
    .stack-more {
      z-index: 10;
      width: var(--size); height: var(--size);
      align-items: center; justify-content: center;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
      background: color-mix(in srgb, var(--mat-sys-on-surface) 16%, var(--surface-1, #262b33));
    }
  `],
})
export class AvatarStackComponent {
  @Input() people: AvatarStackPerson[] = [];
  /** Total de envolvidos (pode ser maior que a lista recebida). */
  @Input() total: number | null = null;
  @Input() size = 32;
  @Input() max = 4;

  private get count(): number {
    return Math.max(this.total ?? 0, this.people.length);
  }

  visible(): AvatarStackPerson[] {
    return this.count > this.max ? this.people.slice(0, this.max - 1) : this.people.slice(0, this.max);
  }

  extra(): number {
    return this.count - this.visible().length;
  }

  /** Quanto cada avatar entra por baixo do anterior: mais gente, mais aperto (fica sempre um pedaço de cada). */
  overlap(): number {
    const n = this.visible().length + (this.extra() > 0 ? 1 : 0);
    return Math.round(this.size * (n >= 4 ? 0.5 : 0.4));
  }

  tooltip(): string {
    const names = this.people.map((p) => p.name).filter(Boolean);
    const rest = this.count - names.length;
    return names.join(', ') + (rest > 0 ? ` e mais ${rest}` : '');
  }
}
