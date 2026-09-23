import { MODULE_ID, setSetting, t } from "./const.mjs";
import { getMapping } from "./cards.mjs";
import { store } from "./speaking.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SNOWFLAKE = /^\d{17,20}$/;

function pickerSource(path) {
  return /^(icons|ui|sounds|cards)\//.test(path) ? "public" : "data";
}

/**
 * Procura artes com sufixo ao lado da arte do ator ou do token:
 *   pasta/ezren.webp → pasta/ezren-closed.webp e pasta/ezren-open.webp
 * (qualquer extensão de imagem). Só o GM consegue listar pastas.
 */
export async function detectArt(actor) {
  const bases = [actor?.img, actor?.prototypeToken?.texture?.src]
    .filter(p => p && !/^(https?:|data:)/.test(p) && !p.includes("mystery-man"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  for (const base of bases) {
    const slash = base.lastIndexOf("/");
    const dir = slash >= 0 ? base.slice(0, slash) : "";
    const file = decodeURIComponent(base.slice(slash + 1));
    const stem = file.replace(/\.[^.]+$/, "").replace(/[-_](closed|open)$/i, "");
    let files = [];
    try {
      files = (await FP.browse(pickerSource(base), decodeURIComponent(dir))).files ?? [];
    } catch {
      continue;
    }
    const find = suffix => files.find(f => {
      const name = decodeURIComponent(f.split("/").pop()).replace(/\.[^.]+$/, "");
      return name.toLowerCase() === `${stem}${suffix}`.toLowerCase()
        || name.toLowerCase() === `${stem}${suffix.replace("-", "_")}`.toLowerCase();
    });
    const closed = find("-closed");
    const open = find("-open");
    if (closed || open) return { closed: closed ?? base, open: open ?? "" };
  }
  return null;
}

/** Configuração do GM: Discord ↔ usuário ↔ personagem e as artes. */
export class MappingConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-mapping`,
    tag: "form",
    classes: ["rf-mapping"],
    window: { title: "RF.Mapping.Title", icon: "fa-solid fa-users-gear", resizable: true },
    position: { width: 760, height: "auto" },
    form: { handler: MappingConfig._onSubmit, closeOnSubmit: true },
    actions: {
      detect: MappingConfig._onDetect,
      detectAll: MappingConfig._onDetectAll,
      useMember: MappingConfig._onUseMember,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/mapping.hbs`, scrollable: [".rf-scroll"] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  constructor(options) {
    super(options);
    this._unsub = store.onChange(kind => {
      if (kind === "state" || kind === "bridge") this._refreshMembers();
    });
  }

  async close(options) {
    this._unsub?.();
    return super.close(options);
  }

  async _prepareContext() {
    const mapping = getMapping();
    const actors = game.actors.filter(a => a.type === "character" || a.hasPlayerOwner);
    const actorList = (actors.length ? actors : [...game.actors])
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(a => ({ id: a.id, name: a.name }));
    const memberNames = new Map([...store.members.values()].map(m => [m.id, m.name]));

    const users = [...game.users].map(user => {
      const entry = mapping.users[user.id] ?? {};
      const actorId = entry.actorId ?? "";
      return {
        id: user.id,
        name: user.name,
        color: user.color?.css ?? String(user.color ?? ""),
        isGM: user.isGM,
        active: user.active,
        discordId: entry.discordId ?? "",
        discordName: memberNames.get(entry.discordId) ?? "",
        defaultActor: user.character?.name ?? "",
        actors: actorList.map(a => ({ ...a, selected: a.id === actorId })),
        closed: entry.closed ?? "",
        open: entry.open ?? "",
      };
    });

    return {
      players: users.filter(u => !u.isGM),
      gms: users.filter(u => u.isGM),
      gm: mapping.gm,
      members: this._memberContext(mapping),
      bridgeConnected: store.bridgeConnected,
      channelName: store.channel?.name ?? "",
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "RF.Mapping.Save" }],
    };
  }

  _memberContext(mapping = getMapping()) {
    const byDiscord = new Map(Object.entries(mapping.users).map(([uid, e]) => [e.discordId, uid]));
    return [...store.members.values()].map(m => ({
      id: m.id,
      name: m.name,
      username: m.username,
      avatar: m.avatar,
      speaking: store.raw.has(m.id),
      mappedTo: game.users.get(byDiscord.get(m.id))?.name ?? "",
    }));
  }

  /** Atualiza só a lista de quem está na call, sem perder o que foi digitado. */
  _refreshMembers() {
    const box = this.element?.querySelector(".rf-members");
    if (!box) return;
    const list = this._memberContext();
    const esc = foundry.utils.escapeHTML ?? (s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`));
    const status = store.bridgeConnected
      ? (store.channel ? t("Mapping.InChannel", { channel: esc(store.channel.name) }) : t("Mapping.NoChannel"))
      : t("Mapping.BridgeOff");
    box.querySelector(".rf-members-status").innerHTML = status;
    box.querySelector(".rf-members-list").innerHTML = list.map(m => `
      <li class="${m.speaking ? "speaking" : ""}">
        ${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : ""}
        <span class="rf-member-name">${esc(m.name)}</span>
        <code>${esc(m.id)}</code>
        <span class="rf-member-map">${m.mappedTo ? `→ ${esc(m.mappedTo)}` : ""}</span>
      </li>`).join("");
    const datalist = this.element.querySelector("#rf-discord-members");
    if (datalist) datalist.innerHTML = list.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._refreshMembers();
  }

  static async _onDetect(_event, target) {
    const row = target.closest("[data-user-id]");
    await MappingConfig._detectRow(row, true);
  }

  static async _onDetectAll() {
    let found = 0;
    for (const row of this.element.querySelectorAll(".rf-player-row[data-user-id]")) {
      if (await MappingConfig._detectRow(row, false)) found++;
    }
    ui.notifications.info(t("Mapping.DetectAllDone", { count: found }));
  }

  static async _detectRow(row, notify) {
    const userId = row.dataset.userId;
    const select = row.querySelector("select");
    const actor = game.actors.get(select?.value) ?? game.users.get(userId)?.character;
    if (!actor) {
      if (notify) ui.notifications.warn(t("Mapping.NoActor"));
      return false;
    }
    const art = await detectArt(actor);
    if (!art) {
      if (notify) ui.notifications.warn(t("Mapping.DetectNone", { name: actor.name }));
      return false;
    }
    const set = (field, value) => {
      const el = row.querySelector(`[name="users.${userId}.${field}"]`);
      if (el) el.value = value;
    };
    set("closed", art.closed);
    set("open", art.open);
    if (notify) ui.notifications.info(t("Mapping.DetectFound", { name: actor.name }));
    return true;
  }

  static _onUseMember(_event, target) {
    const input = target.closest(".rf-discord-field")?.querySelector("input");
    if (!input) return;
    input.focus();
    input.showPicker?.();
  }

  static async _onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const users = {};
    const bad = [];
    for (const [userId, raw] of Object.entries(data.users ?? {})) {
      if (!game.users.get(userId)) continue;
      const discordId = String(raw.discordId ?? "").trim();
      if (discordId && !SNOWFLAKE.test(discordId)) bad.push(game.users.get(userId).name);
      const entry = {
        discordId: SNOWFLAKE.test(discordId) ? discordId : "",
        actorId: raw.actorId || "",
        closed: raw.closed || "",
        open: raw.open || "",
      };
      if (entry.discordId || entry.actorId || entry.closed || entry.open) users[userId] = entry;
    }
    const gm = {
      name: String(data.gm?.name ?? "").trim(),
      closed: data.gm?.closed || "",
      open: data.gm?.open || "",
      useNpc: !!data.gm?.useNpc,
    };
    if (bad.length) ui.notifications.warn(t("Mapping.BadIds", { names: bad.join(", ") }));
    await setSetting("mapping", { users, gm });
    ui.notifications.info(t("Mapping.Saved"));
  }
}

