export const MODULE_ID = "retratos-falantes";
export const SOCKET = `module.${MODULE_ID}`;

export const t = (key, data) => data
  ? game.i18n.format(`RF.${key}`, data)
  : game.i18n.localize(`RF.${key}`);

export const getSetting = key => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);
