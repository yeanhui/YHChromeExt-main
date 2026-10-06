import { createIcons, Zap, ShieldCheck, PawPrint } from "lucide";
import { PetParade, normalizePetMode, normalizeIdleSeconds } from "./pets.js";

createIcons({ icons: { Zap, ShieldCheck, PawPrint } });
const toggle = document.querySelector("#enabled");
const status = document.querySelector("#status");
const error = document.querySelector("#error");
const pets = document.querySelector("#pets");
let previousPets = "all";
const sound = document.querySelector("#sound");
const idleSeconds = document.querySelector("#idle-seconds");
let previousIdleSeconds = 5;
const preview = document.querySelector("#pet-preview");

function renderPets() {
  const context = preview.getContext("2d");
  context.setTransform(2, 0, 0, 2, 0, 0);
  context.clearRect(0, 0, preview.width / 2, preview.height / 2);
  const parade = new PetParade();
  parade.setMode(pets.value);
  parade.spawn();
  if (pets.value === "all") {
    parade.spawn();
    parade.spawn();
  }
  for (const [index, pet] of parade.pets.entries()) {
    pet.x =
      parade.pets.length === 1
        ? 120
        : parade.pets.length === 3
          ? 26 + index * 94
          : 76 + index * 94;
  }
  parade.drawWater(context, preview.width / 2);
  parade.draw(context);
  preview.style.visibility = pets.value === "off" ? "hidden" : "visible";
}

function render(enabled) {
  toggle.checked = enabled;
  document.body.dataset.enabled = String(enabled);
  status.textContent = enabled ? "On" : "Off";
}

chrome.storage.local
  .get({ enabled: false, pets: "all", sound: true, idleSeconds: 5 })
  .then((settings) => {
    render(settings.enabled === true);
    pets.value = normalizePetMode(settings.pets);
    sound.checked = settings.sound !== false;
    previousIdleSeconds = normalizeIdleSeconds(settings.idleSeconds);
    idleSeconds.value = String(previousIdleSeconds);
    previousPets = pets.value;
    renderPets();
    toggle.disabled = false;
    pets.disabled = false;
    sound.disabled = false;
    idleSeconds.disabled = false;
  })
  .catch(() => {
    status.textContent = "Unavailable";
    error.textContent =
      "Could not load your preference. Reopen the popup to retry.";
    error.hidden = false;
  });

toggle.addEventListener("change", async () => {
  const enabled = toggle.checked;
  toggle.disabled = true;
  error.hidden = true;
  try {
    await chrome.storage.local.set({ enabled });
    render(enabled);
  } catch {
    render(!enabled);
    error.textContent = "Could not save your preference. Please try again.";
    error.hidden = false;
  } finally {
    toggle.disabled = false;
  }
});

pets.addEventListener("change", async () => {
  const selected = pets.value;
  pets.disabled = true;
  error.hidden = true;
  try {
    await chrome.storage.local.set({ pets: selected });
    previousPets = selected;
    renderPets();
  } catch {
    pets.value = previousPets;
    error.textContent = "Could not save your pet choice. Please try again.";
    error.hidden = false;
  } finally {
    pets.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled)
    render(changes.enabled.newValue === true);
  if (area === "local" && changes.pets) {
    pets.value = normalizePetMode(changes.pets.newValue);
    previousPets = pets.value;
    renderPets();
  }
  if (area === "local" && changes.sound) sound.checked = changes.sound.newValue !== false;
  if (area === "local" && changes.idleSeconds) {
    previousIdleSeconds = normalizeIdleSeconds(changes.idleSeconds.newValue);
    idleSeconds.value = String(previousIdleSeconds);
  }
});

sound.addEventListener("change", async () => {
  const selected = sound.checked;
  sound.disabled = true;
  error.hidden = true;
  try {
    await chrome.storage.local.set({ sound: selected });
  } catch {
    sound.checked = !selected;
    error.textContent = "Could not save your sound preference. Please try again.";
    error.hidden = false;
  } finally {
    sound.disabled = false;
  }
});

idleSeconds.addEventListener("change", async () => {
  error.hidden = true;
  if (!idleSeconds.checkValidity()) {
    idleSeconds.value = String(previousIdleSeconds);
    error.textContent = "Enter a whole number from 1 to 3600 seconds.";
    error.hidden = false;
    return;
  }
  const selected = idleSeconds.valueAsNumber;
  if (!Number.isFinite(selected)) {
    idleSeconds.value = String(previousIdleSeconds);
    error.textContent = "Enter a whole number from 1 to 3600 seconds.";
    error.hidden = false;
    return;
  }
  const previous = previousIdleSeconds;
  idleSeconds.disabled = true;
  try {
    await chrome.storage.local.set({ idleSeconds: selected });
    previousIdleSeconds = selected;
  } catch {
    idleSeconds.value = String(previous);
    error.textContent = "Could not save your idle time. Please try again.";
    error.hidden = false;
  } finally {
    idleSeconds.disabled = false;
  }
});
