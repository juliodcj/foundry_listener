import { MODULE_ID } from "./const.mjs";
import { bar } from "./bar.mjs";
import { bridge } from "./bridge.mjs";
import { MappingConfig } from "./mapping-app.mjs";

export function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);
  const rebuild = () => bar.rebuild();
  const apply = () => bar.applySettings();

  // ---- mundo (GM) -----------------------------------------------------------

  game.settings.registerMenu(MODULE_ID, "mappingMenu", {
    name: "RF.Settings.Mapping.Name",
    label: "RF.Settings.Mapping.Label",
    hint: "RF.Settings.Mapping.Hint",
    icon: "fa-solid fa-users-gear",
    type: MappingConfig,
    restricted: true,
  });

  reg("mapping", {
    scope: "world", config: false, type: Object,
    default: { users: {}, gm: { name: "", closed: "", open: "", useNpc: true } },
    onChange: rebuild,
  });

  reg("wsPort", {
    name: "RF.Settings.WsPort.Name", hint: "RF.Settings.WsPort.Hint",
    scope: "world", config: true, restricted: true, type: Number, default: 8770,
    onChange: () => bridge.restart(),
  });

  reg("showGm", {
    name: "RF.Settings.ShowGm.Name", hint: "RF.Settings.ShowGm.Hint",
    scope: "world", config: true, type: String, default: "speaking",
    choices: {
      speaking: "RF.Settings.ShowGm.Speaking",
      always: "RF.Settings.ShowGm.Always",
      never: "RF.Settings.ShowGm.Never",
    },
    onChange: rebuild,
  });

  reg("cardFilter", {
    name: "RF.Settings.CardFilter.Name", hint: "RF.Settings.CardFilter.Hint",
    scope: "world", config: true, type: String, default: "all",
    choices: { all: "RF.Settings.CardFilter.All", active: "RF.Settings.CardFilter.Active" },
    onChange: rebuild,
  });

  reg("showStats", {
    name: "RF.Settings.ShowStats.Name", hint: "RF.Settings.ShowStats.Hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: rebuild,
  });

  reg("flipMs", {
    name: "RF.Settings.FlipMs.Name", hint: "RF.Settings.FlipMs.Hint",
    scope: "world", config: true, type: Number, default: 150,
    range: { min: 60, max: 500, step: 10 },
    onChange: () => bar.restartFlip(),
  });

  reg("releaseMs", {
    name: "RF.Settings.ReleaseMs.Name", hint: "RF.Settings.ReleaseMs.Hint",
    scope: "world", config: true, type: Number, default: 300,
    range: { min: 0, max: 1500, step: 50 },
  });

  reg("combatMode", {
    name: "RF.Settings.CombatMode.Name", hint: "RF.Settings.CombatMode.Hint",
    scope: "world", config: true, type: String, default: "none",
    choices: {
      none: "RF.Settings.CombatMode.None",
      pause: "RF.Settings.CombatMode.Pause",
      hide: "RF.Settings.CombatMode.Hide",
    },
    onChange: () => bar.updateCombat(),
  });

  // Posição, escala e orientação que valem para quem nunca mexeu na barra.
  reg("defaultLayout", {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => bar.applyLayout(),
  });

  // ---- cliente (cada pessoa na própria tela) ----------------------------------

  reg("hidden", {
    name: "RF.Settings.Hidden.Name", hint: "RF.Settings.Hidden.Hint",
    scope: "client", config: true, type: Boolean, default: false,
    onChange: () => {
      apply();
      ui.controls?.render();
    },
  });

  reg("compact", {
    name: "RF.Settings.Compact.Name", hint: "RF.Settings.Compact.Hint",
    scope: "client", config: true, type: Boolean, default: false,
    onChange: apply,
  });

  reg("idleOpacity", {
    name: "RF.Settings.IdleOpacity.Name", hint: "RF.Settings.IdleOpacity.Hint",
    scope: "client", config: true, type: Number, default: 0.6,
    range: { min: 0.1, max: 1, step: 0.05 },
    onChange: apply,
  });

  reg("locked", {
    scope: "client", config: false, type: Boolean, default: true,
    onChange: apply,
  });

  // Só o que este cliente mudou (posição, escala, orientação); o resto vem do GM.
  reg("layout", {
    scope: "client", config: false, type: Object, default: {},
    onChange: () => bar.applyLayout(),
  });
}

export function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "toggleBar", {
    name: "RF.Keys.Toggle.Name",
    hint: "RF.Keys.Toggle.Hint",
    editable: [{ key: "KeyR", modifiers: ["Alt", "Shift"] }],
    onDown: () => {
      bar.toggleHidden();
      return true;
    },
  });
  game.keybindings.register(MODULE_ID, "resetBar", {
    name: "RF.Keys.Reset.Name",
    hint: "RF.Keys.Reset.Hint",
    editable: [],
    onDown: () => {
      bar.resetPosition();
      return true;
    },
  });
  game.keybindings.register(MODULE_ID, "lockBar", {
    name: "RF.Keys.Lock.Name",
    hint: "RF.Keys.Lock.Hint",
    editable: [],
    onDown: () => {
      game.settings.set(MODULE_ID, "locked", !game.settings.get(MODULE_ID, "locked"));
      return true;
    },
  });
}

