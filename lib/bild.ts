// Bilder für den Rechnungs-Upload aufbereiten (nur im Browser): iPhone-Fotos kommen als
// HEIC, sind mehrere MB groß und lassen sich nicht in eine PDF einbetten. Deshalb wird
// jedes Bild zu einem verkleinerten JPEG.

export const DATEI_ENDUNGEN = /\.(pdf|jpe?g|png|heic|heif|webp)$/i;

function istHeic(datei: File): boolean {
  return /\.(heic|heif)$/i.test(datei.name) || /image\/hei[cf]/i.test(datei.type);
}

export function istPdf(datei: File): boolean {
  return /\.pdf$/i.test(datei.name) || datei.type === 'application/pdf';
}

/** Wandelt ein Bild (JPG, PNG, WebP, HEIC) in ein JPEG mit höchstens `maxKante` Pixeln um. */
export async function bildAlsJpeg(datei: File, maxKante = 2200): Promise<File> {
  let quelle: Blob = datei;
  if (istHeic(datei)) {
    const heic2any = (await import('heic2any')).default;
    const ergebnis = await heic2any({ blob: datei, toType: 'image/jpeg', quality: 0.9 });
    quelle = Array.isArray(ergebnis) ? ergebnis[0] : ergebnis;
  }

  const bild = await createImageBitmap(quelle);
  const faktor = Math.min(1, maxKante / Math.max(bild.width, bild.height));
  const breite = Math.round(bild.width * faktor);
  const hoehe = Math.round(bild.height * faktor);

  const canvas = document.createElement('canvas');
  canvas.width = breite;
  canvas.height = hoehe;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Bild konnte nicht verarbeitet werden.');
  ctx.fillStyle = '#fff'; // PNGs mit Transparenz sonst schwarz
  ctx.fillRect(0, 0, breite, hoehe);
  ctx.drawImage(bild, 0, 0, breite, hoehe);
  bild.close();

  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Bild konnte nicht verarbeitet werden.');
  const basis = datei.name.replace(/\.[^.]+$/, '') || 'foto';
  return new File([blob], `${basis}.jpg`, { type: 'image/jpeg' });
}
