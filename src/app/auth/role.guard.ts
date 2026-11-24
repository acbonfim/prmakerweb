import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RoleService } from '../services/role.service';
import { GlobalService } from '../services/global.service';
import { RoleRouteData, decideRoleRoute } from '../services/role.logic';

/**
 * 0099 (ajustes 2): guarda por papel. `data.roles` (precisa de um), `data.deny` (barra quem só tem estes),
 * `data.access` (regra nomeada: workbench | desk | not-management-only) e `data.redirect` (padrão: Início).
 * Use depois do AuthGuard: `canActivate: [AuthGuard, roleGuard]`.
 */
export const roleGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const data = (route.data ?? {}) as RoleRouteData;
  const decision = decideRoleRoute(inject(RoleService).roles(), data);
  if (decision === true) return true;
  if (data.message) inject(GlobalService).sendAlertError(data.message, 'OK');
  // Mantém a query (card/épico) quando o destino é a Mesa — o link antigo continua útil.
  const target = router.parseUrl(decision);
  if (decision.startsWith('/auth/desk') && !Object.keys(target.queryParams).length) {
    const q = route.queryParams ?? {};
    if (q['card']) target.queryParams = { card: q['card'] };
  }
  return state.url.split('?')[0] === decision.split('?')[0] ? false : target;
};
