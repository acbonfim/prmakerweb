import {Component, EventEmitter, HostListener, Input, OnInit, Output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatMenuModule} from '@angular/material/menu';
import {MatDividerModule} from '@angular/material/divider';
import {AutoCompleteModule} from 'primeng/autocomplete';
import {FormsModule} from '@angular/forms';
import {HttpClient} from '@angular/common/http';
import {LoadingBarService} from '@ngx-loading-bar/core';
import {UserService} from '../../services/UserService.service';
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
    AutoCompleteModule,
    FormsModule,
    InputGroupModule,
    InputGroupAddonModule,
    ButtonModule,
    InputNumberModule,
    MatFormFieldModule,
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


  constructor(
    private _globalService: GlobalService,
    public _storageService: StorageService,
    private _wsService: WsService,
  ) { }

  ngOnInit(): void {
    this.title = environment.title;
    this.isProduction = environment.production;
    this.user = this._storageService.getAccess().user;

    let nameSplit = this.user.fullName.split(' ');
    let names = nameSplit.length;

    this.user.firstName = nameSplit[0];
    this.user.lastName = nameSplit[names - 1];
    this.realTimeMethods();
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
