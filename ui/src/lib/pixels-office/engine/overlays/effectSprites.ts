const SMOKE_SOURCES = [
  "/pixels/furniture/SMOKE/SMOKE_1.png",
  "/pixels/furniture/SMOKE/SMOKE_2.png",
  "/pixels/furniture/SMOKE/SMOKE_3.png",
];
const CONFETTI_SOURCE = "/pixels/furniture/CONFETTI/CONFETTI.png";

const smokeImages: (HTMLImageElement | null)[] = [null, null, null];
let confettiImage: HTMLImageElement | null = null;
let requested = false;

export function requestEffectSprites(): void {
  if (requested || typeof Image === "undefined") return;
  requested = true;
  for (let i = 0; i < SMOKE_SOURCES.length; i += 1) {
    const image = new Image();
    image.src = SMOKE_SOURCES[i];
    smokeImages[i] = image;
  }
  confettiImage = new Image();
  confettiImage.src = CONFETTI_SOURCE;
}

export function smokeFrame(index: number): HTMLImageElement | null {
  const image = smokeImages[index];
  return image && image.complete && image.naturalWidth > 0 ? image : null;
}

export function confettiPop(): HTMLImageElement | null {
  return confettiImage && confettiImage.complete && confettiImage.naturalWidth > 0
    ? confettiImage
    : null;
}
