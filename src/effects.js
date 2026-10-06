import { PetParade, IdlePetCall } from "./pets.js";

const COLORS = ["#f6ed55", "#5effbd", "#ff647e", "#6be8ff"];
const MAX_PARTICLES = 150;

export class Effects {
  particles = [];
  frame = null;
  previousTime = null;
  animations = [];
  pulse = null;
  parade = new PetParade();
  ambient = false;
  soundEnabled = true;
  audio = null;
  audioPaused = false;
  audioRetryElapsed = 0;
  resumePending = null;
  recordings = new Map();
  recordingLoads = new Map();
  recordingSource = null;
  idleCall = new IdlePetCall();

  constructor(petMode = "all") {
    this.parade.setMode(petMode);
    this.host = document.createElement("div");
    this.host.dataset.powerModeHost = "";
    this.host.setAttribute("aria-hidden", "true");
    const root = this.host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { pointer-events: none; }
      * { box-sizing: border-box; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .counter { position: absolute; top: 70px; right: 24px; max-width: calc(100% - 32px); color: #fff;
        padding: 12px 16px; border-left: 3px solid #5effbd; background: #101715f0; border-radius: 4px;
        font: 700 30px/1.1 'Bahnschrift', 'Franklin Gothic Medium', sans-serif; text-align: right; }
      .label { display: block; color: #5effbd; margin-bottom: 4px; font-size: 11px; letter-spacing: 0; }
      .celebration { position: absolute; top: 150px; right: 24px; max-width: calc(100% - 32px);
        font: 700 24px/1.2 'Bahnschrift', 'Franklin Gothic Medium', sans-serif; color: #f6ed55;
        text-shadow: 0 2px 3px #000; text-align: right; overflow-wrap: anywhere; }
      [hidden] { display: none; }
      @media (max-width: 420px) { .counter { top: 64px; right: 16px; font-size: 24px; }
        .celebration { top: 140px; right: 16px; font-size: 20px; } }
    </style><canvas></canvas><div class="counter" hidden><span class="label">POWER MODE</span><span class="hits"></span></div><div class="celebration" hidden></div>`;
    this.canvas = root.querySelector("canvas");
    this.context = this.canvas.getContext("2d");
    this.counter = root.querySelector(".counter");
    this.hits = root.querySelector(".hits");
    this.celebration = root.querySelector(".celebration");
    document.documentElement.append(this.host);
    this.resize();
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(innerWidth * ratio);
    this.canvas.height = Math.round(innerHeight * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  setPets(mode, animate) {
    this.idleCall.activity();
    if (mode === "off") this.stopAudio();
    else if (!animate) this.suspendAudio();
    this.parade.setMode(mode);
    this.ambient = animate && this.parade.mode !== "off";
    this.parade.tick(0, innerWidth, this.ambient, innerHeight, 0);
    if (this.ambient && this.frame === null) {
      this.frame = requestAnimationFrame((time) => this.draw(time));
    } else if (!this.ambient && !this.particles.length) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
      this.previousTime = null;
      this.context.clearRect(0, 0, innerWidth, innerHeight);
    }
  }

  setSound(enabled) {
    this.soundEnabled = enabled === true;
    this.idleCall.activity();
    if (!this.soundEnabled) this.stopAudio();
  }

  setIdleSeconds(seconds) {
    this.idleCall.setDelay(seconds);
  }

  suspendAudio() {
    this.audioPaused = true;
    this.stopCall();
    if (this.audio?.state === "running") this.audio.suspend().catch(() => {});
  }

  resumeAudio() {
    if (!this.soundEnabled || !this.ambient || document.hidden || !document.hasFocus()) return;
    this.audioPaused = false;
    this.recoverAudio(true);
  }

  activity(unlock = false) {
    this.idleCall.activity();
    if (!unlock || !this.soundEnabled || !this.ambient) return;
    this.audioPaused = false;
    this.recoverAudio(true);
  }

  recoverAudio(gesture = false) {
    if (!this.soundEnabled || !this.ambient || this.audioPaused || document.hidden || !document.hasFocus()) return;
    try {
      if (this.audio?.state === "closed") this.stopAudio();
      if (!this.audio) {
        const audio = new AudioContext();
        this.audio = audio;
        audio.onstatechange = () => {
          if (this.audio !== audio || audio.state === "running") return;
          this.stopCall();
          this.recoverAudio();
        };
      }
      this.loadRecordings(this.audio);
      if (this.audio.state !== "running" && (gesture || !this.resumePending)) {
        const pending = this.audio.resume();
        this.resumePending = pending;
        pending.catch(() => {}).finally(() => {
          if (this.resumePending === pending) this.resumePending = null;
        });
      }
    } catch {
      this.stopAudio();
    }
  }

  stopAudio() {
    this.stopCall();
    const audio = this.audio;
    this.audio = null;
    this.resumePending = null;
    if (audio) {
      audio.onstatechange = null;
      if (audio.state !== "closed") audio.close().catch(() => {});
    }
    this.recordings.clear();
    this.recordingLoads.clear();
  }

  loadRecordings(audio) {
    for (const [kind, file] of [["rooster", "rooster.oga"], ["donkey", "donkey.wav"]]) {
      if (this.recordings.has(kind) || this.recordingLoads.has(kind)) continue;
      const loading = fetch(chrome.runtime.getURL(`assets/audio/${file}`))
        .then((response) => {
          if (!response.ok) throw new Error(`Audio file returned ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => audio.decodeAudioData(data))
        .then((buffer) => {
          if (this.audio === audio) this.recordings.set(kind, buffer);
        })
        .catch((error) => {
          if (this.audio === audio) console.warn(`Power Mode could not load the ${kind} recording.`, error);
        })
        .finally(() => {
          if (this.recordingLoads.get(kind) === loading) this.recordingLoads.delete(kind);
        });
      this.recordingLoads.set(kind, loading);
    }
  }

  stopCall() {
    this.recordingSource?.stop();
    this.recordingSource = null;
  }

  playCall(kind) {
    if (!this.soundEnabled || this.audio?.state !== "running") return;
    if (kind !== "fish") {
      const buffer = this.recordings.get(kind);
      if (!buffer || this.recordingSource) return;
      const source = this.audio.createBufferSource();
      const gain = this.audio.createGain();
      source.buffer = buffer;
      gain.gain.value = 0.65;
      source.connect(gain);
      gain.connect(this.audio.destination);
      this.recordingSource = source;
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (this.recordingSource === source) this.recordingSource = null;
      };
      source.start(this.audio.currentTime, 0, Math.min(buffer.duration, 5.5));
      return;
    }
    const calls = {
      fish: [[0, 0.12, 450, 1000], [0.18, 0.14, 600, 1200], [0.4, 0.12, 500, 900]],
    };
    for (const [offset, duration, startFrequency, endFrequency] of calls[kind] || []) {
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      const start = this.audio.currentTime + offset;
      oscillator.type = kind === "fish" ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(startFrequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.045, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      oscillator.connect(gain);
      gain.connect(this.audio.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + duration);
    }
  }

  show(count, milestone, point, reducedMotion) {
    if (count < 3) return;
    this.counter.hidden = false;
    this.hits.textContent = `${count} HITS`;
    if (reducedMotion) return;
    this.pulse?.cancel();
    this.pulse = this.counter.animate(
      [{ transform: "scale(1.06)" }, { transform: "scale(1)" }],
      { duration: 120, easing: "ease-out" },
    );
    if (milestone) {
      for (const animation of this.animations) animation.cancel();
      this.animations = [];
      this.celebration.textContent = `${count} HITS COMBO!`;
      this.celebration.hidden = false;
      this.animations.push(
        this.celebration.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)", offset: 0.15 },
            { opacity: 1, offset: 0.7 },
            { opacity: 0, transform: "translateY(-12px)" },
          ],
          { duration: 700, fill: "forwards" },
        ),
      );
      this.animations.push(
        this.canvas.animate(
          [
            { transform: "translate(0,0)" },
            { transform: "translate(3px,-2px)" },
            { transform: "translate(-3px,2px)" },
            { transform: "translate(0,0)" },
          ],
          { duration: 150 },
        ),
      );
    }
    if (point) this.burst(point, milestone ? 12 : 6);
    if (this.parade.pets.length && this.frame === null)
      this.frame = requestAnimationFrame((time) => this.draw(time));
  }

  burst(point, amount) {
    const room = MAX_PARTICLES - this.particles.length;
    for (let index = 0; index < Math.min(room, amount); index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 45 + Math.random() * 100;
      this.particles.push({
        x: point.x,
        y: point.y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 45,
        age: 0,
        lifetime: 0.3 + Math.random() * 0.3,
        size: 2 + Math.random() * 2,
        color: COLORS[index % COLORS.length],
      });
    }
    if (this.frame === null)
      this.frame = requestAnimationFrame((time) => this.draw(time));
  }

  draw(time) {
    if (this.previousTime !== null && time - this.previousTime < 1000 / 30) {
      this.frame = requestAnimationFrame((next) => this.draw(next));
      return;
    }
    const idleElapsed =
      this.previousTime === null
        ? 0
        : Math.max(0, (time - this.previousTime) / 1000);
    const elapsed = Math.min(idleElapsed, 0.04);
    this.audioRetryElapsed += idleElapsed;
    if (this.audioRetryElapsed >= 2) {
      this.audioRetryElapsed = 0;
      this.recoverAudio();
    }
    this.previousTime = time;
    this.context.clearRect(0, 0, innerWidth, innerHeight);
    if (this.ambient) this.parade.drawWater(this.context, innerWidth);
    this.particles = this.particles.filter(
      (particle) => particle.age + elapsed < particle.lifetime,
    );
    for (const particle of this.particles) {
      particle.age += elapsed;
      particle.x += particle.velocityX * elapsed;
      particle.y += particle.velocityY * elapsed;
      particle.velocityY += 180 * elapsed;
      this.context.globalAlpha = 1 - particle.age / particle.lifetime;
      this.context.fillStyle = particle.color;
      this.context.fillRect(
        particle.x,
        particle.y,
        particle.size,
        particle.size,
      );
    }
    this.context.globalAlpha = 1;
    this.parade.tick(elapsed, innerWidth, this.ambient, innerHeight, idleElapsed);
    this.parade.draw(this.context);
    if (this.ambient && this.soundEnabled) {
      const canPlay = document.hasFocus() && !this.audioPaused && this.audio?.state === "running";
      const kinds = canPlay
        ? [...new Set(this.parade.pets.filter((pet) => pet.x + 22 * pet.scale > 0 && pet.x < innerWidth).map((pet) => pet.kind))]
        : [];
      const kind = this.idleCall.tick(idleElapsed, kinds);
      if (kind) this.playCall(kind);
    }
    if (this.particles.length || this.ambient)
      this.frame = requestAnimationFrame((next) => this.draw(next));
    else {
      this.frame = null;
      this.previousTime = null;
    }
  }

  reset(clearParticles = false) {
    this.counter.hidden = true;
    this.celebration.hidden = true;
    this.pulse?.cancel();
    this.pulse = null;
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    if (clearParticles) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
      this.previousTime = null;
      this.particles = [];
      this.context.clearRect(0, 0, innerWidth, innerHeight);
      if (this.ambient)
        this.frame = requestAnimationFrame((time) => this.draw(time));
    }
  }

  pause() {
    this.suspendAudio();
    this.ambient = false;
    this.parade.clear();
    this.reset(true);
  }

  destroy() {
    this.pause();
    this.stopAudio();
    this.host.remove();
  }
}

export function isPageActivity(event) {
  return event.type !== "keydown" || !/^(AudioVolume|Volume)(Up|Down|Mute)$/.test(event.key);
}
