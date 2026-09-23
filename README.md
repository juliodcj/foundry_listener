# Retratos Falantes (Foundry VTT + Discord)

Uma barra com os retratos dos personagens dentro do Foundry, no estilo dos
overlays de stream. Quando alguém fala no canal de voz do Discord, o retrato
dessa pessoa se anima (alternando entre duas artes, ou aumentando e diminuindo
de tamanho), e todos os
jogadores veem isso no próprio Foundry.

São três peças:

| Pasta     | O que é | Onde roda |
|-----------|---------|-----------|
| `app/`    | **Ouvidor.exe**: janela do Windows que liga o bot e mostra o status (Discord, canal de voz, quem está na call, conexão com o Foundry). | PC do mestre |
| `bot/`    | Bot do Discord (Node.js) que entra na call e avisa quem começou e parou de falar. Não grava nem decodifica áudio. | PC do mestre (o Ouvidor.exe abre ele escondido) |
| `module/` | Módulo **Retratos Falantes** do Foundry (v13 e v14). Mostra a barra para todo mundo. | Mundo do Foundry |

```
Discord ──voz──▶ bot (Node) ──ws://127.0.0.1──▶ Foundry do mestre ──socket do módulo──▶ todos os jogadores
```

Nada além do próprio Foundry passa pelo túnel da Cloudflare. Só o Foundry do
mestre, na mesma máquina, conecta no bot. Os jogadores não instalam nada: basta
o módulo estar ativo no mundo.

---

## 1. Criar o bot no Discord (uma vez só)

1. Abra o [Discord Developer Portal](https://discord.com/developers/applications)
   → **New Application** → dê um nome (ex.: *Ouvidor*) → **Create**.
2. No menu da esquerda, **Bot**:
   - clique em **Reset Token** → **Copy**. Esse é o **token**; guarde, ele
     só aparece uma vez. Não mostre para ninguém (quem tem o token controla o bot).
   - Não precisa ligar nenhuma *Privileged Gateway Intent*.
3. Ligue o **Modo Desenvolvedor** no seu Discord: Configurações do usuário →
   **Avançado** → **Modo desenvolvedor**. Com ele, o clique direito mostra
   **Copiar ID** em servidores, canais e pessoas.
4. Copie:
   - o **ID do servidor** (clique direito no ícone do servidor → Copiar ID do servidor);
   - o **seu ID** (clique direito no seu nome → Copiar ID do usuário). É o
     "ID do GM": quando você entrar num canal de voz, o bot entra junto.

### Convidar o bot para o servidor

Jeito mais fácil: abra o Ouvidor (passo 2), configure o token e clique em
**Copiar link de convite do bot**. Cole o link no navegador e escolha o servidor.

Se preferir montar o link: Developer Portal → **OAuth2** → **URL Generator**:

- *Scopes*: `bot` e `applications.commands`
- *Bot Permissions*: **View Channels** e **Connect**

Abra a URL gerada e escolha o servidor. Se o canal de voz for privado, dê ao
cargo do bot as permissões *Ver canal* e *Conectar* nesse canal.

---

## 2. Instalar o Ouvidor (PC do mestre)

1. Instale o **Node.js 22.12 ou mais novo** (uma vez só). No PowerShell:
   `winget install OpenJS.NodeJS.LTS`
2. Baixe o **Ouvidor.zip** (página de *Releases* do repositório, ou aba
   *Actions* → último build → artefato `Ouvidor`) e extraia numa pasta
   qualquer. Mantenha a pasta `bot` ao lado do `Ouvidor.exe`.
3. Abra o `Ouvidor.exe`. Na **engrenagem**, preencha:
   - **Token do bot**
   - **ID do servidor**
   - **Seu ID do Discord (GM)**
   - **Canal de voz fixo** (opcional): se preenchido, o bot só entra
     sozinho nesse canal. Vazio, ele segue você para qualquer canal de voz.
   - **Porta do bot** (padrão `8770`): tem que ser igual à do módulo.
   - **Porta do Foundry** (padrão `30000`): só para o indicador "Foundry online".
4. **Salvar** e **Iniciar**.

A configuração fica em `%AppData%\Ouvidor\config.json`. Se você já usava um
`bot\.env`, o Ouvidor importa os valores dele na primeira vez.

### O que aparece na janela

- **Status** do bot (online, conectando, reconectando, erro), com o nome do bot
  e do servidor.
- **Ping Discord**, **Na call** (quantas pessoas no canal do bot) e **Rodando há**.
- **Discord**, **Canal de voz** (ouvindo / fora da call), **Módulo no Foundry**
  (se o Foundry do mestre está conectado no bot, com o nome do usuário e do
  mundo) e **Foundry VTT** (se a porta local responde).
- **Na call**: quem está no canal, com destaque verde em quem está falando agora.
  Dá para mandar o bot **Entrar** num canal (ou no canal onde você está) e **Sair**.
- **Copiar link de convite do bot**.
- **Atividade**: conexões, entradas e saídas da call, erros. Marque
  *mostrar falas* para ver cada começo/fim de fala.

Fechar a janela encerra o bot. Se o bot cair, o Ouvidor reinicia sozinho.

Erros comuns aparecem com a solução na própria janela: Node.js não instalado,
token recusado, bot fora do servidor, porta em uso.

### Sem o Ouvidor (opcional)

O bot também roda sozinho num prompt:

1. Em `bot\`, copie `.env.example` para `.env` e preencha.
2. Rode `iniciar.bat` (instala as dependências na primeira vez e reinicia o
   bot se ele cair). `iniciar-tudo.bat` abre o bot e o Foundry juntos.

Só uma cópia do bot pode rodar por vez (as duas usariam a mesma porta).

### Comandos no Discord

- `/entrar`: o bot entra no canal de voz em que você está.
- `/sair`: o bot sai do canal.

---

## 3. Instalar o módulo no Foundry

No Foundry: **Add-on Modules** → **Install Module** → em *Manifest URL* cole:

```
https://github.com/juliodcj/ouvidor/releases/latest/download/module.json
```

(Ou extraia `retratos-falantes.zip` em `Data/modules/retratos-falantes`.)

Ative o módulo **Retratos Falantes** no mundo (Manage Modules).

### Configurar jogadores e artes (mestre)

**Configurações** → **Retratos Falantes** → **Jogadores, Discord e artes** → **Configurar**.

- No topo aparece **quem está na call agora**, com nome e ID do Discord.
  Com o bot rodando e você na call, é só escolher cada pessoa na lista.
- Para cada jogador:
  - **ID do Discord** (clique no botão de lista para escolher entre quem está na call);
  - **Personagem** (vazio = o personagem atribuído ao usuário no Foundry);
  - **Arte 1** e **Arte 2 (opcional)**. Com as duas, o retrato alterna entre
    elas enquanto a pessoa fala (ex.: boca fechada e boca aberta). Com uma arte
    só (estática), o retrato aumenta e diminui de tamanho (ou quica, ou só
    brilha: veja *Animação com uma arte só*). Sem arte, usa o retrato do ator.
  - O botão de varinha procura artes com sufixo ao lado da arte do ator ou do
    token: `ezren.webp` → `ezren-closed.webp` e `ezren-open.webp` (qualquer
    extensão). **Procurar artes de todos** faz isso para todo mundo.
- **Mestre**: seu ID do Discord, o nome no card (padrão "Mestre") e as artes.
  Com **Usar o NPC selecionado** ligado, quando você seleciona o token de um
  NPC, o seu card mostra esse NPC enquanto você fala.

Quem está na call sem ID configurado é ignorado.

### Outras configurações do módulo

| Configuração | Escopo | O que faz |
|---|---|---|
| Porta do bot | mundo | Porta do WebSocket do bot (igual à do Ouvidor). |
| Card do mestre | mundo | Mostrar o card do mestre só quando fala, sempre ou nunca. |
| Quais jogadores mostrar | mundo | Todos com personagem, ou só quem está conectado no Foundry. |
| Mostrar dados da ficha | mundo | PV, nível, classe e pontos de heroísmo (círculos) do PF2e. |
| Estilo do retrato | mundo | **Recorte** (padrão): a arte PNG sem fundo fica em pé sobre a placa, sem moldura, e o brilho segue o contorno do personagem. **Moldura**: a arte fica dentro de um quadro. |
| Velocidade da troca de arte | mundo | Intervalo entre a arte 1 e a arte 2 (padrão 150 ms). |
| Esmaecer quem não fala | mundo | A arte de quem está calado fica mais apagada (ligado por padrão). |
| Animação com uma arte só | mundo | Aumentar e diminuir (padrão), quicar, ou só o brilho. |
| Ícone dos pontos de heroísmo | mundo | Imagem no lugar dos círculos; pontos gastos ficam apagados. |
| Espera ao parar de falar | mundo | Atraso antes de voltar ao normal, para não piscar entre palavras (padrão 300 ms). |
| Durante o combate | mundo | Nada, pausar a animação ou esconder a barra. |
| Esconder a barra | cliente | Cada pessoa esconde na própria tela. |
| Modo compacto | cliente | Mostra só quem está falando. |
| Opacidade quando ninguém fala | cliente | Transparência da barra em repouso. |

---

## 4. Usar a barra

A barra fica fixa na tela (não se move com o mapa). Passe o mouse sobre ela
para ver os botões:

- 🔒 **Cadeado**: travada, a barra não se mexe. Clique para **destravar**; aí
  aparecem os outros botões e dá para **arrastar a barra** por qualquer parte.
  (Com ela travada, **Alt + arrastar** também move.)
- **− 100% +**: ajusta a **escala**. A bolinha dourada no canto inferior
  direito também redimensiona, arrastando.
- ↔ / ↕: barra horizontal ou vertical.
- **Compacto**: só quem está falando.
- ↺ **Resetar**: volta para a posição e o tamanho padrão do mestre (útil se
  a barra sumiu da vista).
- 👁 **Esconder**. Para mostrar de novo: botão **Retratos Falantes** na barra de
  ferramentas de tokens (à esquerda), **Alt+Shift+R**, ou nas Configurações.
- Duplo clique num card abre a ficha (se você tiver permissão).

**Posição de cada um, padrão do mestre.** Cada jogador pode mover e
redimensionar a barra na própria tela, e isso fica salvo só para ele. Quem
nunca mexeu usa a posição que o mestre definiu: o mestre ajusta a barra dele e
clica em **Usar esta posição e tamanho como padrão para todos** (botão que só o
mestre vê). Quem mexeu e quer voltar ao padrão clica em **Resetar**.

Só o mestre vê a bolinha de status na barra: **verde** = conectado ao bot,
**vermelha** = sem bot (a barra continua aparecendo, só não anima).

---

## 5. Rotina de cada sessão

1. Abra o **Ouvidor.exe** (ele liga o bot sozinho).
2. Abra o **Foundry** (o executável, em `localhost:30000`) e o mundo como mestre.
   No Ouvidor, *Módulo no Foundry* fica verde.
3. Abra o túnel da Cloudflare e mande o link para os jogadores.
4. Entre no canal de voz do Discord. O bot entra junto (ou use `/entrar`).
5. Jogue. Quando terminar, feche o Ouvidor.

Se você der F5 no Foundry ou o bot reiniciar, a conexão volta sozinha em
alguns segundos. Jogadores que recarregam a página recebem o estado atual.

---

## Problemas comuns

- **Ninguém anima**: confira no Ouvidor se *Canal de voz* está "Ouvindo" e
  *Módulo no Foundry* está "Conectado"; confira os IDs do Discord na
  configuração do módulo.
- **"Módulo no Foundry: Aguardando"**: o Foundry precisa estar aberto como
  mestre **nesta máquina**, e a porta do bot tem que ser igual nos dois lados.
  Com mais de um mestre logado, só o *GM ativo* conecta.
- **"O Discord recusou o token"**: gere outro em Developer Portal → Bot →
  Reset Token e cole na engrenagem.
- **"Fora do servidor"**: convide o bot com o link de convite.
- **O bot entra mas ninguém fala**: o bot precisa entrar sem estar ensurdecido
  (ele já faz isso). Se alguém moveu o bot ou o ensurdeceu no servidor, use
  `/sair` e `/entrar`.
- **A barra sumiu**: botão da barra de tokens, Alt+Shift+R ou Resetar.

Observação: o Discord só informa "começou/parou de falar", sem áudio. Por
isso as artes alternam num ritmo fixo; sincronia labial por fonema
não faz parte desta versão.

---

## Desenvolvimento

- **Bot**: `cd bot && npm install && npm start` (lê `bot/.env`). Com
  `OUVIDOR_IPC=1`, escreve linhas `@@OUVIDOR {json}` que o Ouvidor lê.
  Mensagens do WebSocket para o Foundry:
  - `{ "type": "state", "channelId", "channelName", "members": [...], "speaking": [...] }` ao conectar e quando o canal ou os membros mudam;
  - `{ "type": "speaking", "discordUserId", "speaking": true|false, "ts" }`;
  - `{ "type": "ping", "ts" }` a cada 15 s.
- **Ouvidor** (Go 1.26+): compila de qualquer sistema com
  `cd app && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H=windowsgui -s -w" -o ../dist/Ouvidor.exe .`
  Em Linux/macOS, `go run .` dentro de `app/` abre a mesma interface em
  `http://127.0.0.1:8766`. O ícone vem de `app/winres/` e é gerado com
  `go run github.com/tc-hib/go-winres@latest make --arch amd64`.
- **Módulo**: sem build; os arquivos de `module/` vão como estão. A API fica em
  `game.modules.get("retratos-falantes").api` (barra, ponte e estado de fala).
- **Release**: criar uma tag `vX.Y.Z` publica `Ouvidor.zip`,
  `retratos-falantes.zip` e `module.json` (o workflow ajusta a versão do módulo).

Inspirado na [Live Actors](https://github.com/mordachai/live-actors) (MIT),
que anima retratos a partir do microfone no navegador; aqui a detecção de fala
vem do Discord.
