# Módulo de Férias - Atualizações Implementadas

## 📋 Resumo das Alterações

O módulo de férias foi completamente atualizado para suportar **períodos aquisitivos** conforme a nova estrutura da API, além de incluir novas telas dedicadas para melhor gestão das férias.

---

## 🆕 Novas Funcionalidades Implementadas

### 1. **Suporte a Períodos Aquisitivos**

O sistema agora trabalha com períodos aquisitivos em vez de anos simples:
- **Período Aquisitivo**: Período de ~12 meses em que o funcionário trabalha para adquirir férias
- **Período de Gozo**: Período de 12 meses após o aquisitivo em que as férias podem ser tiradas
- Campo `isActive`: Indica se o período ainda está válido

**Novos campos nos models:**
```typescript
interface VacationBalance {
  // ... campos anteriores
  acquisitionPeriodStart: string;  // Novo
  acquisitionPeriodEnd: string;    // Novo
  usagePeriodStart: string;        // Novo
  usagePeriodEnd: string;          // Novo
  isActive: boolean;               // Novo
}
```

### 2. **Tela de Gerenciamento de Períodos Aquisitivos**

**Rota:** `/auth/vacation-balances`

**Funcionalidades:**
- ✅ Visualizar todos os períodos aquisitivos (ativos e expirados)
- ✅ Criar novo período aquisitivo
- ✅ Editar período existente
- ✅ Excluir período (apenas se não houver dias usados)
- ✅ Visualização em cards com informações detalhadas
- ✅ Cálculo automático do período de gozo
- ✅ Validação de período de ~12 meses (365-366 dias)

**Modal de Criação/Edição:**
- Campos: Dias Disponíveis, Início e Fim do Período Aquisitivo
- Cálculo automático do período de gozo
- Validações:
  - Período deve ter aproximadamente 12 meses
  - Dias disponíveis entre 0 e 30
  - Data de fim posterior à de início

### 3. **Tela Dedicada para Aprovação de Férias (Gestores)**

**Rota:** `/auth/vacation-approvals`

**Funcionalidades:**
- ✅ Visualização de todas as solicitações em cards
- ✅ Filtro por status (Todos, Aguardando Aprovação, Aprovado, Autorizado, Concluído)
- ✅ Aprovar solicitações pendentes
- ✅ Autorizar férias (RH)
- ✅ Excluir solicitações
- ✅ Visualização de observações do gestor e RH
- ✅ Interface limpa e organizada

### 4. **Calendário Sem Scroll**

**Ajustes realizados:**
- Redução de gaps entre células (8px → 4px)
- Tamanho de fonte ajustado (14px → 13px nos dias da semana)
- Altura controlada dos dias (min: 60px, max: 80px)
- `overflow: hidden` no container do calendário
- `grid-auto-rows: 1fr` para altura uniforme
- Padding reduzido para melhor aproveitamento do espaço

O calendário agora exibe todo o mês sem necessidade de scroll vertical.

---

## 🔧 Atualizações no Service

### Novos Endpoints (Recomendados)

```typescript
// Obter todos os períodos aquisitivos do usuário
getMyBalances(): Observable<VacationBalance[]>

// Obter todos os períodos de um usuário específico (gestor)
getUserBalances(userId: string): Observable<VacationBalance[]>

// Criar novo período aquisitivo
createBalance(request: CreateVacationBalance): Observable<VacationBalance>

// Atualizar período existente
updateBalance(id: number, request: UpdateVacationBalance): Observable<VacationBalance>

// Excluir período
deleteBalance(id: number): Observable<void>
```

### Endpoints Antigos (Mantidos para Compatibilidade)

```typescript
// Deprecated - usar getMyBalances()
getMyBalance(year: number): Observable<VacationBalance>

// Deprecated - usar getUserBalances(userId)
getUserBalance(userId: string, year: number): Observable<VacationBalance>
```

---

## 📁 Novos Arquivos Criados

### Componentes

1. **balance-modal.component.ts**
   - Modal para criar/editar períodos aquisitivos
   - Validações de período e cálculo automático de gozo
   - Localização: `src/app/pages/authenticated/vacations/components/`

2. **vacation-balances.component.ts**
   - Tela de gerenciamento de períodos aquisitivos
   - Grid responsivo de cards
   - Localização: `src/app/pages/authenticated/vacations/`

3. **vacation-approvals.component.ts**
   - Tela dedicada para gestores aprovarem férias
   - Filtros por status
   - Localização: `src/app/pages/authenticated/vacations/`

### Models Atualizados

**vacation.model.ts** - Adicionados:
- `CreateVacationBalance`
- `UpdateVacationBalance`
- Campos de período aquisitivo em `VacationBalance`

---

## 🗺️ Novas Rotas

```typescript
// Tela principal de férias (calendário e solicitações)
/auth/vacations

// Gerenciamento de períodos aquisitivos
/auth/vacation-balances

// Aprovação de férias (gestores)
/auth/vacation-approvals
```

---

## 🎨 Itens de Menu Adicionados

1. **Férias** (`beach_access`) → `/auth/vacations`
   - Calendário e solicitações de férias

2. **Meus Períodos** (`event_available`) → `/auth/vacation-balances`
   - Gerenciar períodos aquisitivos

3. **Aprovar Férias** (`assignment_turned_in`) → `/auth/vacation-approvals`
   - Tela de aprovação para gestores

---

## 🔄 Mudanças no Componente Principal

### vacations.component.ts

**Antes:**
```typescript
myBalance: VacationBalance | null = null;

loadBalance() {
  this.vacationService.getMyBalance(this.currentYear).subscribe(...)
}
```

**Depois:**
```typescript
myBalances: VacationBalance[] = [];
activeBalances: VacationBalance[] = [];

loadBalance() {
  this.vacationService.getMyBalances().subscribe({
    next: (balances) => {
      this.myBalances = balances;
      this.activeBalances = balances.filter(b => b.isActive);
      // ...
    }
  });
}

// Novos métodos para totais
getTotalRemainingDays(): number
getTotalAvailableDays(): number
getTotalUsedDays(): number
```

### vacations.component.html

**Exibição de Saldo Atualizada:**
```html
<div class="balance-info" *ngIf="activeBalances.length > 0">
  <div class="balance-item">
    <span class="balance-label">Disponível:</span>
    <span class="balance-value">{{ getTotalAvailableDays() }} dias</span>
  </div>
  <!-- Soma de todos os períodos ativos -->
</div>
```

---

## ✅ Funcionalidades Completas

### Para Usuários Comuns:
- [x] Ver calendário mensal
- [x] Ver seus saldos de férias (todos os períodos)
- [x] Criar/editar/excluir solicitações pendentes
- [x] Gerenciar períodos aquisitivos
- [x] Ver total de dias disponíveis de todos os períodos ativos

### Para Gestores:
- [x] Todas as funcionalidades de usuário comum
- [x] Tela dedicada para aprovações
- [x] Filtrar solicitações por status
- [x] Aprovar solicitações
- [x] Autorizar férias (RH)
- [x] Excluir qualquer solicitação (exceto concluídas)

---

## 🎨 Melhorias Visuais

### Calendário:
- ✅ Exibição sem scroll (tudo visível na tela)
- ✅ Espaçamento otimizado
- ✅ Altura controlada e uniforme dos dias
- ✅ Responsivo para mobile

### Cards de Períodos:
- ✅ Visual limpo e organizado
- ✅ Indicadores de status (Ativo/Expirado)
- ✅ Informações de período aquisitivo e de gozo separadas
- ✅ Chips coloridos para status
- ✅ Hover effect nos cards

### Tela de Aprovações:
- ✅ Grid responsivo
- ✅ Filtro por status
- ✅ Ações contextuais por card
- ✅ Indicadores visuais de status

---

## 📱 Responsividade

Todos os novos componentes são totalmente responsivos:
- Desktop: Grid com múltiplas colunas
- Tablet: 2 colunas
- Mobile: 1 coluna

---

## 🔐 Controle de Permissões

As novas telas respeitam as roles do JWT:
- **Meus Períodos**: Todos os usuários
- **Aprovar Férias**: Apenas gestores e admins

O sistema extrai automaticamente as roles do token e habilita/desabilita funcionalidades.

---

## 📊 Fluxo Completo de Uso

### Usuário Comum:
1. Acessa "Meus Períodos" → Cria período aquisitivo
2. Acessa "Férias" → Vê saldo total disponível
3. Cria solicitação de férias
4. Aguarda aprovação do gestor

### Gestor:
1. Acessa "Aprovar Férias" → Filtra por "Aguardando Aprovação"
2. Aprova solicitação (status → Aprovado pelo Gestor)
3. Autoriza férias (status → Autorizado pelo RH)
4. Dias são deduzidos automaticamente do saldo

---

## 🐛 Correções de Bugs

1. **DatePicker Error**: Adicionados providers necessários
   - `DateAdapter`
   - `MAT_DATE_FORMATS`
   - `MAT_DATE_LOCALE`

2. **Calendário com Scroll**: Ajustado CSS para exibição completa

3. **Compatibilidade com API**: Suporte a períodos aquisitivos implementado

---

## 📝 Notas Técnicas

### Validações Implementadas:
- Período aquisitivo deve ter 365-366 dias
- Dias disponíveis entre 0 e 30
- Não pode excluir período com dias usados
- Data de fim posterior à de início

### Cálculos Automáticos:
- Período de gozo calculado automaticamente (12 meses após o aquisitivo)
- Total de dias somando todos os períodos ativos
- Status `isActive` baseado na data atual vs período de gozo

---

## 🚀 Como Usar

### Acessar as Novas Telas:

1. **Gerenciar Períodos:**
   - Menu → "Meus Períodos"
   - Ou navegar para: `/auth/vacation-balances`

2. **Aprovar Férias (Gestores):**
   - Menu → "Aprovar Férias"
   - Ou navegar para: `/auth/vacation-approvals`

3. **Calendário e Solicitações:**
   - Menu → "Férias"
   - Ou navegar para: `/auth/vacations`

---

## 🎯 Benefícios das Atualizações

✅ **Conformidade com Legislação**: Períodos aquisitivos refletem a CLT
✅ **Melhor UX**: Telas dedicadas para cada funcionalidade
✅ **Gestão Facilitada**: Gestores têm tela específica para aprovações
✅ **Visualização Clara**: Calendário sem scroll, cards informativos
✅ **Múltiplos Períodos**: Suporte a vários períodos aquisitivos simultâneos
✅ **Validações Robustas**: Prevenção de erros e inconsistências

---

**Módulo completamente atualizado e pronto para uso!** 🎉
