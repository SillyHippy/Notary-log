/**
 * Compresses an image (from File or data URL) to a smaller JPEG data URL.
 *
 * @param source - A File object or a data URL string
 * @param maxWidth - Maximum width in pixels (height scaled proportionally). Default 800.
 * @param quality - JPEG quality 0–1. Default 0.7.
 * @returns Promise resolving to a JPEG data URL string
 */
export async function compressImageToDataUrl(
  source: File | string,
  maxWidth = 800,
  quality = 0.7,
): Promise<string> {
  const img = new Image();

  const dataUrl: string = await new Promise((resolve, reject) => {
    img.onload = () => resolve(img.src);
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    if (source instanceof File) {
      img.src = URL.createObjectURL(source);
    } else {
      img.src = source;
    }
  });

  // Clean up object URL if we created one
  if (source instanceof File) {
    URL.revokeObjectURL(img.src);
  }

  // Draw to canvas at reduced size
  const canvas = document.createElement('canvas');
  let width = img.naturalWidth;
  let height = img.naturalHeight;

  if (width > maxWidth) {
    height = Math.round(height * (maxWidth / width));
    width = maxWidth;
  }

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', quality);
}
