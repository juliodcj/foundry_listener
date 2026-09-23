import { MODULE_ID, getSetting, t } from "./const.mjs";
import { registerKeybindings, registerSettings } from "./settings.mjs";
import { bar } from "./bar.mjs";
import { bridge } from "./bridge.mjs";
import { emit, initSocket } from "./socket.mjs";
import { gmSpeaker } from "./gm-speaker.mjs";
import { store } from "./speaking.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerKeybindings();
});

Hooks.once("ready", () => {
  bar.init();
  bridge.sync();
  initSocket(bridge);

  // Card do GM troca para o NPC selecionado.
  gmSpeaker.onChange(() => bar.rebuild());

  // Para macros e depuração: game.modules.get("retratos-falantes").api
  game.modules.get(MODULE_ID).api = { bar, bridge, store, gmSpeaker };
});

// Quem é o GM ativo pode mudar quando GMs entram e saem.
Hooks.on("userConnected", (user, connected) => {
  bridge.sync();
  if (user.isGM && !connected && !game.users.activeGM) store.clear();
  if (getSetting("cardFilter") === "active") bar.requestRebuild();
});

Hooks.on("updateUser", (user, changes) => {
  if ("character" in changes || "color" in changes || "name" in changes || "avatar" in changes) bar.requestRebuild();
});
Hooks.on("createUser", () => bar.requestRebuild());
Hooks.on("deleteUser", () => bar.requestRebuild());

// Dados da ficha (HP, hero points, nível, classe) em tempo real.
Hooks.on("updateActor", actor => bar.onActorChange(actor));
Hooks.on("deleteActor", () => bar.requestRebuild());
for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, item => bar.onActorChange(item.parent));
}

// Combate: pausar ou esconder a barra, conforme a configuração.
for (const hook of ["createCombat", "updateCombat", "deleteCombat", "combatStart"]) {
  Hooks.on(hook, () => bar.updateCombat());
}
Hooks.on("canvasReady", () => bar.updateCombat());

let controlTimer = null;

// GM: o NPC selecionado vira o retrato de quem fala pelo GM.
Hooks.on("controlToken", () => {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  // controlToken dispara uma vez por token ao trocar a seleção; espera assentar.
  clearTimeout(controlTimer);
  controlTimer = setTimeout(() => {
    const speaker = gmSpeaker.fromControlled();
    if (JSON.stringify(speaker) === JSON.stringify(gmSpeaker.current)) return;
    gmSpeaker.set(speaker);
    emit({ type: "gmSpeaker", speaker });
  }, 50);
});

// Botão na barra de ferramentas de tokens para mostrar/esconder a barra.
// v13+: controls é um objeto por camada, e tools também é um objeto.
Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens;
  if (!tokens?.tools) return;
  tokens.tools[`${MODULE_ID}-toggle`] = {
    name: `${MODULE_ID}-toggle`,
    title: t("Controls.Toggle"),
    icon: "fa-solid fa-users-rectangle",
    order: Object.keys(tokens.tools).length,
    toggle: true,
    active: !getSetting("hidden"),
    onChange: (_event, active) => bar.toggleHidden(!active),
  };
});
