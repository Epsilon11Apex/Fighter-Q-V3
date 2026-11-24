/* Rejeu d'une capture dans l'application réelle (jsdom), puis vérification de l'enregistreur.
   Les trames sont fabriquées à partir des MODÈLES RÉELS relevés dans les captures du 23/11,
   avec le CRC-8 de l'application recalculé. Rien n'est inventé côté décodage : on vérifie
   que la page affiche ce que le protocole contient, et rien de plus. */
'use strict';
const { boot, frame } = require('./harness');

let fail = 0;
const ok = (c, label, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + label + (extra !== undefined ? '  → ' + extra : '')); if (!c) fail++; };
const num = (v) => (v === null || v === undefined) ? NaN : Number(v);

const SPEED_RAW = { 0: 30000, 8: 148, 15: 78, 25: 47, 41: 41 };

function f71() {
  const a = new Array(19).fill(0);
  a[0] = 0x55; a[1] = 0x71; a[3] = 3; a[5] = 0x1E; a[6] = 85; a[7] = 96;
  a[8] = 0x55; a[9] = 0x55; a[10] = 60; a[11] = 100; a[12] = 25; a[13] = 25;
  a[14] = 42; a[15] = 52; a[17] = 0; a[18] = 0x1C;
  return frame(a);
}
/* Offsets repris de la capture réelle et du générateur de démo de l'app :
   vitesse = t[15..16] (t[7..8] en est la copie), températures = t[9] et t[17],
   courant avant/arrière = t[4..5] et t[12..13]. */
function f72(raw, t9 = 14, t13 = 0) {
  const a = new Array(19).fill(0);
  a[0] = 0x55; a[1] = 0x72;
  a[7] = (raw >> 8) & 0xFF; a[8] = raw & 0xFF;
  a[9] = t9;                                   // température contrôleur (trame réelle : 0x0E)
  a[13] = t13; a[14] = 0;                      // octets non nuls seulement en roulage
  a[15] = (raw >> 8) & 0xFF; a[16] = raw & 0xFF;  // vitesse
  a[17] = 14;                                  // température contrôleur, seconde sonde
  return frame(a);
}
function f73({ max = 0, trip = 0, odo = 900, regen = 0, q = 86 } = {}) {
  const a = new Array(19).fill(0);
  a[0] = 0x55; a[1] = 0x73;
  a[4] = (Math.round(max * 10) >> 8) & 0xFF; a[5] = Math.round(max * 10) & 0xFF;
  a[6] = (Math.round(trip * 10) >> 8) & 0xFF; a[7] = Math.round(trip * 10) & 0xFF;
  a[8] = 0; a[9] = (odo >> 8) & 0xFF; a[10] = odo & 0xFF;
  a[11] = (Math.round(regen * 10) >> 8) & 0xFF; a[12] = Math.round(regen * 10) & 0xFF;
  a[13] = q; a[14] = 0; a[15] = 52; a[16] = 0; a[17] = 0xFF; a[18] = 0xFF;
  return frame(a);
}
function f52(q) {
  const a = new Array(19).fill(0);
  a[0] = 0x55; a[1] = 0x52; a[8] = q; a[9] = q; a[10] = q; a[11] = q;
  return frame(a);
}

(async () => {
  const { win, errors } = await boot();
  const FQ = win.__FQ, T = FQ.S.parser.T;

  console.log('\n[1] démarrage');
  ok(errors.length === 0, 'aucune erreur JS', errors.slice(0, 2).join(' | '));
  ok(win.TEV.SELFTEST.ok, 'auto-test protocole', win.TEV.SELFTEST.hex);

  console.log('\n[2] rejeu — arrêt, puis montée en vitesse, puis arrêt');
  FQ.feed(f71());
  ok(T.gear === 3, 'vitesse 3 active', T.gear);
  FQ.feed(f72(30000));
  ok(num(T.speed) === 0, 'repos : sentinelle 30000 → 0 km/h', T.speed);
  for (const raw of [148, 78, 47, 41]) FQ.feed(f72(raw, 14, 4));
  ok(T.speedRaw === 41, 'dernier raw = 41', T.speedRaw);
  ok(Math.abs(num(T.speed) - 59.5) < 0.06, 'vitesse décodée = 59,5 km/h', num(T.speed).toFixed(2));
  FQ.feed(f73({ max: 59.5, trip: 0.2, odo: 901, regen: 0 }));

  console.log('\n[3] ce qui est réellement transmis');
  ok(T.energyFb === 0, 'compteur régénération = 0,0 Wh (aucun freinage enregistré)', T.energyFb);
  ok(Math.abs(T.maxSpeed - 59.5) < 0.06, 'max machine = 59,5 km/h', T.maxSpeed);
  ok(T.odometer === 901, 'odomètre = 901', T.odometer);
  ok(T.soc === null || T.soc === 0, 'SOC non exploité (trame 55 52 sans tension)', T.soc);
  ok(T.maxCellTemp === null && T.minCellTemp === null, 'aucune température batterie', T.maxCellTemp);
  ok(T.gearCache[3] && T.gearCache[3].eabsLevel === 5, 'réglage E-ABS = 5/15', T.gearCache[3] && T.gearCache[3].eabsLevel);

  console.log('\n[4] trame 55 52 en stub : le quadruplet reste brut, sans interprétation');
  FQ.feed(f52(86));
  ok(Array.isArray(T.batQuad) && T.batQuad.join(',') === '86,86,86,86', 'quadruplet brut conservé', T.batQuad && T.batQuad.join(','));
  ok(T.volt === 0, 'tension 0,0 V → pas d\'affichage de tension', T.volt);
  ok(T.maxCellTemp === null, 'pas de température fabriquée à partir de ce quadruplet', T.maxCellTemp);

  console.log('\n[5] rendre l\'écran ne doit rien casser');
  let renderErr = null;
  try { FQ.render(); } catch (e) { renderErr = String(e); }
  ok(!renderErr, 'render() sans exception', renderErr);
  const spd = win.document.getElementById('spd').textContent;
  ok(spd === '60' || spd === '59', 'compteur de vitesse à l\'écran', spd);

  console.log('\n[6] enregistreur : démarrage, capture, arrêt');
  FQ.recStart();
  // on passe par feedBytes, exactement le même point d'entrée que le lien Bluetooth réel
  for (let i = 0; i < 40; i++) FQ.feedBytes(i % 2 ? f72(41, 14, 4) : f73({ max: 59.5, trip: 0.2, odo: 901, q: 86 }));
  // la ligne ETAT s'écrit une fois par seconde réelle : on laisse le temps passer
  await new Promise((r) => setTimeout(r, 1300));
  FQ.recStop();
  const body = FQ.recBody();
  const lines = body.split('\n');
  ok(FQ.S.rec.count === 40, '40 trames comptées, ni plus ni moins', FQ.S.rec.count);
  ok(body.startsWith('# Fighter Q'), 'en-tête présent', lines[0].slice(0, 40));
  ok(/# fin /.test(body), 'ligne de fin présente');
  ok(/ETAT t=/.test(body), 'lignes d\'état lisibles à l\'œil');
  ok(/regen=/.test(body), 'le compteur de régénération figure dans la ligne d\'état');
  ok(/t72_13_14=/.test(body), 'les octets candidats 55 72 t[13..14] aussi');
  ok(lines.every((l) => !/TDE|T1[A-Z0-9]{5,}/.test(l)), 'aucun identifiant apparent dans le fichier');

  console.log('\n[7] capture de 8 minutes : volume et mémoire');
  const t0 = Date.now();
  FQ.recStart();
  const N = 2160;                   // ≈ 4,5 trames/s × 480 s
  for (let i = 0; i < N; i++) FQ.feedBytes(i % 3 ? f72(41 + (i % 5), 14, 4) : f73({ max: 59.5, trip: 1.2, odo: 903, q: 86 }));
  FQ.recStop();
  const big = FQ.recBody();
  const kb = Buffer.byteLength(big, 'utf8') / 1024;
  ok(FQ.S.rec.count >= N, 'trames capturées sur 8 min simulées', FQ.S.rec.count);
  ok(kb > 150 && kb < 900, 'taille du fichier plausible', kb.toFixed(0) + ' Ko');
  ok(big.split('\n').length >= N, 'aucune ligne perdue', big.split('\n').length);
  const heap = process.memoryUsage().heapUsed / 1048576;
  ok(heap < 400, 'mémoire JS du banc', heap.toFixed(0) + ' Mo');
  console.log('    (rejeu de ' + N + ' trames en ' + (Date.now() - t0) + ' ms)');

  console.log('\n[8] brouillon : une capture interrompue doit survivre à un rechargement');
  const raw = win.localStorage.getItem('fq.rec.draft.v1');
  ok(!!raw, 'brouillon écrit dans localStorage');
  const d = JSON.parse(raw);
  ok(d.count === FQ.S.rec.count, 'nombre de trames conservé', d.count);
  ok(d.lines.length >= d.count, 'lignes conservées', d.lines.length);
  ok(d.ended === true, 'capture marquée comme terminée');

  console.log('\n[9] marquage automatique du freinage et de la régénération');
  // le marquage se déclenche sur une chute de vitesse et un compteur qui augmente,
  // évalués une fois par seconde réelle — il faut donc laisser le temps passer.
  FQ.recStart();
  FQ.feedBytes(f72(41, 14, 4));              // ~59,5 km/h
  await new Promise((r) => setTimeout(r, 1100));
  FQ.feedBytes(f72(96, 14, 4));              // ~25,8 km/h → chute de ~34 km/h
  FQ.feedBytes(f73({ max: 59.5, trip: 0.5, odo: 902, regen: 4.2, q: 86 }));
  await new Promise((r) => setTimeout(r, 1100));
  FQ.feedBytes(f73({ max: 59.5, trip: 0.5, odo: 902, regen: 7.1, q: 86 }));  // regen +2,9 Wh
  await new Promise((r) => setTimeout(r, 1100));
  FQ.recStop();
  const mbody = FQ.recBody();
  ok(/# FREIN /.test(mbody), 'un freinage (chute de vitesse) est marqué automatiquement');
  ok(/# REGEN \+/.test(mbody), 'une augmentation du compteur régénération est marquée');
  ok(mbody.indexOf('# FREIN') < mbody.indexOf('# REGEN') || /# FREIN/.test(mbody) && /# REGEN/.test(mbody),
     'les deux marqueurs sont dans le fichier');

  console.log('\n[10] estimation distance restante (immunisée contre le voltage sag)');
  // Sur cette machine, la tension pack (55 52 t[2..3]) est à 0 : le parseur rejette la trame
  // avant de remplir T.soc, mais capture le niveau brut t[8] via T.batQuad. L'estimateur doit
  // lire ce niveau relatif (100 → 91) + l énergie intégrée + la distance pour estimer les km.
  // reset de l état d estimation : les sections précédentes ont déjà observé un niveau (86).
  const St = FQ.S; St.lvl0 = null; St.lvlNow = null; St.capWh = null; St.rangeKm = null; St.rangeSrc = '';
  FQ.feedBytes(f52(100));                       // niveau de départ = 100
  // roulage avec courant moteur élevé + vitesse, sur plusieurs secondes réelles
  for (let i = 0; i < 8; i++) {
    FQ.feedBytes(f72(41, 14, 200));             // ~59,5 km/h, courant arrière 20 A
    await new Promise((r) => setTimeout(r, 1100));
  }
  FQ.feedBytes(f52(91));                        // niveau actuel = 91 → chute de 9 points
  await new Promise((r) => setTimeout(r, 300));
  const S = FQ.S;
  ok(S.lvl0 === 100, 'niveau de départ observé', S.lvl0);
  ok(S.lvlNow === 91, 'niveau actuel observé', S.lvlNow);
  ok(S.energyAcc > 0.3, 'énergie intégrée mesurée', S.energyAcc.toFixed(2) + ' Wh');
  ok(S.sessionKm > 0.1, 'distance session intégrée', S.sessionKm.toFixed(3) + ' km');
  ok(S.capWh > 0 && S.capWh < 5000, 'capacité pack auto-calibrée', S.capWh ? S.capWh.toFixed(0) + ' Wh' : 'null');
  ok(typeof S.rangeKm === 'number' && S.rangeKm > 0 && S.rangeKm < 500,
     'distance restante estimée', S.rangeKm ? S.rangeKm.toFixed(1) + ' km' : 'null');
  ok(S.rangeSrc === 'level+km', 'source de l estimation', S.rangeSrc);
  // l estimation doit être immunisée contre le sag : elle dépend de l énergie intégrée
  // sur la distance, pas du voltage instantané (qui est à 0 sur cette machine).

  console.log('\n' + (fail ? fail + ' ÉCHEC(S)' : 'tout est vert'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
