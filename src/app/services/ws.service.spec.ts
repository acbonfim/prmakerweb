/* tslint:disable:no-unused-variable */

import { TestBed, async, inject } from '@angular/core/testing';
import { WsService } from './ws.service';

describe('Service: Ws', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WsService]
    });
  });

  it('should ...', inject([WsService], (service: WsService) => {
    expect(service).toBeTruthy();
  }));
});
