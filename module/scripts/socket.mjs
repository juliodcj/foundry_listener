import { SOCKET } from "./const.mjs";
import { store } from "./speaking.mjs";
import { gmSpeaker } from "./gm-speaker.mjs";

// Mensagens entre clientes pelo socket do módulo. O Foundry não devolve a
// mensagem para quem enviou, então quem envia também aplica localmente.

export function emit(payload) {
  game.socket.emit(SOCKET, { ...payload, from: game.user.id });
}

function fromGM(data) {
  return !!game.users.get(data.from)?.isGM;
}

let bridgeRef = null;

export function initSocket(bridge) {
  bridgeRef = bridge;
  game.socket.on(SOCKET, data => {
    if (!data || typeof data !== "object") return;
    switch (data.type) {
      case "state":
        if (fromGM(data)) store.setState(data);
        break;
      case "speaking":
        if (fromGM(data)) store.setSpeaking(data.id, !!data.speaking);
        break;
      case "clear":
        if (fromGM(data)) store.clear();
        break;
      case "gmSpeaker":
        if (fromGM(data)) gmSpeaker.set(data.speaker ?? null);
        break;
      case "requestState":
        // Alguém abriu ou recarregou o Foundry: o GM que tem a ponte responde.
        if (bridgeRef?.active) {
          emit({ type: "state", ...store.snapshot() });
          emit({ type: "gmSpeaker", speaker: gmSpeaker.current });
        }
        break;
    }
  });
  if (!game.user.isGM || !bridgeRef?.active) emit({ type: "requestState" });
}
