import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { GlobalService } from '../../services/global.service';
import { saveBlob } from '../../services/execution-plan.service';

interface SkillInfo {
  name: string;
  description: string;
  version: string;
  fileCount: number;
  size: number;
}

/**
 * "Skills do Claude" (feature 0024): as skills do PRMake (analisar-bug, gerar-prmake, …) instaladas com um
 * comando e atualizadas sozinhas a cada sessão do Claude Code. A fonte fica no repositório da API e cada
 * deploy publica a versão nova — sem plugin/marketplace.
 */
@Component({
  selector: 'app-skills-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="sk">
      <div class="sk__header">
        <mat-icon class="sk__lead">smart_toy</mat-icon>
        <div class="sk__titles">
          <span class="sk__title">Skills do Claude Code</span>
          <span class="sk__sub">Instale uma vez; elas se atualizam sozinhas a cada sessão do Claude Code.</span>
        </div>
        <button mat-icon-button (click)="close()" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </div>

      <div class="sk__body">
        <section class="sk__step">
          <span class="sk__num">1</span>
          <div class="sk__step-body">
            <div class="sk__step-title">Gere a sua API Key</div>
            <p>O comando usa a sua chave pessoal (não expira; a mesma de "Minha API Key").</p>
            @if (apiKey()) {
              <span class="sk__ok"><mat-icon>check_circle</mat-icon> Chave gerada — já está no comando abaixo.</span>
            } @else {
              <button mat-stroked-button (click)="generate()" [disabled]="generating()">
                @if (generating()) { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>vpn_key</mat-icon> }
                Gerar API Key e montar o comando
              </button>
            }
            @if (error()) { <p class="sk__error">{{ error() }}</p> }
          </div>
        </section>

        <section class="sk__step">
          <span class="sk__num">2</span>
          <div class="sk__step-body">
            <div class="sk__step-title">Rode no terminal (macOS/Linux)</div>
            <div class="sk__cmd">
              <code>{{ reveal() ? command() : maskedCommand() }}</code>
              <div class="sk__cmd-actions">
                @if (apiKey()) {
                  <button mat-icon-button (click)="reveal.set(!reveal())" [matTooltip]="reveal() ? 'Ocultar a chave' : 'Mostrar a chave'">
                    <mat-icon>{{ reveal() ? 'visibility_off' : 'visibility' }}</mat-icon>
                  </button>
                }
                <button mat-icon-button (click)="copy()" [disabled]="!apiKey()" matTooltip="Copiar o comando">
                  <mat-icon>content_copy</mat-icon>
                </button>
              </div>
            </div>
            <p class="sk__note">
              Instala em <code>~/.claude/skills</code>, salva o token em <code>~/.claude/prmake-token.txt</code> e coloca um
              hook de início de sessão em <code>~/.claude/settings.json</code> que atualiza as skills automaticamente
              (sem rede, não faz nada). Precisa de <code>curl</code>, <code>jq</code>, <code>unzip</code>, <code>rsync</code> e <code>python3</code>.
            </p>
          </div>
        </section>

        <section class="sk__step">
          <span class="sk__num">3</span>
          <div class="sk__step-body">
            <div class="sk__step-title">Pronto — use no Claude Code</div>
            <p>Ex.: <code>/analisar-bug 74517</code>. Status e atualização manual: <code>bash ~/.claude/skills/.prmake/prmake-skills.sh status</code></p>
          </div>
        </section>

        <div class="sk__list-title">Publicadas agora</div>
        @if (loading()) {
          <div class="sk__state"><mat-spinner diameter="22"></mat-spinner></div>
        } @else if (loadError()) {
          <div class="sk__state sk__error">Não foi possível carregar as skills.</div>
        } @else {
          @for (s of skills(); track s.name) {
            <div class="sk__skill">
              <mat-icon class="sk__skill-icon">extension</mat-icon>
              <div class="sk__skill-body">
                <div class="sk__skill-name">{{ s.name }} <span class="sk__ver">v{{ s.version }}</span></div>
                <div class="sk__skill-desc" [title]="s.description">{{ s.description }}</div>
              </div>
              <button mat-icon-button (click)="download(s)" [disabled]="downloading() === s.name" matTooltip="Baixar o pacote (.zip)">
                <mat-icon>download</mat-icon>
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .sk { display: flex; flex-direction: column; max-height: 88vh; color: var(--mat-sys-on-surface); }
    .sk__header { display: flex; align-items: center; gap: 10px; padding: 14px 10px 14px 20px; background: var(--surface-2, #323232);
      border-bottom: 1px solid rgba(255,255,255,.06); }
    .sk__lead { color: var(--mat-sys-primary); }
    .sk__titles { flex: 1; display: flex; flex-direction: column; }
    .sk__title { font-weight: 600; font-size: 16px; }
    .sk__sub { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .sk__body { overflow-y: auto; padding: 16px 20px 20px; }
    .sk__step { display: flex; gap: 12px; margin-bottom: 16px; }
    .sk__num { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); }
    .sk__step-body { flex: 1; min-width: 0; }
    .sk__step-title { font-weight: 600; font-size: 13.5px; margin-bottom: 4px; }
    .sk__step-body p { margin: 0 0 8px; font-size: 12.5px; color: color-mix(in srgb, var(--mat-sys-on-surface) 72%, transparent); }
    .sk__ok { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: #3fb950; }
    .sk__ok .mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .sk__cmd { display: flex; align-items: flex-start; gap: 6px; padding: 10px 6px 10px 12px; border-radius: 8px; background: rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.08); }
    .sk__cmd code { flex: 1; min-width: 0; font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 12px; line-height: 1.5;
      word-break: break-all; white-space: pre-wrap; color: #c9d1d9; }
    .sk__cmd-actions { display: flex; flex: none; }
    .sk__note { margin-top: 8px !important; font-size: 11.5px !important; }
    code { font-family: 'Courier New', monospace; font-size: 11.5px; color: #c9d1d9; background: rgba(255,255,255,.06); padding: 0 4px; border-radius: 4px; }
    .sk__list-title { margin: 8px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent); }
    .sk__skill { display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 10px; border-radius: 8px; }
    .sk__skill:hover { background: rgba(255,255,255,.03); }
    .sk__skill-icon { color: var(--mat-sys-primary); flex: none; }
    .sk__skill-body { flex: 1; min-width: 0; }
    .sk__skill-name { font-weight: 600; font-size: 13px; }
    .sk__ver { font-weight: 400; font-size: 11px; color: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent);
      font-family: 'Courier New', monospace; }
    .sk__skill-desc { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 62%, transparent);
      overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .sk__state { display: flex; justify-content: center; padding: 16px; }
    .sk__error { color: var(--mat-sys-error, #f2b8b5); }
  `]
})
export class SkillsDialogComponent implements OnInit {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private globalService = inject(GlobalService);
  private dialogRef = inject(MatDialogRef<SkillsDialogComponent>);

  private readonly apiUrl = `${environment.apiUrl}Skills`;

  readonly skills = signal<SkillInfo[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly apiKey = signal<string | null>(null);
  readonly generating = signal(false);
  readonly error = signal<string | null>(null);
  readonly reveal = signal(false);
  readonly downloading = signal<string | null>(null);

  readonly command = computed(() => {
    const key = this.apiKey() ?? '<sua-api-key>';
    return `curl -fsSL -H "x-api-key: ${key}" ${this.apiUrl}/install.sh | PRMAKE_TOKEN=${key} bash`;
  });

  readonly maskedCommand = computed(() => {
    const key = this.apiKey();
    if (!key) return this.command();
    const masked = `${key.slice(0, 10)}…${key.slice(-4)}`;
    return this.command().split(key).join(masked);
  });

  ngOnInit(): void {
    this.http.get<{ toolVersion: string; skills: SkillInfo[] }>(this.apiUrl).subscribe({
      next: (res) => { this.skills.set(res?.skills ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); this.loadError.set(true); }
    });
  }

  generate(): void {
    if (this.generating()) return;
    this.generating.set(true);
    this.error.set(null);
    this.authService.generateApiKey().subscribe({
      next: (res: any) => {
        this.generating.set(false);
        const data = res?.object ?? res?.Object ?? {};
        const key = data.apiKey ?? data.ApiKey;
        if (!key) { this.error.set('Não foi possível gerar a API Key. Tente novamente.'); return; }
        this.apiKey.set(key);
      },
      error: (err) => {
        this.generating.set(false);
        this.error.set(err?.error?.message || err?.error?.Message || 'Não foi possível gerar a API Key. Tente novamente.');
      }
    });
  }

  copy(): void {
    if (this.apiKey()) this.globalService.copyToClipBoard(this.command());
  }

  download(skill: SkillInfo): void {
    this.downloading.set(skill.name);
    this.http.get(`${this.apiUrl}/${encodeURIComponent(skill.name)}/package`, { responseType: 'blob' }).subscribe({
      next: (blob) => { this.downloading.set(null); saveBlob(blob, `${skill.name}-${skill.version}.zip`); },
      error: () => this.downloading.set(null)
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}
