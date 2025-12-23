import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {AuthService} from '../../../../services/auth.service';
import {GlobalService} from '../../../../services/global.service';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatCardModule} from '@angular/material/card';
import {MatIconModule} from '@angular/material/icon';
import {FormsModule} from '@angular/forms';
import {MatBadgeModule} from '@angular/material/badge';
import {MatProgressBarModule} from '@angular/material/progress-bar';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDividerModule} from '@angular/material/divider';
import {MatSliderModule} from '@angular/material/slider';
import {MatSlideToggleModule} from '@angular/material/slide-toggle';
import {MatTooltipModule} from '@angular/material/tooltip';
import {DialogPrompt} from '../../../../components/dialog-prompt/dialog-prompt';
import {MatInputModule} from '@angular/material/input';
import {MatButtonModule} from '@angular/material/button';

@Component({
  selector: 'app-manager',
  templateUrl: './manager.component.html',
  styleUrls: ['./manager.component.css'],
  imports: [
    MatFormFieldModule,
    MatCardModule,
    MatIconModule,
    FormsModule,
    MatBadgeModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatSliderModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatInputModule,
    MatButtonModule
  ]
})
export class ManagerComponent implements OnInit {
  allUsers: any = [];
  load: any = {};
  actualPage = 0;
  filterName = '';
  actionId: string = '';
  showIcon = false;
  idItem = '';

  constructor(
    private _authService: AuthService,
    private _globalService: GlobalService,
    public dialog: MatDialog
  ) {}

  ngOnInit() {
    this.getAllUsers(0);
  }

  getDisplayName(fullName: string): string{
      let splitedName = fullName.split(" ");

      let firstName = splitedName[0];
      let lastName = splitedName[splitedName.length - 1]

      return firstName + " " + lastName;


  }

  showIconByEvent(event: Event, show: boolean) {
    const target = event.target as HTMLElement;
    const icon = target.querySelector('i');
    if (show) {
      if (icon) {
        icon.style.display = 'inline';
        icon.classList.remove('d-none');
      }
    } else {
      if (icon) {
        icon.style.display = 'none';
      }
    }
  }

  openDialogEdit(user: any) {
    const dialogRef = this.dialog.open(DialogPrompt, {
      width: '1200px',
      data: user,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        if (this.filterName.length > 0) {
          this.getAllUsersByUserName(this.filterName, this.actualPage);
        } else {
          this.getAllUsers(this.actualPage);
        }
      }
    });
  }

  morePage() {
    this.actualPage = this.actualPage + 1;

    if (this.filterName.length > 0) {
      this.getAllUsersByUserName(this.filterName, this.actualPage);
    } else {
      this.getAllUsers(this.actualPage);
    }
  }

  activeToogle(user: any) {
    console.log(user);
    this.load.activeToogle = true;
    this.actionId = 'toogle-' + user.id;

    let isActive = !user.active;
    console.log('passei: ', isActive);
    this._authService.activeToggle(user.id, isActive).subscribe(
      (_ret: any) => {
        this.load.activeToogle = false;
        this.actionId = '';
        if (_ret !== null) {
          let idx = this.allUsers.elements.findIndex(
            (x: any) => x.id === user.id
          );
          this.allUsers.elements[idx].active = _ret.active;
        }
      },
      (error) => {
        this.actionId = '';
        this.load.activeToogle = false;
      }
    );
  }

  getAllUsers(page: number) {

  }

  getAllUsersByUserName(userName: string, page: number) {

  }
}
