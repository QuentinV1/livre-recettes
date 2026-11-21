/**
 * Compresses an uploaded image file on the client side using HTML5 Canvas.
 * Resizes to a max dimension (default 1200px) and encodes as JPEG.
 */
export async function compressImageFile(
  file: File,
  maxDimension = 1200,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le fichier image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format d’image non supporté.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D indisponible.'));
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Generates a crisp, appetizing SVG data-URL illustration for sample or photo-less recipes.
 */
export function createDishIllustration(
  bgFrom: string,
  bgTo: string,
  accent: string,
  iconKind: 'roast' | 'leaf' | 'bowl' | 'pasta' | string,
  label: string
): string {
  const safeLabel = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let iconSvg = '';
  switch (iconKind) {
    case 'leaf':
      iconSvg = `<path d="M400 175c35 0 65 28 65 65 0 42-40 70-65 70s-65-28-65-70c0-37 30-65 65-65zm0 20v95" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case 'bowl':
      iconSvg = `<path d="M330 235h140c0 45-31 75-70 75s-70-30-70-75zm25-25c15-15 35-15 45 0s30 15 45 0" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case 'pasta':
      iconSvg = `<path d="M340 265c20-35 100-35 120 0M350 285h100M375 190v45M400 185v50M425 190v45" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    default:
      iconSvg = `<path d="M345 255c0-32 25-58 55-58s55 26 55 58H345zm-15 20h140M390 178h20" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bgFrom}"/>
        <stop offset="100%" stop-color="${bgTo}"/>
      </linearGradient>
    </defs>
    <rect width="800" height="520" fill="url(#g)"/>
    <circle cx="400" cy="240" r="158" fill="#FFFFFF" fill-opacity="0.92"/>
    <circle cx="400" cy="240" r="134" fill="${accent}" fill-opacity="0.16" stroke="${accent}" stroke-width="4" stroke-dasharray="10 8"/>
    ${iconSvg}
    <rect x="210" y="426" width="380" height="44" rx="22" fill="#FFFFFF" fill-opacity="0.9"/>
    <text x="400" y="454" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="700" fill="#1C1917" text-anchor="middle">${safeLabel}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
