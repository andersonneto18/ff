# FF Arena — Documentação Completa

> Plataforma de apostas P2P em dinheiro real para partidas 1v1 e torneios no Free Fire.  
> Stack: Next.js 14 · MySQL (Railway) · Stripe · Web Push

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Estrutura de Ficheiros](#2-estrutura-de-ficheiros)
3. [Variáveis de Ambiente](#3-variáveis-de-ambiente)
4. [Base de Dados](#4-base-de-dados)
5. [API — Endpoints](#5-api--endpoints)
6. [Frontend — Componentes](#6-frontend--componentes)
7. [Painel Admin](#7-painel-admin)
8. [Fluxo de Pagamentos](#8-fluxo-de-pagamentos)
9. [Sistema de Apostas](#9-sistema-de-apostas)
10. [Sistema de Torneios](#10-sistema-de-torneios)
11. [Notificações](#11-notificações)
12. [Autenticação](#12-autenticação)
13. [Comissões e Prémios](#13-comissões-e-prémios)
14. [Segurança](#14-segurança)
15. [Deploy](#15-deploy)

---

## 1. Visão Geral

**FF Arena** é uma plataforma onde jogadores de Free Fire apostam dinheiro real em partidas 1v1. O fluxo central é:

1. Jogador cria sala e define valor da aposta → saldo debitado imediatamente
2. Oponente entra na sala → saldo debitado
3. A partida ocorre (fora da plataforma, no jogo)
4. Cada jogador reporta o seu resultado (vitória ou derrota)
5. Se os resultados coincidirem → pote pago ao vencedor (menos 15% de comissão)
6. Se houver conflito → admin decide

**Modelo de negócio:** 15% de comissão sobre cada pote + taxas de entrada em torneios.

---

## 2. Estrutura de Ficheiros

```
ff-arenalocal/
├── app/
│   ├── page.js                        # App principal (~2232 linhas) — todas as views do utilizador
│   ├── layout.js                      # Layout raiz (meta, fonts)
│   ├── providers.js                   # Providers React (Toaster, etc.)
│   ├── admin/
│   │   └── page.js                    # Painel admin (~2100 linhas)
│   ├── api/
│   │   └── [[...path]]/
│   │       └── route.js               # API backend unificada (~1450 linhas)
│   └── checkout/
│       ├── success/page.js            # Redirect pós-pagamento Stripe
│       └── cancel/page.js            # Redirect cancelamento Stripe
├── lib/
│   ├── db.js                          # ORM customizado + Schema MySQL (~536 linhas)
│   ├── auth.js                        # Hash de password + sessões
│   └── push.js                        # Web Push (VAPID)
├── components/ui/                     # Componentes Shadcn/Radix UI
├── public/
│   └── sw.js                          # Service Worker (notificações push)
├── scripts/                           # Scripts utilitários
├── .env                               # Configuração do ambiente
└── package.json
```

---

## 3. Variáveis de Ambiente

Ficheiro: `.env` (nunca versionar com credenciais reais)

| Variável | Descrição |
|----------|-----------|
| `MYSQL_HOST` | Host da base de dados MySQL |
| `MYSQL_PORT` | Porta MySQL |
| `MYSQL_USER` | Utilizador MySQL |
| `MYSQL_PASSWORD` | Password MySQL |
| `MYSQL_DATABASE` | Nome da base de dados |
| `MYSQL_CONNECTION_LIMIT` | Limite de conexões no pool |
| `NEXT_PUBLIC_BASE_URL` | URL base da aplicação (ex: `https://ffarena.pt`) |
| `STRIPE_SECRET_KEY` | Chave secreta Stripe (`sk_live_...`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Chave pública Stripe (`pk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Segredo de assinatura do webhook Stripe |
| `ADMIN_EMAIL` | Email da conta administrador |
| `ADMIN_PASSWORD` | Password da conta administrador |
| `PLATFORM_COMMISSION_PERCENT` | Comissão da plataforma em % (ex: `15`) |
| `VAPID_PUBLIC_KEY` | Chave pública VAPID para Web Push |
| `VAPID_PRIVATE_KEY` | Chave privada VAPID para Web Push |
| `VAPID_SUBJECT` | Email de contacto VAPID (`mailto:...`) |

---

## 4. Base de Dados

ORM customizado em `lib/db.js` que expõe uma API estilo MongoDB sobre MySQL 8.

### Tabelas

#### `users`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | UUID PK | Identificador único |
| `email` | VARCHAR 190 UNIQUE | Email de login |
| `passwordHash` / `salt` | VARCHAR | Credenciais scrypt |
| `name` | VARCHAR | Nome de exibição |
| `ffUid` | VARCHAR | UID no Free Fire |
| `ffNickname` | VARCHAR | Nick no Free Fire |
| `photoUrl` | VARCHAR | Avatar (DiceBear) |
| `balanceCents` | INT | Saldo disponível em cêntimos |
| `pendingCents` | INT | Valor em levantamentos pendentes |
| `totalEarningsCents` | INT | Total ganho em toda a vida |
| `wins` / `losses` | INT | Estatísticas |
| `banned` | TINYINT | 0 = ativo, 1 = banido |
| `banReason` | TEXT | Motivo do ban |
| `isAdmin` | TINYINT | 0 = utilizador, 1 = admin |
| `deviceType` | ENUM | MOBILE / EMULADOR / MOBILADOR |
| `notificationsEnabled` | TINYINT | Push ativo |
| `createdAt` | DATETIME | Data de criação |

#### `rooms`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | UUID PK | ID da sala |
| `creatorId` / `opponentId` | UUID FK | Participantes |
| `betAmountCents` | INT | Valor apostado por cada jogador |
| `mode` | VARCHAR | Modo de jogo (X1, Contra Squad…) |
| `roomType` | VARCHAR | Tipo (Rápida…) |
| `server` | VARCHAR | Servidor (BR, EU, Ásia…) |
| `weapons` | VARCHAR | Armas permitidas |
| `platform` | VARCHAR | Plataforma (Mobile, Emulador…) |
| `characters` / `pets` | VARCHAR | Regras opcionais |
| `notes` | TEXT | Observações |
| `status` | ENUM | Ver estados abaixo |
| `winnerId` / `loserId` | UUID | Após conclusão |
| `claims` | JSON | `{userId: "win"\|"loss"}` |
| `firstClaimAt` | DATETIME | Quando primeiro resultado foi submetido |
| `prizeCents` / `commissionCents` | INT | Após finalização |
| `finalizeReason` | VARCHAR | Motivo da finalização |
| `previousStatus` | VARCHAR | Status antes de disputa |
| `createdAt` / `startedAt` / `finishedAt` | DATETIME | Timestamps |

**Estados possíveis da sala:**

```
ABERTA → EMPARELHADA → EM_ANDAMENTO → FINALIZADA
                                     ↘ EM_CONFLITO → (admin resolve) → FINALIZADA
                        EM_ANDAMENTO → EM_DISPUTA  → (admin resolve) → FINALIZADA
ABERTA → CANCELADA
```

| Estado | Descrição |
|--------|-----------|
| `ABERTA` | Aguarda oponente |
| `EMPARELHADA` | Ambos pagaram, a aguardar início |
| `EM_ANDAMENTO` | Partida a decorrer |
| `FINALIZADA` | Concluída, prémio pago |
| `EM_CONFLITO` | Ambos declaram vitória (ou ambos derrota) |
| `EM_DISPUTA` | Denúncia enviada |
| `CANCELADA` | Criador cancelou (reembolso) |

#### `transactions`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | UUID PK | — |
| `userId` | UUID FK | Utilizador |
| `type` | ENUM | Ver tipos abaixo |
| `amountCents` | INT | Valor |
| `roomId` / `withdrawalId` / `stripeSessionId` | UUID | Entidade relacionada |
| `balance` | INT | Saldo após transação |
| `description` | TEXT | Descrição legível |
| `createdAt` | DATETIME | — |

**Tipos de transação:**
`bet_create` · `bet_join` · `win` · `commission` · `topup` · `withdrawal_request` · `withdrawal_refund` · `tournament_entry` · `tournament_prize` · `tournament_refund` · `reversal` · `bonus` · `refund`

#### `withdrawals`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | UUID PK | — |
| `userId` | UUID FK | — |
| `amountCents` | INT | Valor pedido |
| `fullName` | VARCHAR | Nome do titular |
| `withdrawalType` | ENUM | IBAN / MBWAY / TRANSFERENCIA |
| `iban` / `mbway` | VARCHAR | Dados de pagamento |
| `status` | ENUM | PENDENTE → EM_PROCESSAMENTO → PAGO / REJEITADO |
| `rejectionReason` | TEXT | Se rejeitado |
| `createdAt` / `paidAt` | DATETIME | Timestamps |

#### `reports`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | UUID PK | — |
| `roomId` / `reporterId` | UUID FK | Contexto |
| `tournamentId` / `tournamentMatchId` | UUID | Se for torneio |
| `reason` | TEXT | Descrição do problema |
| `videoData` | LONGTEXT | Vídeo em base64 |
| `screenshots` | JSON | Array de imagens base64 |
| `status` | ENUM | PENDENTE / ACEITE / REJEITADA |
| `createdAt` / `processedAt` | DATETIME | Timestamps |

#### `room_messages`
Mensagens do chat dentro de cada sala. Max 1000 caracteres por mensagem.

#### `notifications`
Notificações in-app por utilizador. Campos: `type`, `title`, `message`, `relatedId`, `isRead`.

#### `push_subscriptions`
Subscrições Web Push. Campos: `endpoint`, `endpointHash` (SHA256), `p256dh`, `auth`.

#### `withdrawal_methods`
Um registo por utilizador com o método de levantamento configurado (IBAN / MB WAY / Transferência).

#### `platform_settings`
Tabela chave-valor para configurações globais:

| Chave | Descrição |
|-------|-----------|
| `topupsEnabled` | Liga/desliga depósitos |
| `stripeEnabled` | Liga/desliga Stripe |
| `bonusEnabled` | Liga/desliga banner de bónus |
| `mbwayPhone` | Número MB WAY da plataforma |
| `platformIban` | IBAN da plataforma |
| `commissionPercent` | Comissão atual |

#### `audit_log`
Histórico de todas as ações admin: quem fez o quê, quando, sobre que entidade.

#### `mbway_topups`
Depósitos MB WAY manuais com prova de pagamento (imagem base64). Estados: PENDENTE / CONFIRMADO / REJEITADO.

#### `tournaments` / `tournament_participants` / `tournament_matches`
Ver secção [Sistema de Torneios](#10-sistema-de-torneios).

#### `support_messages`
Chat entre utilizadores e admin.

### ORM — API Disponível

```js
const col = db.collection('users')

col.findOne({ id: 'uuid' })
col.find({ status: 'ABERTA' }).sort({ createdAt: -1 }).limit(100).toArray()
col.insertOne({ id, email, ... })
col.updateOne({ id }, { $set: { balanceCents: 500 }, $inc: { wins: 1 } })
col.countDocuments({ isAdmin: 0 })
col.deleteMany({ userId: 'uuid' })
col.aggregate([{ $match: {...} }, { $group: { _id: null, total: { $sum: '$amountCents' } } }]).toArray()
```

Operadores de filtro suportados: `$in`, `$or`, `$ne`, `$isNull`, `$gt`, `$lt`, `$gte`, `$lte`

---

## 5. API — Endpoints

**Base:** `/api`  
**Auth:** Header `Authorization: Bearer <token>`  
Todos os endpoints autenticados retornam `401` se o token for inválido.

---

### Autenticação

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/auth/register` | ✗ | Cria conta. Body: `{email, password, name, ffUid, ffNickname, deviceType}` |
| POST | `/auth/login` | ✗ | Inicia sessão. Body: `{email, password}`. Retorna `{token, user}` |
| GET | `/auth/me` | ✓ | Retorna utilizador atual |

---

### Salas (Apostas)

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/rooms` | ✗ | Lista salas ABERTAS (máx. 100) |
| POST | `/rooms` | ✓ | Cria sala. Body: `{betEuros, mode, server, weapons, platform, ...}` — debita saldo |
| GET | `/rooms/mine` | ✓ | Salas do utilizador atual |
| GET | `/rooms/:id` | ✗ | Detalhe da sala. Aciona auto-finalização se timeout 24h |
| POST | `/rooms/:id/join` | ✓ | Entra na sala (atómico) — debita saldo, muda para EMPARELHADA |
| POST | `/rooms/:id/cancel` | ✓ | Cancela sala ABERTA (só criador) — reembolso |
| POST | `/rooms/:id/start` | ✓ | Inicia partida (só criador) — EMPARELHADA → EM_ANDAMENTO |
| POST | `/rooms/:id/claim` | ✓ | Submete resultado. Body: `{result: "win"\|"loss"}` |
| GET | `/rooms/:id/messages` | ✓ | Histórico de chat (últimas 500 msgs) |
| POST | `/rooms/:id/messages` | ✓ | Envia mensagem. Body: `{message}` |
| POST | `/rooms/:id/report` | ✓ | Envia denúncia. Body: `{reason, videoData?, screenshots[]}` |

---

### Carteira

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/wallet` | ✓ | Balance, transações, levantamentos |
| GET | `/wallet/notifications` | ✓ | Notificações + contagem não lidas |
| POST | `/wallet/notifications/read-all` | ✓ | Marca todas como lidas |
| POST | `/wallet/notifications/:id/read` | ✓ | Marca uma como lida |
| POST | `/wallet/notifications/clear` | ✓ | Remove todas |
| POST | `/wallet/topup` | ✓ | Cria sessão Stripe. Body: `{amountEuros}` (min 5€) |
| POST | `/wallet/topup/mbway` | ✓ | Depósito MB WAY manual. Body: `{amountEuros, proofImage}` |
| GET | `/wallet/mbway-topups` | ✓ | Histórico depósitos MB WAY |
| GET | `/wallet/withdrawal-method` | ✓ | Método de levantamento configurado |
| POST | `/wallet/withdrawal-method` | ✓ | Configura método. Body: `{fullName, type, iban?, mbway?}` |
| POST | `/wallet/withdraw` | ✓ | Pede levantamento. Body: `{amountEuros}` (min 2€) |
| POST | `/stripe/webhook` | ✗ | Webhook Stripe (assinatura verificada) |
| POST | `/stripe/verify` | ✓ | Verificação manual de sessão Stripe |
| POST | `/wallet/sync-topups` | ✓ | Recuperação: sincroniza sessões Stripe não processadas |

---

### Push / Notificações

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/push/vapid-public-key` | ✗ | Chave pública VAPID |
| POST | `/push/subscribe` | ✓ | Regista subscrição Web Push |
| POST | `/push/unsubscribe` | ✓ | Remove subscrição |
| GET/POST | `/push/preference` | ✓ | Lê/define `notificationsEnabled` |
| POST | `/push/test` | ✓ | Envia notificação de teste |

---

### Ranking & Perfil

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/platform-status` | ✗ | Feature flags, contactos, comissão |
| GET | `/ranking?type=wins\|earnings\|rate` | ✗ | Top 20 jogadores |
| GET | `/profile/:userId` | ✗ | Perfil público |

---

### Torneios

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/tournaments` | ✓ | Lista torneios ABERTO / EM_ANDAMENTO |
| POST | `/tournaments/:id/join` | ✓ | Inscrição (debita taxa) |
| POST | `/tournaments/:id/leave` | ✓ | Desinscrição (reembolso, antes de iniciar) |
| POST | `/tournaments/:id/match/:matchId/claim` | ✓ | Resultado da partida |
| POST | `/tournaments/:id/match/:matchId/report` | ✓ | Denúncia numa partida |

---

### Suporte

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/support/messages` | ✓ | Mensagens do utilizador com o suporte |
| POST | `/support/messages` | ✓ | Envia mensagem ao suporte |

---

### Admin (`/admin/*`) — Requer `isAdmin: true`

| Método | Path | Descrição |
|--------|------|-----------|
| GET/POST | `/admin/settings` | Lê/atualiza feature flags e configurações |
| GET | `/admin/dashboard` | Métricas: utilizadores, salas, receita, lucro |
| GET | `/admin/rooms` | Todas as salas com filtro por estado |
| GET | `/admin/reports` | Denúncias pendentes/resolvidas |
| POST | `/admin/report/:id` | Aceita ou rejeita denúncia. Body: `{action: "accept"\|"reject", winnerId?}` |
| GET | `/admin/disputes` | Salas em conflito |
| POST | `/admin/dispute/:id` | Resolve conflito. Body: `{winnerId?}` (null = cancelar+reembolsar) |
| GET | `/admin/withdrawals` | Levantamentos com filtro de estado |
| POST | `/admin/withdrawal/:id/paid` | Marca como pago |
| POST | `/admin/withdrawal/:id/processing` | Marca como em processamento |
| POST | `/admin/withdrawal/:id/reject` | Rejeita. Body: `{reason}` |
| GET | `/admin/users` | Lista / pesquisa utilizadores |
| POST | `/admin/ban` | Bane utilizador. Body: `{userId, reason}` |
| POST | `/admin/unban` | Remove ban. Body: `{userId}` |
| GET | `/admin/mbway-topups` | Depósitos MB WAY pendentes |
| POST | `/admin/mbway-topup/:id/confirm` | Confirma e credita saldo |
| POST | `/admin/mbway-topup/:id/reject` | Rejeita. Body: `{reason}` |
| GET | `/admin/tournaments` | Lista torneios |
| POST | `/admin/tournaments` | Cria torneio |
| POST | `/admin/tournaments/:id/start` | Inicia e gera bracket |
| POST | `/admin/tournaments/:id/cancel` | Cancela e reembolsa todos |
| POST | `/admin/tournaments/:id/match/:matchId/resolve` | Resolve partida manualmente |
| POST | `/admin/bonus-credit` | Distribui bónus de boas-vindas |
| GET | `/admin/audit-log` | Histórico de ações admin |
| GET | `/admin/support-messages` | Mensagens de suporte de todos os utilizadores |
| POST | `/admin/support-messages/:userId/reply` | Responde a utilizador |

---

## 6. Frontend — Componentes

**Ficheiro:** `app/page.js`

### Hooks Customizados

**`useApi()`**
- Wrapper sobre `fetch` com header `Authorization: Bearer <token>`
- Token lido de `localStorage` (`ff_token`)
- Retorna `async (path, options) => data`

**`useNotifications()`**
- Polling a cada 8 segundos em `/wallet/notifications`
- Retorna: `{ notifications, unreadCount, markRead, markAllRead, clearNotifications }`
- Exibe toasts para notificações novas

### Views Principais

| View | Descrição |
|------|-----------|
| **Landing** | Hero, features, planos, FAQ, botões de registo/login |
| **Arena** | Lista de salas abertas com filtros; botão "Criar Sala" |
| **Minhas Salas** | Salas ativas e histórico do utilizador |
| **Wallet** | Saldo, transações, levantamentos, métodos de pagamento |
| **Torneios** | Lista de torneios, inscrição, bracket |
| **Ranking** | Top 20 por vitórias / ganhos / taxa de vitória |
| **Notificações** | Painel lateral de notificações in-app |

### Componentes Chave

**`CreateRoomDialog`**
- Formulário com: valor da aposta, modo, servidor, armas, plataforma
- Calcula comissão em tempo real (`pote × commissionPercent%`)
- Valida saldo disponível antes de submeter

**`RoomDetail`**
- Mostra estado atual, participantes, ações disponíveis
- Ações por estado:
  - `ABERTA`: Entrar (oponente) ou Cancelar (criador)
  - `EMPARELHADA`: Iniciar (criador)
  - `EM_ANDAMENTO`: Declarar Vitória / Declarar Derrota
  - `FINALIZADA`: Mostra vencedor + prémio
  - `EM_CONFLITO` / `EM_DISPUTA`: Mensagem + formulário de denúncia
- Chat integrado com polling

**`WalletView`**
- Balance em destaque
- Histórico de transações com tipo e valor
- Lista de levantamentos com estado
- Configuração de método de pagamento (IBAN / MB WAY)
- Botões: Carregar com Stripe ou MB WAY

**`CompressImage(file)`** — Utilitário
- Redimensiona para máx. 1280px
- Comprime para JPEG 75%
- Retorna data URL (base64)

### Estados de Sala — Labels e Cores

| Estado | Label | Cor |
|--------|-------|-----|
| ABERTA | A AGUARDAR PAGAMENTO | Amarelo |
| EMPARELHADA | EMPARELHADA | Azul |
| EM_ANDAMENTO | EM ANDAMENTO | Roxo (pulse) |
| FINALIZADA | FINALIZADA | Cinza |
| EM_CONFLITO | RESULTADO EM CONFLITO | Laranja (pulse) |
| EM_DISPUTA | EM DISPUTA | Vermelho |
| CANCELADA | CANCELADA | Cinza escuro |

---

## 7. Painel Admin

**Ficheiro:** `app/admin/page.js`  
**Acesso:** Rota `/admin` — requer `isAdmin: true`

### Secções

| Secção | Funcionalidades |
|--------|----------------|
| **Dashboard** | KPIs de utilizadores, salas, receita, lucro. Toggles de features |
| **Salas** | Filtro por estado, lista completa com participantes |
| **Denúncias** | Revisão de provas (vídeo + screenshots), aceitar/rejeitar |
| **Conflitos** | Salas com resultados opostos; histórico de chat; resolver manualmente |
| **Jogadores** | Pesquisa, ver estatísticas, banir/desbanir |
| **Levantamentos** | Processar pedidos, marcar como pago ou rejeitar |
| **MB WAY** | Verificar provas de pagamento, confirmar/rejeitar depósitos |
| **Torneios** | Criar, iniciar, cancelar torneios; resolver partidas |
| **Audit Log** | Histórico de ações de todos os admins |
| **Suporte** | Chat com utilizadores |
| **Configurações** | Feature flags, número MB WAY, IBAN da plataforma, comissão |

---

## 8. Fluxo de Pagamentos

### Depósito via Stripe

```
1. Utilizador escolhe valor (mín. 5€, máx. 5000€)
2. POST /wallet/topup → Stripe cria checkout session
3. Utilizador é redirecionado para página Stripe
4. Pagamento concluído
   ├── Webhook: Stripe → POST /stripe/webhook → processTopupCompleted()
   └── Fallback: utilizador regressa a /checkout/success → POST /stripe/verify
5. processTopupCompleted():
   ├── Verificação idempotente (stripeSessionId UNIQUE)
   ├── Credita balanceCents
   ├── Regista transação tipo "topup"
   └── Envia notificação ao utilizador
```

### Depósito via MB WAY (manual)

```
1. Utilizador transfere para número MB WAY da plataforma
2. Carrega prova de pagamento (screenshot)
3. POST /wallet/topup/mbway → cria registo PENDENTE
4. Admin vê em /admin/mbway-topups
5. Admin confirma → balance creditado + notificação
   Ou rejeita com motivo
```

### Levantamento

```
1. Utilizador configura método (IBAN / MB WAY / Transferência)
2. Pede levantamento (mín. 2€)
3. POST /wallet/withdraw:
   ├── Cria withdrawal PENDENTE
   ├── Debita balanceCents
   └── Adiciona a pendingCents
4. Admin processa:
   ├── Marca como EM_PROCESSAMENTO
   ├── Transfere dinheiro manualmente
   └── Marca como PAGO → pendingCents decrementado + notificação
   Ou rejeita → saldo reembolsado
```

---

## 9. Sistema de Apostas

### Criação e Entrada

```js
// Criação — debita imediatamente
balanceCents -= betAmountCents
room.status = 'ABERTA'

// Entrada — operação atómica (previne race condition)
UPDATE rooms SET status='EMPARELHADA', opponentId=?
WHERE id=? AND status='ABERTA' AND opponentId IS NULL
// Se affectedRows === 0 → sala já foi preenchida
```

### Lógica de Claims (resultados)

| Criador | Oponente | Resultado |
|---------|----------|-----------|
| `win` | `loss` | Criador vence → FINALIZADA |
| `loss` | `win` | Oponente vence → FINALIZADA |
| `win` | `win` | EM_CONFLITO (admin decide) |
| `loss` | `loss` | EM_CONFLITO (admin decide) |
| `win` | *(24h sem resposta)* | Criador vence automaticamente |
| `loss` | *(24h sem resposta)* | Oponente vence automaticamente |

### Auto-Finalização (timeout 24h)

```
GET /rooms/:id aciona autoFinalizeTimeout()
Se EM_ANDAMENTO + apenas 1 claim + 24h passadas:
  → finalizeRoom(db, room, winnerId, 'timeout_single_claim')
```

### `finalizeRoom(db, room, winnerId, reason)`

```
1. Calcula: pote = betAmountCents × 2
2. comissão = pote × commissionPercent / 100
3. prémio = pote − comissão
4. Credita prémio ao vencedor
5. Regista transação "win" para vencedor
6. Regista transação "commission" para plataforma
7. Incrementa wins do vencedor, losses do perdedor
8. Notifica ambos os jogadores
```

---

## 10. Sistema de Torneios

### Estados de Torneio

```
RASCUNHO → ABERTO (inscrições) → EM_ANDAMENTO → FINALIZADO
                                → CANCELADO (reembolso total)
```

### Bracket — Eliminação Simples

```
1. Admin inicia torneio
2. Jogadores são emparelhados aleatoriamente
3. Se número ímpar → um jogador recebe "bye" (avança automaticamente)
4. Partidas geradas por ronda
5. Vencedor de cada partida avança para a ronda seguinte
6. Auto-finalização com timeout de 2h (vs. 24h nas salas normais)
```

### Prémios de Torneio

```
totalPot = entryFeeCents × numParticipants
commission = totalPot × commissionPercent / 100
net = totalPot − commission
1º lugar: net × 87.5%
2º lugar: net × 12.5%
```

### Lógica de Claims em Torneio

Idêntica às salas normais, mas com timeout de 2h e sem chat.

---

## 11. Notificações

### Web Push (VAPID)

**Ficheiro:** `lib/push.js` + `public/sw.js`

```
1. Frontend pede permissão ao browser
2. ServiceWorker regista subscrição PushSubscription
3. POST /push/subscribe → guardado em push_subscriptions
4. Quando evento ocorre no servidor:
   sendPushToUser(db, userId, { title, body, url, type })
5. web-push envia para endpoint do browser
6. Service Worker recebe "push" → exibe notificação
7. Clique → navega para url ou foca janela existente
```

**Subscrições expiradas** são removidas automaticamente (código 404/410).

### In-App (Polling)

- Frontend faz polling a `/wallet/notifications` a cada 8s
- Notificações novas exibidas como toasts (Sonner)
- Badge com contagem de não lidas no sino

### Eventos que Geram Notificações

| Evento | Tipo |
|--------|------|
| Oponente entrou na sala | `room_joined` |
| Nova mensagem no chat | `private_message` |
| Levantamento pago | `withdrawal_paid` |
| Levantamento rejeitado | `withdrawal_rejected` |
| Torneio iniciado | `tournament` |
| Inscrição confirmada | `tournament` |
| Depósito MB WAY pendente | `topup_pending` |
| Conta desbloqueada | `account_update` |

---

## 12. Autenticação

**Ficheiro:** `lib/auth.js`

### Passwords

```js
hashPassword(password, salt?)
// scrypt: 64 bytes, N=16384, r=8, p=1
// Retorna: { salt: hex16bytes, hash: hex64bytes }

verifyPassword(password, salt, hash)
// crypto.timingSafeEqual() — previne timing attacks
```

### Sessões

```js
createSession(userId)
// Token = UUID v4 + 24 bytes aleatórios (hex)
// Guardado em tabela sessions
// Retorna token para guardar no cliente

getUserFromRequest(request)
// Extrai "Bearer <token>" do header Authorization
// Verifica em sessions JOIN users
// Retorna utilizador ou null
```

**Sem JWT** — tokens guardados no servidor, invalidação imediata possível.  
**Token no cliente** — `localStorage` com chave `ff_token`.

---

## 13. Comissões e Prémios

### Aposta Normal (1v1)

```
Exemplo: 10€ de aposta cada
Pote total: 20€
Comissão (15%): 3€
Prémio vencedor: 17€
```

### Torneio (8 jogadores, 2€ taxa)

```
Pote total: 16€
Comissão (15%): 2.40€
Net: 13.60€
1º lugar: 11.90€ (87.5%)
2º lugar: 1.70€ (12.5%)
```

### Configuração

A comissão é configurável via:
1. `.env` → `PLATFORM_COMMISSION_PERCENT`
2. Tabela `platform_settings` → chave `commissionPercent` (sobrepõe .env)
3. Admin pode alterar em tempo real no dashboard

---

## 14. Segurança

| Área | Implementação |
|------|---------------|
| Passwords | scrypt + salt único por utilizador |
| Sessões | Tokens de 192+ bits de entropia, guardados no servidor |
| SQL Injection | Queries parametrizadas via mysql2/promise |
| Race conditions | UPDATE atómico na entrada de salas |
| Stripe webhook | Verificação de assinatura com `STRIPE_WEBHOOK_SECRET` |
| Idempotência | Constraint UNIQUE em `stripeSessionId` |
| VAPID | Par de chaves para autenticar push notifications |
| CORS | Habilitado (Access-Control-Allow-Origin: *) |
| Rate limiting | **Não implementado** — considerar adicionar |
| Admin auth | Flag `isAdmin` verificada em cada endpoint admin |

---

## 15. Deploy

### Stack de Produção

| Componente | Serviço |
|------------|---------|
| Frontend + API | Vercel |
| Base de dados | Railway (MySQL 8) |
| Pagamentos | Stripe (modo live) |
| Push notifications | Web Push VAPID |

### Comandos

```bash
npm run dev       # Desenvolvimento local (porta 3000)
npm run build     # Build de produção
npm run start     # Servidor de produção
```

### Variáveis na Vercel

Todas as variáveis do `.env` devem ser configuradas em:  
`Vercel Dashboard → Project → Settings → Environment Variables`

### Webhook Stripe na Vercel

URL do webhook a configurar no Stripe Dashboard:
```
https://SEU_DOMINIO.vercel.app/api/stripe/webhook
```

### Service Worker

O ficheiro `public/sw.js` é servido automaticamente pelo Next.js em `/sw.js`.  
O registo é feito no frontend após o utilizador ativar notificações.

---

*Documentação gerada em Junho 2026 — FF Arena v1.x*
