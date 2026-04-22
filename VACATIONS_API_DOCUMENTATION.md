# API de Gerenciamento de Férias - Documentação

## ⚠️ MUDANÇAS IMPORTANTES - LEIA PRIMEIRO

### Atualização do Modelo de Saldo de Férias

O sistema foi refatorado para trabalhar com **períodos aquisitivos** em vez de anos simples. Esta mudança reflete melhor a legislação trabalhista brasileira.

### O que mudou:

#### **ANTES (modelo antigo por ano):**
```json
{
  "userId": "...",
  "availableDays": 30,
  "year": 2024
}
```

#### **AGORA (modelo com períodos):**
```json
{
  "userId": "...",
  "availableDays": 30,
  "acquisitionPeriodStart": "2024-01-01T00:00:00Z",
  "acquisitionPeriodEnd": "2024-12-31T00:00:00Z",
  "usagePeriodStart": "2025-01-01T00:00:00Z",
  "usagePeriodEnd": "2025-12-31T00:00:00Z",
  "year": 2024,
  "isActive": true
}
```

### ✅ Ações Necessárias no Frontend:

1. **Atualizar modelo de dados:**
   - Adicionar campos de período aquisitivo e período de gozo aos tipos/interfaces
   - O campo `year` ainda existe para compatibilidade

2. **Usar novos endpoints:**
   - ✅ **RECOMENDADO:** `GET /api/v1/Vacations/balances` - lista todos os períodos
   - ⚠️ **DEPRECATED:** `GET /api/v1/Vacations/balance?year=2024` - ainda funciona mas não recomendado

3. **Criar saldo com período:**
   - Endpoint `POST /api/v1/Vacations/balance` agora requer `acquisitionPeriodStart` e `acquisitionPeriodEnd` em vez de `year`

4. **Exibir informações do período:**
   - Mostrar ao usuário qual período aquisitivo ele tem direito
   - Indicar qual o período de gozo (quando pode usar as férias)
   - Usar o campo `isActive` para mostrar apenas períodos válidos

5. **Validação de datas:**
   - O backend valida se a data da solicitação está dentro do período de gozo
   - Nova mensagem de erro: "Vacation dates are outside the usage period for this balance"

### 📋 Exemplo de Uso no Frontend:

```javascript
// Buscar todos os saldos do usuário
const response = await fetch('/api/v1/Vacations/balances', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const balances = await response.json();

// Filtrar apenas períodos ativos
const activeBalances = balances.filter(b => b.isActive);

// Exibir para o usuário
activeBalances.forEach(balance => {
  console.log(`Período Aquisitivo: ${balance.acquisitionPeriodStart} a ${balance.acquisitionPeriodEnd}`);
  console.log(`Pode usar de: ${balance.usagePeriodStart} a ${balance.usagePeriodEnd}`);
  console.log(`Dias disponíveis: ${balance.remainingDays}`);
});
```

### 🔄 Resumo das Mudanças de Endpoints:

| Ação | Endpoint Antigo (Deprecated) | Endpoint Novo (Recomendado) |
|------|------------------------------|------------------------------|
| Criar saldo | `POST /balance` com `{userId, availableDays, year}` | `POST /balance` com `{userId, availableDays, acquisitionPeriodStart, acquisitionPeriodEnd}` |
| Obter meu saldo | `GET /balance?year=2024` | `GET /balances` (retorna array com todos os períodos) |
| Obter saldo de usuário | `GET /balance/{userId}?year=2024` | `GET /balances/{userId}` (retorna array com todos os períodos) |

### 🛠️ Migração Passo a Passo:

**Fase 1 - Preparação (sem quebrar o sistema):**
1. Adicionar novos campos aos tipos TypeScript/JavaScript
2. Atualizar telas para exibir os novos campos (se disponíveis)
3. Manter compatibilidade com o campo `year`

**Fase 2 - Migração:**
1. Substituir chamadas de `GET /balance?year=X` por `GET /balances`
2. Atualizar formulários de criação de saldo para usar períodos
3. Adicionar validação de período de gozo nas telas

**Fase 3 - Finalização:**
1. Remover código que usa endpoints deprecated
2. Testar todos os fluxos com o novo modelo

### ⚡ Compatibilidade:

- ✅ Endpoints antigos ainda funcionam (mas marcados como deprecated)
- ✅ Campo `year` ainda é retornado nas respostas
- ✅ Nenhuma quebra imediata - migração pode ser gradual
- ⚠️ Novos saldos criados já incluem todos os campos de período
- ⚠️ Backend valida automaticamente se a data está no período de gozo correto

---

## Visão Geral

Este módulo gerencia solicitações de férias dos usuários, permitindo criar, aprovar e acompanhar períodos de férias. O sistema possui controle de permissões por roles (usuário, gestor, admin) extraídas do token JWT.

**Base URL:** `/api/v1/Vacations`

**Autenticação:** Todas as rotas requerem autenticação via JWT token no header `Authorization: Bearer <token>`

---

## 🎯 Regras Obrigatórias para o Frontend

### 1. Estrutura de Autenticação

**O frontend DEVE:**
- ✅ Armazenar o token JWT recebido do backend de autenticação
- ✅ Enviar o token em TODAS as requisições no header: `Authorization: Bearer <token>`
- ✅ Decodificar o token para extrair informações do usuário:
  ```javascript
  const token = localStorage.getItem('token');
  const decoded = jwt_decode(token);
  const userId = decoded.ExternalId;    // GUID do usuário (claim: ExternalId)
  const roles = decoded.role;            // Array de roles ['user', 'gestor', 'admin']
  ```
- ✅ Redirecionar para login se o token expirar (erro 401)

### 2. Validações de Formulário (Regras de Negócio)

**Ao criar/editar solicitação de férias:**
- ✅ `startDate` NÃO pode ser no passado (validar: `startDate >= hoje`)
- ✅ `endDate` DEVE ser posterior a `startDate` (validar: `endDate > startDate`)
- ✅ `businessDays` DEVE ser maior que zero
- ✅ Verificar saldo disponível ANTES de enviar (chamar endpoint de saldo)
- ✅ Mostrar mensagem se saldo insuficiente

**Exemplo de validação:**
```javascript
const today = new Date();
today.setHours(0, 0, 0, 0);

if (startDate < today) {
  return "A data de início não pode ser no passado";
}

if (endDate <= startDate) {
  return "A data de fim deve ser posterior à data de início";
}

if (businessDays <= 0) {
  return "Dias úteis deve ser maior que zero";
}

// Verificar saldo
const balance = await getVacationBalance(userId, startDate.getFullYear());
if (balance.remainingDays < businessDays) {
  return `Saldo insuficiente. Disponível: ${balance.remainingDays} dias`;
}
```

### 3. Controle de Permissões por Role

**O frontend DEVE habilitar/desabilitar funcionalidades baseado nas roles:**

```javascript
const roles = jwt_decode(token).role;
const isUser = roles.includes('user');
const isGestor = roles.includes('gestor');
const isAdmin = roles.includes('admin');

// Regras de exibição:
// - Botão "Criar Solicitação": sempre visível para todos
// - Botão "Editar": apenas se status === 1 (PendingApproval) E userId === usuarioLogado
// - Botão "Excluir": apenas se status === 1 E userId === usuarioLogado OU isGestor
// - Botão "Aprovar": apenas se isGestor E status === 1
// - Botão "Autorizar RH": apenas se isGestor E status === 2
// - Menu "Gerenciar Saldos": apenas se isAdmin
```

### 4. Status das Solicitações (Enum)

**O backend retorna status como número inteiro. O frontend DEVE mapear:**

```javascript
const VacationStatus = {
  1: { name: 'PendingApproval', label: 'Aguardando Aprovação', color: 'yellow' },
  2: { name: 'ApprovedByManager', label: 'Aprovado pelo Gestor', color: 'blue' },
  3: { name: 'AuthorizedByHR', label: 'Autorizado pelo RH', color: 'green' },
  4: { name: 'Completed', label: 'Concluído', color: 'gray' },
  5: { name: 'Cancelled', label: 'Cancelado', color: 'red' }
};

// Uso:
const statusInfo = VacationStatus[vacationRequest.status];
<Badge color={statusInfo.color}>{statusInfo.label}</Badge>
```

### 5. Formato de Datas (ISO 8601)

**O backend espera e retorna datas no formato ISO 8601:**

```javascript
// Ao ENVIAR para o backend:
const startDate = new Date(2024, 6, 1); // 1 de julho de 2024
const isoString = startDate.toISOString(); // "2024-07-01T00:00:00.000Z"

// Ao RECEBER do backend:
const response = await fetch('/api/v1/Vacations/request/1');
const data = await response.json();
const startDate = new Date(data.startDate); // Converte ISO para Date
```

### 6. Tratamento de Erros

**O backend retorna erros padronizados. O frontend DEVE:**

```javascript
try {
  const response = await fetch('/api/v1/Vacations/request', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestData)
  });

  if (!response.ok) {
    const error = await response.json();

    switch (response.status) {
      case 400:
        // Erro de validação - mostrar mensagem ao usuário
        showError(error.detail || 'Dados inválidos');
        break;
      case 401:
        // Não autenticado - redirecionar para login
        redirectToLogin();
        break;
      case 403:
        // Sem permissão - mostrar mensagem
        showError('Você não tem permissão para esta ação');
        break;
      case 404:
        // Recurso não encontrado
        showError('Solicitação não encontrada');
        break;
      default:
        showError('Erro ao processar requisição');
    }
    return;
  }

  const data = await response.json();
  showSuccess('Operação realizada com sucesso!');
} catch (error) {
  showError('Erro de conexão com o servidor');
}
```

### 7. Atualização de Saldo após Ações

**O frontend DEVE atualizar o saldo automaticamente após:**
- Criar uma solicitação (diminui dias disponíveis temporariamente)
- Excluir uma solicitação autorizada (devolve dias)
- Gestor autorizar solicitação (confirma dedução)

```javascript
// Após criar/excluir/autorizar:
await refreshVacationBalance(userId, year);
```

### 8. Calendário - Regras de Exibição

**Ao exibir o calendário mensal:**
- ✅ Mostrar APENAS férias com status 3 (AuthorizedByHR) ou 4 (Completed)
- ✅ Permitir múltiplos usuários na mesma data
- ✅ Marcar dias ocupados visualmente
- ✅ Mostrar tooltip com nomes dos usuários ao passar o mouse

```javascript
// Buscar calendário do mês
const calendar = await fetch(`/api/v1/Vacations/calendar?month=7&year=2024`);
const days = await calendar.json();

// Renderizar:
days.forEach(day => {
  if (day.isOccupied) {
    // Marcar dia como ocupado
    // Mostrar quantos usuários: day.occupancies.length
    // Tooltip: day.occupancies.map(o => o.userName).join(', ')
  }
});
```

### 9. Fluxo de Aprovação (Importante!)

**O frontend DEVE respeitar o fluxo sequencial:**

1. **Usuário cria** → Status = 1 (PendingApproval)
2. **Gestor aprova** → Status = 2 (ApprovedByManager)
3. **Gestor/RH autoriza** → Status = 3 (AuthorizedByHR) + **deduz saldo**
4. **Sistema marca como concluído** → Status = 4 (quando data chega)

**Regras:**
- ✅ Não permitir autorizar sem antes aprovar
- ✅ Não permitir editar após aprovação
- ✅ Usuário só pode excluir se status = 1
- ✅ Gestor pode excluir se status ≠ 4 e ≠ 5

### 10. Query Parameters - Formatação Correta

**Ao fazer requisições com query params:**

```javascript
// ✅ CORRETO:
const url = `/api/v1/Vacations/calendar?month=${month}&year=${year}`;

// ❌ ERRADO:
const url = `/api/v1/Vacations/calendar?month='${month}'&year='${year}'`;

// Para múltiplos parâmetros, usar URLSearchParams:
const params = new URLSearchParams({
  month: 7,
  year: 2024
});
const url = `/api/v1/Vacations/calendar?${params.toString()}`;
```

---

## Roles e Permissões

- **user**: Usuário comum - pode criar, visualizar e editar suas próprias solicitações
- **gestor**: Gestor - pode aprovar, autorizar e excluir solicitações de férias
- **admin**: Administrador - acesso completo, incluindo gerenciamento de saldos

---

## 1. Solicitações de Férias

### 1.1. Criar Solicitação de Férias

Cria uma nova intenção de férias para o usuário autenticado.

**Endpoint:** `POST /api/v1/Vacations/request`

**Roles:** `user`, `gestor`, `admin`

**Request Body:**
```json
{
  "startDate": "2024-07-01T00:00:00Z",
  "endDate": "2024-07-15T00:00:00Z",
  "businessDays": 10
}
```

**Campos:**
- `startDate` (DateTime, obrigatório): Data de início das férias (não pode ser no passado)
- `endDate` (DateTime, obrigatório): Data de fim das férias (deve ser posterior a startDate)
- `businessDays` (int, obrigatório): Quantidade de dias úteis solicitados

**Response:** `200 OK`
```json
{
  "id": 1,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "startDate": "2024-07-01T00:00:00Z",
  "endDate": "2024-07-15T00:00:00Z",
  "businessDays": 10,
  "status": 1,
  "statusDescription": "PendingApproval",
  "managerNotes": null,
  "hrNotes": null,
  "approvedByManagerId": null,
  "approvedByManagerAt": null,
  "authorizedByHRId": null,
  "authorizedByHRAt": null,
  "createdAt": "2024-06-01T10:00:00Z",
  "updatedAt": null
}
```

**Validações:**
- O usuário deve ter saldo de férias suficiente para o ano solicitado
- **Saldo automático:** Se o usuário não tiver saldo cadastrado, o sistema cria automaticamente um saldo de 30 dias para o ano
- Não pode haver conflito com outras solicitações do mesmo usuário
- A data de início não pode ser no passado

**Erros Possíveis:**
- `400 Bad Request`: Dados inválidos ou saldo insuficiente
- `401 Unauthorized`: Token inválido ou ausente

---

### 1.2. Atualizar Solicitação de Férias

Atualiza uma solicitação de férias existente. **Só pode ser feito se o status for "PendingApproval"** (antes da aprovação do gestor).

**Endpoint:** `PUT /api/v1/Vacations/request/{id}`

**Roles:** `user`, `gestor`, `admin`

**Path Parameters:**
- `id` (int): ID da solicitação de férias

**Request Body:**
```json
{
  "startDate": "2024-07-05T00:00:00Z",
  "endDate": "2024-07-20T00:00:00Z",
  "businessDays": 12
}
```

**Response:** `200 OK` (mesmo formato da criação)

**Regras:**
- Somente o próprio usuário pode editar sua solicitação
- Não pode editar após aprovação do gestor
- Valida saldo disponível e conflitos de datas

**Erros Possíveis:**
- `400 Bad Request`: Tentativa de edição após aprovação ou dados inválidos
- `403 Forbidden`: Tentativa de editar solicitação de outro usuário
- `404 Not Found`: Solicitação não encontrada

---

### 1.3. Obter Solicitação de Férias Específica

Retorna os detalhes de uma solicitação de férias.

**Endpoint:** `GET /api/v1/Vacations/request/{id}`

**Roles:** `user`, `gestor`, `admin`

**Path Parameters:**
- `id` (int): ID da solicitação de férias

**Response:** `200 OK` (mesmo formato da criação)

**Erros Possíveis:**
- `404 Not Found`: Solicitação não encontrada

---

### 1.4. Obter Minhas Solicitações de Férias

Retorna todas as solicitações de férias do usuário autenticado.

**Endpoint:** `GET /api/v1/Vacations/my-requests`

**Roles:** `user`, `gestor`, `admin`

**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "startDate": "2024-07-01T00:00:00Z",
    "endDate": "2024-07-15T00:00:00Z",
    "businessDays": 10,
    "status": 2,
    "statusDescription": "ApprovedByManager",
    "managerNotes": "Aprovado",
    "hrNotes": null,
    "approvedByManagerId": "660e8400-e29b-41d4-a716-446655440000",
    "approvedByManagerAt": "2024-06-02T14:30:00Z",
    "authorizedByHRId": null,
    "authorizedByHRAt": null,
    "createdAt": "2024-06-01T10:00:00Z",
    "updatedAt": "2024-06-02T14:30:00Z"
  }
]
```

---

### 1.5. Obter Todas as Solicitações de Férias

Retorna todas as solicitações de férias de todos os usuários (para visualização geral do quadro).

**Endpoint:** `GET /api/v1/Vacations/all-requests`

**Roles:** `user`, `gestor`, `admin`

**Response:** `200 OK` (array com mesmo formato acima)

---

### 1.6. Aprovar Solicitação de Férias (Gestor)

Aprova uma solicitação de férias. Muda o status para "ApprovedByManager".

**Endpoint:** `POST /api/v1/Vacations/request/{id}/approve`

**Roles:** `gestor`, `admin`

**Path Parameters:**
- `id` (int): ID da solicitação de férias

**Request Body:**
```json
{
  "notes": "Aprovado conforme solicitado"
}
```

**Campos:**
- `notes` (string, opcional): Observações do gestor

**Response:** `200 OK` (mesmo formato da criação com status atualizado)

**Regras:**
- Somente solicitações com status "PendingApproval" podem ser aprovadas
- O ID do gestor é extraído automaticamente do token JWT

**Erros Possíveis:**
- `400 Bad Request`: Status não permite aprovação
- `403 Forbidden`: Usuário não tem role de gestor
- `404 Not Found`: Solicitação não encontrada

---

### 1.7. Autorizar Solicitação de Férias (RH)

Autoriza uma solicitação já aprovada pelo gestor. Muda o status para "AuthorizedByHR" e **deduz os dias do saldo do usuário**.

**Endpoint:** `POST /api/v1/Vacations/request/{id}/authorize`

**Roles:** `gestor`, `admin`

**Path Parameters:**
- `id` (int): ID da solicitação de férias

**Request Body:**
```json
{
  "notes": "Autorizado pelo RH"
}
```

**Campos:**
- `notes` (string, opcional): Observações do RH

**Response:** `200 OK` (mesmo formato da criação com status atualizado)

**Regras:**
- Somente solicitações com status "ApprovedByManager" podem ser autorizadas
- O ID do responsável RH é extraído automaticamente do token JWT
- Os dias úteis são automaticamente deduzidos do saldo do usuário

**Erros Possíveis:**
- `400 Bad Request`: Status não permite autorização ou saldo não encontrado
- `403 Forbidden`: Usuário não tem role de gestor
- `404 Not Found`: Solicitação não encontrada

---

### 1.8. Excluir Solicitação de Férias

Exclui uma solicitação de férias. Regras variam conforme o usuário:

**Endpoint:** `DELETE /api/v1/Vacations/request/{id}`

**Roles:** `user`, `gestor`, `admin`

**Path Parameters:**
- `id` (int): ID da solicitação de férias

**Response:** `204 No Content`

**Regras por Role:**

**Usuário comum:**
- Pode excluir apenas suas próprias solicitações
- Somente se o status for "PendingApproval" (antes da aprovação do gestor)

**Gestor/Admin:**
- Pode excluir qualquer solicitação
- Não pode excluir solicitações com status "Completed" ou "Cancelled"
- Se excluir uma solicitação já autorizada pelo RH, os dias são devolvidos ao saldo do usuário

**Erros Possíveis:**
- `400 Bad Request`: Tentativa de exclusão não permitida pelo status
- `403 Forbidden`: Usuário tentando excluir solicitação de outro usuário sem ser gestor
- `404 Not Found`: Solicitação não encontrada

---

## 2. Calendário de Férias

### 2.1. Obter Calendário Mensal

Retorna o calendário de férias de um mês específico, mostrando as datas ocupadas e por quem estão ocupadas.

**Endpoint:** `GET /api/v1/Vacations/calendar`

**Roles:** `user`, `gestor`, `admin`

**Query Parameters:**
- `month` (int, obrigatório): Mês (1-12)
- `year` (int, obrigatório): Ano (2000-2100)

**Exemplo:** `GET /api/v1/Vacations/calendar?month=7&year=2024`

**Response:** `200 OK`
```json
[
  {
    "date": "2024-07-01T00:00:00Z",
    "isOccupied": true,
    "occupancies": [
      {
        "userId": "550e8400-e29b-41d4-a716-446655440000",
        "userName": "550e8400-e29b-41d4-a716-446655440000",
        "vacationRequestId": 1
      },
      {
        "userId": "660e8400-e29b-41d4-a716-446655440000",
        "userName": "660e8400-e29b-41d4-a716-446655440000",
        "vacationRequestId": 3
      }
    ]
  },
  {
    "date": "2024-07-02T00:00:00Z",
    "isOccupied": true,
    "occupancies": [
      {
        "userId": "550e8400-e29b-41d4-a716-446655440000",
        "userName": "550e8400-e29b-41d4-a716-446655440000",
        "vacationRequestId": 1
      }
    ]
  },
  {
    "date": "2024-07-03T00:00:00Z",
    "isOccupied": false,
    "occupancies": []
  }
]
```

**Campos:**
- `date`: Data do dia
- `isOccupied`: Indica se há pelo menos uma pessoa de férias neste dia
- `occupancies`: Lista de usuários de férias neste dia (somente férias autorizadas ou concluídas)

**Observações:**
- Retorna todos os dias do mês solicitado
- Somente férias com status "AuthorizedByHR" ou "Completed" aparecem no calendário
- O campo `userName` atualmente retorna o GUID do usuário (pode ser integrado com um serviço externo de usuários)

**Erros Possíveis:**
- `400 Bad Request`: Mês ou ano inválido

---

## 3. Saldo de Férias

> **💡 IMPORTANTE - MUDANÇA NO MODELO:** O sistema agora trabalha com **períodos aquisitivos** em vez de anos simples. Cada saldo é baseado em um período aquisitivo (aproximadamente 12 meses) e possui um período de gozo correspondente (12 meses após o período aquisitivo).

> **💡 Saldo Automático:** O sistema cria **automaticamente** um saldo de 30 dias quando o usuário faz sua primeira solicitação de férias. O período aquisitivo padrão é de 01/01 a 31/12 do ano da solicitação. Portanto, **não é obrigatório** cadastrar saldos manualmente, a menos que você queira definir valores ou períodos diferentes.

### Conceitos Importantes:

- **Período Aquisitivo:** Período de ~12 meses em que o funcionário trabalha para adquirir o direito às férias
- **Período de Gozo:** Período de 12 meses **após** o período aquisitivo em que as férias podem ser tiradas
- **Exemplo:**
  - Período Aquisitivo: 01/01/2024 a 31/12/2024 (trabalha)
  - Período de Gozo: 01/01/2025 a 31/12/2025 (pode tirar férias)

### 3.1. Criar Saldo de Férias (Admin)

Cria o registro de saldo de férias para um usuário com período aquisitivo específico.

**Endpoint:** `POST /api/v1/Vacations/balance`

**Roles:** `admin`

**Request Body:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "availableDays": 30,
  "acquisitionPeriodStart": "2024-01-01T00:00:00Z",
  "acquisitionPeriodEnd": "2024-12-31T00:00:00Z"
}
```

**Campos:**
- `userId` (Guid, obrigatório): ID do usuário
- `availableDays` (int, obrigatório): Quantidade de dias disponíveis (deve ser >= 0)
- `acquisitionPeriodStart` (DateTime, obrigatório): Data de início do período aquisitivo
- `acquisitionPeriodEnd` (DateTime, obrigatório): Data de fim do período aquisitivo

**Validações:**
- O período aquisitivo deve ter aproximadamente 12 meses (365-366 dias)
- `acquisitionPeriodStart` deve ser anterior a `acquisitionPeriodEnd`
- Não pode haver outro saldo com o mesmo período aquisitivo para o mesmo usuário

**Response:** `200 OK`
```json
{
  "id": 1,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "availableDays": 30,
  "usedDays": 0,
  "remainingDays": 30,
  "acquisitionPeriodStart": "2024-01-01T00:00:00Z",
  "acquisitionPeriodEnd": "2024-12-31T00:00:00Z",
  "usagePeriodStart": "2025-01-01T00:00:00Z",
  "usagePeriodEnd": "2025-12-31T00:00:00Z",
  "year": 2024,
  "isActive": true,
  "createdAt": "2024-01-01T08:00:00Z",
  "updatedAt": null
}
```

**Campos de Resposta:**
- `acquisitionPeriodStart/End`: Período em que o funcionário trabalhou para adquirir as férias
- `usagePeriodStart/End`: Período em que as férias podem ser tiradas (calculado automaticamente: 12 meses após o período aquisitivo)
- `year`: Ano de referência (baseado no início do período aquisitivo) - mantido para compatibilidade
- `isActive`: Indica se o período de gozo ainda está válido (hoje <= usagePeriodEnd)

**Regras:**
- Cada usuário pode ter apenas um saldo por período aquisitivo
- O período de gozo é calculado automaticamente: inicia no dia seguinte ao fim do período aquisitivo e dura 12 meses

**Erros Possíveis:**
- `400 Bad Request`: Período inválido, dias negativos, ou saldo já existe para este período
- `403 Forbidden`: Usuário não tem role de admin

---

### 3.2. Obter Meu Saldo de Férias (por ano - deprecated)

> **⚠️ DEPRECATED:** Este endpoint está mantido para compatibilidade mas recomenda-se usar `/balances` para obter todos os períodos.

Retorna o saldo de férias do usuário autenticado para um ano específico.

**Endpoint:** `GET /api/v1/Vacations/balance`

**Roles:** `user`, `gestor`, `admin`

**Query Parameters:**
- `year` (int, obrigatório): Ano de referência (2000-2100)

**Exemplo:** `GET /api/v1/Vacations/balance?year=2024`

**Response:** `200 OK`
```json
{
  "id": 1,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "availableDays": 30,
  "usedDays": 10,
  "remainingDays": 20,
  "acquisitionPeriodStart": "2024-01-01T00:00:00Z",
  "acquisitionPeriodEnd": "2024-12-31T00:00:00Z",
  "usagePeriodStart": "2025-01-01T00:00:00Z",
  "usagePeriodEnd": "2025-12-31T00:00:00Z",
  "year": 2024,
  "isActive": true,
  "createdAt": "2024-01-01T08:00:00Z",
  "updatedAt": "2024-06-15T10:30:00Z"
}
```

**Erros Possíveis:**
- `400 Bad Request`: Ano inválido
- `404 Not Found`: Saldo não encontrado para este usuário/ano

---

### 3.3. Obter Todos os Meus Saldos de Férias (RECOMENDADO)

Retorna todos os saldos de férias (todos os períodos aquisitivos) do usuário autenticado.

**Endpoint:** `GET /api/v1/Vacations/balances`

**Roles:** `user`, `gestor`, `admin`

**Exemplo:** `GET /api/v1/Vacations/balances`

**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "availableDays": 30,
    "usedDays": 30,
    "remainingDays": 0,
    "acquisitionPeriodStart": "2023-01-01T00:00:00Z",
    "acquisitionPeriodEnd": "2023-12-31T00:00:00Z",
    "usagePeriodStart": "2024-01-01T00:00:00Z",
    "usagePeriodEnd": "2024-12-31T00:00:00Z",
    "year": 2023,
    "isActive": false,
    "createdAt": "2023-01-01T08:00:00Z",
    "updatedAt": "2023-08-15T10:30:00Z"
  },
  {
    "id": 2,
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "availableDays": 30,
    "usedDays": 10,
    "remainingDays": 20,
    "acquisitionPeriodStart": "2024-01-01T00:00:00Z",
    "acquisitionPeriodEnd": "2024-12-31T00:00:00Z",
    "usagePeriodStart": "2025-01-01T00:00:00Z",
    "usagePeriodEnd": "2025-12-31T00:00:00Z",
    "year": 2024,
    "isActive": true,
    "createdAt": "2024-01-01T08:00:00Z",
    "updatedAt": "2024-06-15T10:30:00Z"
  }
]
```

**Campos:**
- `isActive`: `true` se o período de gozo ainda está válido (hoje <= usagePeriodEnd)
- Ordenado por `acquisitionPeriodStart` decrescente (mais recente primeiro)

**Uso Recomendado:**
- Use este endpoint para exibir um histórico completo de períodos aquisitivos
- Filtre no frontend pelos períodos ativos: `balances.filter(b => b.isActive)`
- Mostre ao usuário quais períodos estão disponíveis para usar

---

### 3.4. Obter Saldo de Férias de um Usuário (Gestor - por ano)

> **⚠️ DEPRECATED:** Este endpoint está mantido para compatibilidade mas recomenda-se usar `/balances/{userId}` para obter todos os períodos.

Retorna o saldo de férias de um usuário específico para um ano. Disponível apenas para gestores e admins.

**Endpoint:** `GET /api/v1/Vacations/balance/{userId}`

**Roles:** `gestor`, `admin`

**Path Parameters:**
- `userId` (Guid): ID do usuário

**Query Parameters:**
- `year` (int, obrigatório): Ano de referência (2000-2100)

**Exemplo:** `GET /api/v1/Vacations/balance/550e8400-e29b-41d4-a716-446655440000?year=2024`

**Response:** `200 OK` (mesmo formato do 3.2)

**Erros Possíveis:**
- `400 Bad Request`: Ano inválido
- `403 Forbidden`: Usuário não tem role de gestor/admin
- `404 Not Found`: Saldo não encontrado para este usuário/ano

---

### 3.5. Obter Todos os Saldos de um Usuário (Gestor - RECOMENDADO)

Retorna todos os saldos de férias de um usuário específico. Disponível apenas para gestores e admins.

**Endpoint:** `GET /api/v1/Vacations/balances/{userId}`

**Roles:** `gestor`, `admin`

**Path Parameters:**
- `userId` (Guid): ID do usuário

**Exemplo:** `GET /api/v1/Vacations/balances/550e8400-e29b-41d4-a716-446655440000`

**Response:** `200 OK` (array com mesmo formato do 3.3)

**Erros Possíveis:**
- `403 Forbidden`: Usuário não tem role de gestor/admin

---

## 4. Status das Solicitações

As solicitações de férias seguem um fluxo de estados:

| Status | Valor | Descrição |
|--------|-------|-----------|
| PendingApproval | 1 | Aguardando aprovação do gestor |
| ApprovedByManager | 2 | Aprovada pelo gestor, aguardando autorização do RH |
| AuthorizedByHR | 3 | Autorizada pelo RH, férias confirmadas |
| Completed | 4 | Férias concluídas (atualizado automaticamente quando startDate >= hoje) |
| Cancelled | 5 | Férias canceladas |

**Fluxo Normal:**
1. Usuário cria solicitação → `PendingApproval`
2. Gestor aprova → `ApprovedByManager`
3. Gestor/RH autoriza → `AuthorizedByHR` (deduz dias do saldo)
4. Sistema marca como concluída quando a data chega → `Completed`

---

## 5. Cenários de Uso Frontend

### 5.1. Tela Principal - Calendário de Férias

**Objetivo:** Visualizar o calendário mensal com datas ocupadas

**Chamadas:**
1. `GET /api/v1/Vacations/calendar?month=7&year=2024` - Obter calendário
2. `GET /api/v1/Vacations/balance?year=2024` - Obter saldo disponível do usuário

**Exibição:**
- Renderizar calendário mensal
- Marcar datas ocupadas com indicador visual
- Mostrar tooltip com nomes dos usuários de férias ao passar mouse
- Exibir saldo de férias disponível

---

### 5.2. Modal - Criar Solicitação de Férias

**Objetivo:** Usuário registrar intenção de férias

**Fluxo:**
1. Usuário seleciona data início e fim no calendário
2. Frontend calcula dias úteis (ou solicita ao backend)
3. `POST /api/v1/Vacations/request` - Criar solicitação
4. Mostrar sucesso e atualizar calendário

**Validações Frontend:**
- Data início não pode ser no passado
- Data fim deve ser posterior à data início
- Verificar saldo disponível antes de enviar

---

### 5.3. Tela - Minhas Solicitações

**Objetivo:** Visualizar e gerenciar solicitações próprias

**Chamadas:**
1. `GET /api/v1/Vacations/my-requests` - Listar solicitações

**Ações Disponíveis:**
- **Editar** (botão habilitado apenas se `status === 1 - PendingApproval`):
  - `PUT /api/v1/Vacations/request/{id}`
- **Excluir** (botão habilitado apenas se `status === 1 - PendingApproval`):
  - `DELETE /api/v1/Vacations/request/{id}`

**Exibição:**
- Lista de solicitações com status, datas e dias
- Indicador visual de status (cores diferentes)
- Notas do gestor/RH (se houver)

---

### 5.4. Tela Gestor - Aprovar Solicitações

**Objetivo:** Gestor aprovar e gerenciar solicitações de todos os usuários

**Verificação de Role:**
```javascript
const roles = jwt_decode(token).role; // Extrair roles do token
const isManager = roles.includes('gestor') || roles.includes('admin');
```

**Chamadas:**
1. `GET /api/v1/Vacations/all-requests` - Listar todas as solicitações

**Ações Disponíveis para Gestor:**
- **Aprovar** (apenas se `status === 1`):
  - `POST /api/v1/Vacations/request/{id}/approve`
- **Autorizar RH** (apenas se `status === 2`):
  - `POST /api/v1/Vacations/request/{id}/authorize`
- **Excluir** (se `status !== 4 e status !== 5`):
  - `DELETE /api/v1/Vacations/request/{id}`

**Filtros Sugeridos:**
- Por status
- Por usuário
- Por data

---

### 5.5. Tela Admin - Gerenciar Saldos

**Objetivo:** Admin criar e gerenciar saldos de férias dos usuários

**Verificação de Role:**
```javascript
const roles = jwt_decode(token).role;
const isAdmin = roles.includes('admin');
```

**Chamadas:**
1. `GET /api/v1/Vacations/balance/{userId}?year=2024` - Consultar saldo
2. `POST /api/v1/Vacations/balance` - Criar saldo para um usuário

**Funcionalidades:**
- Criar saldo anual para cada usuário
- Visualizar saldos existentes
- Acompanhar consumo de férias

---

## 6. Integração com Token JWT

O sistema extrai informações do usuário automaticamente do token JWT:

**Claims Utilizadas:**
- `ClaimTypes.NameIdentifier`: GUID do usuário (obrigatório)
- `ClaimTypes.Role`: Roles do usuário (user, gestor, admin)

**Exemplo de Token Decodificado:**
```json
{
  "nameid": "550e8400-e29b-41d4-a716-446655440000",
  "role": ["user", "gestor"],
  "exp": 1719820800
}
```

**No Frontend:**
- Enviar token no header: `Authorization: Bearer <token>`
- Decodificar token para habilitar/desabilitar funcionalidades baseadas em roles
- Usar `nameid` como identificador do usuário logado

---

## 7. Códigos de Resposta HTTP

| Código | Descrição |
|--------|-----------|
| 200 OK | Requisição bem-sucedida |
| 204 No Content | Exclusão bem-sucedida |
| 400 Bad Request | Dados inválidos, regras de negócio violadas |
| 401 Unauthorized | Token ausente ou inválido |
| 403 Forbidden | Usuário não tem permissão para a ação |
| 404 Not Found | Recurso não encontrado |
| 500 Internal Server Error | Erro no servidor |

---

## 8. Exemplos de Erros

**Erro 400 - Saldo Insuficiente:**
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "Bad Request",
  "status": 400,
  "detail": "Insufficient vacation days. Available: 5, Requested: 10"
}
```

**Erro 403 - Permissão Negada:**
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.3",
  "title": "Forbidden",
  "status": 403,
  "detail": "You can only update your own vacation requests"
}
```

---

## 9. Observações Importantes

1. **Atualização Automática de Status:**
   - Um job em background pode ser implementado para marcar férias autorizadas como "Completed" quando a data de início for atingida
   - Método disponível: `ProcessCompletedVacationsAsync()` na aplicação

2. **Cálculo de Dias Úteis:**
   - O frontend deve calcular os dias úteis considerando feriados e fins de semana
   - O backend apenas valida se há saldo suficiente

3. **Conflito de Datas:**
   - O sistema impede que um usuário tenha duas solicitações para o mesmo período
   - Não impede que múltiplos usuários tenham férias na mesma data

4. **Devolução de Saldo:**
   - Se um gestor excluir uma solicitação já autorizada, os dias são automaticamente devolvidos ao saldo do usuário

5. **userName no Calendário:**
   - Atualmente retorna o GUID do usuário
   - Para nomes reais, integrar com o backend de autenticação que fornece os GUIDs

---

## 10. Checklist de Implementação Frontend

- [ ] Configurar interceptor HTTP para adicionar token JWT
- [ ] Criar serviço de autenticação para decodificar token e extrair roles
- [ ] Implementar calendário mensal interativo
- [ ] Criar modal de criação/edição de solicitação de férias
- [ ] Implementar cálculo de dias úteis
- [ ] Criar tela "Minhas Solicitações" com filtros
- [ ] Implementar tela de gestores com aprovação/autorização
- [ ] Criar tela admin para gerenciar saldos
- [ ] Adicionar indicadores visuais de status
- [ ] Implementar tratamento de erros global
- [ ] Adicionar confirmações para ações destrutivas (excluir)
- [ ] Implementar loading states durante chamadas API
- [ ] Adicionar validações de formulário
- [ ] Criar componentes reutilizáveis (cards de férias, calendário)
- [ ] Implementar responsividade mobile

---

**Desenvolvido para o Sistema Solvace - Módulo de Férias**
