// Logs do console e, quando o bot roda dentro do FoundryListener.exe (FOUNDRY_LISTENER_IPC=1),
// linhas "@@FOUNDRY_LISTENER {json}" que o app lê para montar a tela de status.

const IPC_PREFIX = "@@FOUNDRY_LISTENER ";
const ipc = process.env.FOUNDRY_LISTENER_IPC === "1";

const colors = { info: "\x1b[36m", ok: "\x1b[32m", warn: "\x1b[33m", err: "\x1b[31m", speak: "\x1b[35m" };

function stamp() {
  return new Date().toLocaleTimeString("pt-BR", { hour12: false });
}

function emit(obj) {
  if (ipc) process.stdout.write(IPC_PREFIX + JSON.stringify(obj) + "\n");
}

export function log(level, text) {
  if (ipc) {
    emit({ ev: "log", level, text });
    return;
  }
  const color = process.stdout.isTTY ? colors[level] ?? "" : "";
  const reset = color ? "\x1b[0m" : "";
  const line = `[${stamp()}] ${color}${text}${reset}`;
  if (level === "err") console.error(line);
  else console.log(line);
}

// Status completo; o app só mostra o último. Mudanças em sequência (várias
// pessoas falando) são agrupadas em no máximo um envio a cada 100 ms.
let pending = null;
let timer = null;
export function reportStatus(status) {
  if (!ipc) return;
  pending = status;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    emit({ ev: "status", ...pending() });
  }, 100);
}

export function reportFatal(kind, text) {
  if (ipc) emit({ ev: "fatal", kind, text });
  log("err", text);
}

export { ipc };
