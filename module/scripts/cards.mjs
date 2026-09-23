import { getSetting, t } from "./const.mjs";
import { gmSpeaker } from "./gm-speaker.mjs";

/** Configuração salva pelo GM (discord ↔ usuário ↔ ator, artes). */
export function getMapping() {
  const m = getSetting("mapping") ?? {};
  return {
    users: m.users ?? {},
    gm: { name: "", closed: "", open: "", useNpc: true, ...(m.gm ?? {}) },
  };
}

export function actorForUser(user, mapping = getMapping()) {
  const entry = mapping.users[user.id];
  if (entry?.actorId) {
    const actor = game.actors.get(entry.actorId);
    if (actor) return actor;
  }
  return user.character ?? null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Dados da ficha para o card. Caminhos do data model do pf2e (v7+):
 *   system.attributes.hp.{value,max,temp}
 *   actor.level (ou system.details.level.value)
 *   actor.class (item de classe) → .name
 *   system.resources.heroPoints.{value,max}
 * Em outros sistemas, só o HP é tentado e o resto fica em branco.
 */
export function actorStats(actor) {
  if (!actor) return {};
  const sys = actor.system ?? {};
  const hp = sys.attributes?.hp;
  const hero = sys.resources?.heroPoints;
  const level = num(actor.level ?? sys.details?.level?.value);
  const className = actor.class?.name ?? sys.details?.class?.name ?? "";
  const stats = {};
  if (hp && num(hp.max)) {
    const value = num(hp.value) ?? 0;
    const max = num(hp.max);
    stats.hp = {
      value, max,
      temp: num(hp.temp) ?? 0,
      pct: Math.max(0, Math.min(100, (value / max) * 100)),
      tone: value / max <= 0.25 ? "low" : value / max <= 0.5 ? "mid" : "high",
    };
  }
  if (level !== null) stats.level = level;
  if (className) stats.className = className;
  if (hero && game.system.id === "pf2e") {
    const max = num(hero.max) ?? 3;
    const value = num(hero.value) ?? 0;
    stats.hero = { value, max, pips: Array.from({ length: max }, (_, i) => i < value) };
  }
  return stats;
}

function userColor(user) {
  const c = user.color;
  return (c?.css ?? c?.toString?.() ?? String(c ?? "")) || "#c9a14a";
}

/**
 * Lista de cards que a barra mostra, na ordem. Só entra quem tem ator
 * (jogadores) e o GM, conforme a configuração.
 */
export function buildCards() {
  const mapping = getMapping();
  const filter = getSetting("cardFilter");
  const showStats = getSetting("showStats");
  const cards = [];

  for (const user of game.users) {
    if (user.isGM) continue;
    if (filter === "active" && !user.active) continue;
    const actor = actorForUser(user, mapping);
    if (!actor) continue;
    const entry = mapping.users[user.id] ?? {};
    cards.push({
      key: user.id,
      userId: user.id,
      actorId: actor.id,
      discordId: entry.discordId || "",
      isGM: false,
      color: userColor(user),
      name: actor.name,
      player: user.name,
      closed: entry.closed || actor.img || actor.prototypeToken?.texture?.src || "icons/svg/mystery-man.svg",
      open: entry.open || "",
      stats: showStats ? actorStats(actor) : {},
    });
  }

  const showGm = getSetting("showGm");
  if (showGm !== "never") {
    const gmUser = game.users.find(u => u.isGM && mapping.users[u.id]?.discordId)
      ?? game.users.activeGM ?? game.users.find(u => u.isGM);
    if (gmUser) {
      const entry = mapping.users[gmUser.id] ?? {};
      const npc = mapping.gm.useNpc ? gmSpeaker.current : null;
      cards.unshift({
        key: "gm",
        userId: gmUser.id,
        actorId: npc?.actorId ?? null,
        discordId: entry.discordId || "",
        isGM: true,
        gmMode: showGm,
        color: userColor(gmUser),
        name: npc?.name || mapping.gm.name || t("Card.GMName"),
        player: gmUser.name,
        closed: npc?.img || mapping.gm.closed || gmUser.avatar || "icons/svg/mystery-man.svg",
        open: npc ? "" : mapping.gm.open || "",
        stats: {},
      });
    }
  }
  return cards;
}

/** Atores cujas mudanças afetam a barra. */
export function trackedActorIds() {
  const mapping = getMapping();
  const ids = new Set();
  for (const user of game.users) {
    const actor = actorForUser(user, mapping);
    if (actor) ids.add(actor.id);
  }
  return ids;
}
