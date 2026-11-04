import { Component, OnDestroy, computed, effect, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { CaseChatStatusService } from '../../services/case-chat-status.service';
import { UserPhotoService } from '../../services/user-photo.service';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { openCaseChat } from './open-case-chat';

/**
 * 0080: prévia ao vivo do Especialista do caso na coluna da direita do card — as últimas mensagens, o que ele está
 * fazendo agora e "Abrir a conversa". Sem conversa ainda, um convite curto.
 */
@Component({
  selector: 'app-case-preview',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, UserAvatarComponent],
  template: `
    @if (card(); as c) {
      <section class="cp" aria-label="Especialista do caso">
        <button type="button" class="cp__head" (click)="open()">
          <span class="sp-av"><mat-icon>psychology</mat-icon></span>
          <span class="cp__titles">
            <b>Especialista do caso</b>
            <small>{{ s().unread ? (s().unread === 1 ? '1 nova' : s().unread + ' novas') + ' · ' : '' }}{{ s().people ? s().people + (s().people === 1 ? ' pessoa' : ' pessoas') + ' na conversa' : 'pergunte qualquer coisa do caso' }}</small>
          </span>
          @if (s().working) { <span class="cp__live"><span class="cp__dot"></span>ativo</span> }
        </button>
        @for (m of s().last; track m.id) {
          <div class="cp__msg">
            @if (m.authorKind === 'specialist') { <span class="sp-av sp-av--sm"><mat-icon>psychology</mat-icon></span> }
            @else { <app-user-avatar [name]="m.authorName" [imageUrl]="photos.photo(m.authorUserId)" [size]="24"></app-user-avatar> }
            <span class="cp__bubble" [class.cp__bubble--spec]="m.authorKind === 'specialist'">{{ preview(m.kind === 'voice' ? (m.transcript || 'mensagem de voz') : m.text) }}</span>
          </div>
        }
        @if (s().working && s().activity) {
          <div class="cp__act"><span class="cp__spin"></span>{{ s().activity }}</div>
        }
        <button mat-flat-button class="cp__open" (click)="open()"><mat-icon>forum</mat-icon>{{ s().last.length ? 'Abrir a conversa' : 'Conversar com o especialista' }}</button>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .cp { border-radius: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,.07); background: var(--surface-1, #2a2a2a); }
    .cp__head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 0; cursor: pointer; text-align: left; color: inherit; font: inherit;
      background: linear-gradient(135deg, rgba(142,108,240,.22), rgba(142,108,240,.04)); }
    .cp__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cp__titles b { font-size: 13.5px; }
    .cp__titles small { font-size: 11.5px; opacity: .65; }
    .cp__live { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #3fb950; padding: 2px 8px; border-radius: 10px; background: rgba(63,185,80,.12); }
    .cp__dot { width: 6px; height: 6px; border-radius: 50%; background: #3fb950; }
    .sp-av { width: 30px; height: 30px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: #fff;
      background: radial-gradient(circle at 30% 25%, #d9c6ff, #8e6cf0 55%, #5a3fb8); }
    .sp-av mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .sp-av--sm { width: 24px; height: 24px; } .sp-av--sm mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .cp__msg { display: flex; gap: 8px; padding: 8px 12px 0; align-items: flex-start; }
    .cp__bubble { font-size: 12.5px; line-height: 1.4; padding: 6px 10px; border-radius: 4px 12px 12px 12px; background: rgba(255,255,255,.06);
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .cp__bubble--spec { background: color-mix(in srgb, #c4a7ff 12%, transparent); }
    .cp__act { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #c4a7ff; padding: 8px 12px 0 44px; }
    .cp__spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid rgba(196,167,255,.3); border-top-color: #c4a7ff; animation: cp-spin .9s linear infinite; }
    @keyframes cp-spin { to { transform: rotate(360deg); } }
    .cp__open { margin: 10px 12px 12px; width: calc(100% - 24px); background: linear-gradient(135deg, #8e6cf0, #6a4fd0) !important; color: #fff !important; }
  `]
})
export class CasePreviewComponent implements OnDestroy {
  readonly card = input<string | null>(null);
  private statusApi = inject(CaseChatStatusService);
  private dialog = inject(MatDialog);
  readonly photos = inject(UserPhotoService);
  private watching: string | null = null;

  readonly s = computed(() => {
    const c = this.card();
    return c ? this.statusApi.status(c)() : { last: [], lastNumber: 0, seenNumber: 0, unread: 0, working: false, activity: null, people: 0 };
  });

  constructor() {
    effect(() => {
      const c = this.card();
      if (c === this.watching) return;
      if (this.watching) this.statusApi.unwatch(this.watching);
      this.watching = c;
      if (c) this.statusApi.watch(c);
    });
    effect(() => this.photos.ensure(this.s().last.map((m) => m.authorUserId)));
  }

  ngOnDestroy(): void {
    if (this.watching) this.statusApi.unwatch(this.watching);
  }

  preview(text: string): string {
    const t = (text || '').replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim();
    return t.length > 180 ? t.slice(0, 180) + '…' : t;
  }

  open(): void {
    const c = this.card();
    if (c) openCaseChat(this.dialog, c);
  }
}
