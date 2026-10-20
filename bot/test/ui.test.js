import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A janela do app (embutida no .exe) para inteira se o script tiver um erro
// de sintaxe: nada aparece e o bot nem inicia.
test("o script da janela do app não tem erro de sintaxe", () => {
  const html = readFileSync(new URL("../../app/ui/index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 0, "nenhum <script> encontrado");
  scripts.forEach((code, i) => assert.doesNotThrow(() => new Function(code), `script ${i + 1}`));
});
