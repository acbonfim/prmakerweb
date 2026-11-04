import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * 0080: fotos dos usuários por externalId (Cime.Auth `PhotosByExternalIds`), em cache para a sessão — '' = sem foto
 * (o avatar cai para as iniciais). Mesma regra do histórico de versões e da linha do tempo.
 */
@Injectable({ providedIn: 'root' })
export class UserPhotoService {
  private auth = inject(AuthService);
  private readonly photos = signal<Record<string, string>>({});
  private readonly asked = new Set<string>();

  photo(userId?: string | null): string | null {
    return userId ? this.photos()[userId.toLowerCase()] || null : null;
  }

  ensure(ids: (string | null | undefined)[]): void {
    const missing = Array.from(new Set(ids.filter((x): x is string => !!x).map((x) => x.toLowerCase()))).filter((id) => !this.asked.has(id));
    if (!missing.length) return;
    missing.forEach((id) => this.asked.add(id));
    this.auth.getPhotosByExternalIds(missing).subscribe({
      next: (res: any) => {
        const list = res?.object ?? res?.Object ?? [];
        const map = { ...this.photos() };
        for (const u of list) {
          const ext = (u.externalId || u.ExternalId || '').toLowerCase();
          const url = u.imageUrl || u.ImageUrl;
          if (ext && url) map[ext] = url;
        }
        for (const id of missing) if (!(id in map)) map[id] = '';
        this.photos.set(map);
      },
      error: () => missing.forEach((id) => this.asked.delete(id))
    });
  }
}
