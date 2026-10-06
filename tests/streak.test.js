import test from "node:test";
import assert from "node:assert/strict";
import {
  Streak,
  eligibleTarget,
  keyboardIntent,
  qualifyingInput,
} from "../src/streak.js";
import { PetParade, IdlePetCall, normalizePetMode, normalizeIdleSeconds } from "../src/pets.js";
import { Effects, isPageActivity } from "../src/effects.js";

test("counter and milestone boundaries", () => {
  const streak = new Streak();
  for (let index = 1; index <= 21; index += 1) {
    assert.deepEqual(streak.hit("editor", index * 50), {
      count: index,
      milestone: index % 10 === 0,
    });
  }
});

test("exact timeout, delayed timers, editor switch, and explicit reset", () => {
  const streak = new Streak();
  streak.hit("first", 0);
  assert.equal(streak.hit("first", 1499).count, 2);
  assert.equal(streak.hit("first", 2999).count, 1);
  assert.equal(streak.hit("first", 9999).count, 1);
  assert.equal(streak.hit("second", 10000).count, 1);
  streak.reset();
  assert.equal(streak.count, 0);
});

test("password, read-only, disabled and non-text inputs are ineligible", () => {
  const input = { nodeType: 1, localName: "input", type: "text" };
  assert.equal(eligibleTarget([input]), input);
  for (const changes of [
    { type: "password" },
    { type: "number" },
    { readOnly: true },
    { disabled: true },
  ]) {
    assert.equal(eligibleTarget([{ ...input, ...changes }]), null);
  }
});

test("only trusted keyboard-driven edits qualify", () => {
  const key = { isTrusted: true, key: "a" };
  assert.equal(keyboardIntent(key), true);
  for (const changes of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { key: "ArrowLeft" },
    { isTrusted: false },
  ]) {
    assert.equal(keyboardIntent({ ...key, ...changes }), false);
  }
  const input = { isTrusted: true, inputType: "insertText" };
  const intent = { target: "editor", time: 100 };
  assert.equal(qualifyingInput(input, intent, "editor", 110), true);
  for (const changes of [
    { inputType: "insertFromPaste" },
    { inputType: "historyUndo" },
    { isTrusted: false },
    { isComposing: true },
  ]) {
    assert.equal(
      qualifyingInput({ ...input, ...changes }, intent, "editor", 110),
      false,
    );
  }
  assert.equal(qualifyingInput(input, null, "editor", 110), false);
  assert.equal(qualifyingInput(input, intent, "other", 110), false);
  assert.equal(qualifyingInput(input, intent, "editor", 1100), false);
});

test("pets alternate, remain bounded, move, and leave the viewport", () => {
  const parade = new PetParade();
  for (let index = 0; index < 10; index += 1) parade.spawn();
  assert.equal(parade.pets.length, 3);
  assert.deepEqual(
    parade.pets.map((pet) => pet.kind),
    ["fish", "rooster", "donkey"],
  );
  const start = parade.pets[0].x;
  parade.tick(1, 390);
  assert.ok(parade.pets[0].x > start);
  parade.tick(10, 390);
  assert.equal(parade.pets.length, 0);
});

test("particle bursts remain bounded under sustained input", () => {
  const effects = Object.create(Effects.prototype);
  effects.particles = [];
  effects.frame = 1;
  for (let index = 0; index < 1000; index += 1)
    effects.burst({ x: 50, y: 50 }, 12);
  assert.equal(effects.particles.length, 150);
});

test("pet choices and cleanup are deterministic", () => {
  const parade = new PetParade();
  for (const mode of ["fish", "rooster", "donkey"]) {
    parade.setMode(mode);
    parade.spawn();
    assert.equal(parade.pets[0].kind, mode);
  }
  parade.setMode("off");
  parade.spawn();
  assert.equal(parade.pets.length, 0);
  parade.setMode("both");
  parade.spawn();
  parade.clear();
  assert.equal(parade.pets.length, 0);
});

test("ambient pets start and respawn without keyboard input", () => {
  const parade = new PetParade(() => 0.5);
  parade.setMode("all");
  parade.tick(0, 390, true);
  assert.equal(parade.pets.length, 1);
  assert.equal(parade.pets[0].x, 12);
  const kinds = new Set();
  for (let index = 0; index < 1200; index += 1) {
    parade.tick(0.1, 390, true);
    assert.ok(parade.pets.length <= 3);
    for (const pet of parade.pets) kinds.add(pet.kind);
  }
  assert.deepEqual([...kinds].sort(), ["donkey", "fish", "rooster"]);
  parade.setMode("off");
  parade.tick(10, 390, true);
  assert.equal(parade.pets.length, 0);
});

test("fish bubbles are bounded, rise, and are removed on a mode change", () => {
  const parade = new PetParade(() => 0.5);
  parade.setMode("fish");
  parade.spawn(true);
  for (let index = 0; index < 20; index += 1) parade.blowBubbles(parade.pets[0]);
  assert.equal(parade.bubbles.length, 24);
  const initialY = parade.bubbles[0].y;
  parade.tick(0.1, 1280);
  assert.ok(parade.bubbles[0].y < initialY);
  parade.tick(3, 1280);
  assert.equal(parade.bubbles.length, 0);
  parade.tick(1, 1280);
  assert.equal(parade.bubbles.length, 4);
  parade.setMode("rooster");
  assert.equal(parade.bubbles.length, 0);
});

test("legacy pet preferences migrate to the new animals", () => {
  for (const [oldMode, newMode] of Object.entries({ both: "all", corgi: "donkey", kitty: "rooster", octopus: "fish" }))
    assert.equal(normalizePetMode(oldMode), newMode);
  assert.equal(normalizePetMode("invalid"), "all");
});

test("idle calls default to five seconds, reset on activity, and rotate visible species", () => {
  const call = new IdlePetCall();
  assert.equal(call.tick(4, ["fish"]), null);
  call.activity();
  assert.equal(call.tick(4, ["fish"]), null);
  assert.equal(call.tick(1, ["fish"]), "fish");
  assert.equal(call.tick(5, ["rooster", "donkey"]), "donkey");
  assert.equal(call.tick(5, []), null);
  assert.equal(call.tick(1, ["rooster"]), "rooster");
});

test("fish bubbles are synthesized and land animals use non-overlapping real recordings", () => {
  const tones = [];
  const sources = [];
  const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} };
  const effects = Object.create(Effects.prototype);
  effects.soundEnabled = true;
  effects.idleCall = new IdlePetCall();
  const rooster = { duration: 5.3 };
  const donkey = { duration: 22 };
  effects.recordings = new Map([["rooster", rooster], ["donkey", donkey]]);
  effects.recordingLoads = new Map();
  effects.audio = {
    state: "running", currentTime: 0, destination: {},
    createOscillator() {
      const tone = { frequency: parameter, connect() {}, disconnect() {}, start() {}, stop() {} };
      tones.push(tone);
      return tone;
    },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(...argumentsList) { this.argumentsList = argumentsList; }, stop() { this.stopped = true; } };
      sources.push(source);
      return source;
    },
    createGain() { return { gain: parameter, connect() {}, disconnect() {} }; },
    close() { return Promise.resolve(); },
  };
  effects.playCall("fish");
  assert.equal(tones.length, 3);
  assert.ok(tones.every((tone) => tone.type === "sine"));
  effects.playCall("rooster");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].buffer, rooster);
  assert.deepEqual(sources[0].argumentsList, [0, 0, 5.3]);
  effects.playCall("donkey");
  assert.equal(sources.length, 1);
  sources[0].onended();
  effects.playCall("donkey");
  assert.equal(sources.length, 2);
  assert.equal(sources[1].buffer, donkey);
  assert.deepEqual(sources[1].argumentsList, [0, 0, 5.5]);
  effects.setSound(false);
  assert.equal(effects.audio, null);
  assert.equal(sources[1].stopped, true);
  effects.playCall("rooster");
  assert.equal(tones.length, 3);
});

test("idle delay is configurable, bounded, and restarts on changes", () => {
  const call = new IdlePetCall();
  call.tick(4, ["fish"]);
  call.setDelay(3);
  assert.equal(call.tick(2.9, ["fish"]), null);
  assert.equal(call.tick(0.1, ["fish"]), "fish");
  assert.equal(call.tick(3, ["fish"]), "fish");
  assert.equal(normalizeIdleSeconds(0), 1);
  assert.equal(normalizeIdleSeconds(4000), 3600);
  assert.equal(normalizeIdleSeconds(2.4), 2);
  for (const value of [undefined, null, "3", NaN, Infinity])
    assert.equal(normalizeIdleSeconds(value), 5);
});

test("losing focus suspends rather than destroys unlocked audio", async () => {
  const effects = Object.create(Effects.prototype);
  effects.idleCall = new IdlePetCall();
  const audio = {
    state: "running",
    suspend() { this.state = "suspended"; return Promise.resolve(); },
  };
  effects.audio = audio;
  effects.idleCall.tick(10, []);
  effects.suspendAudio();
  assert.equal(effects.audio, audio);
  assert.equal(audio.state, "suspended");
  assert.equal(effects.idleCall.elapsed, 10);
});

test("idle audio uses wall time even when animation motion is capped", (context) => {
  const globals = { document: { hasFocus: () => true }, innerWidth: 390, innerHeight: 844, requestAnimationFrame: () => 1 };
  const previous = Object.fromEntries(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  context.after(() => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  Object.assign(globalThis, globals);
  const effects = Object.create(Effects.prototype);
  effects.context = { clearRect() {}, globalAlpha: 1 };
  effects.particles = [];
  effects.previousTime = 0;
  effects.ambient = true;
  effects.soundEnabled = true;
  effects.audio = { state: "running" };
  effects.idleCall = new IdlePetCall();
  effects.setIdleSeconds(1);
  effects.parade = {
    pets: [{ x: 12, kind: "fish", scale: 3 }],
    drawWater() {}, draw() {},
    tick(elapsed) { assert.equal(elapsed, 0.04); },
  };
  const calls = [];
  effects.playCall = (kind) => calls.push(kind);
  effects.draw(1000);
  assert.deepEqual(calls, ["fish"]);
});

test("startup prepares audio without depending on a settings change or prior activation", (context) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
  globalThis.document = { hidden: false, hasFocus: () => true };
  const effects = Object.create(Effects.prototype);
  effects.idleCall = new IdlePetCall();
  effects.soundEnabled = true;
  effects.ambient = true;
  const unlocks = [];
  effects.recoverAudio = (unlock) => unlocks.push(unlock);
  effects.resumeAudio();
  assert.deepEqual(unlocks, [true]);
  effects.soundEnabled = false;
  effects.resumeAudio();
  assert.deepEqual(unlocks, [true]);
});

test("redrawn land animals fit the top strip with species-specific colors", () => {
  for (const kind of ["rooster", "donkey"]) {
    const rectangles = [];
    const context = {
      canvas: { width: 390 }, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
      moveTo() {}, quadraticCurveTo() {}, stroke() {},
      fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); },
    };
    const parade = new PetParade();
    parade.setMode(kind);
    parade.spawn(true);
    parade.draw(context);
    assert.ok(rectangles.length > 100);
    assert.ok(rectangles.every((rectangle) => rectangle.y >= 0 && rectangle.y + rectangle.height <= 60));
    const colors = new Set(rectangles.map((rectangle) => rectangle.color));
    assert.ok(colors.has(kind === "rooster" ? "#ee5360" : "#728797"));
  }
});

test("pets grow every five visible seconds and spawn across the page", () => {
  const parade = new PetParade();
  parade.tick(0, 1280, true, 900, 0);
  assert.equal(parade.pixelSize, 3);
  parade.tick(0.04, 1280, true, 900, 4.99);
  assert.equal(parade.pixelSize, 3);
  parade.tick(0.04, 1280, true, 900, 0.01);
  assert.equal(parade.pixelSize, 4);
  parade.tick(5, 1280, true, 900, 5);
  assert.equal(parade.pixelSize, 5);
  assert.ok(parade.pets.some((pet) => pet.y > 60));
  assert.ok(parade.pets.every((pet) => pet.scale === 5));
  parade.tick(0, 1280, true, 900, 1000);
  assert.equal(parade.pixelSize, 9);
  assert.ok(parade.pets.every((pet) => pet.y + 20 * pet.scale <= 900));
  parade.tick(0, 100, true, 80, 0);
  assert.equal(parade.pixelSize, 4);
  parade.clear();
  assert.equal(parade.pixelSize, 3);
  assert.equal(parade.growthElapsed, 0);
});

test("audio recovers interruptions and closed contexts but respects intentional pauses", async (context) => {
  const names = ["document", "AudioContext"];
  const previous = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  context.after(() => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  globalThis.document = { hidden: false, hasFocus: () => true };
  const contexts = [];
  globalThis.AudioContext = class {
    state = "suspended";
    resumes = 0;
    constructor() { contexts.push(this); }
    resume() { this.resumes += 1; this.state = "running"; return Promise.resolve(); }
    suspend() { this.state = "suspended"; this.onstatechange?.(); return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
  };
  const effects = Object.create(Effects.prototype);
  effects.audio = null;
  effects.soundEnabled = true;
  effects.ambient = true;
  effects.audioPaused = false;
  effects.idleCall = new IdlePetCall();
  effects.recordings = new Map();
  effects.recordingLoads = new Map();
  effects.loadRecordings = () => {};
  effects.idleCall.tick(10, []);
  effects.recoverAudio();
  await Promise.resolve();
  await Promise.resolve();
  const first = effects.audio;
  first.state = "interrupted";
  first.onstatechange();
  assert.equal(first.state, "running");
  assert.equal(first.resumes, 2);
  effects.suspendAudio();
  assert.equal(first.state, "suspended");
  effects.recoverAudio();
  assert.equal(first.state, "suspended");
  effects.resumeAudio();
  assert.equal(first.state, "running");
  first.state = "closed";
  first.onstatechange();
  assert.equal(contexts.length, 2);
  assert.notEqual(effects.audio, first);
  assert.equal(effects.audio.state, "running");
  effects.soundEnabled = false;
  effects.audio.state = "interrupted";
  effects.recoverAudio();
  assert.equal(effects.audio.state, "interrupted");
  assert.equal(effects.idleCall.elapsed, 10);
});

test("only page interaction resets idle; system volume keys do not count", () => {
  for (const key of ["AudioVolumeUp", "AudioVolumeDown", "AudioVolumeMute", "VolumeUp", "VolumeDown", "VolumeMute"])
    assert.equal(isPageActivity({ type: "keydown", key }), false);
  for (const event of [{ type: "keydown", key: "a" }, { type: "pointerdown" }, { type: "pointermove" }, { type: "wheel" }, { type: "scroll" }])
    assert.equal(isPageActivity(event), true);
  const call = new IdlePetCall();
  assert.equal(call.tick(4, []), null);
  assert.equal(call.tick(2, []), null);
  assert.equal(call.tick(0, ["rooster"]), "rooster");
  call.activity();
  assert.equal(call.tick(4, ["rooster"]), null);
});
