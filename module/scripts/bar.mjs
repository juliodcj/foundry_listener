import { getSetting, setSetting, t } from "./const.mjs";
import { store } from "./speaking.mjs";
import { buildCards, trackedActorIds } from "./cards.mjs";

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.1;
const DEFAULT_LAYOUT = { xFrac: 0.5, yFrac: 0, scale: 1, orientation: "horizontal" };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundScale = s => Math.round(clamp(s, MIN_SCALE, MAX_SCALE) * 100) / 100;

function validLayout(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  if (Number.isFinite(obj.xFrac)) out.xFrac = clamp(obj.xFrac, 0, 1);
  if (Number.isFinite(obj.yFrac)) out.yFrac = clamp(obj.yFrac, 0, 1);
  if (Number.isFinite(obj.scale)) out.scale = roundScale(obj.scale);
  if (obj.orientation === "horizontal" || obj.orientation === "vertical") out.orientation = obj.orientation;
  return out;
}

/**
 * A barra de retratos: um elemento HTML fixo na tela (fora do canvas, então
 * não acompanha pan/zoom do mapa). Posição e escala são de cada cliente; quem
 * nunca mexeu usa o padrão que o GM definiu.
 */
class PortraitBar {
  constructor() {
    this.el = null;
    this.cardEls = new Map(); // key → elemento do card
    this.cards = [];
    this.flipTimer = null;
    this.drag = null;
    this.tracked = new Set();
    this.combatActive = false;
  }

  // ---- ciclo de vida -------------------------------------------------------

  init() {
    this.el = document.createElement("section");
    this.el.id = "rf-bar";
    this.el.className = "rf-bar";
    this.el.setAttribute("aria-label", t("Bar.Label"));
    this.el.innerHTML = `
      <div class="rf-toolbar" role="toolbar">
        <span class="rf-status" data-tooltip=""></span>
        <button type="button" data-action="lock"><i class="fa-solid fa-lock"></i></button>
        <span class="rf-unlocked-only">
          <button type="button" data-action="smaller" data-tooltip="${esc(t("Bar.Smaller"))}"><i class="fa-solid fa-minus"></i></button>
          <span class="rf-scale-label"></span>
          <button type="button" data-action="bigger" data-tooltip="${esc(t("Bar.Bigger"))}"><i class="fa-solid fa-plus"></i></button>
          <button type="button" data-action="orientation" data-tooltip="${esc(t("Bar.Orientation"))}"><i class="fa-solid fa-arrows-left-right"></i></button>
          <button type="button" data-action="compact"><i class="fa-solid fa-compress"></i></button>
          <button type="button" data-action="reset" data-tooltip="${esc(t("Bar.Reset"))}"><i class="fa-solid fa-rotate-left"></i></button>
          <button type="button" data-action="setDefault" class="rf-gm-only" data-tooltip="${esc(t("Bar.SetDefault"))}"><i class="fa-solid fa-users-viewfinder"></i></button>
          <button type="button" data-action="hide" data-tooltip="${esc(t("Bar.Hide"))}"><i class="fa-solid fa-eye-slash"></i></button>
        </span>
      </div>
      <div class="rf-cards"></div>
      <div class="rf-empty">${esc(t("Bar.Empty"))}</div>
      <div class="rf-grip" data-tooltip="${esc(t("Bar.Resize"))}"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></div>
    `;
    this.cardsEl = this.el.querySelector(".rf-cards");
    this.statusEl = this.el.querySelector(".rf-status");
    this.el.classList.toggle("rf-is-gm", game.user.isGM);
    document.body.append(this.el);

    this.el.addEventListener("click", ev => this._onClick(ev));
    this.el.addEventListener("pointerdown", ev => this._onPointerDown(ev));
    this.cardsEl.addEventListener("dblclick", ev => this._onCardDblClick(ev));
    window.addEventListener("resize", foundry.utils.debounce(() => this.applyLayout(), 100));
    // Cards aparecendo e sumindo (modo compacto, card do GM, imagens
    // carregando) mudam o tamanho: reposiciona para continuar dentro da tela.
    new ResizeObserver(() => {
      if (this.drag || this.el.classList.contains("rf-resizing")) return;
      const { xFrac, yFrac } = this.layout();
      this._place(xFrac, yFrac);
    }).observe(this.el);

    store.onChange(kind => {
      if (kind === "bridge") this.updateStatus();
      else this.updateSpeaking();
    });

    this.updateCombat();
    this.rebuild();
    this.applySettings();
    this.updateStatus();
  }

  /** Recria todos os cards (mapeamento, usuários ou fichas mudaram). */
  rebuild() {
    if (!this.el) return;
    this.cards = buildCards();
    this.tracked = trackedActorIds();
    const keep = new Set();
    for (const card of this.cards) {
      keep.add(card.key);
      let el = this.cardEls.get(card.key);
      if (!el) {
        el = document.createElement("article");
        this.cardEls.set(card.key, el);
      }
      this._renderCard(el, card);
      this.cardsEl.append(el); // append também reordena
    }
    for (const [key, el] of this.cardEls) {
      if (!keep.has(key)) {
        el.remove();
        this.cardEls.delete(key);
      }
    }
    this.el.classList.toggle("rf-no-cards", this.cards.length === 0);
    this.updateSpeaking();
    this.applyLayout();
  }

  requestRebuild = foundry.utils.debounce(() => this.rebuild(), 50);

  /** Chamado quando um ator muda (HP, hero points, nível...). */
  onActorChange(actor) {
    if (actor && this.tracked.has(actor.id)) this.requestRebuild();
  }

  _renderCard(el, card) {
    el.className = "rf-card";
    el.dataset.key = card.key;
    el.dataset.userId = card.userId;
    if (card.actorId) el.dataset.actorId = card.actorId;
    else delete el.dataset.actorId;
    el.style.setProperty("--rf-color", card.color);
    el.classList.toggle("rf-gm", card.isGM);
    el.classList.toggle("rf-gm-auto", card.isGM && card.gmMode === "speaking");
    el.classList.toggle("rf-has-open", !!card.open);
    el.classList.toggle("rf-no-discord", !card.discordId);

    const s = card.stats;
    const hp = s.hp ? `
      <div class="rf-hp rf-hp-${s.hp.tone}">
        <div class="rf-hp-fill" style="width:${s.hp.pct}%"></div>
        <span>${esc(t("Card.HP"))}: ${s.hp.value}/${s.hp.max}${s.hp.temp ? ` <em>+${s.hp.temp}</em>` : ""}</span>
      </div>` : "";
    const heroIcon = getSetting("heroIcon");
    const hero = s.hero ? `
      <div class="rf-hero" data-tooltip="${esc(t("Card.HeroPoints"))}: ${s.hero.value}/${s.hero.max}">
        ${s.hero.pips.map(on => heroIcon
          ? `<img class="${on ? "on" : ""}" src="${esc(heroIcon)}" alt="" draggable="false">`
          : `<i class="${on ? "on" : ""}"></i>`).join("")}
      </div>` : "";
    const sub = [
      s.level !== undefined ? `${t("Card.Level")} ${s.level}` : "",
      s.className ?? "",
    ].filter(Boolean).join(" - ");

    el.innerHTML = `
      <div class="rf-portrait">
        <img class="rf-img rf-closed" src="${esc(card.closed)}" alt="" draggable="false">
        ${card.open ? `<img class="rf-img rf-open" src="${esc(card.open)}" alt="" draggable="false">` : ""}
      </div>
      <div class="rf-plate">
        <span class="rf-name">${esc(card.name)}</span>
        <div class="rf-player-row">
          <span class="rf-player">${esc(card.player)}</span>
          ${sub ? `<span class="rf-sub">${esc(sub)}</span>` : ""}
        </div>
        ${hp || hero ? `<div class="rf-stats-row">${hp}${hero}</div>` : ""}
      </div>
    `;
  }

  // ---- fala ------------------------------------------------------------------

  updateSpeaking() {
    if (!this.el) return;
    const paused = this.combatActive && getSetting("combatMode") === "pause";
    let any = false;
    let anyFlip = false;
    for (const card of this.cards) {
      const el = this.cardEls.get(card.key);
      if (!el) continue;
      const speaking = !paused && store.isSpeaking(card.discordId);
      el.classList.toggle("rf-speaking", speaking);
      if (speaking) {
        any = true;
        if (card.open) anyFlip = true;
      }
    }
    this.el.classList.toggle("rf-idle", !any);
    this._setFlipping(anyFlip);
  }

  _setFlipping(on) {
    if (on && !this.flipTimer) {
      const ms = clamp(Number(getSetting("flipMs")) || 150, 50, 1000);
      this.el.classList.add("rf-mouth");
      this.flipTimer = setInterval(() => this.el.classList.toggle("rf-mouth"), ms);
    } else if (!on && this.flipTimer) {
      clearInterval(this.flipTimer);
      this.flipTimer = null;
      this.el.classList.remove("rf-mouth");
    }
  }

  restartFlip() {
    this._setFlipping(false);
    this.updateSpeaking();
  }

  // ---- combate ---------------------------------------------------------------

  updateCombat() {
    this.combatActive = !!game.combat?.started;
    if (!this.el) return;
    this.applySettings();
    this.updateSpeaking();
  }

  // ---- configurações do cliente -----------------------------------------------

  applySettings() {
    if (!this.el) return;
    const hiddenByCombat = this.combatActive && getSetting("combatMode") === "hide";
    const locked = getSetting("locked");
    const compact = getSetting("compact");
    this.el.classList.toggle("rf-hidden", getSetting("hidden") || hiddenByCombat);
    this.el.classList.toggle("rf-locked", locked);
    this.el.classList.toggle("rf-unlocked", !locked);
    this.el.classList.toggle("rf-compact", compact);
    const style = getSetting("portraitStyle");
    this.el.classList.toggle("rf-style-cutout", style !== "frame");
    this.el.classList.toggle("rf-style-frame", style === "frame");
    const single = getSetting("singleArtAnimation");
    for (const mode of ["pulse", "bounce", "none"]) this.el.classList.toggle(`rf-single-${mode}`, single === mode);
    this.el.style.setProperty("--rf-idle-opacity", clamp(Number(getSetting("idleOpacity")), 0, 1));

    const lockBtn = this.el.querySelector('[data-action="lock"]');
    lockBtn.innerHTML = `<i class="fa-solid ${locked ? "fa-lock" : "fa-lock-open"}"></i>`;
    lockBtn.dataset.tooltip = locked ? t("Bar.Unlock") : t("Bar.Lock");
    lockBtn.classList.toggle("active", !locked);
    const compactBtn = this.el.querySelector('[data-action="compact"]');
    compactBtn.dataset.tooltip = compact ? t("Bar.CompactOff") : t("Bar.CompactOn");
    compactBtn.classList.toggle("active", compact);
    this.applyLayout();
  }

  /** Layout em uso: padrão do GM, com o que este cliente mudou por cima. */
  layout() {
    return {
      ...DEFAULT_LAYOUT,
      ...validLayout(getSetting("defaultLayout")),
      ...validLayout(getSetting("layout")),
    };
  }

  applyLayout(layout = this.layout()) {
    if (!this.el) return;
    this.el.style.setProperty("--rf-scale", layout.scale);
    this.el.classList.toggle("rf-vertical", layout.orientation === "vertical");
    this.el.classList.toggle("rf-horizontal", layout.orientation !== "vertical");
    this.el.querySelector(".rf-scale-label").textContent = `${Math.round(layout.scale * 100)}%`;
    const orientBtn = this.el.querySelector('[data-action="orientation"] i');
    orientBtn.className = `fa-solid ${layout.orientation === "vertical" ? "fa-arrows-up-down" : "fa-arrows-left-right"}`;
    this._place(layout.xFrac, layout.yFrac);
  }

  /**
   * A posição é guardada como fração do espaço livre (0 = encostado à
   * esquerda/topo, 1 = à direita/embaixo). Assim a barra continua dentro da
   * tela em qualquer resolução.
   */
  _place(xFrac, yFrac) {
    const rect = this.el.getBoundingClientRect();
    const freeX = Math.max(0, window.innerWidth - rect.width);
    const freeY = Math.max(0, window.innerHeight - rect.height);
    const left = Math.round(freeX * clamp(xFrac, 0, 1));
    const top = Math.round(freeY * clamp(yFrac, 0, 1));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this._placeToolbar(top, rect.height);
  }

  /** Barra de ferramentas acima da barra; se não couber, embaixo; senão, por dentro. */
  _placeToolbar(top, height) {
    const room = 30;
    const above = top >= room;
    const below = !above && window.innerHeight - (top + height) >= room;
    this.el.classList.toggle("rf-toolbar-below", below);
    this.el.classList.toggle("rf-toolbar-inside", !above && !below);
  }

  _fracFromPosition(left, top) {
    const rect = this.el.getBoundingClientRect();
    const freeX = Math.max(1, window.innerWidth - rect.width);
    const freeY = Math.max(1, window.innerHeight - rect.height);
    return { xFrac: clamp(left / freeX, 0, 1), yFrac: clamp(top / freeY, 0, 1) };
  }

  async saveOwnLayout(changes) {
    const own = { ...validLayout(getSetting("layout")), ...changes };
    await setSetting("layout", own);
  }

  async resetPosition() {
    await setSetting("layout", {});
    ui.notifications.info(t("Bar.ResetDone"));
  }

  async toggleHidden(force) {
    const hidden = force ?? !getSetting("hidden");
    await setSetting("hidden", hidden);
    if (hidden) ui.notifications.info(t("Bar.HiddenHint"));
  }

  async changeScale(delta) {
    const scale = roundScale(this.layout().scale + delta);
    await this.saveOwnLayout({ scale });
  }

  // ---- status da ponte (só GM) ----------------------------------------------

  updateStatus() {
    if (!this.statusEl) return;
    const ok = store.bridgeConnected;
    this.statusEl.classList.toggle("ok", ok);
    let tip = ok ? t("Bridge.Connected") : t("Bridge.Disconnected");
    if (ok && store.channel) tip += ` · ${store.channel.name}`;
    this.statusEl.dataset.tooltip = tip;
  }

  // ---- interação ------------------------------------------------------------

  async _onClick(ev) {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;
    ev.preventDefault();
    btn.blur();
    const layout = this.layout();
    switch (btn.dataset.action) {
      case "lock":
        await setSetting("locked", !getSetting("locked"));
        break;
      case "smaller":
        await this.changeScale(-SCALE_STEP);
        break;
      case "bigger":
        await this.changeScale(SCALE_STEP);
        break;
      case "orientation":
        await this.saveOwnLayout({ orientation: layout.orientation === "vertical" ? "horizontal" : "vertical" });
        break;
      case "compact":
        await setSetting("compact", !getSetting("compact"));
        break;
      case "reset":
        await this.resetPosition();
        break;
      case "hide":
        await this.toggleHidden(true);
        break;
      case "setDefault":
        if (!game.user.isGM) return;
        await setSetting("defaultLayout", layout);
        ui.notifications.info(t("Bar.DefaultSaved"));
        break;
    }
  }

  _onCardDblClick(ev) {
    const actorId = ev.target.closest(".rf-card")?.dataset.actorId;
    const actor = actorId ? game.actors.get(actorId) : null;
    if (actor?.testUserPermission(game.user, "OBSERVER")) actor.sheet.render(true);
  }

  _onPointerDown(ev) {
    if (ev.button !== 0) return;
    const grip = ev.target.closest(".rf-grip");
    const locked = getSetting("locked");
    if (grip && !locked) return this._startResize(ev);
    if (ev.target.closest("button")) return;
    // Destravada: arrasta por qualquer parte. Travada: só com Alt.
    if (locked && !ev.altKey) return;
    this._startDrag(ev);
  }

  _startDrag(ev) {
    ev.preventDefault();
    const rect = this.el.getBoundingClientRect();
    this.drag = { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top, moved: false };
    this.el.classList.add("rf-dragging");
    this.el.setPointerCapture(ev.pointerId);
    const move = e => {
      const r = this.el.getBoundingClientRect();
      const left = clamp(e.clientX - this.drag.dx, 0, Math.max(0, window.innerWidth - r.width));
      const top = clamp(e.clientY - this.drag.dy, 0, Math.max(0, window.innerHeight - r.height));
      this.el.style.left = `${left}px`;
      this.el.style.top = `${top}px`;
      this._placeToolbar(top, r.height);
      this.drag.moved = true;
    };
    const up = async e => {
      this.el.removeEventListener("pointermove", move);
      this.el.removeEventListener("pointerup", up);
      this.el.removeEventListener("pointercancel", up);
      this.el.releasePointerCapture(e.pointerId);
      this.el.classList.remove("rf-dragging");
      const moved = this.drag?.moved;
      this.drag = null;
      if (!moved) return;
      const { xFrac, yFrac } = this._fracFromPosition(parseFloat(this.el.style.left), parseFloat(this.el.style.top));
      await this.saveOwnLayout({ xFrac, yFrac });
    };
    this.el.addEventListener("pointermove", move);
    this.el.addEventListener("pointerup", up);
    this.el.addEventListener("pointercancel", up);
  }

  _startResize(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const startScale = this.layout().scale;
    const rect = this.el.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;
    const base = Math.max(rect.width, rect.height, 1);
    const startX = ev.clientX;
    const startY = ev.clientY;
    const grip = ev.target.closest(".rf-grip");
    grip.setPointerCapture(ev.pointerId);
    this.el.classList.add("rf-resizing");
    let scale = startScale;
    const move = e => {
      const delta = Math.max(e.clientX - startX, e.clientY - startY);
      scale = roundScale(startScale * (base + delta) / base);
      this.el.style.setProperty("--rf-scale", scale);
      this.el.querySelector(".rf-scale-label").textContent = `${Math.round(scale * 100)}%`;
      // Mantém o canto de cima à esquerda parado enquanto redimensiona.
      this.el.style.left = `${startLeft}px`;
      this.el.style.top = `${startTop}px`;
    };
    const up = async e => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      grip.releasePointerCapture(e.pointerId);
      this.el.classList.remove("rf-resizing");
      const { xFrac, yFrac } = this._fracFromPosition(startLeft, startTop);
      await this.saveOwnLayout({ scale, xFrac, yFrac });
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }
}

export const bar = new PortraitBar();

