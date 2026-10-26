// Magic-kort as a web app (iPhone and Android): the customer version of the Android app.
// Searches and browses faraos.dk's Magic singles live, shows København's stock, and keeps a
// wish list ("kurv") on the phone with a QR code for staff. A port of MainActivity.java.
"use strict";

const STOCK_KEY = "kobenhavn", STORE_NAME = "København";
const LIST_URL = "https://mikkelfaraos.github.io/Magic-Katalog/liste.html";  // staff list page behind the QR code
const SCAN_LIMIT_PAGES = 125;  // browsing everything without search or set: stop after this many pages (8 cards each)
const CART_KEY = "magic-cart";

const COLOR_DA = { white: "Hvid", blue: "Blå", black: "Sort", red: "Rød", green: "Grøn", multi: "Flerfarvet",
  colorless: "Farveløs", artifact: "Artefakt", land: "Land" };

const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ---------------------------------------------------------------- data from magic.json

let apiUrl, template, inStockFilter, sets = [];

/** Store names come back as e.g. "k�benhavn"; match on their unambiguous parts. */
function storeKey(loc) {
  const l = String(loc).toLowerCase();
  if (l.startsWith("on")) return "online";
  if (l.startsWith("od")) return "odense";
  if (l.startsWith("k")) return "kobenhavn";
  if (l.startsWith("l")) return "lyngby";
  if (l.includes("rhus")) return "aarhus";
  return l;
}

function money(v) {
  return (Number.isInteger(v) ? v.toLocaleString("da-DK") + ",-"
    : v.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + " kr.";
}

// ---------------------------------------------------------------- what's being shown

let query = "", currentSet = null, colorId = 0, onlyHere = true;
let generation = 0, nextSubPage = 0, loading = false, exhausted = false, lastError = null, scanned = 0;
let shown = [];

/** København's stock is the web shop's own ("online") stock, so its "På lager" filter fits. */
const useShopStockFilter = () => onlyHere && query === "";

function body(subPage) {
  const b = structuredClone(template);
  if (currentSet) {
    b.currentMenuId = colorId || currentSet.id;
    b.menuIdLevel4 = currentSet.id;
    b.menuLevel = colorId ? 5 : 4;
  }
  b.searchString = query || null;
  b.filter = useShopStockFilter() ? inStockFilter : null;
  b.subPage = subPage;
  return b;
}

async function post(b) {
  const r = await fetch(apiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  if (!r.ok) throw new Error("webshoppen svarede " + r.status);
  return r.json();
}

function startQuery() {
  generation++;
  shown = [];
  nextSubPage = 0;
  scanned = 0;
  loading = false;
  exhausted = false;
  lastError = null;
  $("#grid").replaceChildren();
  window.scrollTo(0, 0);
  loadMore();
}

/**
 * Fetch the next pages (8 cards each). With a search the app filters København's stock itself:
 * it fetches 4 pages side by side, up to 24 per round, until a dozen matches are found.
 */
async function loadMore() {
  if (loading || exhausted) return;
  loading = true;
  updateStatus();
  const gen = generation, startSub = nextSubPage;
  const clientFilter = onlyHere, scan = clientFilter && !useShopStockFilter();
  const maxPages = scan ? 24 : 2, batch = scan ? 4 : 1;
  const capped = scan && query === "" && !currentSet;
  const found = [];
  let pages = 0, end = false, err = null;
  try {
    while (pages < maxPages && found.length < 12 && !end) {
      const answers = [];
      for (let i = 0; i < batch && pages + i < maxPages; i++) answers.push(post(body(startSub + pages + i)));
      for (const a of await Promise.all(answers)) {
        pages++;
        if (!a.items || a.items.length === 0) { end = true; break; }  // past the last page
        for (const it of a.items) {
          const c = parseCard(it);
          if (!clientFilter || c.here > 0) found.push(c);
        }
      }
      if (gen !== generation) return;  // a newer query took over
      if (scan) $("#status").textContent = (shown.length + found.length) + " kort på lager i " + STORE_NAME
        + "  ·  Gennemsøger webshoppen… " + (startSub + pages) * 8 + " kort tjekket";
      if (capped && startSub + pages >= SCAN_LIMIT_PAGES) { end = true; break; }
    }
  } catch (e) {
    err = navigator.onLine === false ? "Ingen internetforbindelse." : "Kunne ikke hente kort (" + e.message + ").";
  }
  if (gen !== generation) return;
  loading = false;
  lastError = err;
  nextSubPage = startSub + pages;
  scanned = nextSubPage * 8;
  if (end) exhausted = true;
  if (err && pages === 0) {
    exhausted = true;  // don't hammer a dead connection, but try again in a while
    setTimeout(() => { if (gen === generation && lastError) startQuery(); }, 15000);
  }
  const grid = $("#grid");
  for (const c of found) grid.appendChild(tile(c));
  shown.push(...found);
  updateStatus();
  // Still room on screen? Keep going (the observer only fires when the sentinel comes into view).
  if (!exhausted && $("#more").getBoundingClientRect().top < innerHeight + 800) loadMore();
}

function parseCard(it) {
  const st = it.status || {};
  const normal = st.normalPrice ? st.normalPrice.price : 0;
  const menu = it.menuPath || "";
  const c = {
    id: it.itemNumber, name: it.displayName || "", set: it.displayName2 || "", img: it.imagePath || "",
    color: COLOR_DA[menu.substring(menu.lastIndexOf("/") + 1)] || "",
    soldOut: !!st.isSoldOut, price: st.onSalePrice ? st.onSalePrice.price : normal, here: 0, online: 0, copies: [],
  };
  for (const o of st.inventories || []) {
    const k = storeKey(o.location);
    if (k === STOCK_KEY) c.here += Math.max(0, o.stock);
    if (k === "online") c.online += Math.max(0, o.stock);
  }
  let cheapestHere = Infinity;
  for (const o of it.usedConditions || []) {
    const extra = [];
    if (o.foil) extra.push("Foil");
    if (o.language) extra.push(o.language);
    if (o.note && o.note !== o.language) extra.push(o.note);
    const pr = o.bestPrice || o.price;
    const cp = { condition: o.name || "", extra: extra.join(" · "), price: pr ? pr.price : c.price, here: 0, online: 0 };
    for (const x of o.inventories || []) {
      const k = storeKey(x.location);
      if (k === STOCK_KEY) cp.here += Math.max(0, x.stock);
      if (k === "online") cp.online += Math.max(0, x.stock);
    }
    if (cp.here > 0) cheapestHere = Math.min(cheapestHere, cp.price);
    c.copies.push(cp);
  }
  if (cheapestHere !== Infinity) c.price = cheapestHere;
  // In stock here first, then cheapest first.
  c.copies.sort((a, b) => (a.here > 0) !== (b.here > 0) ? (a.here > 0 ? -1 : 1) : a.price - b.price);
  return c;
}

function updateStatus() {
  const capped = exhausted && onlyHere && !useShopStockFilter() && query === "" && !currentSet && nextSubPage >= SCAN_LIMIT_PAGES;
  let state;
  if (loading) state = "Henter kort fra faraos.dk…";
  else if (lastError) state = "⚠ " + lastError;
  else if (capped) state = "De nyeste " + scanned + " kort er gennemsøgt – vælg et sæt eller søg for at finde flere";
  else if (exhausted) state = "Alle kort vist";
  else state = "Rul ned for flere";
  $("#status").textContent = shown.length + " kort · " + (onlyHere ? "på lager i " + STORE_NAME : "hele webshoppen") + "  ·  " + state;

  const empty = $("#empty");
  empty.hidden = shown.length > 0;
  if (loading) empty.textContent = "Henter kort fra webshoppen…";
  else if (lastError) empty.textContent = "Ingen forbindelse til webshoppen lige nu.\n" + lastError;
  else if (onlyHere) empty.textContent = (query === "" ? "Ingen kort på lager i butikken i denne visning."
    : "Ingen kort med »" + query + "« på lager i butikken.")
    + "\nTryk på »Kun på lager i butikken« for at se hele webshoppen – kortene kan bestilles online.";
  else empty.textContent = query === "" ? "Ingen kort i denne visning." : "Ingen kort fundet for »" + query + "«.";
}

// ---------------------------------------------------------------- tiles and badges

function badge(here, online, soldOut, long) {
  if (here > 2) return [long ? "● På lager i butikken (" + here + ")" : "På lager", "green"];
  if (here > 0) return [long ? "● Kun " + here + " tilbage i butikken" : "Få tilbage", "amber"];
  if (online > 0) return [long ? "● Ikke i butikken – kan bestilles online" : "Online", "grey"];
  return [long ? "● Udsolgt" : "Udsolgt", "red"];
}

/** The card picture, cropped to the card's own shape (the shop's pictures have white bars). */
function cardPic(url, cls) {
  const box = el("div", "pic" + (cls ? " " + cls : ""));
  if (url) {
    const img = el("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    img.src = url;
    img.onerror = () => img.remove();
    box.appendChild(img);
  }
  return box;
}

function tile(c) {
  const t = el("button", "tile");
  t.type = "button";
  t.appendChild(cardPic(c.img));
  t.appendChild(el("div", "name", c.name));
  t.appendChild(el("div", "set", c.set));
  const row = el("div", "row");
  row.appendChild(el("span", "price", (c.copies.length > 1 ? "fra " : "") + money(c.price)));
  const [text, color] = badge(c.here, c.online, c.soldOut, false);
  row.appendChild(el("span", "badge " + color, text));
  t.appendChild(row);
  t.onclick = () => openDetail(c);
  return t;
}

// ---------------------------------------------------------------- overlays (card page, cart, set picker)

/** Overlays get a history entry, so the phone's Back button / swipe closes them. */
let overlayOpen = false;

function showOverlay(content) {
  const ov = $("#overlay");
  ov.replaceChildren(content);
  ov.onclick = e => { if (e.target === ov) closeOverlay(); };  // tap beside the panel to close
  ov.hidden = false;
  ov.scrollTop = 0;
  document.body.classList.add("locked");
  if (!overlayOpen) history.pushState({ overlay: true }, "");
  overlayOpen = true;
}

function closeOverlay() {
  if (overlayOpen) history.back();  // popstate does the hiding
}

window.addEventListener("popstate", () => {
  overlayOpen = false;
  $("#overlay").hidden = true;
  $("#overlay").replaceChildren();
  $("#overlay").style.backgroundColor = "";
  document.body.classList.remove("locked");
});

/**
 * Pull the panel down to close it, like a sheet. Only a downward drag that starts while the
 * overlay (and the set list, if under the finger) is scrolled to the top; otherwise it scrolls.
 */
function swipeToClose(ov) {
  let downY = 0, startY = null, dy = 0, lastY = 0, dragging = false, t0 = 0;
  const reset = () => { startY = null; dragging = false; };
  ov.addEventListener("touchstart", e => {
    const list = e.target.closest(".setlist");
    if (e.touches.length > 1 || ov.scrollTop > 0 || (list && list.scrollTop > 0)) return reset();
    downY = lastY = startY = e.touches[0].clientY;
    t0 = e.timeStamp;
    dy = 0;
    dragging = false;
  }, { passive: true });
  ov.addEventListener("touchmove", e => {
    if (startY === null) return;
    lastY = e.touches[0].clientY;
    dy = lastY - startY;
    if (!dragging) {
      if (dy < -4) return reset();  // going up: a normal scroll
      if (dy < 10) return;
      dragging = true;
      startY += dy;  // start the panel from where the drag was recognised
      dy = 0;
    }
    e.preventDefault();
    const panel = ov.firstElementChild;
    panel.style.transition = "none";
    panel.style.transform = "translateY(" + Math.max(0, dy) + "px)";
    ov.style.backgroundColor = "rgba(0,0,0," + (0.69 * Math.max(0.25, 1 - dy / 700)) + ")";
  }, { passive: false });
  const end = e => {
    if (!dragging) return reset();
    const panel = ov.firstElementChild;
    // A flick counts from where the finger first went down, so short quick ones close too.
    const total = lastY - downY, fast = total / Math.max(1, e.timeStamp - t0) > 0.5;  // px per ms
    if (e.type === "touchend" && (dy > innerHeight * 0.15 || (fast && total > 60))) {
      panel.style.transition = "transform .17s ease-in";
      panel.style.transform = "translateY(100vh)";
      setTimeout(closeOverlay, 160);
    } else {
      panel.style.transition = "transform .2s";
      panel.style.transform = "";
      ov.style.backgroundColor = "";
    }
    reset();
  };
  ov.addEventListener("touchend", end);
  ov.addEventListener("touchcancel", end);
}

function backButton(label) {
  const b = el("button", "btn accent", label);
  b.type = "button";
  b.onclick = closeOverlay;
  return b;
}

function openDetail(c) {
  const panel = el("div", "panel detail");
  panel.appendChild(cardPic(c.img.replace("/medium/", "/large/"), "big"));
  const info = el("div", "info");
  info.appendChild(el("div", "kicker", (c.set + (c.color ? "  ·  " + c.color : "")).toUpperCase()));
  info.appendChild(el("h2", null, c.name));
  const [text, color] = badge(c.here, c.online, c.soldOut, true);
  info.appendChild(el("div", "badge big " + color, text));
  info.appendChild(el("div", "kicker head", "UDGAVER OG PRISER"));
  if (c.copies.length === 0) info.appendChild(el("div", "price", money(c.price)));
  for (const cp of c.copies) info.appendChild(copyRow(c, cp));
  info.appendChild(el("p", "note", "Stand: Near Mint (NM) = som ny · Slightly Played (SP) = let brugt · "
    + "Moderately Played (MP) = brugt · Heavily Played (HP) = meget brugt."));
  info.appendChild(backButton("‹  Tilbage"));
  panel.appendChild(info);
  showOverlay(panel);
}

function copyRow(card, cp) {
  const row = el("div", "copy" + (cp.here > 0 ? "" : " dim"));
  const top = el("div", "line");
  const left = el("div", "grow");
  left.appendChild(el("div", "cond", cp.condition || "Kort"));
  if (cp.extra) left.appendChild(el("div", "extra", cp.extra));
  top.appendChild(left);
  top.appendChild(el("div", "price", money(cp.price)));
  row.appendChild(top);
  const bottom = el("div", "line");
  const [text, color] = badge(cp.here, cp.online, false, false);
  bottom.appendChild(el("div", "badge grow " + color, text));
  // Only copies that are physically in the store can go in the cart.
  if (cp.here > 0) {
    const add = el("button", "btn small");
    add.type = "button";
    const label = () => {
      const n = qtyInCart(card, cp), full = n >= cp.here;
      add.textContent = full ? "✓ Alle i kurven" : n > 0 ? "+ Én mere (" + n + ")" : "+ Læg i kurv";
      add.classList.toggle("accent", !full);
      add.disabled = full;
    };
    label();
    add.onclick = () => {
      addToCart(card, cp);
      label();
      add.animate([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], 220);
    };
    bottom.appendChild(add);
  }
  row.appendChild(bottom);
  return row;
}

// ---------------------------------------------------------------- cart (a wish list for the counter)

let cart = [];  // {card:{id,name,set,img}, copy:{condition,extra,price,here}, qty}

function loadCart() {
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch (e) { cart = []; }
}

function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* private mode: cart lasts this visit */ }
  const n = cartCount();
  const b = $("#cartBtn");
  b.querySelector(".count").textContent = n ? String(n) : "";
  b.classList.toggle("accent", n > 0);
}

const sameLine = (l, c, cp) => l.card.id === c.id && l.copy.condition === cp.condition && l.copy.extra === cp.extra;
const qtyInCart = (c, cp) => (cart.find(l => sameLine(l, c, cp)) || { qty: 0 }).qty;
const cartCount = () => cart.reduce((n, l) => n + l.qty, 0);
const cartTotal = () => cart.reduce((s, l) => s + l.qty * l.copy.price, 0);

function addToCart(c, cp) {
  const l = cart.find(x => sameLine(x, c, cp));
  if (l) { if (l.qty < cp.here) l.qty++; }
  else cart.push({ card: { id: c.id, name: c.name, set: c.set, img: c.img },
    copy: { condition: cp.condition, extra: cp.extra, price: cp.price, here: cp.here }, qty: 1 });
  saveCart();
  const b = $("#cartBtn");
  b.animate([{ transform: "scale(1)" }, { transform: "scale(1.1)" }, { transform: "scale(1)" }], 240);
}

function openCart() {
  const panel = el("div", "panel cart");
  const top = el("div", "line");
  top.appendChild(el("h2", "grow", "Din kurv"));
  const x = el("button", "btn icon", "✕");
  x.type = "button";
  x.setAttribute("aria-label", "Luk kurven");
  x.onclick = closeOverlay;
  top.appendChild(x);
  panel.appendChild(top);
  panel.appendChild(el("p", "how", "Gå til kassen og vis denne liste til personalet – så finder de kortene frem til dig."));
  const lines = el("div", "lines");
  const qrBox = el("div", "qrbox");
  const canvas = el("canvas");
  qrBox.appendChild(canvas);
  const total = el("div", "total");
  const redraw = () => {
    lines.replaceChildren();
    if (cart.length === 0) lines.appendChild(el("p", "emptycart",
      "Kurven er tom.\nÅbn et kort og tryk »+ Læg i kurv« ud for den udgave, du vil have."));
    for (const l of cart) lines.appendChild(cartRow(l, redraw));
    qrBox.hidden = cart.length === 0;
    if (cart.length) cartLink().then(link => drawQr(canvas, link));
    total.textContent = "I alt: " + money(cartTotal()) + "   (" + cartCount() + " kort)";
    saveCart();
  };
  redraw();
  panel.appendChild(lines);
  panel.appendChild(qrBox);
  panel.appendChild(total);
  const buttons = el("div", "buttons");
  const clear = el("button", "btn", "Tøm kurv");
  clear.type = "button";
  clear.onclick = () => { if (cart.length && confirm("Tøm kurven?")) { cart = []; redraw(); } };
  buttons.appendChild(clear);
  buttons.appendChild(backButton("‹  Se flere kort"));
  panel.appendChild(buttons);
  showOverlay(panel);
}

function cartRow(l, redraw) {
  const row = el("div", "cartrow");
  row.appendChild(cardPic(l.card.img, "thumb"));
  const mid = el("div", "grow");
  mid.appendChild(el("div", "name", l.card.name));
  mid.appendChild(el("div", "set", l.card.set));
  mid.appendChild(el("div", "copyline", l.copy.condition + (l.copy.extra ? "  ·  " + l.copy.extra : "") + "   ·   Varenr. " + l.card.id));
  const controls = el("div", "line");
  const minus = el("button", "btn round", "−");
  minus.type = "button";
  minus.onclick = () => { if (--l.qty <= 0) cart.splice(cart.indexOf(l), 1); redraw(); };
  const plus = el("button", "btn round", "+");
  plus.type = "button";
  plus.disabled = l.qty >= l.copy.here;
  plus.onclick = () => { if (l.qty < l.copy.here) l.qty++; redraw(); };
  controls.append(minus, el("span", "qty", String(l.qty)), plus, el("span", "price grow right", money(l.qty * l.copy.price)));
  mid.appendChild(controls);
  row.appendChild(mid);
  return row;
}

/** The cart packed into the staff page's address: JSON → raw deflate → base64url (like the Android app). */
async function cartLink() {
  const items = cart.map(l => [l.card.id, l.card.name, l.card.set, l.copy.condition, l.copy.extra, l.qty, l.copy.price]);
  const d = new Date();
  const json = JSON.stringify({ s: STORE_NAME, t: d.getDate() + "/" + (d.getMonth() + 1) + " kl. "
    + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"), i: items });
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return LIST_URL + "#z=" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch (e) {
    return LIST_URL;  // very old browser: the code still opens the (empty) page
  }
}

function drawQr(canvas, text) {
  let grid;
  try { grid = qrEncode(new TextEncoder().encode(text)); } catch (e) { canvas.hidden = true; return; }
  const n = grid.length, quiet = 4, full = n + 2 * quiet, scale = 8;
  canvas.width = canvas.height = full * scale;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000";
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (grid[y][x]) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  canvas.hidden = false;
}

// ---------------------------------------------------------------- set picker and filter chips

function chooseSet() {
  if (currentSet) {  // the chip shows "✕": tapping it clears the set
    currentSet = null;
    colorId = 0;
    refreshChips();
    startQuery();
    return;
  }
  const panel = el("div", "panel sets");
  panel.appendChild(el("h2", null, "Vælg sæt"));
  const filter = el("input", "field");
  filter.type = "search";
  filter.placeholder = "Skriv for at finde et sæt…";
  panel.appendChild(filter);
  const list = el("div", "setlist");
  const fill = () => {
    const f = filter.value.trim().toLowerCase();
    list.replaceChildren();
    for (const s of sets) {
      if (f && !s.title.toLowerCase().includes(f)) continue;
      const row = el("button", "setrow");
      row.type = "button";
      const icon = el("span", "seticon");
      if (s.icon) {
        const img = el("img");
        img.loading = "lazy";
        img.alt = "";
        img.src = "sets/" + s.id + ".png";
        icon.appendChild(img);
      }
      row.append(icon, el("span", null, s.title));
      row.onclick = () => {
        currentSet = s;
        colorId = 0;
        closeOverlay();
        refreshChips();
        startQuery();
      };
      list.appendChild(row);
    }
  };
  filter.oninput = fill;
  fill();
  panel.appendChild(list);
  panel.appendChild(backButton("Annuller"));
  showOverlay(panel);
}

function refreshChips() {
  $("#hereChip").classList.toggle("accent", onlyHere);
  const sc = $("#setChip");
  sc.replaceChildren();
  if (currentSet && currentSet.icon) {
    const img = el("img");
    img.alt = "";
    img.src = "sets/" + currentSet.id + ".png";
    sc.appendChild(img);
  }
  sc.appendChild(document.createTextNode(currentSet ? currentSet.title + "  ✕" : "Alle sæt ▾"));
  sc.classList.toggle("accent", !!currentSet);
  const colors = $("#colors");
  colors.replaceChildren();
  colors.hidden = !currentSet;
  if (!currentSet) return;
  const chip = (label, id) => {
    const c = el("button", "btn chip" + (colorId === id ? " accent" : ""), label);
    c.type = "button";
    c.onclick = () => { colorId = id; refreshChips(); startQuery(); };
    colors.appendChild(c);
  };
  chip("Alle farver", 0);
  for (const c of currentSet.colors || []) chip(c.title, c.id);
}

// ---------------------------------------------------------------- install hint ("add to home screen")

function installHint() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let dismissed = false;
  try { dismissed = localStorage.getItem("magic-install-hint") === "no"; } catch (e) { /* ignore */ }
  if (standalone || dismissed) return;
  const bar = $("#install");
  const text = bar.querySelector(".text"), go = bar.querySelector(".go");
  const hide = () => {
    bar.hidden = true;
    try { localStorage.setItem("magic-install-hint", "no"); } catch (e) { /* ignore */ }
  };
  bar.querySelector(".x").onclick = hide;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) {
    text.textContent = "Få Magic-kort som app: tryk på Del-knappen ⬆︎ og vælg »Føj til hjemmeskærm«.";
    go.hidden = true;
    bar.hidden = false;
  }
  // Android/Chrome: the browser offers its own install dialog.
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    text.textContent = "Få Magic-kort som app på din telefon.";
    go.hidden = false;
    go.onclick = async () => { e.prompt(); await e.userChoice; hide(); };
    bar.hidden = false;
  });
  window.addEventListener("appinstalled", hide);
}

// ---------------------------------------------------------------- start

async function main() {
  const d = await (await fetch("magic.json")).json();
  apiUrl = d.url;
  template = d.template;
  inStockFilter = d.inStockFilter;
  sets = d.sets;

  const search = $("#search");
  let searchSoon = 0;
  const runSearch = () => {
    clearTimeout(searchSoon);
    const q = search.value.trim();
    if (q === query) return;
    query = q;
    startQuery();
  };
  search.addEventListener("input", () => {
    clearTimeout(searchSoon);
    const n = search.value.trim().length;
    if (n === 0 || n >= 3) searchSoon = setTimeout(runSearch, 700);  // search while typing, after a pause
  });
  $("#searchForm").addEventListener("submit", e => { e.preventDefault(); runSearch(); search.blur(); });
  $("#clearBtn").onclick = () => { search.value = ""; runSearch(); };
  $("#cartBtn").onclick = openCart;
  $("#hereChip").onclick = () => { onlyHere = !onlyHere; refreshChips(); startQuery(); };
  $("#setChip").onclick = chooseSet;

  new IntersectionObserver(entries => { if (entries[0].isIntersecting) loadMore(); }, { rootMargin: "800px" })
    .observe($("#more"));
  swipeToClose($("#overlay"));

  loadCart();
  saveCart();
  refreshChips();
  installHint();
  startQuery();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* works without it */ });
main().catch(e => {
  $("#empty").hidden = false;
  $("#empty").textContent = "Appen kunne ikke starte: " + e.message + "\nPrøv at genindlæse siden.";
});
