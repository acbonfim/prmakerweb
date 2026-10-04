import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReverseAsset, ReverseEngineeringService } from '../../../services/reverse-engineering.service';

/** UI/UX do módulo (0052): links do Figma/protótipo e arquivos (imagens, PDFs, exports) que o Claude usa no documento de UI/UX e no de design. */
@Component({
  selector: 'app-re-assets',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <section class="assets">
      <header>
        <mat-icon>design_services</mat-icon><b>Figma, protótipos e arquivos de UI/UX</b>
        <span class="muted">— o Claude lê na sessão de UI/UX e de Spec. design e aponta onde o implementado diverge</span>
      </header>
      <ul class="list">
        @for (a of assets(); track a.id) {
          <li>
            <mat-icon class="kind">{{ icon(a.kind) }}</mat-icon>
            <button type="button" class="link" (click)="open(a)">{{ a.title }}</button>
            @if (a.screens.length) { <span class="chip">{{ a.screens.join(', ') }}</span> }
            @if (a.notes) { <span class="muted">{{ a.notes }}</span> }
            <span class="spacer"></span>
            <span class="muted">{{ a.createdBy }}</span>
            <button type="button" class="icon" (click)="remove(a)" matTooltip="Remover"><mat-icon>delete</mat-icon></button>
          </li>
        } @empty {
          <li class="muted">Nenhum anexo ainda. Adicione o link do Figma (arquivo ou frame), do protótipo, ou suba as telas exportadas.</li>
        }
      </ul>
      <div class="add">
        <input type="text" placeholder="Título (ex.: Figma — Cadastro de ideia)" [(ngModel)]="title">
        <input type="url" placeholder="https://www.figma.com/… ou link do protótipo" [(ngModel)]="url">
        <input type="text" class="short" placeholder="Telas (TELA-001, …)" [(ngModel)]="screens">
        <button mat-stroked-button type="button" (click)="addLink()" [disabled]="busy() || !url.trim()"><mat-icon>link</mat-icon>Adicionar link</button>
        <label class="upload" mat-stroked-button>
          <input type="file" (change)="upload($event)" accept="image/*,.pdf,.fig,.zip,.svg">
          <mat-icon>upload_file</mat-icon>Subir arquivo
        </label>
      </div>
    </section>
  `,
  styles: [`
    .assets { padding: 12px 16px; border-radius: 10px; background: rgba(57,197,207,.05); border: 1px solid rgba(57,197,207,.25); margin: 10px 0; }
    header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
    header mat-icon { color: #39c5cf; }
    .muted { font-size: 12px; opacity: .65; }
    .list { list-style: none; padding: 0; margin: 8px 0; display: flex; flex-direction: column; gap: 4px; }
    .list li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .kind { font-size: 18px; width: 18px; height: 18px; opacity: .8; }
    .link { border: none; background: transparent; color: var(--mat-sys-primary); cursor: pointer; font: inherit; padding: 0; text-align: left; }
    .icon { border: none; background: transparent; color: inherit; cursor: pointer; opacity: .6; display: inline-flex; }
    .icon mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .spacer { flex: 1; }
    .chip { font-size: 11px; padding: 0 6px; border-radius: 8px; background: rgba(255,255,255,.07); }
    .add { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .add input[type=text], .add input[type=url] { flex: 1 1 200px; padding: 6px 8px; border-radius: 6px; background: rgba(0,0,0,.3); color: inherit;
      border: 1px solid rgba(255,255,255,.15); font: inherit; font-size: 13px; }
    .add input.short { flex: 0 1 160px; }
    .upload { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; padding: 6px 12px; border-radius: 18px;
      border: 1px solid rgba(255,255,255,.25); font-size: 13px; }
    .upload input { display: none; }
  `]
})
export class ReAssetsComponent {
  private api = inject(ReverseEngineeringService);
  private snack = inject(MatSnackBar);
  moduleKey = input.required<string>();
  assets = input<ReverseAsset[]>([]);
  changed = output<void>();
  busy = signal(false);
  title = '';
  url = '';
  screens = '';

  icon(kind: string) { return ({ figma: 'draw', prototype: 'touch_app', link: 'link', image: 'image', file: 'description' } as any)[kind] ?? 'attach_file'; }

  addLink() {
    this.busy.set(true);
    this.api.addLink(this.moduleKey(), {
      title: this.title.trim() || this.url.trim(), url: this.url.trim(),
      screens: this.screens.split(',').map(s => s.trim()).filter(Boolean)
    }).subscribe({
      next: () => { this.busy.set(false); this.title = this.url = this.screens = ''; this.changed.emit(); },
      error: e => { this.busy.set(false); this.toast(e); }
    });
  }

  upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = '';
    if (!file) return;
    this.busy.set(true);
    this.api.addFile(this.moduleKey(), file, this.title.trim() || file.name, undefined, this.screens).subscribe({
      next: () => { this.busy.set(false); this.title = this.screens = ''; this.changed.emit(); },
      error: e => { this.busy.set(false); this.toast(e); }
    });
  }

  open(a: ReverseAsset) {
    if (a.url) { window.open(a.url, '_blank', 'noopener'); return; }
    this.api.assetFile(a.id).subscribe({
      next: blob => { const u = URL.createObjectURL(blob); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); },
      error: e => this.toast(e)
    });
  }

  remove(a: ReverseAsset) {
    if (!confirm(`Remover "${a.title}"?`)) return;
    this.api.deleteAsset(a.id).subscribe({ next: () => this.changed.emit(), error: e => this.toast(e) });
  }

  private toast(e: any) { this.snack.open(e?.error?.error ?? 'Não foi possível concluir.', 'OK', { duration: 6000 }); }
}
