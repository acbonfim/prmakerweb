import { Component, ElementRef, EventEmitter, Output, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';

// Cropper redondo próprio (canvas), sem dependências externas.
// Seleciona uma imagem, permite zoom + arrastar dentro de um recorte circular
// e emite um PNG redondo (data URL) via (cropped).
@Component({
  selector: 'app-round-image-cropper',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatSliderModule],
  template: `
    <input #fileInput type="file" accept="image/*" hidden (change)="onFile($event)">

    @if (!imageLoaded()) {
      <button mat-stroked-button type="button" class="pick-btn" (click)="fileInput.click()">
        <mat-icon>add_a_photo</mat-icon> Selecionar imagem
      </button>
    } @else {
      <div class="cropper">
        <div #viewport class="viewport"
             (pointerdown)="onPointerDown($event)"
             (pointermove)="onPointerMove($event)"
             (pointerup)="onPointerUp($event)"
             (pointerleave)="onPointerUp($event)">
          <img #img class="crop-img"
               [src]="imageSrc()"
               [style.width.px]="scaledW()"
               [style.height.px]="scaledH()"
               [style.transform]="'translate(' + offsetX() + 'px,' + offsetY() + 'px)'"
               draggable="false">
          <div class="ring"></div>
        </div>

        <div class="zoom-row">
          <mat-icon>zoom_out</mat-icon>
          <mat-slider min="1" max="3" step="0.01" class="zoom-slider">
            <input matSliderThumb [value]="zoom()" (valueChange)="onZoom($event)">
          </mat-slider>
          <mat-icon>zoom_in</mat-icon>
        </div>

        <div class="crop-actions">
          <button mat-button type="button" (click)="fileInput.click()">
            <mat-icon>image</mat-icon> Trocar
          </button>
          <button mat-flat-button color="primary" type="button" (click)="confirm()">
            <mat-icon>check</mat-icon> Aplicar
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .pick-btn { width: 100%; }
    .cropper { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .viewport {
      position: relative;
      width: 240px;
      height: 240px;
      border-radius: 50%;
      overflow: hidden;
      background: #14181d;
      touch-action: none;
      cursor: grab;
    }
    .viewport:active { cursor: grabbing; }
    .crop-img { position: absolute; top: 0; left: 0; user-select: none; -webkit-user-drag: none; }
    .ring {
      position: absolute; inset: 0; border-radius: 50%;
      box-shadow: 0 0 0 2px rgba(255,255,255,0.7) inset, 0 0 0 9999px rgba(0,0,0,0.08);
      pointer-events: none;
    }
    .zoom-row { display: flex; align-items: center; gap: 8px; width: 240px; }
    .zoom-slider { flex: 1; }
    .zoom-row mat-icon { opacity: 0.7; }
    .crop-actions { display: flex; gap: 8px; }
  `]
})
export class RoundImageCropperComponent {
  @Output() cropped = new EventEmitter<string>();

  @ViewChild('viewport') viewport?: ElementRef<HTMLDivElement>;
  @ViewChild('img') img?: ElementRef<HTMLImageElement>;

  imageLoaded = signal(false);
  imageSrc = signal<string>('');
  zoom = signal(1);
  offsetX = signal(0);
  offsetY = signal(0);
  scaledW = signal(0);
  scaledH = signal(0);

  private readonly V = 240;      // tamanho do viewport (px)
  private readonly OUT = 320;    // resolução do PNG de saída
  private naturalW = 0;
  private naturalH = 0;
  private baseScale = 1;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private srcEl: HTMLImageElement | null = null;

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => this.loadImage(reader.result as string);
    reader.readAsDataURL(file);
    input.value = '';
  }

  private loadImage(dataUrl: string): void {
    const image = new Image();
    image.onload = () => {
      this.srcEl = image;
      this.imageSrc.set(dataUrl);
      this.naturalW = image.naturalWidth;
      this.naturalH = image.naturalHeight;
      // "cover": a imagem sempre preenche o círculo.
      this.baseScale = Math.max(this.V / this.naturalW, this.V / this.naturalH);
      this.zoom.set(1);
      this.applyScale();
      this.centerImage();
      this.imageLoaded.set(true);
    };
    image.src = dataUrl;
  }

  private applyScale(): void {
    const s = this.baseScale * this.zoom();
    this.scaledW.set(this.naturalW * s);
    this.scaledH.set(this.naturalH * s);
  }

  private centerImage(): void {
    this.offsetX.set((this.V - this.scaledW()) / 2);
    this.offsetY.set((this.V - this.scaledH()) / 2);
    this.clamp();
  }

  private clamp(): void {
    const minX = this.V - this.scaledW();
    const minY = this.V - this.scaledH();
    this.offsetX.set(Math.min(0, Math.max(minX, this.offsetX())));
    this.offsetY.set(Math.min(0, Math.max(minY, this.offsetY())));
  }

  onZoom(value: number): void {
    // Mantém o centro visual ao dar zoom.
    const cx = (this.V / 2 - this.offsetX());
    const cy = (this.V / 2 - this.offsetY());
    const prev = this.baseScale * this.zoom();
    this.zoom.set(value);
    const next = this.baseScale * this.zoom();
    const ratio = next / prev;
    this.applyScale();
    this.offsetX.set(this.V / 2 - cx * ratio);
    this.offsetY.set(this.V / 2 - cy * ratio);
    this.clamp();
  }

  onPointerDown(e: PointerEvent): void {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    this.offsetX.set(this.offsetX() + (e.clientX - this.lastX));
    this.offsetY.set(this.offsetY() + (e.clientY - this.lastY));
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.clamp();
  }

  onPointerUp(e: PointerEvent): void {
    this.dragging = false;
  }

  confirm(): void {
    if (!this.srcEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = this.OUT;
    canvas.height = this.OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Recorte circular.
    ctx.beginPath();
    ctx.arc(this.OUT / 2, this.OUT / 2, this.OUT / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const k = this.OUT / this.V; // escala viewport -> saída
    ctx.drawImage(
      this.srcEl,
      this.offsetX() * k,
      this.offsetY() * k,
      this.scaledW() * k,
      this.scaledH() * k
    );

    this.cropped.emit(canvas.toDataURL('image/png'));
  }
}
