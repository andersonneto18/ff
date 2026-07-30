# FF Arena — As Tecnologias Usadas, Explicadas

> Este guia explica **cada peça tecnológica** usada neste projeto, em linguagem simples, com uma analogia e um exemplo real tirado do próprio código. Não é preciso saber programar para entender — é para teres uma imagem mental do que é cada coisa e porque está aqui.

---

## Visão geral: como as peças se encaixam

Pensa numa aplicação como um restaurante:

- **Next.js** é o edifício inteiro — a cozinha e a sala de jantar no mesmo espaço
- **React** é a forma como a sala de jantar é organizada e decorada (o que o cliente vê)
- **Node.js** é a eletricidade que faz tudo funcionar por trás
- **MySQL** é a despensa/arrecadação onde tudo fica guardado
- **Stripe** é o TPA (máquina de cartão) — trata dos pagamentos
- **Cloudflare R2** é um armazém externo só para coisas grandes (vídeos)
- **Tailwind + Radix/shadcn** são o design de interior — como tudo tem a mesma aparência
- **Git + GitHub** é o histórico de receitas — cada versão do prato fica guardada
- **Vercel** é quem entrega o restaurante já montado ao público, na internet

Vamos a cada peça.

---

## 1. Next.js — o framework principal

**O que é:** Uma "moldura" construída sobre React que permite escrever tanto o que o utilizador vê (frontend) como a lógica do servidor (backend) **no mesmo projeto**, sem precisar de dois projetos separados.

**Analogia:** Se React é só "a decoração da sala", o Next.js é o edifício completo — já vem com portas, canalização e eletricidade prontas, só falta decorar.

**Porque está aqui:** Sem o Next.js, precisarias de um projeto para o site (React puro) e outro projeto separado para o servidor (ex: Express/Node). O Next.js junta os dois — é por isso que o [app/api/[[...path]]/route.js](app/api/[[...path]]/route.js) (o "backend") e o [app/page.js](app/page.js) (o "frontend") vivem na mesma pasta `app/`.

**Onde vês isto no código:** a pasta `app/` inteira. Cada `page.js` é um ecrã, cada `route.js` é um endpoint de servidor.

---

## 2. React — a biblioteca de interface

**O que é:** A biblioteca que permite construir a interface (botões, formulários, listas) como "peças de Lego" reutilizáveis, chamadas **componentes**.

**Analogia:** Em vez de desenhares cada porta de armário à mão todas as vezes, fazes um "componente Porta" uma vez, e usas-o em todos os armários da cozinha.

**Porque está aqui:** Todo o ecrã da app (a Arena, a Wallet, o Ranking) é montado com pequenos componentes reutilizáveis. Isso poupa trabalho e mantém tudo consistente.

**Onde vês isto no código:** cada `function NomeQualquer() { return (...) }` em [app/page.js](app/page.js) é um componente. Por exemplo, `RoomCard` ([page.js:498](app/page.js#L498)) é o "cartão" que representa uma sala na lista — é desenhado uma vez e reutilizado para todas as salas.

---

## 3. Node.js — o motor que corre o servidor

**O que é:** É o que permite correr código JavaScript **fora do browser**, ou seja, no servidor. Sem o Node.js, o JavaScript só serviria para o que acontece dentro da página do utilizador.

**Analogia:** É a eletricidade do edifício — não a vês diretamente, mas sem ela nada corre.

**Porque está aqui:** Todo o backend (validar login, debitar saldo, falar com o Stripe) corre em JavaScript graças ao Node.js. Por isso o mesmo idioma (JavaScript) é usado tanto no frontend como no backend deste projeto.

---

## 4. MySQL — a base de dados

**O que é:** Onde tudo fica guardado permanentemente — utilizadores, salas, transações, tudo o que precisa de sobreviver depois de fechares o browser.

**Analogia:** É a arrecadação do restaurante — as prateleiras (tabelas) onde cada tipo de coisa (jogadores, salas, pagamentos) tem o seu lugar.

**Porque está aqui:** É uma base de dados robusta, gratuita, e muito usada — boa escolha para guardar dinheiro real e histórico de transações com segurança.

**Detalhe interessante deste projeto:** normalmente falarias com o MySQL escrevendo SQL (`SELECT * FROM users WHERE...`). Aqui, foi escrita uma camada própria em [lib/db.js](lib/db.js) que imita a forma como o MongoDB (outra base de dados, mais "informal") funciona — por exemplo `db.collection('users').findOne({ id })` — mas por trás traduz isso para SQL de verdade. É uma forma de escrever menos código repetitivo.

**Onde está hospedada:** no Railway (um serviço que aloja bases de dados MySQL na nuvem) — é por isso que o `.env` tem `MYSQL_HOST=thomas.proxy.rlwy.net` em vez de `localhost`.

---

## 5. Tailwind CSS — o estilo visual

**O que é:** Uma forma de estilizar (cores, espaçamentos, tamanhos) escrevendo classes diretamente no HTML, tipo `className="bg-purple-600 rounded-lg p-4"`, em vez de escrever ficheiros CSS separados.

**Analogia:** Em vez de teres um livro de instruções de decoração à parte, escreves diretamente na etiqueta de cada móvel "roxo, cantos arredondados, almofadado".

**Porque está aqui:** É rápido de escrever e garante que tudo usa o mesmo sistema de cores/espaçamentos, sem inventar valores diferentes em cada sítio.

**Onde vês isto:** em qualquer `className="..."` espalhado por `app/page.js` e `app/admin/page.js`. O ficheiro [tailwind.config.js](tailwind.config.js) define as regras gerais (cores da marca, etc.).

---

## 6. Radix UI / shadcn — os componentes prontos

**O que é:** Uma biblioteca de componentes de interface já feitos e testados — botões, caixas de diálogo (modais), menus — que só precisam de ser estilizados, não construídos de raiz.

**Analogia:** Em vez de construíres uma porta de armário do zero, compras uma porta já pronta e só pintas da cor que queres.

**Porque está aqui:** Coisas como o modal de vídeo que adicionámos na seção de Disputas usam isto — o `Dialog` já resolve sozinho problemas complicados (fechar ao clicar fora, acessibilidade para teclado, etc.), não precisámos de programar isso.

**Onde vês isto:** a pasta [components/ui/](components/ui/) — cada ficheiro é um componente destes (`dialog.js`, `button.js`, `card.js`, etc.).

---

## 7. Stripe — os pagamentos com cartão

**O que é:** Um serviço externo especializado em processar pagamentos com cartão de crédito/débito com segurança, para não seres tu a guardar números de cartão (o que seria ilegal e perigoso sem certificações específicas).

**Analogia:** É o TPA (máquina de pagamento) do restaurante — tu não guardas o cartão do cliente, só pedes ao TPA para cobrar e ele confirma se correu bem.

**Porque está aqui:** Processa os carregamentos de saldo (`/wallet/topup`) com cartão. Depois de o pagamento ser confirmado, o Stripe avisa a tua aplicação através de um **webhook** (uma chamada automática que o Stripe faz ao teu servidor).

**Onde vês isto:** [route.js:383](app/api/[[...path]]/route.js#L383) (`/stripe/webhook`) — é o "telefone" que o Stripe usa para avisar "este pagamento foi concluído".

---

## 8. Cloudflare R2 — armazenamento de vídeos

**O que é:** Um serviço para guardar ficheiros grandes (vídeos, imagens) fora da base de dados, servido através de uma "morada" (URL).

**Analogia:** É o armazém externo do restaurante — em vez de amontoares caixas grandes na cozinha (a base de dados), guardas-as num armazém à parte, e só usas um papelinho com a morada para lá ir buscar quando precisas.

**Porque foi adicionado:** foi o que implementámos juntos recentemente — antes, vídeos de denúncia eram guardados diretamente na base de dados como texto gigante (base64), o que quebrava com vídeos grandes. Agora só a "morada" do vídeo fica na base de dados.

**Onde vês isto:** [lib/r2.js](lib/r2.js) (a ligação ao R2) e o endpoint `/rooms/:id/video-upload-url` em [route.js](app/api/[[...path]]/route.js).

---

## 9. Web Push / VAPID — notificações do browser

**O que é:** A tecnologia que permite a um site enviar notificações ao telemóvel/computador do utilizador **mesmo com o browser fechado**, parecido com notificações de uma app nativa.

**Analogia:** É como teres o número de telemóvel de alguém para lhe mandares um SMS, mesmo que ele não esteja a olhar para o ecrã naquele momento.

**Porque está aqui:** Avisa o jogador quando alguém entra na sala dele, quando o levantamento é pago, etc., sem ele ter de estar com a app aberta.

**Onde vês isto:** [lib/push.js](lib/push.js) (envia) e [public/sw.js](public/sw.js) (recebe, no lado do browser — chamado de "Service Worker").

---

## 10. Git e GitHub — histórico e cópia de segurança do código

**O que é:** O Git é a ferramenta que grava "fotografias" (commits) do código ao longo do tempo, para poderes voltar atrás se algo correr mal. O GitHub é o site onde essas fotografias ficam guardadas online.

**Analogia:** É como guardares uma cópia de cada versão de um documento importante, com data e um bilhete a explicar o que mudou — se estragares a versão atual, tens sempre para onde voltar.

**Porque está aqui:** Sem isto, perder o computador ou apagar um ficheiro por engano significaria perder trabalho para sempre. Também é o que liga o teu código ao serviço que o publica na internet (Vercel).

**Onde vês isto:** a pasta escondida `.git/` (criada quando fizemos `git init`) e o repositório `https://github.com/andersonneto18/ff`.

---

## 11. Vercel — onde a aplicação fica publicada

**O que é:** Um serviço que pega no teu código (do GitHub) e coloca-o a correr na internet automaticamente, sem teres de gerir um servidor tu mesmo.

**Analogia:** É a equipa que pega no restaurante já montado e o abre ao público na morada certa — tu não precisas de saber eletricidade ou canalização, eles tratam disso.

**Porque está aqui:** Sempre que fazes `git push`, a Vercel deteta a mudança e publica automaticamente a nova versão, sem precisares de fazer nada manual no servidor.

---

## Resumo rápido — "o que faz o quê"

| Se precisares de... | A tecnologia responsável é |
|---|---|
| Mudar o que aparece no ecrã | React (dentro do Next.js) |
| Mudar a lógica de negócio (regras, validações) | Next.js (o `route.js`) |
| Guardar/consultar dados permanentes | MySQL (via `lib/db.js`) |
| Mudar cores/espaçamentos | Tailwind CSS |
| Um botão/modal com comportamento pronto | Radix UI / shadcn (`components/ui/`) |
| Processar um pagamento com cartão | Stripe |
| Guardar um vídeo grande | Cloudflare R2 |
| Avisar o utilizador sem app aberta | Web Push (VAPID) |
| Guardar uma versão seguraça do código | Git + GitHub |
| Publicar a app na internet | Vercel |
