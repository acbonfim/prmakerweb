/* tslint:disable:no-unused-variable */

import { TestBed, async, inject } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { WsService } from './ws.service';

describe('Service: Ws', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WsService, provideHttpClient(), provideHttpClientTesting()]
    });
  });

  it('should ...', inject([WsService], (service: WsService) => {
    expect(service).toBeTruthy();
  }));
});
