import {
  Streak,
  IDLE_MS,
  eligibleTarget,
  keyboardIntent,
  qualifyingInput,
} from "./streak.js";
import { caretPoint } from "./caret.js";
import { Effects, isPageActivity } from "./effects.js";
import { normalizePetMode, normalizeIdleSeconds } from "./pets.js";

const streak = new Streak();
const motion = matchMedia("(prefers-reduced-motion: reduce)");
let enabled = false;
let effects = null;
let intent = null;
let composition = null;
let resetTimer = null;
let petMode = "all";
let soundEnabled = true;
let soundChanged = false;
let idleSeconds = 5;
let idleSecondsChanged = false;
let enabledChanged = false;
let petsChanged = false;

function reset(clearParticles = false, keepComposition = false) {
  clearTimeout(resetTimer);
  resetTimer = null;
  intent = null;
  if (!keepComposition) composition = null;
  streak.reset();
  effects?.reset(clearParticles);
}

function setEnabled(value) {
  enabled = value === true;
  reset(true);
  if (!enabled) {
    effects?.destroy();
    effects = null;
  } else {
    syncPets();
  }
}

function syncPets() {
  const animate = enabled && !document.hidden && !motion.matches;
  if (animate && petMode !== "off") effects ||= new Effects(petMode);
  effects?.setSound(soundEnabled);
  effects?.setIdleSeconds(idleSeconds);
  effects?.setPets(petMode, animate);
  effects?.resumeAudio();
}

for (const type of ["pointermove", "pointerdown", "pointerup", "click", "keydown", "wheel", "scroll", "touchstart", "touchend"]) {
  window.addEventListener(type, (event) => {
    if (!enabled || !event.isTrusted || document.hidden || !isPageActivity(event)) return;
    effects?.activity(["pointerdown", "pointerup", "click", "keydown", "touchend"].includes(type));
  }, { capture: true, passive: true });
}

function hit(target) {
  const result = streak.hit(target, performance.now());
  if (result.count >= 3) {
    effects ||= new Effects(petMode);
    effects.show(
      result.count,
      result.milestone,
      motion.matches ? null : caretPoint(target),
      motion.matches,
    );
  }
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => reset(false, true), IDLE_MS);
}

window.addEventListener(
  "keydown",
  (event) => {
    intent = null;
    if (!enabled || document.hidden || !keyboardIntent(event)) return;
    const target = eligibleTarget(event.composedPath());
    if (target) intent = { target, time: performance.now() };
  },
  true,
);

window.addEventListener(
  "keyup",
  () => {
    intent = null;
  },
  true,
);

window.addEventListener(
  "input",
  (event) => {
    if (!enabled || document.hidden) return;
    const target = eligibleTarget(event.composedPath());
    if (composition) {
      if (event.isTrusted && target === composition.target)
        composition.edited = true;
      return;
    }
    if (target && qualifyingInput(event, intent, target, performance.now()))
      hit(target);
    intent = null;
  },
  true,
);

window.addEventListener(
  "compositionstart",
  (event) => {
    intent = null;
    if (enabled && event.isTrusted && !document.hidden) {
      const target = eligibleTarget(event.composedPath());
      composition = target ? { target, edited: false } : null;
    }
  },
  true,
);

window.addEventListener(
  "compositionend",
  (event) => {
    const target = eligibleTarget(event.composedPath());
    const committed =
      enabled &&
      !document.hidden &&
      target &&
      target === composition?.target &&
      composition.edited &&
      event.data.length > 0;
    composition = null;
    intent = null;
    if (committed) hit(target);
  },
  true,
);

window.addEventListener(
  "focusout",
  (event) => {
    if (streak.target && !streak.target.contains(event.relatedTarget)) reset();
  },
  true,
);
window.addEventListener("blur", () => {
  reset(true);
  effects?.suspendAudio();
});
window.addEventListener("focus", () => effects?.resumeAudio());
navigator.mediaDevices?.addEventListener("devicechange", () => effects?.resumeAudio());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    reset(true);
    effects?.pause();
  } else {
    syncPets();
  }
});
window.addEventListener("pagehide", () => {
  reset(true);
  effects?.pause();
});
window.addEventListener("pageshow", () => {
  if (enabled) syncPets();
});
window.addEventListener("resize", () => effects?.resize());
motion.addEventListener("change", () => {
  reset(true);
  syncPets();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.pets) {
    petsChanged = true;
    petMode = normalizePetMode(changes.pets.newValue);
  }
  if (changes.sound) {
    soundChanged = true;
    soundEnabled = changes.sound.newValue !== false;
    effects?.setSound(soundEnabled);
    effects?.resumeAudio();
  }
  if (changes.idleSeconds) {
    idleSecondsChanged = true;
    idleSeconds = normalizeIdleSeconds(changes.idleSeconds.newValue);
    effects?.setIdleSeconds(idleSeconds);
  }
  if (changes.enabled) {
    enabledChanged = true;
    setEnabled(changes.enabled.newValue);
  } else if (changes.pets) {
    syncPets();
  }
});
chrome.storage.local
  .get({ enabled: false, pets: "all", sound: true, idleSeconds: 5 })
  .then((settings) => {
    if (!petsChanged) petMode = normalizePetMode(settings.pets);
    if (!soundChanged) soundEnabled = settings.sound !== false;
    if (!idleSecondsChanged) idleSeconds = normalizeIdleSeconds(settings.idleSeconds);
    if (!enabledChanged) setEnabled(settings.enabled);
    else syncPets();
  })
  .catch(() => setEnabled(false));
