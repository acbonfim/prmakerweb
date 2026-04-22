# Módulo de Férias - Documentação de Implementação

## 📋 Visão Geral

O módulo de férias foi implementado seguindo o padrão da aplicação existente, permitindo que os usuários solicitem, visualizem e gerenciem suas férias através de um calendário interativo.

## 🗂️ Estrutura de Arquivos

```
src/app/
├── pages/authenticated/vacations/
│   ├── components/
│   │   └── vacation-request-modal.component.ts    # Modal de criação/edição de férias
│   ├── models/
│   │   └── vacation.model.ts                      # Interfaces e enums TypeScript
│   ├── vacations.component.ts                     # Componente principal
│   ├── vacations.component.html                   # Template HTML
│   └── vacations.component.css                    # Estilos
├── services/
│   └── vacation.service.ts                        # Service de integração com API
└── components/side-menu/
    └── side-menu.component.ts                     # Item adicionado ao menu
```

## 🔌 Integração com a API

O módulo consome a API REST documentada em `VACATIONS_API_DOCUMENTATION.md`:

- **Base URL**: `${environment.apiUrl}Vacations`
- **Autenticação**: Token JWT via interceptor existente
- **Endpoints utilizados**:
  - `POST /request` - Criar solicitação
  - `PUT /request/{id}` - Atualizar solicitação
  - `GET /my-requests` - Minhas solicitações
  - `GET /all-requests` - Todas as solicitações (gestores)
  - `GET /calendar` - Calendário mensal
  - `GET /balance` - Saldo de férias
  - `POST /request/{id}/approve` - Aprovar (gestor)
  - `POST /request/{id}/authorize` - Autorizar RH (gestor)
  - `DELETE /request/{id}` - Excluir

## 🎯 Funcionalidades Implementadas

### 1. Calendário Interativo
- Visualização mensal com navegação entre meses
- Marcação visual de dias ocupados
- Tooltip mostrando usuários em férias
- Destaque do dia atual

### 2. Solicitação de Férias
- Modal para criar nova solicitação
- Validação de datas (não pode ser no passado)
- Verificação de saldo disponível
- Cálculo de dias úteis

### 3. Gestão de Solicitações
- **Usuário comum**:
  - Visualizar suas próprias solicitações
  - Editar solicitações pendentes
  - Excluir solicitações pendentes

- **Gestor** (role 'gestor' ou 'admin'):
  - Visualizar todas as solicitações
  - Aprovar solicitações pendentes
  - Autorizar férias (RH)
  - Excluir qualquer solicitação (exceto concluídas)

### 4. Controle de Status
- **Status 1 - Aguardando Aprovação** (amarelo)
- **Status 2 - Aprovado pelo Gestor** (azul)
- **Status 3 - Autorizado pelo RH** (verde)
- **Status 4 - Concluído** (cinza)
- **Status 5 - Cancelado** (vermelho)

### 5. Saldo de Férias
- Exibição do saldo disponível no topo
- Validação automática antes de criar solicitação
- Indicadores visuais de dias disponíveis, usados e restantes

## 🔐 Controle de Permissões

O módulo extrai as roles do token JWT armazenado no `apiKey`:

```typescript
const token = this.storageService.getItem('apiKey');
const payload = JSON.parse(atob(token.split('.')[1]));
const roles = Array.isArray(payload.role) ? payload.role : [payload.role];
this.isManager = roles.includes('gestor') || roles.includes('admin');
```

### Regras de Permissão

| Ação | Usuário Comum | Gestor/Admin |
|------|---------------|--------------|
| Ver calendário | ✅ | ✅ |
| Criar solicitação | ✅ | ✅ |
| Editar própria solicitação (status 1) | ✅ | ✅ |
| Excluir própria solicitação (status 1) | ✅ | ✅ |
| Ver todas as solicitações | ❌ | ✅ |
| Aprovar solicitações | ❌ | ✅ |
| Autorizar férias (RH) | ❌ | ✅ |
| Excluir qualquer solicitação | ❌ | ✅ |

## 🚀 Como Acessar

1. Faça login na aplicação
2. No menu lateral, clique em **"Férias"** (ícone de guarda-sol)
3. A rota acessada será: `/auth/vacations`

## 📱 Abas do Módulo

### 1. Calendário
- Visualização mensal de férias autorizadas
- Botão para criar nova solicitação
- Navegação entre meses/anos

### 2. Minhas Solicitações
- Lista de todas as suas solicitações
- Opções de editar/excluir (quando permitido)
- Status coloridos
- Observações do gestor/RH

### 3. Gestão de Férias (apenas gestores)
- Lista de todas as solicitações da equipe
- Botões de aprovar/autorizar/excluir
- Filtros por status (futuro)

## 🎨 Componentes e Estilização

O módulo utiliza Angular Material seguindo o padrão da aplicação:
- `MatCard` para containers
- `MatTabs` para organização
- `MatDialog` para modais
- `MatButton`, `MatIcon`, `MatChip` para UI
- `MatDatepicker` para seleção de datas
- `MatSnackBar` para notificações

## 📊 Fluxo de Aprovação

```
1. Usuário cria solicitação
   ↓
2. Status: Aguardando Aprovação (amarelo)
   ↓
3. Gestor aprova
   ↓
4. Status: Aprovado pelo Gestor (azul)
   ↓
5. Gestor/RH autoriza (deduz do saldo)
   ↓
6. Status: Autorizado pelo RH (verde)
   ↓
7. Quando data chega: Concluído (cinza)
```

## ⚠️ Validações Implementadas

### Frontend
- ✅ Data de início não pode ser no passado
- ✅ Data de fim deve ser posterior à de início
- ✅ Dias úteis deve ser maior que zero
- ✅ Saldo suficiente antes de criar
- ✅ Apenas status "Pendente" pode ser editado
- ✅ Verificação de role para ações de gestor

### Backend (API)
- ✅ Validação de saldo de férias
- ✅ Verificação de conflito de datas do mesmo usuário
- ✅ Controle de status para ações
- ✅ Autenticação via JWT
- ✅ Autorização por roles

## 🔄 Integração com Sistema Existente

### Autenticação
- Utiliza o mesmo interceptor (`auth.interceptor.ts`)
- Token JWT enviado no header `Authorization: Bearer {token}`
- Token também enviado como `x-api-key` para rotas autenticadas

### Storage
- Usa `StorageService` para acessar dados do usuário logado
- Extrai `user.externalId` para identificação

### Loading
- Integrado com `LoadingBarService` existente
- Exibe barra de progresso durante requisições

### Notificações
- Utiliza `MatSnackBar` para feedback ao usuário
- Mensagens de sucesso e erro padronizadas

## 📝 Notas Técnicas

### Calendário
- Construído manualmente para máximo controle
- Suporta múltiplos usuários na mesma data
- Considera apenas férias com status 3 (Autorizado) ou 4 (Concluído)

### Responsividade
- Design mobile-first
- Breakpoint em 768px
- Grid adaptável para diferentes telas

### Performance
- Lazy loading do componente
- Standalone components (Angular 14+)
- ChangeDetection otimizado

## 🐛 Troubleshooting

### Problema: Não consigo ver a aba "Gestão de Férias"
**Solução**: Verifique se seu usuário possui a role 'gestor' ou 'admin' no token JWT.

### Problema: Erro 401 ao fazer requisições
**Solução**: Verifique se o token JWT está válido e sendo enviado corretamente pelo interceptor.

### Problema: Calendário não carrega férias
**Solução**: Verifique se há férias autorizadas (status 3 ou 4) no período selecionado.

### Problema: Não consigo criar solicitação
**Solução**: Verifique se você possui saldo de férias cadastrado para o ano atual.

## 🚀 Melhorias Futuras Sugeridas

1. **Filtros avançados**: Por status, período, usuário
2. **Exportação**: PDF/Excel das solicitações
3. **Notificações**: Email quando status muda
4. **Comentários**: Thread de discussão nas solicitações
5. **Histórico**: Log de todas as alterações
6. **Dashboard**: Gráficos e estatísticas
7. **Integração**: Com calendário externo (Google Calendar, Outlook)
8. **Mobile App**: Aplicativo nativo
9. **Cálculo automático**: Dias úteis considerando feriados
10. **Aprovação em lote**: Para gestores

## 📞 Suporte

Em caso de dúvidas ou problemas, consulte:
- Documentação da API: `VACATIONS_API_DOCUMENTATION.md`
- Código fonte: `src/app/pages/authenticated/vacations/`
- Service: `src/app/services/vacation.service.ts`

---

**Desenvolvido seguindo o padrão da aplicação Solvace PRForm**
