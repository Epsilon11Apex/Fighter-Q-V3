#!/usr/bin/env python3
"""Question précise : y a-t-il un signal de FREINAGE (régénération) dans la capture ?
On compare, pour chaque événement de décélération, les octets 55 72 t[13..14] et
toutes les trames 55 73, avec les événements d'ACCÉLERATION, pour voir si un octet
réagit au freinage spécifiquement. Ne rien inventer : on mesure la corrélation."""
import re
from collections import defaultdict

PATH = '/tmp/arena-coding-uploads/fighter-q-capture-2026-11-24T08-20-10.txt'

frames = []
for line in open(PATH, encoding='utf-8'):
    m = re.match(r'^(\d\d):(\d\d):(\d\d)\.(\d+)\tRX ((?:[0-9A-Fa-f]{2} ?)+)$', line)
    if m:
        h, mi, s, ms, hx = m.groups()
        sec = int(h)*3600 + int(mi)*60 + int(s) + int(ms[:3])/1000.0
        frames.append((sec, [int(x, 16) for x in hx.split()]))

speeds = [(sec, b) for sec, b in frames if b[1] == 0x72]

def speed(b):
    raw = (b[15] << 8) | b[16]
    if raw >= 3000 or raw == 0:
        return 0.0
    return 287.0 * 8.5 / raw

def regen(b):
    return ((b[11] << 8) | b[12]) * 0.1

# --- détecter accélérations et décélérations ---
events = []   # (sec, v_avant, v_apres, type)
prev = None
for sec, b in speeds:
    v = speed(b)
    if prev is not None:
        psec, pv = prev
        d = v - pv
        if d <= -5 and pv >= 5:
            events.append((psec, sec, pv, v, 'decel'))
        elif d >= 5 and v >= 5:
            events.append((psec, sec, pv, v, 'accel'))
    prev = (sec, v)

print(f"événements : {len(events)}  ({sum(1 for e in events if e[4]=='decel')} décélérations, "
      f"{sum(1 for e in events if e[4]=='accel')} accélérations)")

# --- octets 55 72 t[13..14] autour de chaque événement ---
bysec = {}
for sec, b in frames:
    bysec.setdefault(round(sec, 1), b)

def window(psec, sec):
    """recueille les t[13..14] des 55 72 et les regen des 55 73 dans [psec-1, sec+1]"""
    out = []
    for sx in range(int(psec)-1, int(sec)+2):
        b = bysec.get(sx)
        if not b: continue
        if b[1] == 0x72:
            out.append(f"72 t13={b[13]:02X} t14={b[14]:02X}")
        elif b[1] == 0x73:
            out.append(f"73 regen={regen(b)} t11..12={b[11]:02X}{b[12]:02X}")
    return out

print("\n--- décélérations : octets dans la fenêtre ---")
for e in [e for e in events if e[4] == 'decel']:
    psec, sec, pv, v, _ = e
    print(f"  v {pv:.0f}→{v:.0f} @{psec:.0f}s : " + " | ".join(window(psec, sec)))

print("\n--- accélérations : octets dans la fenêtre ---")
for e in [e for e in events if e[4] == 'accel']:
    psec, sec, pv, v, _ = e
    print(f"  v {pv:.0f}→{v:.0f} @{psec:.0f}s : " + " | ".join(window(psec, sec)))

# --- regen : toutes les valeurs distinctes sur la session ---
rv = sorted({round(regen(b), 1) for sec, b in frames if b[1] == 0x73})
print(f"\nvaleurs distinctes du compteur regen (55 73 t[11..12]) sur toute la session : {rv}")

# --- t[13..14] : relation t14/t13 ---
ratios = []
for sec, b in frames:
    if b[1] == 0x72 and b[13] > 0:
        ratios.append(round(b[14] / b[13], 3))
if ratios:
    from statistics import mean
    print(f"\nratio t14/t13 : moyenne {mean(ratios):.3f}, min {min(ratios)}, max {max(ratios)}")

# --- t[13] de 55 73 (partagé avec bat) : vérifier qu'il correspond au quad 55 52 ---
mismatch = 0
ok = 0
for sec, b in frames:
    if b[1] == 0x73:
        # chercher la 55 52 proche
        best = None
        for sec2, b2 in frames:
            if b2[1] == 0x52 and abs(sec2 - sec) < 2:
                best = b2; break
        if best:
            if best[8] == b[13]:
                ok += 1
            else:
                mismatch += 1
print(f"\n55 73 t[13] vs 55 52 t[8] : égaux {ok} fois, différents {mismatch} fois")

# --- le quad 55 52 décroît : preuve de décharge ---
quad = []
for sec, b in frames:
    if b[1] == 0x52:
        quad.append((sec, b[8]))
print(f"\nquad 55 52 t[8] : début {quad[0]}, fin {quad[-1]}, min {min(q[1] for q in quad)}, max {max(q[1] for q in quad)}")
print(f"  monotone décroissant ? {all(quad[i][1] >= quad[i+1][1] for i in range(len(quad)-1))}")
