import { getSetting } from "./const.mjs";

/**
 * NPC que o GM está "interpretando": quando o GM seleciona o token de um NPC,
 * o card do GM mostra esse NPC enquanto ele fala (ideia da live-actors).
 */
class GmSpeaker {
  constructor() {
    this.current = null; // { actorId, tokenId, name, img } ou null
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  set(speaker) {
    const same = JSON.stringify(speaker) === JSON.stringify(this.current);
    this.current = speaker;
    if (!same) for (const fn of this.listeners) fn(speaker);
  }

  /** Calcula o NPC a partir dos tokens selecionados (só no cliente do GM). */
  fromControlled() {
    if (!getSetting("mapping")?.gm?.useNpc) return null;
    const token = canvas?.tokens?.controlled?.at(-1);
    const actor = token?.actor;
    if (!actor) return null;
    if (actor.hasPlayerOwner) return null; // personagem de jogador não conta como NPC
    return {
      actorId: actor.id,
      tokenId: token.id,
      name: token.document.name || actor.name,
      img: actor.img || token.document.texture?.src || "",
    };
  }
}

export const gmSpeaker = new GmSpeaker();
