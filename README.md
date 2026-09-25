# Retratos Falantes (Foundry VTT + Discord)

Uma barra com os retratos dos personagens dentro do Foundry, no estilo dos
overlays de stream. Quando alguém fala no canal de voz do Discord, o retrato
dessa pessoa se anima (alternando entre duas artes, ou aumentando e diminuindo
de tamanho), e todos os
jogadores veem isso no próprio Foundry.

São três peças:

| Pasta     | O que é | Onde roda |
|-----------|---------|-----------|
| `app/`    | **FoundryListener.exe**: janela do Windows que liga o bot e mostra o status (Discord, canal de voz, quem está na call, conexão com o Foundry). | PC do mestre |
| `bot/`    | Bot do Discord (Node.js) que entra na call e avisa quem começou e parou de falar. Quando você pede, grava a sessão (uma faixa por pessoa). | PC do mestre (o FoundryListener.exe abre ele escondido) |
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
   → **New Application** → dê um nome (ex.: *Foundry Listener*) → **Create**.
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

Jeito mais fácil: abra o Foundry Listener (passo 2), configure o token e clique em
**Copiar link de convite do bot**. Cole o link no navegador e escolha o servidor.

Se preferir montar o link: Developer Portal → **OAuth2** → **URL Generator**:

- *Scopes*: `bot` e `applications.commands`
- *Bot Permissions*: **View Channels**, **Connect** e **Send Messages** (esta última só
  para o aviso de gravação no chat do canal de voz)

Abra a URL gerada e escolha o servidor. Se o canal de voz for privado, dê ao
cargo do bot as permissões *Ver canal* e *Conectar* nesse canal (e *Enviar
mensagens*, para o aviso de gravação).

Se você convidou o bot antes da gravação existir, convide de novo com o link do
Foundry Listener: é o jeito de ele ganhar a permissão *Enviar mensagens*. Não
precisa tirar o bot do servidor antes.

---

## 2. Instalar o Foundry Listener (PC do mestre)

1. Instale o **Node.js 22.12 ou mais novo** (uma vez só). No PowerShell:
   `winget install OpenJS.NodeJS.LTS`
2. Baixe o **FoundryListener.zip** (página de *Releases* do repositório, ou aba
   *Actions* → último build → artefato `FoundryListener`) e extraia numa pasta
   qualquer. Mantenha a pasta `bot` ao lado do `FoundryListener.exe`.
3. Abra o `FoundryListener.exe`. Na **engrenagem**, preencha:
   - **Token do bot**
   - **ID do servidor**
   - **Seu ID do Discord (GM)**
   - **Canal de voz fixo** (opcional): se preenchido, o bot só entra
     sozinho nesse canal. Vazio, ele segue você para qualquer canal de voz.
   - **Porta do bot** (padrão `8770`): tem que ser igual à do módulo.
   - **Porta do Foundry** (padrão `30000`): só para o indicador "Foundry online".
4. **Salvar** e **Iniciar**.

A configuração fica em `%AppData%\FoundryListener\config.json`. Se você já usava um
`bot\.env`, o Foundry Listener importa os valores dele na primeira vez. Quem
vinha da versão com o nome antigo (Ouvidor) não precisa configurar de novo: a
configuração em `%AppData%\Ouvidor\config.json` é lida enquanto não existir a nova.

### O que aparece na janela

A janela segue a mesma ordem da do [Foundry Tunnel](https://github.com/juliodcj/foundry_server),
para os dois ficarem harmônicos lado a lado no [Foundry Dock](https://github.com/juliodcj/foundry_dock):

- **Status** do bot (online, conectando, reconectando, erro), com o nome do bot
  e do servidor.
- **Na call** (quantas pessoas no canal do bot), **No ar há** e **Latência**
  (até o Discord).
- **Na call**: quem está no canal, com destaque verde em quem está falando agora.
  Dá para mandar o bot **Entrar** num canal (ou no canal onde você está) e
  **Sair**, e **Copiar link de convite do bot**.
- **Gravação**: gravar e parar, marcar momentos, as últimas gravações e as
  opções (veja [Gravar a sessão](#gravar-a-sessão)).
- **Foundry VTT** (se a porta local responde), **Módulo no Foundry** (se o
  Foundry do mestre está conectado no bot, com o nome do usuário e do mundo),
  **Discord** e **Canal de voz** (ouvindo / fora da call).
- **Atividade**, a mais recente em cima: conexões, entradas e saídas da call,
  erros. Marque *mostrar falas* para ver cada começo/fim de fala.

Fechar a janela encerra o bot. Se o bot cair, o Foundry Listener reinicia sozinho.

Erros comuns aparecem com a solução na própria janela: Node.js não instalado,
token recusado, bot fora do servidor, porta em uso.

### Gravar a sessão

A seção **Gravação** grava o áudio da call. É sempre manual: nada é gravado
até você clicar em **Gravar**.

1. Com o bot numa call (*Canal de voz* "Ouvindo"), clique em **Gravar**. O bot
   avisa no chat do canal de voz que a call está sendo gravada. Na lista *Na
   call*, uma bolinha vermelha marca quem já está numa faixa.
2. Durante a sessão, **Marcar momento** (com uma descrição opcional, como
   "início do combate") guarda aquele instante.
3. **Parar gravação** fecha os arquivos, avisa no chat e junta todo mundo num
   arquivo só.

Cada gravação vira uma pasta, por padrão em `Documentos\Foundry Listener\Gravações`:

```
2026-09-24_21-30_Taverna\
  sessao.json               ← dados da gravação (abaixo)
  Julio_1234.ogg            ← uma faixa por pessoa: nome + fim do ID do Discord
  Pedro_5678.ogg
  sessao-completa.ogg       ← todo mundo junto (gerado ao parar)
```

- As faixas são Ogg Opus comuns: abrem no VLC, no Audacity, no navegador. A
  criptografia do Discord só vale no caminho: o bot recebe o áudio já aberto,
  como qualquer participante.
- Todas as faixas começam no mesmo instante, com silêncio onde a pessoa não
  fala. Abrindo todas juntas no Audacity, a sessão fica em multipista, alinhada.
- O áudio é gravado como o Discord manda, sem converter nada: sem custo de CPU,
  e só ocupa espaço quando alguém fala (algumas centenas de MB por sessão
  longa, no máximo).
- Se o PC ou o bot cair, o que foi gravado até ali continua tocável.
- Se o bot trocar de canal ou reconectar, a gravação continua. Parar ou
  reiniciar o bot encerra a gravação (sem o mix; use **Gerar mix** depois).

**O arquivo com todo mundo junto** (`sessao-completa.ogg`) é feito pelo
**ffmpeg**, que precisa estar instalado (uma vez só):
`winget install Gyan.FFmpeg`. Depois, reinicie o bot. Sem o ffmpeg, as faixas
são gravadas normalmente e o botão **Gerar mix** das *Últimas gravações* faz o
arquivo depois.

**Opções de gravação**:

- **Pasta das gravações**.
- **Não gravar (IDs)**: IDs do Discord de quem não quer ser gravado. Essas
  pessoas ficam fora das faixas e do mix.
- **Avisar no chat do canal de voz** (ligado por padrão). Avise sempre os
  jogadores antes de gravar: gravar sem consentimento vai contra as regras do
  Discord e a LGPD.

O `sessao.json` serve para outros programas (transcrição, por exemplo):

```json
{
  "format": "foundry-listener-recording",
  "version": 1,
  "startedAt": "2026-09-25T00:30:00.000Z",
  "endedAt": "2026-09-25T04:10:12.480Z",
  "duration": 13212.48,
  "sampleRate": 48000,
  "guild": { "id": "…", "name": "Mesa" },
  "channels": [{ "id": "…", "name": "Taverna", "at": 0 }],
  "tracks": [
    {
      "userId": "…", "name": "Julio", "username": "julio",
      "file": "Julio_1234.ogg",
      "firstAudioAt": 3.42,
      "segments": [[3.42, 7.9], [12.1, 15.36]]
    }
  ],
  "markers": [{ "at": 1830.5, "label": "início do combate" }],
  "mix": { "file": "sessao-completa.ogg", "status": "ok" }
}
```

Os tempos estão em segundos desde o início da gravação, iguais em todas as
faixas. `segments` são os trechos em que a pessoa falou (pausas de mais de
meio segundo separam um trecho do outro). `endedAt` fica `null` enquanto grava,
ou se a gravação foi interrompida. `mix.status`: `running`, `ok`, `failed`,
`no-ffmpeg` ou `pending`.

### Dentro do Foundry Dock

Aberto pelo [Foundry Dock](https://github.com/juliodcj/foundry_dock), o app
recebe `--dock=<janela do Dock>`: a janela já nasce fora da tela e entra no
Dock sem barra de título nem botão na barra de tarefas, e o Dock a encaixa na
moldura dela. Aberto do jeito normal, nada muda.

### Sem o Foundry Listener (opcional)

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
https://github.com/juliodcj/foundry_listener/releases/latest/download/module.json
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
| Porta do bot | mundo | Porta do WebSocket do bot (igual à do Foundry Listener). |
| Card do mestre | mundo | Mostrar o card do mestre só quando fala, sempre ou nunca. |
| Quais jogadores mostrar | mundo | Todos com personagem, ou só quem está conectado no Foundry. |
| Mostrar dados da ficha | mundo | PV, nível, classe e pontos de heroísmo (círculos) do PF2e. |
| Estilo do retrato | mundo | **Recorte** (padrão): a arte PNG sem fundo fica em pé sobre a placa, sem moldura, e o brilho segue o contorno do personagem. **Moldura**: a arte fica dentro de um quadro. **Moldura com fundo**: igual, com um fundo opaco atrás da arte, para partes transparentes do personagem não se misturarem com o cenário. |
| Zoom da arte na moldura | mundo | Nos estilos com moldura: 1 = arte inteira dentro do quadro (mesma altura do recorte); mais que isso aproxima a partir do centro da imagem. |
| Tamanho da placa | mundo | Aumenta ou diminui a placa (nome, PV, nível) sem mexer na arte. O + e − da barra aumentam tudo junto. |
| Tamanho do personagem | mundo | Aumenta ou diminui a arte do personagem sem mexer na placa. |
| Virar para quem fala | mundo | Desligado por padrão. Quando duas pessoas conversam, uma delas espelha a arte para olhar para a outra (só na barra horizontal). O mestre fica de fora: não vira e não conta como parte da conversa. Diga para que lado as artes olham: se olham para a direita, vira o card mais à direita; se para a esquerda, o mais à esquerda. Só conta quem falou pelo menos meio segundo, e cada card fica pelo menos 1,5 s virado antes de mudar de novo. |
| Tempo de conversa | mundo | Duas pessoas estão conversando se as duas falaram dentro desse tempo (padrão 6 s). Depois disso a arte desvira. |
| Velocidade da troca de arte | mundo | Intervalo entre a arte 1 e a arte 2 (padrão 150 ms). |
| Brilho em quem fala | mundo | Contorno na cor do jogador em volta de quem está falando (ligado por padrão). |
| Esmaecer quem não fala | mundo | A arte de quem está calado fica mais apagada (ligado por padrão). |
| Animação com uma arte só | mundo | Aumentar e diminuir (padrão), quicar, ou só o brilho. |
| Ícone dos pontos de heroísmo | mundo | Imagem no lugar dos círculos; pontos gastos ficam apagados. |
| Tolerância para começar a falar | mundo | O retrato só anima se o som durar pelo menos esse tempo (padrão 0 = desligado). Aumente (200 a 400 ms) se cliques, teclado ou barulhos do microfone animam o retrato. Para barulho contínuo, ajuste a Sensibilidade de entrada no Discord. |
| Espera ao parar de falar | mundo | Atraso antes de voltar ao normal, para não piscar entre palavras (padrão 300 ms). |
| Durante o combate | mundo | Nada, pausar a animação ou esconder a barra. |
| Esconder a barra (mestre) | cliente | Só na tela do mestre. Jogadores recolhem em vez de esconder. |
| Modo compacto | mundo | Placa só com nome, jogador e pontos de heroísmo; cards colados, com cantos retos. |
| Só quem está falando aparece | mundo | Esconde os cards de quem não está falando. |
| Apagar a barra inteira quando ninguém fala | mundo | Opacidade da barra toda em repouso (volta ao normal com o mouse em cima). Padrão 1 = desligado. |

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
- **Compacto**: placa só com o nome do personagem, do jogador e os pontos de
  heroísmo; os cards ficam colados, com cantos retos.
- 🎙 **Só quem fala**: esconde os cards de quem não está falando.
- ⌃ **Recolher**: esconde os retratos e deixa só uma abinha "Retratos" (clique
  nela para voltar). Serve para ver algo que está atrás da barra; vale só na
  sua tela.
- 👁 **Esconder dos jogadores** (só o mestre vê): some com a barra na tela de
  todos os jogadores, por exemplo no começo de um combate. Clique de novo para
  mostrar. Enquanto estiver escondida, o mestre continua vendo a barra, meio
  apagada e com o aviso "oculta para os jogadores". Também dá para ligar e
  desligar nas Configurações (**Esconder a barra dos jogadores**) ou com um
  atalho que o mestre define em Configurar Controles.
- ↺ **Resetar**: volta para a posição e o tamanho padrão do mestre (útil se
  a barra sumiu da vista).
- ✖ **Esconder só na minha tela** (com a barra destravada). Para mostrar de
  novo: botão **Retratos Falantes** na barra de ferramentas de tokens (à
  esquerda), **Alt+Shift+R**, ou nas Configurações. O mestre ganha um ícone
  redondo de retratos no lugar onde a barra estava: um clique e ela volta.
- Duplo clique num card abre a ficha (se você tiver permissão).
- **Pontos de heroísmo** (só o mestre): clique dá um ponto, botão direito tira um.

**O que é de cada jogador, o que é do mestre.** Jogadores só **recolhem**,
**travam/destravam**, **movem** e **mudam o tamanho** da barra (e **Resetar**
volta ao padrão do mestre); isso fica salvo só para eles. Todo o resto segue o
mestre: horizontal/vertical, modo compacto, só quem fala, transparência e
esconder. Quando o mestre muda a orientação, muda para todos; o tamanho do
mestre vale para quem ainda não ajustou o seu. A
posição de quem nunca mexeu é a que o mestre definiu em **Usar esta posição e
tamanho como padrão para todos** (botão que só o mestre vê).

Só o mestre vê a bolinha de status na barra: **verde** = conectado ao bot,
**vermelha** = sem bot (a barra continua aparecendo, só não anima).

---

## 5. Rotina de cada sessão

1. Abra o **FoundryListener.exe** (ele liga o bot sozinho).
2. Abra o **Foundry** (o executável, em `localhost:30000`) e o mundo como mestre.
   No Foundry Listener, *Módulo no Foundry* fica verde.
3. Abra o túnel da Cloudflare e mande o link para os jogadores.
4. Entre no canal de voz do Discord. O bot entra junto (ou use `/entrar`).
5. Se for gravar, avise os jogadores e clique em **Gravar** no Foundry Listener.
6. Jogue. Quando terminar, **Parar gravação** (se estiver gravando) e feche o
   Foundry Listener.

Se você der F5 no Foundry ou o bot reiniciar, a conexão volta sozinha em
alguns segundos. Jogadores que recarregam a página recebem o estado atual.

---

## Problemas comuns

- **Ninguém anima**: confira no Foundry Listener se *Canal de voz* está "Ouvindo" e
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
- **"Sem permissão para avisar no chat"**: convide o bot de novo com o link
  do Foundry Listener (ele agora pede *Enviar mensagens*).
- **A gravação não tem o arquivo `sessao-completa.ogg`**: instale o ffmpeg
  (`winget install Gyan.FFmpeg`), reinicie o bot e clique em **Gerar mix**
  na gravação.
- **A barra sumiu**: Configurações → Retratos Falantes → **Trazer a barra de
  volta** (mostra, abre e volta para a posição padrão; qualquer um pode usar).
  O mestre também tem o ícone redondo de retratos na tela. Nos jogadores:
  botão da barra de tokens, Alt+Shift+R ou Resetar. Se o jogador
  vê o aviso "O mestre escondeu a barra", é o olho do mestre que está ligado:
  só o mestre pode mostrar de novo.

Observação: para animar os retratos, o bot só usa "começou/parou de falar",
sem olhar o áudio. Por isso as artes alternam num ritmo fixo; sincronia labial
por fonema não faz parte desta versão.

---

## Desenvolvimento

- **Bot**: `cd bot && npm install && npm start` (lê `bot/.env`). Com
  `FOUNDRY_LISTENER_IPC=1`, escreve linhas `@@FOUNDRY_LISTENER {json}` que o Foundry Listener lê.
  Mensagens do WebSocket para o Foundry:
  - `{ "type": "state", "channelId", "channelName", "members": [...], "speaking": [...] }` ao conectar e quando o canal ou os membros mudam;
  - `{ "type": "speaking", "discordUserId", "speaking": true|false, "ts" }`;
  - `{ "type": "ping", "ts" }` a cada 15 s.

  Comandos do Foundry Listener para o bot (entrada padrão, um JSON por linha):
  `join`, `leave`, `status`, `record-start` (`dir`, `exclude`, `notify`),
  `record-stop`, `record-mark` (`label`) e `record-mix` (`dir`). A gravação
  fica em `bot/src/recorder.js` e o arquivo Ogg em `bot/src/ogg.js`. Testes:
  `npm test`.
- **Foundry Listener** (Go 1.26+): compila de qualquer sistema com
  `cd app && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H=windowsgui -s -w" -o ../dist/FoundryListener.exe .`
  Em Linux/macOS, `go run .` dentro de `app/` abre a mesma interface em
  `http://127.0.0.1:8766`. O ícone vem de `app/winres/` e é gerado com
  `go run github.com/tc-hib/go-winres@latest make --arch amd64`.
- **Módulo**: sem build; os arquivos de `module/` vão como estão. A API fica em
  `game.modules.get("retratos-falantes").api` (barra, ponte e estado de fala).
- **Release**: criar uma tag `vX.Y.Z` publica `FoundryListener.zip`,
  `retratos-falantes.zip` e `module.json` (o workflow ajusta a versão do módulo).

Inspirado na [Live Actors](https://github.com/mordachai/live-actors) (MIT),
que anima retratos a partir do microfone no navegador; aqui a detecção de fala
vem do Discord.
