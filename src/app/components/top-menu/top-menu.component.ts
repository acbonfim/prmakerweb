import {Component, EventEmitter, HostListener, Input, OnInit, Output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatMenuModule} from '@angular/material/menu';
import {MatDividerModule} from '@angular/material/divider';
import {MatTooltipModule} from '@angular/material/tooltip';
import {AutoCompleteModule} from 'primeng/autocomplete';
import {FormsModule} from '@angular/forms';
import {HttpClient} from '@angular/common/http';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {LoadingBarService} from '@ngx-loading-bar/core';
import {UserService} from '../../services/UserService.service';
import {ProfileDialogComponent} from '../../pages/authenticated/profile/profile-dialog.component';
import {UserAvatarComponent} from '../user-avatar/user-avatar.component';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import {ButtonModule} from 'primeng/button';
import {InputNumberModule} from 'primeng/inputnumber';
import {environment} from '../../../environments/environment';
import {MatFormFieldModule} from '@angular/material/form-field';
import {GlobalService} from '../../services/global.service';
import {StorageService} from '../../services/storage.service';
import {WsService} from '../../services/ws.service';
import {RouterModule} from '@angular/router';

interface AutoCompleteCompleteEvent {
  originalEvent: Event;
  query: string;
}


@Component({
  selector: 'app-top-menu',
  templateUrl: './top-menu.component.html',
  standalone: true,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
    AutoCompleteModule,
    FormsModule,
    InputGroupModule,
    InputGroupAddonModule,
    ButtonModule,
    InputNumberModule,
    MatFormFieldModule,
    MatDialogModule,
    UserAvatarComponent,
    RouterModule
  ],
  styleUrls: ['./top-menu.component.css']
})
export class TopMenuComponent implements OnInit {
  @Output() toggleSidebar = new EventEmitter<void>();
  @Input() isCollapsed: boolean = false;
  @Output() selectedUserEmit = new EventEmitter<void>();

  sidebarOpen = true;
  user: any = {};
  isOn = false;
  isProduction = false;
  title = '';
  isDesktop = false;
  profilePhoto: string | null = null;


  constructor(
    private _globalService: GlobalService,
    public _storageService: StorageService,
    private _wsService: WsService,
    public dialog: MatDialog,
  ) { }

  ngOnInit(): void {
    this.title = environment.title;
    this.isProduction = environment.production;
    this.loadUser();
    this.realTimeMethods();
  }

  // Relê o usuário do storage e recalcula firstName/lastName a partir do fullName.
  // O objeto salvo não persiste firstName/lastName, então precisam ser derivados
  // sempre que o usuário é recarregado (ex.: ao fechar o modal de "Meu perfil").
  private loadUser(): void {
    this.user = this._storageService.getAccess().user;
    this.profilePhoto = this.user?.imagemUrlUser || null;

    let nameSplit = (this.user?.fullName ?? '').trim().split(/\s+/).filter(Boolean);
    let names = nameSplit.length;

    this.user.firstName = nameSplit[0] ?? '';
    this.user.lastName = names > 1 ? nameSplit[names - 1] : '';
  }

  realTimeMethods() {
    this._wsService._wsOn.subscribe((data: boolean) => {
      console.log(data);
      this.isOn = data;
    });
  }

  toggle() {
    this.sidebarOpen = !this.sidebarOpen;
    this._globalService._sideNavToggle(null);
  }

  openProfile() {
    const ref = this.dialog.open(ProfileDialogComponent, { width: '520px' });
    ref.afterClosed().subscribe(() => {
      // Reflete a foto atualizada no avatar do topo e recalcula firstName/lastName.
      this.loadUser();
    });
  }

  logOut() {
    this._wsService.endConnection();
    this._globalService.navigateTo("login");
  }

  @HostListener('window:resize')
  onResize() {
    this.isDesktop = this._globalService.isDesktop();
    this.autoToggleSidebar();
  }

  autoToggleSidebar() {
    if (this.isDesktop) {
      this.sidebarOpen = true;
    } else {
      this.sidebarOpen = false;
    }

    this._globalService._sideNavToggle(this.sidebarOpen);
  }








  onToggleSidebar() {
    this.toggleSidebar.emit();
  }

}
