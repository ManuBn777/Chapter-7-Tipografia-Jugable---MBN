// =====================================================
//  EL RESCATE DE LA N — Tipografía jugable (Unidad 7)
//  p5.js dibuja, Matter.js se encarga de la física.
// =====================================================

// ---------- Ajustes fáciles de cambiar ----------
const NUM_FLOORS = 6;     // cantidad de pisos (usa un número par: 4, 6, 8...)
const GRAVITY = 1.2;      // qué tan fuerte jala hacia abajo
const SPEED = 3.6;        // velocidad al caminar
const JUMP = 7.2;         // fuerza del salto
const CLIMB = 2.6;        // velocidad en la escalera
const TRAMP = 10.5;       // fuerza del trampolín (T)
const T_COOLDOWN = 420;   // cuadros que la T tarda en recargarse (60 = 1 segundo)
const LADDER_GRACE = 110; // cuadros que la escalera sigue visible al soltar el botón
const MAX_BARRELS = 5;    // máximo de barriles (O) por lado
const BARREL_SPEED = 2.6; // qué tan rápido ruedan los barriles
const MOSTRAR_TIEMPO = true; // muestra cuánto se demoran en rescatar la N
const MODO_PRUEBA = false; // true: presiona ESPACIO 10 veces para ganar directo (para probar el final). Ponlo en false para la versión final

// ---------- Medidas del mundo ----------
const W = 1200, H = 700, MID = W / 2;           // lo que se ve en pantalla
const FLOOR_GAP = 140;                          // distancia entre pisos
const TOP_Y = 240;                              // altura del piso de arriba
const WH = TOP_Y + (NUM_FLOORS - 1) * FLOOR_GAP + 40; // alto total del mundo
const THICK = 22;          // grosor de los pisos
const PW = 40, PH = 50;    // tamaño de los jugadores
const BARREL_R = 22;       // radio de los barriles
const DIVIDER_TOP = 185;   // dónde empieza la línea que parte la pantalla
const CAP_Y = 150;         // altura de la N atrapada
const WORD_SIZE = 130, WORD_Y = 270;

// Pisos del lado izquierdo (el derecho es un espejo), de abajo (0) hacia arriba.
// El de abajo es completo; los demás se alternan para que los barriles bajen en zigzag.
function floorShape(k) {
  const y = TOP_Y + (NUM_FLOORS - 1 - k) * FLOOR_GAP;
  if (k === 0) return { x1: 0, x2: 600, y, a: -0.03 };
  return k % 2 === 1 ? { x1: 100, x2: 600, y, a: -0.06 }  // rueda hacia la izquierda
                     : { x1: 0,   x2: 500, y, a:  0.06 }; // rueda hacia la derecha
}
// En cada piso (menos el de arriba) hay un botón (D) y el lugar de una escalera (I).
const buttonX = k => k % 2 === 1 ? 470 : 160;
const ladderX = k => k % 2 === 1 ? 250 : 390;
// Las T están en los pisos pares
const hasTramp = k => k % 2 === 0 && k < NUM_FLOORS - 1;
const TRAMP_X = 280;

// ---------- Física ----------
const { Engine, Bodies, Body, Composite, Events, Query } = Matter;
const CAT = { GIRDER: 1, PLAYER: 2, BARREL: 4, WALL: 8, TRAMP: 16 };
const MASK_PLAYER = CAT.GIRDER | CAT.BARREL | CAT.WALL | CAT.TRAMP;
const MASK_CLIMB = CAT.WALL; // en la escalera se atraviesan los pisos
const GSTEP = GRAVITY * 0.001 * (1000 / 60) ** 2; // lo que jala la gravedad en un cuadro
const probe = Bodies.rectangle(0, 0, PW * 0.7, 8, { isSensor: true }); // "pies" para saber si toca el piso

let engine, floors, floorBodies, girderLetters, ladders, buttons, tramps, barrels, pops, shots, players;
let state, spawnTimer, finale, cam, started = false, testPresses = 0;
let startMillis = 0, finalTime = 0; // para el tiempo
let P = {}; // colores

// ---------- Ayudas ----------
const mx = (side, x) => side === 'L' ? x : W - x;
const mirrorFloor = f => ({ x1: W - f.x2, x2: W - f.x1, y: f.y, a: -f.a });
const floorOf = (side, k) => floors.find(f => f.side === side && f.k === k);
const centerY = (f, x) => f.y + Math.tan(f.a) * (x - f.cx);
const surfaceY = (f, x) => centerY(f, x) - THICK / 2;
const other = side => side === 'L' ? 'R' : 'L';
const sideColor = side => side === 'L' ? P.red : P.blue;
// Copia de un color. Ojo: color(otroColor) en p5 NO hace copia, devuelve el mismo,
// y al cambiarle la transparencia se dañaba el color original.
const cc = c => color(...c.levels);
const easeOutBack = u => { const c = 1.6; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['bg', 'ink', 'soft', 'line', 'world', 'ghost', 'red', 'blue', 'gold']) {
    P[k] = color(cs.getPropertyValue('--' + k).trim());
  }
}

// ---------- Sonidos ----------
let actx = null;
function audio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(f1, f2, dur, type = 'square', vol = 0.08) {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
let clickBuffer = null; // el clic de la Switch (va incrustado al final del código)
function loadClick() {
  if (clickBuffer || !actx) return;
  try {
    const bin = atob(CLICK_DATA.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    actx.decodeAudioData(bytes.buffer).then(b => clickBuffer = b).catch(() => {});
  } catch (e) {}
}
function synthClick() { // clic de respaldo por si el otro no carga
  if (!actx) return;
  const len = Math.floor(actx.sampleRate * 0.03);
  const buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const src = actx.createBufferSource(), hp = actx.createBiquadFilter(), g = actx.createGain();
  src.buffer = buf; hp.type = 'highpass'; hp.frequency.value = 1800; g.gain.value = 0.7;
  src.connect(hp).connect(g).connect(actx.destination); src.start();
  tone(2400, 1800, 0.03, 'square', 0.05);
}
const sfx = {
  jump:   () => tone(380, 720, 0.09, 'square', 0.04),
  bonk:   () => tone(220, 70, 0.18, 'triangle', 0.14),
  press:  () => tone(900, 600, 0.05, 'square', 0.04),
  ladder: () => { tone(660, 660, 0.08, 'sine', 0.08); setTimeout(() => tone(990, 990, 0.12, 'sine', 0.08), 80); },
  boing:  () => tone(200, 620, 0.2, 'sine', 0.1),
  pop:    () => { tone(500, 1400, 0.12, 'square', 0.05); setTimeout(() => tone(1400, 700, 0.1, 'square', 0.04), 60); },
  rescue: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, f, 0.14, 'triangle', 0.08), i * 90)),
  click:  () => {
    if (!clickBuffer) return synthClick();
    const src = actx.createBufferSource();
    src.buffer = clickBuffer;
    src.connect(actx.destination);
    src.start();
  },
};

// ---------- Construir el mundo ----------
function build() {
  if (engine) { Events.off(engine); Engine.clear(engine); }
  engine = Engine.create();
  engine.gravity.y = GRAVITY;
  floors = []; floorBodies = []; girderLetters = []; ladders = []; buttons = []; tramps = []; barrels = []; pops = []; shots = [];
  state = 'play'; finale = null; spawnTimer = { L: 120, R: 150 }; testPresses = 0;
  startMillis = millis();
  cam = { L: 0, R: 0 }; // la cámara empieza arriba, mostrando a la N atrapada

  // Pisos hechos de E
  for (const side of ['L', 'R']) {
    for (let k = 0; k < NUM_FLOORS; k++) {
      const f0 = floorShape(k);
      const f = side === 'L' ? f0 : mirrorFloor(f0);
      f.side = side; f.k = k; f.cx = (f.x1 + f.x2) / 2;
      const len = (f.x2 - f.x1) / Math.cos(f.a);
      f.body = Bodies.rectangle(f.cx, f.y, len, THICK, {
        isStatic: true, angle: f.a, friction: 0.4,
        collisionFilter: { category: CAT.GIRDER, mask: CAT.PLAYER | CAT.BARREL },
      });
      floors.push(f); floorBodies.push(f.body);
      const n = Math.round((f.x2 - f.x1) / 25);
      for (let i = 0; i < n; i++) {
        const x = f.x1 + (i + 0.5) * (f.x2 - f.x1) / n;
        girderLetters.push({ x, y: centerY(f, x), a: f.a, side, k });
      }
    }
  }
  Composite.add(engine.world, floorBodies);

  // Paredes: bordes de la pantalla y la línea del medio
  const wallOpt = { isStatic: true, collisionFilter: { category: CAT.WALL, mask: CAT.PLAYER | CAT.BARREL } };
  Composite.add(engine.world, [
    Bodies.rectangle(-10, WH / 2, 20, WH * 3, wallOpt),
    Bodies.rectangle(W + 10, WH / 2, 20, WH * 3, wallOpt),
    Bodies.rectangle(MID, (DIVIDER_TOP + WH) / 2, 10, WH - DIVIDER_TOP, wallOpt),
  ]);

  // Escaleras (I) y botones (D). El botón de un lado abre la escalera del OTRO lado.
  for (const side of ['L', 'R']) {
    for (let k = 0; k < NUM_FLOORS - 1; k++) {
      ladders.push({ side, k, x: mx(side, ladderX(k)), lower: floorOf(side, k), upper: floorOf(side, k + 1), timer: 0, active: false, appear: 0 });
      buttons.push({ side, k, x: mx(side, buttonX(k)), f: floorOf(side, k), pressed: false, squash: 1 });
    }
  }
  for (const lad of ladders) lad.button = buttons.find(b => b.side !== lad.side && b.k === lad.k);

  // Trampolines (T): rebotan y, si están cargados, rompen los barriles del lado de tu compañera
  for (const side of ['L', 'R']) {
    for (let k = 0; k < NUM_FLOORS; k++) {
      if (!hasTramp(k)) continue;
      const f = floorOf(side, k), x = mx(side, TRAMP_X);
      const body = Bodies.rectangle(x, surfaceY(f, x) - 14, 44, 22, {
        isStatic: true, isSensor: true, angle: f.a,
        collisionFilter: { category: CAT.TRAMP, mask: CAT.PLAYER },
      });
      const t = { side, k, x, f, body, squash: 1, cool: 0, flash: 0 };
      body.plugin.tramp = t;
      tramps.push(t);
      Composite.add(engine.world, body);
    }
  }

  players = [makePlayer('L'), makePlayer('R')];
  Events.on(engine, 'collisionStart', onCollide);
}

function makePlayer(side) {
  const x = side === 'L' ? 70 : W - 70;
  const y = surfaceY(floorOf(side, 0), x) - PH / 2 - 1;
  const b = Bodies.rectangle(x, y, PW, PH, {
    friction: 0, frictionStatic: 0, frictionAir: 0.01, restitution: 0, chamfer: { radius: 6 },
    collisionFilter: { category: CAT.PLAYER, mask: MASK_PLAYER },
  });
  const normalInertia = b.inertia;
  Body.setInertia(b, Infinity); // no se voltea, salvo cuando la tumba un barril
  Composite.add(engine.world, b);
  const keys = side === 'L'
    ? { left: 65, right: 68, up: 87, down: 83 }               // A D W S
    : { left: LEFT_ARROW, right: RIGHT_ARROW, up: UP_ARROW, down: DOWN_ARROW };
  const p = { side, body: b, normalInertia, keys, grounded: false, wasUp: false, climbing: null,
              stun: 0, invuln: 0, squash: 1, moved: false, hint: 1 };
  b.plugin.player = p;
  return p;
}

// ---------- Choques ----------
function onCollide(e) {
  for (const pair of e.pairs) {
    const A = pair.bodyA, B = pair.bodyB;
    const pl = A.plugin.player || B.plugin.player;
    if (!pl) continue;
    const otherBody = A.plugin.player ? B : A;
    if (otherBody.plugin.tramp) {
      if (pl.body.velocity.y > 1 && !pl.climbing && pl.stun === 0) bounce(pl, otherBody.plugin.tramp);
    } else if (otherBody.label === 'barrel') {
      if (pl.stun === 0 && pl.invuln === 0 && !pl.climbing) knock(pl, otherBody);
    }
  }
}

function bounce(p, t) {
  Body.setVelocity(p.body, { x: p.body.velocity.x, y: -TRAMP });
  t.squash = 0.5; p.squash = 1.3; sfx.boing();
  if (t.cool > 0) return;
  // La T está cargada: lanza pequeñas T que persiguen los barriles de tu compañera
  t.cool = T_COOLDOWN; t.flash = 1;
  const target = other(t.side);
  const sy = surfaceY(t.f, t.x) - 40;
  barrels.filter(b => b.side === target).forEach((br, i) => {
    shots.push({ x: t.x, y: sy, sx: t.x, sy, br, t: -i * 6, dur: 38, side: t.side });
  });
  spawnTimer[target] = Math.max(spawnTimer[target], 150); // un respiro antes del próximo barril
  if (shots.length) sfx.press();
}

function updateShots() {
  for (let i = shots.length - 1; i >= 0; i--) {
    const sh = shots[i];
    sh.t++;
    if (sh.t < 0) continue;
    const alive = barrels.includes(sh.br);
    const u = constrain(sh.t / sh.dur, 0, 1), e = u * u * (3 - 2 * u);
    const tx = alive ? sh.br.body.position.x : sh.tx || sh.x, ty = alive ? sh.br.body.position.y : sh.ty || sh.y;
    sh.tx = tx; sh.ty = ty;
    sh.px = sh.x; sh.py = sh.y;
    sh.x = lerp(sh.sx, tx, e);
    sh.y = lerp(sh.sy, ty, e) - Math.sin(u * PI) * 160; // vuela en arco por encima
    if (u >= 1) {
      if (alive) {
        const b = sh.br.body;
        pops.push({ x: b.position.x, y: b.position.y, t: 0, side: sh.side });
        Composite.remove(engine.world, b);
        barrels.splice(barrels.indexOf(sh.br), 1);
        sfx.pop();
      }
      shots.splice(i, 1);
    }
  }
}

function knock(p, barrel) { // un barril tumba a la letra
  p.stun = 60; p.invuln = 150;
  Body.setInertia(p.body, p.normalInertia);
  let dir = Math.sign(barrel.velocity.x);
  if (!dir) dir = p.body.position.x < barrel.position.x ? -1 : 1;
  Body.setVelocity(p.body, { x: dir * 5, y: -6.5 });
  Body.setAngularVelocity(p.body, 0.22 * dir);
  sfx.bonk();
}
function recover(p) {
  Body.setAngle(p.body, 0);
  Body.setAngularVelocity(p.body, 0);
  Body.setInertia(p.body, Infinity);
  Body.setPosition(p.body, { x: p.body.position.x, y: p.body.position.y - 6 });
}

// ---------- Jugadores ----------
function isGrounded(p) {
  const b = p.body;
  Body.setPosition(probe, { x: b.position.x, y: b.position.y + PH / 2 + 3 });
  return Query.collides(probe, floorBodies).length > 0;
}

function ladderNear(p, up) {
  const b = p.body, bottom = b.position.y + PH / 2;
  for (const lad of ladders) {
    if (lad.side !== p.side || !lad.active || !p.grounded) continue;
    if (Math.abs(b.position.x - lad.x) > 22) continue;
    const f = up ? lad.lower : lad.upper;
    if (Math.abs(bottom - surfaceY(f, lad.x)) < 16) return lad;
  }
  return null;
}

function startClimb(p, lad) {
  p.climbing = lad;
  p.body.collisionFilter.mask = MASK_CLIMB;
  Body.setPosition(p.body, { x: lad.x, y: p.body.position.y });
  Body.setVelocity(p.body, { x: 0, y: 0 });
}
function endClimb(p) {
  p.climbing = null;
  p.body.collisionFilter.mask = MASK_PLAYER;
  Body.setVelocity(p.body, { x: 0, y: 0 });
}
function climbUpdate(p, U, D) {
  const b = p.body, lad = p.climbing;
  const dir = (D ? 1 : 0) - (U ? 1 : 0);
  Body.setPosition(b, { x: lad.x, y: b.position.y + dir * CLIMB });
  Body.setVelocity(b, { x: 0, y: -GSTEP }); // cancela la gravedad
  const bottom = b.position.y + PH / 2;
  const top = surfaceY(lad.upper, lad.x), low = surfaceY(lad.lower, lad.x);
  if (bottom <= top - 1) { Body.setPosition(b, { x: lad.x, y: top - PH / 2 - 1 }); endClimb(p); }
  else if (bottom >= low && dir > 0) { Body.setPosition(b, { x: lad.x, y: low - PH / 2 - 1 }); endClimb(p); }
}

function updatePlayer(p) {
  const b = p.body, k = p.keys;
  const L = keyIsDown(k.left), R = keyIsDown(k.right), U = keyIsDown(k.up), D = keyIsDown(k.down);
  if (L || R || U || D) p.moved = true;
  const upPressed = U && !p.wasUp;
  p.wasUp = U;
  if (p.invuln > 0) p.invuln--;

  if (p.stun > 0) { p.stun--; if (p.stun === 0) recover(p); return; }
  if (p.climbing) { climbUpdate(p, U, D); return; }

  const was = p.grounded;
  p.grounded = isGrounded(p);
  if (p.grounded && !was) p.squash = 0.8;

  if (U || D) {
    const lad = ladderNear(p, U);
    if (lad) { startClimb(p, lad); return; }
  }

  const dir = (R ? 1 : 0) - (L ? 1 : 0);
  const v = b.velocity;
  let vx = dir !== 0 ? dir * SPEED : (p.grounded ? v.x * 0.6 : v.x * 0.98);
  let vy = v.y;
  if (upPressed && p.grounded) { vy = -JUMP; p.squash = 1.25; sfx.jump(); }
  Body.setVelocity(b, { x: vx, y: vy });
}

// ---------- Barriles ----------
function spawnBarrel(side) {
  const f = floorOf(side, NUM_FLOORS - 1), x = mx(side, 560), y = surfaceY(f, x) - BARREL_R - 4;
  const blocked = players.some(p => Math.abs(p.body.position.x - x) < 70 && Math.abs(p.body.position.y - y) < 60);
  if (blocked) return false;
  const b = Bodies.circle(x, y, BARREL_R, {
    friction: 0.05, frictionStatic: 0.2, frictionAir: 0.002, restitution: 0.25, density: 0.002,
    collisionFilter: { category: CAT.BARREL, mask: CAT.GIRDER | CAT.WALL | CAT.PLAYER | CAT.BARREL },
  });
  b.label = 'barrel';
  Body.setVelocity(b, { x: side === 'L' ? -1.5 : 1.5, y: 0 });
  Composite.add(engine.world, b);
  barrels.push({ body: b, side, born: frameCount });
  return true;
}

function updateBarrels() {
  for (const side of ['L', 'R']) {
    spawnTimer[side]--;
    if (spawnTimer[side] <= 0) {
      const count = barrels.filter(b => b.side === side).length;
      spawnTimer[side] = (count < MAX_BARRELS && spawnBarrel(side)) ? random(160, 280) : 30;
    }
  }
  // Cada barril rueda cuesta abajo por el piso donde está, como en Donkey Kong
  for (const br of barrels) {
    const b = br.body, { x, y } = b.position;
    const f = floors.find(f => f.side === br.side && x >= f.x1 && x <= f.x2 && Math.abs(y + BARREL_R - surfaceY(f, x)) < 10);
    if (f) Body.setVelocity(b, { x: lerp(b.velocity.x, Math.sign(f.a) * BARREL_SPEED, 0.1), y: b.velocity.y });
  }
  const groundY = floorShape(0).y;
  for (let i = barrels.length - 1; i >= 0; i--) {
    const br = barrels[i], { x, y } = br.body.position;
    br.still = Math.abs(br.body.velocity.x) < 0.2 ? (br.still || 0) + 1 : 0; // ¿se quedó atascado?
    const atEnd = y > groundY - 70 && (x < 90 || x > W - 90); // llegó al fondo, junto a la pared
    if (y > WH + 60 || atEnd || br.still > 120 || frameCount - br.born > 60 * 40) {
      Composite.remove(engine.world, br.body);
      barrels.splice(i, 1);
    }
  }
}

// ---------- Un paso del juego ----------
function step() {
  for (const btn of buttons) {
    const was = btn.pressed;
    btn.pressed = players.some(p => p.side === btn.side && !p.climbing && p.stun === 0 && p.grounded &&
      Math.abs(p.body.position.x - btn.x) < 26 &&
      Math.abs(p.body.position.y + PH / 2 - surfaceY(btn.f, btn.x)) < 14);
    if (btn.pressed && !was) sfx.press();
  }
  for (const lad of ladders) {
    if (lad.button.pressed) lad.timer = LADDER_GRACE;
    else if (lad.timer > 0) lad.timer--;
    const occupied = players.some(p => p.climbing === lad);
    const was = lad.active;
    lad.active = lad.button.pressed || lad.timer > 0 || occupied;
    if (lad.active && !was) sfx.ladder();
  }
  for (const t of tramps) if (t.cool > 0) t.cool--;
  updateShots();
  for (const p of players) updatePlayer(p);
  updateBarrels();
  Engine.update(engine, 1000 / 60);

  // ¿Llegaron las dos arriba, junto a la N atrapada?
  const atTop = p => p.grounded && !p.climbing && p.stun === 0 && p.body.position.y < TOP_Y + 25;
  const [pl, pr] = players;
  if (atTop(pl) && atTop(pr) && pl.body.position.x > 450 && pr.body.position.x < W - 450) startFinale();
}

// Animaciones pequeñas (se calculan una vez por cuadro)
function animate() {
  for (const lad of ladders) lad.appear = lerp(lad.appear, lad.active ? 1 : 0, 0.25);
  for (const btn of buttons) btn.squash = lerp(btn.squash, btn.pressed ? 0.5 : 1, 0.3);
  for (const t of tramps) { t.squash = lerp(t.squash, 1, 0.15); t.flash = Math.max(0, t.flash - 0.04); }
  for (const p of players) {
    p.squash = lerp(p.squash, 1, 0.18);
    p.hint = lerp(p.hint, p.moved ? 0 : 1, 0.03);
  }
  for (let i = pops.length - 1; i >= 0; i--) if (++pops[i].t > 24) pops.splice(i, 1);
  // Cada mitad tiene su cámara, que sigue a su jugadora
  if (started) {
    for (const p of players) {
      const target = constrain(p.body.position.y - H * 0.55, 0, WH - H);
      cam[p.side] = lerp(cam[p.side], target, 0.035);
    }
  }
}

// ---------- Final: la palabra se arma ----------
const BTN = { x: MID, y: H - 120, w: 260, h: 58 }; // botón de volver a jugar
const easeInQuad = u => u * u;
const easeOutCubic = u => 1 - Math.pow(1 - u, 3);

function startFinale() {
  state = 'final';
  finalTime = millis() - startMillis;
  sfx.rescue();
  const items = [];
  // guardamos cada letra en su posición en pantalla (según la cámara de su lado)
  const add = (ch, x, y, a, size, c) => {
    const it = { ch, x, y: y - cam[x < MID ? 'L' : 'R'], a, size, c: cc(c) };
    items.push(it); return it;
  };

  const gl = girderLetters.map(g => add('E', g.x, g.y, g.a, 30, P.world));
  for (const lad of ladders) {
    if (lad.appear < 0.1) continue;
    const top = surfaceY(lad.upper, lad.x) - 6, low = surfaceY(lad.lower, lad.x);
    const n = Math.max(2, Math.round((low - top) / 28)), s = (low - top) / n;
    for (let i = 0; i < n; i++) add('I', lad.x, low - s * (i + 0.5), 0, 32, sideColor(other(lad.side)));
  }
  const btnItems = buttons.map(b => add('D', b.x, surfaceY(b.f, b.x) - 10, b.f.a - HALF_PI, 30, sideColor(b.side)));
  const trItems = tramps.map(t => add('T', t.x, surfaceY(t.f, t.x) - 15, t.f.a, 40, P.world));
  const barItems = barrels.map(br => add('O', br.body.position.x, br.body.position.y, 0, 60, P.ink));
  const barL = add('I', MID - 34, CAP_Y, 0, 64, P.world);
  add('I', MID + 34, CAP_Y, 0, 64, P.world);
  const cap = add('N', MID, CAP_Y, 0, 60, P.ink);
  const nL = add('N', players[0].body.position.x, players[0].body.position.y, 0, 58, P.red);
  const nR = add('N', players[1].body.position.x, players[1].body.position.y, 0, 58, P.blue);

  // Las letras de la palabra salen sobre todo de abajo, para que se vea cómo suben
  const lowest = (list, test) => list.filter(test).reduce((a, b) => (!a || b.y > a.y ? b : a), null);
  const eSrc = lowest(gl, it => it.x > 250 && it.x < 350);
  const tSrc = lowest(trItems, it => it.x < MID);
  const dSrc = lowest(btnItems, it => it.x > MID);
  const oSrc = lowest(barItems, () => true) || add('O', MID + 220, H + 120, 0, 60, P.ink);
  const sources = [nL, barL, cap, tSrc, eSrc, nR, dSrc, oSrc]; // N I N T E N D O

  textSize(WORD_SIZE);
  const word = 'NINTENDO', gap = 6;
  const widths = [...word].map(ch => textWidth(ch));
  let x = MID - (widths.reduce((s, w) => s + w, 0) + gap * 7) / 2;
  sources.forEach((it, i) => {
    it.word = true; it.i = i;
    it.from = { x: it.x, y: it.y, a: it.a, size: it.size, c: cc(it.c) };
    it.tx = x + widths[i] / 2; it.ty = WORD_Y;
    it.sx = MID + (it.tx - MID) * 1.6; // primero aterrizan separadas
    it.tc = cc(i < 4 ? P.red : P.blue);
    it.delay = 18 + i * 5;   // salen una tras otra
    it.dur = 50;
    x += widths[i] + gap;
  });
  // Todo lo demás sale volando hacia arriba, empezando por lo de abajo
  for (const it of items) if (!it.word) {
    it.from = { x: it.x, y: it.y, a: it.a };
    it.tx = it.x + random(-90, 90);
    it.ty = -120;
    it.spin = random(-2.5, 2.5);
    it.delay = 8 + map(it.y, H + 300, 0, 0, 20, true) + random(0, 12);
    it.dur = random(50, 80);
  }
  finale = { items, t: 0, clickT: -1, mergeStart: -1 };
}

function renderFinale() {
  const F = finale;
  F.t++;
  // 1) Lo que no forma la palabra sube y se va por arriba de la pantalla
  for (const it of F.items) {
    if (it.word) continue;
    const u = constrain((F.t - it.delay) / it.dur, 0, 1);
    if (u >= 1) continue;
    const e = easeInQuad(u);
    const x = lerp(it.from.x, it.tx, e), y = lerp(it.from.y, it.ty, e);
    const c = cc(it.c); c.setAlpha(alpha(it.c) * (1 - u * u));
    letter(it.ch, x, y, it.size, it.from.a + it.spin * u, c);
  }
  // 2) Las 8 letras suben, giran y aterrizan SEPARADAS entre sí
  // 3) Cuando todas aterrizan, esperan un momento y se juntan de golpe: ¡clic!
  let landed = true;
  const m = F.mergeStart >= 0 ? constrain((F.t - F.mergeStart) / 14, 0, 1) : 0;
  const mE = m * m * m; // acelera, para que se peguen con fuerza
  for (const it of F.items) {
    if (!it.word) continue;
    const u = constrain((F.t - it.delay) / it.dur, 0, 1);
    if (u < 1) landed = false;
    const e = easeOutCubic(u);
    const x = lerp(lerp(it.from.x, it.sx, e), it.tx, mE);
    const y = lerp(it.from.y, it.ty, e) - Math.sin(u * PI) * 110; // un arco hacia arriba
    const a = (1 - e) * (it.from.a + TWO_PI);
    const land = (u >= 1 && m === 0) ? Math.max(0, 1 - (F.t - it.delay - it.dur) / 10) : 0; // aplastón al aterrizar
    const hit = F.clickT >= 0 ? Math.max(0, 1 - (F.t - F.clickT) / 12) : 0; // aplastón al pegarse
    let hop = 0;
    if (F.clickT >= 0) {
      const k = F.t - F.clickT;
      hop = -Math.abs(Math.sin(k * 0.12 - it.i * 0.45)) * 14 * Math.max(0, 1 - k / 150);
    }
    let c = lerpColor(it.from.c, it.tc, e);
    const wU = F.clickT >= 0 ? constrain((F.t - F.clickT) / 10, 0, 1) : 0; // al pegarse se vuelven blancas
    if (wU > 0) c = lerpColor(c, color(255), wU);
    push();
    if (wU > 0) { stroke(it.tc); strokeWeight(5 * wU); strokeJoin(ROUND); } else noStroke(); // borde de su color para que se lean
    letter(it.ch, x, y + hop, lerp(it.from.size, WORD_SIZE, e), a, c,
           1 + land * 0.15 - hit * 0.12, 1 - land * 0.15 + hit * 0.12);
    pop();
  }
  if (landed && F.mergeStart < 0) F.mergeStart = F.t + 18;   // pausa antes de juntarse
  if (m >= 1 && F.clickT < 0) { F.clickT = F.t; sfx.click(); } // se pegaron
  if (F.clickT >= 0 && MOSTRAR_TIEMPO) {
    const c = cc(P.ink); c.setAlpha(255 * constrain((F.t - F.clickT - 15) / 20, 0, 1));
    fill(c); textSize(30); text('Lo lograron en ' + formatTime(finalTime), MID, WORD_Y + 120);
  }
  // Botón para volver a jugar
  const bu = F.clickT >= 0 ? constrain((F.t - F.clickT - 35) / 20, 0, 1) : 0;
  F.button = bu > 0.5;
  if (bu > 0) {
    const ink = cc(P.ink), soft = cc(P.soft);
    ink.setAlpha(255 * bu); soft.setAlpha(255 * bu);
    noFill(); stroke(ink); strokeWeight(3);
    rectMode(CENTER); rect(BTN.x, BTN.y, BTN.w, BTN.h, 28);
    noStroke(); fill(ink); textSize(26); text('Volver a jugar', BTN.x, BTN.y - 2);
    fill(soft); textSize(16); text('o presionen R', BTN.x, BTN.y + 48);
  }
}

// ---------- Dibujo ----------
function letter(ch, x, y, size, a, c, sx = 1, sy = 1) {
  push(); translate(x, y); rotate(a); scale(sx, sy);
  fill(c); textSize(size); text(ch, 0, 0);
  pop();
}

function drawWorld() {
  // Línea que parte la pantalla
  stroke(P.line); strokeWeight(4);
  drawingContext.setLineDash([10, 12]);
  line(MID, DIVIDER_TOP, MID, WH);
  drawingContext.setLineDash([]);
  noStroke();

  // Pisos de E
  for (const g of girderLetters) letter('E', g.x, g.y, 30, g.a, P.world);

  // Escaleras de I: el color es el de la jugadora que te ayudó
  for (const lad of ladders) {
    const top = surfaceY(lad.upper, lad.x) - 6, low = surfaceY(lad.lower, lad.x);
    const n = Math.max(2, Math.round((low - top) / 28)), s = (low - top) / n;
    const c = cc(sideColor(other(lad.side)));
    c.setAlpha(255 * lad.appear);
    for (let i = 0; i < n; i++) {
      const y = low - s * (i + 0.5);
      letter('I', lad.x, y, 32, 0, P.ghost);
      if (lad.appear > 0.02) { const k = 0.6 + 0.4 * lad.appear; letter('I', lad.x, y, 32, 0, c, k, k); }
    }
  }

  // Botones de D (acostadas, con el lado plano abajo)
  for (const btn of buttons) {
    const c = cc(sideColor(btn.side));
    if (!btn.pressed) c.setAlpha(150);
    push();
    translate(btn.x, surfaceY(btn.f, btn.x)); rotate(btn.f.a); scale(1.15, btn.squash);
    if (btn.pressed) { drawingContext.shadowBlur = 18; drawingContext.shadowColor = c.toString(); }
    rotate(-HALF_PI); fill(c); textSize(30); text('D', 11, 0);
    pop();
  }

  // Trampolines de T: de color cuando están cargados, grises mientras se recargan
  for (const t of tramps) {
    const ready = t.cool === 0;
    const c = cc(ready ? sideColor(t.side) : P.world);
    if (!ready) c.setAlpha(90 + 120 * (1 - t.cool / T_COOLDOWN));
    push(); translate(t.x, surfaceY(t.f, t.x)); rotate(t.f.a); scale(1 / t.squash, t.squash);
    if (ready || t.flash > 0) {
      drawingContext.shadowBlur = ready ? 10 + 6 * Math.sin(frameCount * 0.1) : 40 * t.flash;
      drawingContext.shadowColor = (t.flash > 0 ? sideColor(t.side) : c).toString();
    }
    fill(c); textSize(40); text('T', 0, -15);
    pop();
  }

  // Barriles de O
  for (const br of barrels) letter('O', br.body.position.x, br.body.position.y, 60, br.body.angle, P.ink);
  // Barriles que explotan
  for (const pp of pops) {
    const u = pp.t / 24, c = cc(sideColor(pp.side));
    c.setAlpha(255 * (1 - u));
    letter('O', pp.x, pp.y, 60, 0, c, 1 + u * 1.2, 1 + u * 1.2);
  }

  // Pequeñas T que viajan hacia los barriles del otro lado
  for (const sh of shots) {
    if (sh.t < 0) continue;
    const c = cc(sideColor(sh.side));
    const a = Math.atan2(sh.y - (sh.py ?? sh.y), sh.x - (sh.px ?? sh.x)) + HALF_PI;
    for (let k = 2; k >= 0; k--) { // pequeña estela
      const tc = cc(c); tc.setAlpha(255 * (1 - k * 0.3));
      letter('T', lerp(sh.x, sh.px ?? sh.x, k * 1.5), lerp(sh.y, sh.py ?? sh.y, k * 1.5), 36 - k * 7, a, tc);
    }
  }

  // La N atrapada entre dos I
  const bob = Math.sin(frameCount * 0.08) * 3;
  letter('I', MID - 34, CAP_Y, 64, 0, P.world);
  letter('I', MID + 34, CAP_Y, 64, 0, P.world);
  letter('N', MID, CAP_Y + bob, 60, 0, P.ink);

  // Jugadoras
  for (const p of players) {
    if (p.invuln > 0 && p.stun === 0 && Math.floor(frameCount / 5) % 2 === 0) continue; // parpadea
    const b = p.body, sq = p.squash;
    const lean = p.stun ? 0 : constrain(b.velocity.x * 0.025, -0.12, 0.12);
    push();
    translate(b.position.x, b.position.y); rotate(b.angle + lean);
    translate(0, PH / 2); scale(1 / sq, sq);
    fill(sideColor(p.side)); textSize(58); text('N', 0, -PH / 2 + 3);
    pop();
  }
}

function renderPlay() {
  // Cada mitad se dibuja con su propia cámara
  for (const side of ['L', 'R']) {
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.rect(side === 'L' ? 0 : MID, 0, MID, H);
    drawingContext.clip();
    push(); translate(0, -cam[side]); drawWorld(); pop();
    drawingContext.restore();
  }
  // Teclas (desaparecen cuando empiezan a jugar)
  textSize(18);
  for (const p of players) {
    if (p.hint < 0.02) continue;
    const c = cc(P.soft); c.setAlpha(255 * p.hint); fill(c);
    text(p.side === 'L' ? 'A  D  moverse     W  saltar' : '←  →  moverse     ↑  saltar', p.side === 'L' ? 170 : W - 170, H - 12);
  }
  if (!started) { fill(P.soft); textSize(22); text('Hagan clic aquí para empezar', MID, 40); }
  if (MOSTRAR_TIEMPO && started) { fill(P.soft); textSize(26); text(formatTime(millis() - startMillis), MID, 26); }
  if (MODO_PRUEBA) { fill(P.soft); textSize(16); text(`Modo prueba: ESPACIO ${testPresses}/10`, W - 130, 24); }
}

// ---------- Modo prueba: ganar sin segundo jugador ----------
function testWin() {
  cam.L = 0; cam.R = 0;
  const top = NUM_FLOORS - 1;
  const put = (p, x) => {
    if (p.climbing) endClimb(p);
    if (p.stun > 0) { p.stun = 0; recover(p); }
    Body.setPosition(p.body, { x, y: surfaceY(floorOf(p.side, top), x) - PH / 2 - 1 });
    Body.setVelocity(p.body, { x: 0, y: 0 });
  };
  put(players[0], 520);
  put(players[1], W - 520);
  startFinale();
}

// ---------- p5 ----------
function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.parent('app');
  textFont('Fredoka'); textStyle(BOLD); textAlign(CENTER, CENTER);
  readPalette();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readPalette);
  build();
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

function draw() {
  background(P.bg);
  const s = Math.min(width / W, height / H);
  push();
  translate((width - W * s) / 2, (height - H * s) / 2);
  scale(s);
  if (state === 'play') {
    if (started) step();
    animate();
    renderPlay();
  } else renderFinale();
  pop();
}

function start() {
  audio(); loadClick();
  if (!started) startMillis = millis();
  started = true;
}
const formatTime = ms => { const t = Math.floor(ms / 1000); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function mousePressed() {
  start();
  if (state === 'final' && finale.button) {
    const s = Math.min(width / W, height / H);
    const x = (mouseX - (width - W * s) / 2) / s, y = (mouseY - (height - H * s) / 2) / s;
    if (Math.abs(x - BTN.x) < BTN.w / 2 && Math.abs(y - BTN.y) < BTN.h / 2) build();
  }
}
function keyPressed() {
  start();
  if (key === 'r' || key === 'R') { build(); return false; }
  if (MODO_PRUEBA && keyCode === 32 && state === 'play') {
    testPresses++;
    if (testPresses >= 10) testWin();
    return false;
  }
  if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, 32].includes(keyCode)) return false;
}

// ---------- El clic de la Switch (archivo de sonido convertido a texto) ----------
const CLICK_DATA = 'data:audio/mpeg;base64,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qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSZJgP8sNJtdGDNlBWRSa2BeN6QAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg==';
