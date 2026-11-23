/* Banc de test minimal — exécute index.html dans jsdom, sans navigateur.
   But : prouver que la page démarre sans erreur JS et que le parseur décode
   un fichier de capture réel, trame par trame. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function crc8(buf) {
  let crc = 0;
  for (const b of buf) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0x1ff : (crc << 1) & 0x1ff;
    crc &= 0xff;
  }
  return crc & 0xff;
}

/* construit une trame valide à partir de 19 octets (CRC recalculé) */
function frame(bytes19) {
  const a = bytes19.slice();
  while (a.length < 19) a.push(0);
  return a.concat([crc8(a)]);
}

function parseCapture(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\d\d:\d\d:\d\d\.\d+\tRX ((?:[0-9A-Fa-f]{2} ?)+)$/);
    if (!m) continue;
    out.push(m[1].trim().split(/\s+/).map((h) => parseInt(h, 16)));
  }
  return out;
}

async function boot() {
  const errors = [];
  const vc = new VirtualConsole();
  // jsdom n'implémente pas canvas : l'absence de contexte est un manque du banc, pas un bug de la page
  const soft = /HTMLCanvasElement|getContext|setTransform|not implemented/i;
  vc.on('jsdomError', (e) => { const m = String(e && e.message || e); if (!soft.test(m)) errors.push(m); });
  vc.on('error', (e) => { const m = String(e); if (!soft.test(m)) errors.push(m); });
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.test/index.html',
    virtualConsole: vc,
    // jsdom n'implémente ni canvas ni scrollIntoView : on fournit des doublures minimales,
    // sinon on ne teste pas la page mais les manques du banc.
    beforeParse(win) {
      const ctx = new Proxy({}, {
        get: (t, p) => {
          if (p === 'canvas') return { width: 600, height: 200 };
          if (p === 'measureText') return () => ({ width: 10 });
          if (p === 'createLinearGradient' || p === 'createRadialGradient')
            return () => ({ addColorStop() {} });
          if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
          return typeof p === 'string' ? () => undefined : undefined;
        },
        set: () => true,
      });
      win.HTMLCanvasElement.prototype.getContext = () => ctx;
      win.Element.prototype.scrollIntoView = function () {};
    },
  });
  await new Promise((r) => setTimeout(r, 250));
  return { dom, win: dom.window, errors };
}

module.exports = { HTML, ROOT, crc8, frame, parseCapture, boot };
