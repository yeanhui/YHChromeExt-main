const SPRITES = {
  donkey: [
    "..............g..g....",
    "..............g..g....",
    "..............gp.pg...",
    "..............gg.gg...",
    "..............gggggg..",
    ".............ngggngg..",
    ".............ngggWWW..",
    "..n..........nggWWWW..",
    "..ngggggggggggggWWnW..",
    "..n.gggggggggggggWWW..",
    "...ggggggggggggggg....",
    "....gggccccccgggg.....",
    ".....gg......ggg......",
    ".....gg......gg.......",
    ".....nn......nn.......",
    "......................",
  ],
  rooster: [
    "...............rrr....",
    "..............rrrrr...",
    "..............oWon....",
    "....tt........oooyyy..",
    "...tttt.......ooor....",
    "..tt..tt......oor.....",
    "..t....tt....oooo.....",
    "..tt....t...oooooo....",
    "...ttt..t..oooWWooo...",
    "....ttttt.oooWWoooo...",
    ".....ttt..oooWWoooo...",
    "......tt...oooooo....",
    "............oooo.....",
    "............y..y.....",
    "...........yy..yy.....",
    "......................",
  ],
  fish: [
    "......................",
    "......................",
    "..........yyy.........",
    ".........yyyyy........",
    "..y....oooooooo.......",
    "..yy..oooWWoooooo.....",
    "..yyyooooWWoooWnoo....",
    "..yyyyoooWWoooWnooo...",
    "..yyyooooWWooooooo....",
    "..yy..oooWWoooooo.....",
    "..y....oooooooo.......",
    "..........yyyy........",
    "......................",
    "......................",
  ],
};
const PALETTE = {
  o: "#eeb263",
  W: "#fff2d9",
  n: "#202b32",
  g: "#9bb2c4",
  p: "#f19ba8",
  r: "#ee5360",
  y: "#ffc857",
  t: "#238f91",
  c: "#728797",
};

export class PetParade {
  pets = [];
  sequence = 0;
  mode = "all";
  bubbles = [];
  age = 0;
  spawnElapsed = 0;
  growthElapsed = 0;
  viewportHeight = 60;
  pixelSize = 3;

  constructor(random = Math.random) {
    this.random = random;
  }

  setMode(mode) {
    this.mode = normalizePetMode(mode);
    this.clear();
  }

  spawn(onScreen = false) {
    if (this.mode === "off" || this.pets.length >= 3) return;
    const choices = ["fish", "rooster", "donkey"];
    const kind = this.mode === "all"
      ? choices[this.sequence % choices.length]
      : this.mode;
    this.sequence += 1;
    const start = onScreen
      ? 12
      : Math.min(-70, ...this.pets.map((pet) => pet.x - 80));
    this.pets.push({
      kind,
      x: start,
      y: 0,
      lane: ((this.sequence - 1) % 3) / 2,
      scale: this.pixelSize,
      age: 0,
      speed: kind === "fish" ? 65 : kind === "donkey" ? 105 : 130,
      nextBubble: 2 + this.random() * 4,
    });
  }

  tick(elapsed, width, ambient = false, height = 60, growthElapsed = elapsed) {
    this.age += elapsed;
    this.growthElapsed += growthElapsed;
    this.viewportHeight = height;
    const availableScale = Math.max(1, Math.floor(Math.min(width / 24, height / 20)));
    this.pixelSize = Math.min(9, 3 + Math.floor(this.growthElapsed / 5), availableScale);
    this.spawnElapsed += growthElapsed;
    if (
      ambient &&
      this.mode !== "off" &&
      (!this.pets.length || this.spawnElapsed >= 5)
    ) {
      this.spawn(!this.pets.length);
      this.spawnElapsed = 0;
    }
    let leader = null;
    for (const pet of this.pets) {
      pet.age += elapsed;
      pet.scale = this.pixelSize;
      pet.y = Math.round(pet.lane * Math.max(0, height - 20 * pet.scale));
      pet.x += pet.speed * elapsed;
      if (leader) pet.x = Math.min(pet.x, leader.x - 22 * pet.scale - 14);
      leader = pet;
      if (pet.kind === "fish") {
        pet.nextBubble -= elapsed;
        if (pet.nextBubble <= 0 && pet.x >= 0 && pet.x < width - 22 * pet.scale) {
          this.blowBubbles(pet);
          pet.nextBubble = 2 + this.random() * 4;
        }
      }
    }
    this.pets = this.pets.filter((pet) => pet.x < width + 22 * pet.scale);
    for (const bubble of this.bubbles) {
      bubble.age += elapsed;
      bubble.x += Math.sin(this.age * 3 + bubble.phase) * elapsed * 8;
      bubble.y -= bubble.speed * elapsed;
    }
    this.bubbles = this.bubbles.filter((bubble) => bubble.age < 2 && bubble.y > 3);
  }

  blowBubbles(pet) {
    for (let index = 0; index < 4 && this.bubbles.length < 24; index += 1) {
      this.bubbles.push({
        x: pet.x + (20 + index) * pet.scale,
        y: pet.y + (26 + index * 4) * pet.scale / 3,
        age: 0,
        speed: 14 + this.random() * 8,
        radius: 2 + this.random() * 2,
        phase: this.random() * Math.PI * 2,
      });
    }
  }

  drawWater(context, width) {
    if (!["all", "fish"].includes(this.mode)) return;
    context.globalAlpha = 1;
    context.fillStyle = "#5bd2df14";
    context.fillRect(0, 0, width, 60);
    context.lineCap = "round";
    for (
      let index = 0;
      index < Math.min(8, Math.ceil(width / 180));
      index += 1
    ) {
      const base = 48 + index * 180;
      context.fillStyle = "#ee718d99";
      for (let branch = 0; branch < 3; branch += 1) {
        const coralX = base + 60 + branch * 6;
        context.fillRect(coralX, 42 - branch * 4, 4, 18 + branch * 4);
        context.fillRect(coralX - 4, 46 - branch * 4, 12, 4);
      }
      for (let stem = 0; stem < 3; stem += 1) {
        const sway = Math.sin(this.age * 1.2 + index + stem) * 7;
        const height = 18 + stem * 9;
        context.strokeStyle = stem % 2 ? "#348d775c" : "#51b47b66";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(base + stem * 6, 58);
        context.bezierCurveTo(
          base + sway - 8,
          48,
          base + sway + 8,
          58 - height / 2,
          base + sway,
          58 - height,
        );
        context.stroke();
      }
    }
  }

  draw(context) {
    context.save();
    context.beginPath();
    context.rect(0, 0, context.canvas.width, this.viewportHeight);
    context.clip();
    for (const bubble of this.bubbles) {
      context.strokeStyle = "#85ddeb";
      context.lineWidth = 1.5;
      context.globalAlpha = 0.8 * (1 - bubble.age / 2);
      context.beginPath();
      context.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);
      context.stroke();
    }
    for (const pet of this.pets) {
      const gait = Math.floor(pet.age * 10) % 2;
      const scale = pet.scale;
      const top =
        pet.y + (pet.kind === "fish" ? 3 + Math.sin(pet.age * 2) * 3 : 4 + gait) * scale / 3;
      context.globalAlpha = 1;
      for (const [row, line] of SPRITES[pet.kind].entries()) {
        for (const [column, pixel] of [...line].entries()) {
          if (!PALETTE[pixel]) continue;
          context.fillStyle = PALETTE[pixel];
          context.fillRect(
            Math.round(pet.x) + column * scale,
            top + row * scale,
            scale,
            scale,
          );
        }
      }
      if (pet.kind === "fish") {
        context.fillStyle = PALETTE.y;
        context.fillRect(Math.round(pet.x) + scale + gait * scale, top + 6 * scale, 2 * scale, 3 * scale);
        continue;
      }
      context.strokeStyle = PALETTE.n;
      context.lineWidth = 2 * scale / 3;
      context.beginPath();
      const mouthX = pet.x + (pet.kind === "donkey" ? 55 : 51) * scale / 3;
      const mouthY = top + (pet.kind === "donkey" ? 26 : 12) * scale / 3;
      context.moveTo(mouthX, mouthY);
      context.quadraticCurveTo(mouthX + scale, mouthY + scale, mouthX + 2 * scale, mouthY);
      context.stroke();
      context.fillStyle = pet.kind === "donkey" ? PALETTE.g : PALETTE.y;
      const legs = pet.kind === "donkey" ? [5, 7, 13, 15] : [12, 15];
      for (const [index, column] of legs.entries()) {
        const offset = (index % 2 === gait ? 1 : -1) * 2 * scale / 3;
        const legX = Math.round(pet.x) + column * scale + offset;
        context.fillStyle = pet.kind === "donkey" ? PALETTE.g : PALETTE.y;
        context.fillRect(legX, top + 13 * scale, scale, 2 * scale);
        context.fillStyle = pet.kind === "donkey" ? PALETTE.n : PALETTE.y;
        context.fillRect(legX - (pet.kind === "rooster" ? 2 * scale / 3 : 0), top + 15 * scale, 5 * scale / 3, scale);
      }
    }
    context.globalAlpha = 1;
    context.restore();
  }

  clear() {
    this.pets = [];
    this.bubbles = [];
    this.spawnElapsed = 0;
    this.growthElapsed = 0;
    this.pixelSize = 3;
    this.sequence = 0;
  }
}

export function normalizePetMode(mode) {
  const legacy = { both: "all", corgi: "donkey", kitty: "rooster", octopus: "fish" };
  const selected = legacy[mode] || mode;
  return ["all", "fish", "rooster", "donkey", "off"].includes(selected) ? selected : "all";
}

export class IdlePetCall {
  elapsed = 0;
  sequence = 0;
  delay = 5;

  setDelay(seconds) {
    this.delay = normalizeIdleSeconds(seconds);
    this.activity();
  }

  activity() {
    this.elapsed = 0;
  }

  tick(elapsed, kinds) {
    this.elapsed += elapsed;
    if (this.elapsed < this.delay || !kinds.length) return null;
    this.activity();
    return kinds[this.sequence++ % kinds.length];
  }
}

export function normalizeIdleSeconds(seconds) {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? Math.max(1, Math.min(3600, Math.round(seconds)))
    : 5;
}
