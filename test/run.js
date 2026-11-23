/* Vérifie que la page démarre sans erreur et que le parseur ne fabrique rien. */
'use strict';
const { boot, frame, crc8 } = require('./harness');

let fail = 0;
const ok = (cond, label, extra) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra !== undefined ? '  → ' + extra : ''));
  if (!cond) fail++;
};

(async () => {
  const { win, errors } = await boot();
  console.log('\n[1] démarrage de la page');
  ok(errors.length === 0, 'aucune erreur JS au chargement', errors.slice(0, 3).join(' | '));
  ok(!!win.TEV, 'objet TEV exposé');
  ok(!!win.__FQ && !!win.__FQ.S, 'point d\'accès __FQ.S exposé');
  ok(win.TEV.SELFTEST.ok === true, 'auto-test protocole', win.TEV.SELFTEST.hex);

  const P = new win.TEV.Parser();

  console.log('\n[2] parseur — trame 55 71 authentique (CRC vérifié 0xBD)');
  const f71 = [0x55, 0x71, 0x00, 0x03, 0x00, 0x1e, 0x55, 0x96, 0x55, 0x55, 0x3c, 0x64, 0x19, 0x19, 0x2a, 0x34, 0x00, 0x00, 0x1c, 0xbd];
  P.parse(f71);
  const T = P.T;
  ok(T.have71 === true, 'trame acceptée');
  ok(T.gear === 3, 'gear = 3', T.gear);
  ok(Math.abs(T.cfg.wheel - 8.5) < 1e-9, 'roue = 8,5 pouces', T.cfg.wheel);
  ok(T.cfg.speedLimit === 100, 'limite = 100', T.cfg.speedLimit);
  ok(T.cfg.packVolt === 52, 'tension pack configurée = 52', T.cfg.packVolt);

  console.log('\n[3] E-ABS : niveau lu dans t[9], drapeau lu dans t[4]');
  const g = T.gearCache[3];
  ok(g && g.eabsLevel === 5, 'niveau E-ABS = 5 (quartet haut de t[9])', g && g.eabsLevel);
  ok(T.cfg.abs === false, 'drapeau t[4] bit 3 = 0 (≠ réglage)', T.cfg.abs);

  console.log('\n[4] 55 52 : aucun décodage de température batterie');
  const f52 = frame([0x55, 0x52, 0x00, 0x00, 0x00, 0x56, 0x00, 0x00, 0x56, 0x56, 0x56, 0x56]);
  P.parse(f52);
  ok(Array.isArray(T.batQuad) && T.batQuad.join(',') === '86,86,86,86', 'quadruplet brut conservé', T.batQuad && T.batQuad.join(','));
  ok(T.soc === 0, 'trame rejetée : SOC non exposé (la tension est invalide)', T.soc);
  ok(T.volt === 0, 'tension 0,0 V → trame rejetée (pas de BMS)', T.volt);
  ok(T.maxCellTemp === null, 'aucune température de cellule inventée', T.maxCellTemp);

  console.log('\n[5] 55 72 : vitesse sentinelle et calcul');
  P.parse(frame([0x55, 0x72, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x75, 0x30, 0, 0, 0]));
  ok(T.speed === 0, 'sentinelle raw=30000 → 0 km/h', T.speed);
  P.parse(frame([0x55, 0x72, 0, 0, 0, 0, 0, 0, 0, 0x29, 0, 0, 0, 0x0e, 0x06, 0x00, 0x29, 0, 0, 0]));
  ok(T.speedRaw === 0x29, 'raw = 41', T.speedRaw);
  ok(Math.abs(T.speed - 59.5) < 0.06, 'vitesse = 59,5 km/h (max machine vérifié)', T.speed);

  console.log('\n[6] 55 73 : trajet, max, compteur de régénération');
  P.parse(frame([0x55, 0x73, 0, 0, 0x02, 0x2a, 0, 0x02, 0, 0x03, 0x85, 0, 0, 0x58, 0, 0x34, 0, 0xff, 0xff, 0]));
  ok(Math.abs(T.maxSpeed - 55.4) < 0.06, 'max machine = 55,4 km/h', T.maxSpeed);
  ok(Math.abs(T.trip - 0.2) < 1e-9, 'trajet = 0,2 km', T.trip);
  ok(T.odometer === 901, 'odomètre = 901', T.odometer);
  ok(T.energyFb === 0, 'compteur régénération = 0,0 Wh', T.energyFb);

  console.log('\n[7] CRC : une trame corrompue doit être rejetée par le transport');
  const bad = frame([0x55, 0x73, 0, 0, 1, 2, 3]);
  bad[19] = (bad[19] + 1) & 0xff;
  ok(crc8(bad.slice(0, 19)) !== bad[19], 'CRC altéré détecté', bad[19].toString(16));

  console.log('\n' + (fail ? fail + ' ÉCHEC(S)' : 'tout est vert'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
