import { MODULE_ID } from "./const.mjs";
import { bar } from "./bar.mjs";
import { bridge } from "./bridge.mjs";
import { MappingConfig } from "./mapping-app.mjs";

/** Botão nas configurações: não abre janela, só traz a barra de volta. */
class RestoreBarMenu extends foundry.applications.api.ApplicationV2 {
  async render() {
    await bar.restoreBar();
    return this;
  }
}

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

  game.settings.registerMenu(MODULE_ID, "restoreMenu", {
    name: "RF.Settings.Restore.Name",
    label: "RF.Settings.Restore.Label",
    hint: "RF.Settings.Restore.Hint",
    icon: "fa-solid fa-rotate-left",
    type: RestoreBarMenu,
    restricted: false,
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

  reg("portraitStyle", {
    name: "RF.Settings.PortraitStyle.Name", hint: "RF.Settings.PortraitStyle.Hint",
    scope: "world", config: true, type: String, default: "cutout",
    choices: {
      cutout: "RF.Settings.PortraitStyle.Cutout",
      frame: "RF.Settings.PortraitStyle.Frame",
      frameBg: "RF.Settings.PortraitStyle.FrameBg",
    },
    onChange: apply,
  });

  // Proporção entre a placa (nome, PV) e a arte do personagem, para todos.
  // Estilos com moldura: 1 = arte inteira; mais que isso aproxima (perto do rosto).
  reg("frameZoom", {
    name: "RF.Settings.FrameZoom.Name", hint: "RF.Settings.FrameZoom.Hint",
    scope: "world", config: true, type: Number, default: 1,
    range: { min: 1, max: 3, step: 0.05 },
    onChange: apply,
  });

  reg("plateScale", {
    name: "RF.Settings.PlateScale.Name", hint: "RF.Settings.PlateScale.Hint",
    scope: "world", config: true, type: Number, default: 1,
    range: { min: 0.6, max: 2, step: 0.05 },
    onChange: apply,
  });

  reg("artScale", {
    name: "RF.Settings.ArtScale.Name", hint: "RF.Settings.ArtScale.Hint",
    scope: "world", config: true, type: Number, default: 1,
    range: { min: 0.5, max: 2, step: 0.05 },
    onChange: apply,
  });

  reg("speakingGlow", {
    name: "RF.Settings.SpeakingGlow.Name", hint: "RF.Settings.SpeakingGlow.Hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: apply,
  });

  reg("fadeSilent", {
    name: "RF.Settings.FadeSilent.Name", hint: "RF.Settings.FadeSilent.Hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: apply,
  });

  reg("singleArtAnimation", {
    name: "RF.Settings.SingleArt.Name", hint: "RF.Settings.SingleArt.Hint",
    scope: "world", config: true, type: String, default: "pulse",
    choices: {
      pulse: "RF.Settings.SingleArt.Pulse",
      bounce: "RF.Settings.SingleArt.Bounce",
      none: "RF.Settings.SingleArt.None",
    },
    onChange: apply,
  });

  // Duas pessoas conversando: uma delas espelha a arte para olhar para a outra.
  reg("faceSpeaker", {
    name: "RF.Settings.FaceSpeaker.Name", hint: "RF.Settings.FaceSpeaker.Hint",
    scope: "world", config: true, type: String, default: "off",
    choices: {
      off: "RF.Settings.FaceSpeaker.Off",
      right: "RF.Settings.FaceSpeaker.Right",
      left: "RF.Settings.FaceSpeaker.Left",
    },
    onChange: () => bar.updateFacing(),
  });

  reg("faceWindow", {
    name: "RF.Settings.FaceWindow.Name", hint: "RF.Settings.FaceWindow.Hint",
    scope: "world", config: true, type: Number, default: 6,
    range: { min: 2, max: 20, step: 1 },
    onChange: () => bar.updateFacing(),
  });

  reg("heroIcon", {
    name: "RF.Settings.HeroIcon.Name", hint: "RF.Settings.HeroIcon.Hint",
    scope: "world", config: true, type: String, default: "", filePicker: "image",
    onChange: rebuild,
  });

  reg("startMs", {
    name: "RF.Settings.StartMs.Name", hint: "RF.Settings.StartMs.Hint",
    scope: "world", config: true, type: Number, default: 0,
    range: { min: 0, max: 1000, step: 50 },
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

  // Botão de olho do mestre: esconde a barra de todos os jogadores.
  reg("hiddenForPlayers", {
    name: "RF.Settings.HiddenForPlayers.Name", hint: "RF.Settings.HiddenForPlayers.Hint",
    scope: "world", config: true, restricted: true, type: Boolean, default: false,
    onChange: apply,
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

  // Modo compacto: placa só com nome, jogador e heroísmo, cards colados.
  reg("slim", {
    name: "RF.Settings.Slim.Name", hint: "RF.Settings.Slim.Hint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: apply,
  });

  // Chave antiga do "modo compacto"; hoje é "só quem está falando aparece".
  reg("compact", {
    name: "RF.Settings.Compact.Name", hint: "RF.Settings.Compact.Hint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: apply,
  });

  reg("idleOpacity", {
    name: "RF.Settings.IdleOpacity.Name", hint: "RF.Settings.IdleOpacity.Hint",
    scope: "world", config: true, type: Number, default: 1,
    range: { min: 0.1, max: 1, step: 0.05 },
    onChange: apply,
  });

  // Barra recolhida numa abinha (cada pessoa na própria tela).
  reg("collapsed", {
    scope: "client", config: false, type: Boolean, default: false,
    onChange: () => {
      apply();
      ui.controls?.render();
    },
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
  game.keybindings.register(MODULE_ID, "togglePlayers", {
    name: "RF.Keys.TogglePlayers.Name",
    hint: "RF.Keys.TogglePlayers.Hint",
    editable: [],
    restricted: true,
    onDown: () => {
      bar.togglePlayersView();
      return true;
    },
  });
  game.keybindings.register(MODULE_ID, "resetBar", {
    name: "RF.Keys.Reset.Name",
    hint: "RF.Keys.Reset.Hint",
    editable: [],
    onDown: () => {
      bar.restoreBar();
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

