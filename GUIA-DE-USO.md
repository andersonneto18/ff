# FF Arena — Guia de Uso das Ferramentas

> Este guia ensina a **operar** o projeto no dia a dia: correr localmente, usar os scripts utilitários, mexer em variáveis de ambiente e fazer git/deploy. Para entender a **arquitetura** (como o código funciona por dentro), consulta o [DOCUMENTACAO.md](DOCUMENTACAO.md).

---

## Índice

1. [Correr o projeto localmente](#1-correr-o-projeto-localmente)
2. [Variáveis de ambiente (.env)](#2-variáveis-de-ambiente-env)
3. [Scripts utilitários (pasta scripts/)](#3-scripts-utilitários-pasta-scripts)
4. [Testar a aplicação manualmente](#4-testar-a-aplicação-manualmente)
5. [Git — enviar alterações para o GitHub](#5-git--enviar-alterações-para-o-github)
6. [Deploy (Vercel)](#6-deploy-vercel)
7. [Perguntas frequentes](#7-perguntas-frequentes)

---

## 1. Correr o projeto localmente

Abre um terminal na pasta do projeto (`c:\xampp\htdocs\ff-arenalocal`) e usa um destes comandos:

| Comando | Para que serve |
|---|---|
| `npm run dev` | Liga o servidor local em modo desenvolvimento, em `http://localhost:3000`. Recarrega sozinho sempre que gravas um ficheiro. **É o que usas 99% do tempo.** |
| `npm run build` | Prepara uma versão de produção (otimizada). Útil para confirmar que não há erros antes de enviar para o GitHub/Vercel. Não fica "a correr" — só gera os ficheiros. |
| `npm run start` | Corre a versão gerada pelo `build` (como ficaria em produção). Só funciona depois de correres `build` primeiro. |

**Importante:** o `.env` local está ligado à **base de dados real (Railway)** e às **chaves reais do Stripe**. Ou seja, quando corres `npm run dev` no teu computador, não estás a testar num "ambiente de brincadeira" — estás a mexer nos dados verdadeiros da plataforma (jogadores reais, saldo real, etc.). Tem cuidado ao criar/apagar coisas.

Para parar o servidor: no terminal onde está a correr, `Ctrl + C`.

---

## 2. Variáveis de ambiente (.env)

O ficheiro `.env` (na raiz do projeto) guarda todas as chaves e configurações sensíveis. **Nunca envies este ficheiro para o GitHub** — já está protegido pelo `.gitignore`, mas nunca o cologues manualmente num commit.

Resumo do que cada bloco controla:

| Bloco | Para que serve | Onde mexer se precisares de mudar |
|---|---|---|
| `MYSQL_*` | Liga à base de dados (Railway) | Painel do Railway |
| `STRIPE_*` | Pagamentos com cartão | Dashboard do Stripe |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Conta de administrador criada automaticamente no arranque | Editar aqui e reiniciar o `npm run dev` |
| `PLATFORM_COMMISSION_PERCENT` | Comissão da plataforma (%) — também pode ser mudada em tempo real no painel admin | `.env` ou painel admin |
| `VAPID_*` | Notificações push do browser | Gerado uma vez com `npx web-push generate-vapid-keys` |
| `R2_*` | Armazenamento de vídeos de denúncia (Cloudflare R2) | Painel Cloudflare → R2 → Tokens de API |

Se mudares o `.env`, tens de **reiniciar** o `npm run dev` (Ctrl+C e correr de novo) — ele só lê o ficheiro no arranque.

---

## 3. Scripts utilitários (pasta scripts/)

Estes são pequenos programas que correm uma vez e terminam (não são o servidor). Todos leem o `.env`, por isso **também mexem na base de dados real**.

### `node scripts/check-stripe-balances.js`
**O que faz:** Só lê — mostra o saldo disponível/pendente da conta Stripe da plataforma. Não cria cobranças nem transferências. Seguro de correr a qualquer momento.

```bash
node scripts/check-stripe-balances.js
```

### `node scripts/seed-tournament-test.js`
**O que faz:** Cria 8 jogadores de teste (`test1@ff.test` a `test8@ff.test`, password `teste123`) e um torneio de teste já com todos inscritos, pronto para clicares "Iniciar" no painel admin. Útil para testar o fluxo de torneios sem precisar de 8 contas reais.

```bash
node scripts/seed-tournament-test.js
```

### `node scripts/cleanup-test-data.js`
**O que faz:** Remove tudo o que o `seed-tournament-test.js` criou (os 8 jogadores de teste e o torneio de teste). Corre isto depois de testares, para não deixar lixo na base de dados real.

```bash
node scripts/cleanup-test-data.js
```

### `node scripts/reset-platform.js` ⚠️ **IRREVERSÍVEL**
**O que faz:** Zera saldo, ganhos e estatísticas de **todos** os jogadores, e apaga **todas** as transações, salas, denúncias, levantamentos e notificações. Mantém as contas de utilizador (emails/passwords) e as configurações da plataforma.

Pede confirmação manual (escreve `sim`) antes de continuar. Só corre isto se quiseres mesmo "zerar" a plataforma inteira — não há forma de desfazer.

```bash
node scripts/reset-platform.js
# ou, para saltar a pergunta de confirmação:
node scripts/reset-platform.js --confirm
```

---

## 4. Testar a aplicação manualmente

Fluxo típico para testar uma funcionalidade nova:

1. `npm run dev`
2. Abre `http://localhost:3000` no browser
3. Cria uma conta de teste (ou usa `node scripts/seed-tournament-test.js` para já teres jogadores prontos)
4. Testa o fluxo (criar sala, apostar, denunciar, etc.)
5. Abre `http://localhost:3000/admin` numa aba **anónima/privada** (ou outro browser) para veres o lado do admin ao mesmo tempo, sem misturar sessões
6. Login admin: usa o `ADMIN_EMAIL` / `ADMIN_PASSWORD` que estão no `.env`

**Dica:** para testar duas contas ao mesmo tempo (ex: criador e adversário de uma sala), usa uma aba normal + uma aba anónima — cada uma guarda o seu próprio token de sessão (`localStorage`), por isso não se misturam.

---

## 5. Git — enviar alterações para o GitHub

O projeto está ligado a `https://github.com/andersonneto18/ff.git`, branch `master`.

Fluxo básico depois de qualquer alteração de código:

```bash
git status                  # ver o que mudou
git add <ficheiros>         # escolher o que vai no commit (evita "git add ." às cegas)
git commit -m "descrição do que mudou e porquê"
git push origin master      # enviar para o GitHub
```

**Nunca** faças `git add .env` ou tentes forçar o envio do `.env` — ele tem as chaves reais de produção.

Se quiseres ver o histórico de commits: `git log --oneline`

---

## 6. Deploy (Vercel)

Quando fazes `git push`, se o projeto já estiver ligado a um projeto Vercel, o deploy acontece **automaticamente**.

Checklist para produção funcionar:
- Todas as variáveis do `.env` (incluindo as novas `R2_*`) devem estar em **Vercel → Project → Settings → Environment Variables**
- O webhook do Stripe em produção deve apontar para `https://SEU_DOMINIO.vercel.app/api/stripe/webhook` (configurado no Dashboard do Stripe)

---

## 7. Perguntas frequentes

**"Mudei o `.env` mas não aconteceu nada"**
→ Reinicia o `npm run dev` (Ctrl+C e correr de novo). Variáveis de ambiente só são lidas no arranque.

**"Corri um script e agora tenho jogadores/torneios estranhos na base de dados"**
→ Provavelmente correste o `seed-tournament-test.js`. Corre `node scripts/cleanup-test-data.js` para limpar.

**"Posso apagar a pasta `.next`?"**
→ Sim, é só a build gerada — apaga sem medo, ela é recriada automaticamente no próximo `npm run dev` ou `npm run build`.

**"Como sei se o servidor local está a usar a base de dados real ou uma de testes?"**
→ Olha para `MYSQL_HOST` no `.env`. Se for algo como `thomas.proxy.rlwy.net` (Railway), é a base de dados real de produção. Não há atualmente uma base de dados "de testes" separada — por isso os scripts acima (seed/cleanup) existem para simular dados de teste na mesma base real, e depois limpá-los.
