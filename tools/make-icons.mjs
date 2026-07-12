import Jimp from 'jimp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const quelle = path.join(root, 'assets', 'logo-roh.png');
const ziel = path.join(root, 'public', 'icons');
fs.mkdirSync(ziel, { recursive: true });

let bild;
if (fs.existsSync(quelle)) {
  bild = await Jimp.read(quelle);
  bild.cover(1024, 1024);
} else {
  bild = new Jimp(1024, 1024, '#c7431f');
  const font = await Jimp.loadFont(Jimp.FONT_SANS_128_WHITE);
  bild.print(font, 0, 0, {
    text: 'NJ',
    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
    alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
  }, 1024, 1024);
}

for (const groesse of [512, 192, 180]) {
  await bild.clone().resize(groesse, groesse).writeAsync(path.join(ziel, `icon-${groesse}.png`));
}
console.log('Icons erstellt:', ziel);
