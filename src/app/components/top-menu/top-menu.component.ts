import {Component, EventEmitter, Input, OnInit, Output} from '@angular/core';
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

interface AutoCompleteCompleteEvent {
  originalEvent: Event;
  query: string;
}


@Component({
  selector: 'app-top-menu',
  templateUrl: './top-menu.component.html',
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
    InputNumberModule
  ],
  styleUrls: ['./top-menu.component.css']
})
export class TopMenuComponent implements OnInit {
  @Output() toggleSidebar = new EventEmitter<void>();
  @Input() isCollapsed: boolean = false;
  @Output() selectedUserEmit = new EventEmitter<void>();

  items: any[] | undefined;
  users: any[] = [];
  urlBase = "http://prformapi.runasp.net/api/";
  filteredUsers: any[] = [];
  selectedUser: any = null;


  constructor(
    private http: HttpClient,
    private loadingBar: LoadingBarService,
    private userService: UserService,
  ) { }

  ngOnInit() {
    this.getAllUsers();
  }

  getAllUsers() {
    this.loadingBar.start();
    this.http.get(`${this.urlBase}User/GetUsers`).subscribe(
      (result: any) => {
        this.users = result;
        this.loadingBar.stop();
      },
      error => {
        console.error('Erro ao carregar usuários:', error);
        this.loadingBar.stop();
      }
    );
  }

  searchUsers(event: AutoCompleteCompleteEvent) {
    const query = event.query.toLowerCase();

    if (query) {
      this.filteredUsers = this.users.filter(user =>
        user.name.toLowerCase().includes(query) ||
        (user.email && user.email.toLowerCase().includes(query))
      );
    } else {
      this.filteredUsers = [...this.users];
    }
  }


  onUserSelect(user: any) {
    this.userService.setSelectedUser(user)
  }

  onToggleSidebar() {
    this.toggleSidebar.emit();
  }

}
