import { ChangeDetectorRef, Component, ElementRef, ViewChild, inject, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Campo de branch: prefixo (hotfix/, feature/…) editável com duplo clique + nome da branch.
 * O prefixo é normalizado ao sair da edição (vazio → hotfix/, sempre terminando em "/").
 */
@Component({
  selector: 'app-branch-input',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatTooltipModule],
  template: `
    <mat-form-field appearance="outline" subscriptSizing="dynamic">
      <mat-label>{{ label() }}</mat-label>
      @if (isEditingPrefix) {
        <input matTextPrefix #prefixInput class="pr-prefix-input"
               [ngModel]="prefix()"
               (ngModelChange)="prefix.set($event)"
               (blur)="onPrefixBlur()"
               (click)="$event.stopPropagation()"
               (keydown.enter)="onPrefixBlur()"/>
      } @else {
        <span matTextPrefix class="pr-prefix"
              (dblclick)="onPrefixDoubleClick()"
              [matTooltip]="readonly() ? '' : 'Duplo clique para editar o prefixo'"
              matTooltipPosition="above">
          {{ prefix() }}
        </span>
      }
      <input matInput class="pr-branch-input" placeholder="nome da branch"
             [readonly]="readonly()"
             [ngModel]="name()"
             (ngModelChange)="name.set($event)"/>
    </mat-form-field>
  `,
  styles: [`
    :host { display: block; }
    mat-form-field { width: 100%; }

    /* Prefixo da branch (hotfix/ etc.) como "chip" no accent primário */
    .pr-prefix {
      font-weight: 600;
      font-size: 13px;
      color: var(--mat-sys-primary);
      white-space: nowrap;
    }

    .pr-prefix-input {
      width: 78px;
      background: transparent;
      border: none;
      outline: none;
      color: var(--mat-sys-primary);
      font-weight: 600;
      font-size: 13px;
      padding: 0;
    }
  `]
})
export class BranchInputComponent {
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('prefixInput') prefixInputRef?: ElementRef<HTMLInputElement>;

  readonly prefix = model('hotfix/');
  readonly name = model('');
  readonly label = input('Branch');
  readonly readonly = input(false);

  isEditingPrefix = false;

  onPrefixDoubleClick(): void {
    if (this.readonly()) return;
    this.isEditingPrefix = true;
    // Zoneless: força o render do input antes de focar; o setTimeout garante que o
    // elemento já exista no DOM quando chamamos focus().
    this.cdr.detectChanges();
    setTimeout(() => this.prefixInputRef?.nativeElement.focus());
  }

  onPrefixBlur(): void {
    this.isEditingPrefix = false;
    const prefix = this.prefix();
    if (!prefix || prefix.trim() === '') {
      this.prefix.set('hotfix/');
    } else if (!prefix.endsWith('/')) {
      this.prefix.set(prefix + '/');
    }
    this.cdr.detectChanges();
  }
}
