#!/usr/bin/env python3
"""Analyse complète de la capture de 8 min du 24/11.
Décode le régénération (energyFb = u16(t,11)*0.1 de 55 73), la vitesse (55 72),
les températures contrôleur (55 72 t[9]/t[17]), et cherche la corrélation
entre freinage (chute de vitesse) et octets candidats. Ne rien inventer."""
import re, sys
from collections import defaultdict

PATH = '/tmp/arena-coding-uploads/fighter-q-capture-2026-11-24T08-20-10.txt'

def crc8(data):
    crc = 0
    for b in data:
        crc ^= b & 0xFF
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0x1FF if (crc & 0x80) else ((crc << 1) & 0x1FF)
        crc &= 0xFF
    return crc & 0xFF

frames = []      # (ts_str, sec_float, [bytes])
etat = []        # (ts_str, sec, dict)
for line in open(PATH, encoding='utf-8'):
    m = re.match(r'^(\d\d):(\d\d):(\d\d)\.(\d+)\tRX ((?:[0-9A-Fa-f]{2} ?)+)$', line)
    if m:
        h, mi, s, ms, _hex = m.groups()
        sec = int(h)*3600 + int(mi)*60 + int(s) + int(ms[:3])/1000.0
        b = [int(x, 16) for x in _hex.split()]
        frames.append((m.group(0).split('\t')[0], sec, b))
        continue
    m = re.match(r'^(\d\d):(\d\d):(\d\d)\.(\d+)\tETAT (.*)$', line)
    if m:
        h, mi, s, ms, _body = m.groups()
        sec = int(h)*3600 + int(mi)*60 + int(s) + int(ms[:3])/1000.0
        d = {}
        for part in _body.split('|'):
            part = part.strip()
            if '=' in part:
                k, v = part.split('=', 1)
                d[k.strip()] = v.strip()
        etat.append((m.group(0).split('\t')[0], sec, d))

print(f"trames RX : {len(frames)}   lignes ETAT : {len(etat)}")
print(f"durée : {etat[0][1]:.0f}s → {etat[-1][1]:.0f}s = {(etat[-1][1]-etat[0][1])/60:.1f} min")

# ---- distribution des types de trames ----
by = defaultdict(int)
for _, _, b in frames:
    by[f"55 {b[1]:02X}"] += 1
print("\ntypes de trames :", dict(sorted(by.items())))

# ---- vérification CRC ----
bad = 0
for _, _, b in frames:
    if crc8(b[:19]) != b[19]:
        bad += 1
print(f"trames CRC invalides : {bad}")

# ---- vitesse ----
def speed(t):
    raw = (t[15] << 8) | t[16]
    if raw >= 3000 or raw == 0:
        return 0.0, raw
    return round(287.0 * 8.5 / raw, 1), raw

# ---- regen : energyFb = u16(t,11)*0.1 ----
def regen(t):
    return ((t[11] << 8) | t[12]) * 0.1

# ---- températures contrôleur ----
def temps(t):
    return t[9], t[17]

# ---- états utiles ----
speeds = [(ts, sec, speed(b)) for ts, sec, b in frames if b[1] == 0x72]
regens = [(ts, sec, regen(b)) for ts, sec, b in frames if b[1] == 0x73]
cfgs   = [(ts, sec, b) for ts, sec, b in frames if b[1] == 0x71]
bat    = [(ts, sec, b) for ts, sec, b in frames if b[1] == 0x52]

print(f"\ntrames 55 72 (vitesse) : {len(speeds)}")
print(f"trames 55 73 (compteur) : {len(regens)}")

# vitesse max observée
vs = [s for _, _, (s, _) in speeds]
print(f"vitesse max observée : {max(vs)} km/h")

# regen : valeurs distinctes
rv = sorted({round(r, 1) for _, _, r in regens})
print(f"compteur regen valeurs distinctes : {rv}")

# ---- regen au cours du temps (montée ?) ----
print("\n--- regen aux points de repère ---")
for ts, sec, r in regens[:3] + regens[len(regens)//4:len(regens)//4+3] + regens[-3:]:
    print(f"  {ts}  t={sec:.0f}s  regen={r}")

# ---- détection des freinages (chute de vitesse) ----
print("\n--- décélérations (chute >= 5 km/h entre deux 55 72) ---")
prev = None
events = []
for ts, sec, (s, raw) in speeds:
    if prev is not None:
        pts, psec, praw, ps = prev
        drop = ps - s
        if drop >= 5 and ps >= 5:
            events.append((psec, sec, ps, s, drop))
            print(f"  {pts} → {ts}  v {ps}→{s}  chute {drop:.1f} km/h")
    prev = (ts, sec, raw, s)

print(f"\n{len(events)} évents de décélération détectés")

# ---- pour chaque événement : regen + t[13..14] autour ----
print("\n--- corrélation : octets autour de chaque freinage ---")
bysec = {}
for ts, sec, b in frames:
    bysec.setdefault(round(sec, 1), b)

for i, (psec, sec, ps, s, drop) in enumerate(events, 1):
    # fenêtre [sec-2 .. sec+2]
    win = []
    for sx in range(int(psec)-2, int(sec)+3):
        b = bysec.get(sx)
        if b and b[1] == 0x73:
            win.append((sx, f"73 t11..12={b[11]:02X}{b[12]:02X} regen={regen(b)} t13={b[13]:02X}"))
        elif b and b[1] == 0x72:
            win.append((sx, f"72 t13={b[13]:02X} t14={b[14]:02X} t9={b[9]:02X}"))
    print(f"\n  freinage {i}: v {ps}→{s} @ t={psec:.0f}s")
    for sx, s in win:
        print(f"    t={sx}s  {s}")

# ---- t[13..14] de 55 72 : valeurs en roulage vs au repos ----
print("\n--- 55 72 t[13..14] : valeurs selon la vitesse ---")
t13_vals = defaultdict(set)
for ts, sec, b in frames:
    if b[1] == 0x72:
        s, _ = speed(b)
        bucket = "repos (v<1)" if s < 1 else ("lent (1-10)" if s < 10 else ("moyen (10-30)" if s < 30 else "rapide (>30)"))
        t13_vals[bucket].add((b[13], b[14]))
for k in ["repos (v<1)", "lent (1-10)", "moyen (10-30)", "rapide (>30)"]:
    if t13_vals[k]:
        print(f"  {k}: {sorted(t13_vals[k])}")

# ---- t[9]/t[17] températures contrôleur ----
print("\n--- températures contrôleur (55 72 t[9] / t[17]) ---")
t9 = [b[9] for _, _, b in frames if b[1] == 0x72]
t17 = [b[17] for _, _, b in frames if b[1] == 0x72]
print(f"  t[9]  : min {min(t9)} max {max(t9)} (début {t9[0]}, fin {t9[-1]})")
print(f"  t[17] : min {min(t17)} max {max(t17)} (début {t17[0]}, fin {t17[-1]})")

# ---- bat quad 55 52 ----
print("\n--- 55 52 t[8..11] (valeur partagée) ---")
quad = []
for ts, sec, b in bat:
    quad.append((sec, [b[8], b[9], b[10], b[11]]))
if quad:
    print(f"  début {quad[0]}  fin {quad[-1]}")
    distinct = sorted({tuple(q[1]) for q in quad})
    print(f"  valeurs distinctes : {distinct}")

# ---- trip / odo ----
print("\n--- odomètre / trajet ---")
print(f"  début ETAT : {etat[0][2].get('odo')} / {etat[0][2].get('trip')}")
print(f"  fin   ETAT : {etat[-1][2].get('odo')} / {etat[-1][2].get('trip')}")
