"""Builds mock4.html: three substantially different directions for Lap Timer, from real track data."""
import json, math

T = json.load(open('tracks.json'))

def proj(coords, box, pad=10, rot=False):
    """Fit lon/lat coords into box (x, y, w, h); returns SVG path d."""
    lat0 = sum(c[1] for c in coords) / len(coords)
    k = math.cos(math.radians(lat0))
    pts = [((c[0]) * k, -c[1]) for c in coords]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, y0, w, h = box
    sx = (w - 2 * pad) / (max(xs) - min(xs) or 1); sy = (h - 2 * pad) / (max(ys) - min(ys) or 1)
    s = min(sx, sy)
    ox = x0 + (w - (max(xs) - min(xs)) * s) / 2; oy = y0 + (h - (max(ys) - min(ys)) * s) / 2
    xy = [((p[0] - min(xs)) * s + ox, (p[1] - min(ys)) * s + oy) for p in pts]
    return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in xy), xy

def shared_proj(names, box, pad=24):
    allc = [c for n in names for c in T[n]['geometry']]
    lat0 = sum(c[1] for c in allc) / len(allc); k = math.cos(math.radians(lat0))
    pts = [(c[0] * k, -c[1]) for c in allc]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, y0, w, h = box
    s = min((w - 2 * pad) / (max(xs) - min(xs)), (h - 2 * pad) / (max(ys) - min(ys)))
    ox = x0 + (w - (max(xs) - min(xs)) * s) / 2; oy = y0 + (h - (max(ys) - min(ys)) * s) / 2
    out = {}
    for n in names:
        xy = [((c[0] * k - min(xs)) * s + ox, (-c[1] - min(ys)) * s + oy) for c in T[n]['geometry']]
        out[n] = ('M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in xy), xy)
    return out

def profile(el, box, fill=True):
    x0, y0, w, h = box
    dmax = el[-1]['d']; emin = min(e['elevation'] for e in el); emax = max(e['elevation'] for e in el)
    xy = [(x0 + e['d'] / dmax * w, y0 + h - (e['elevation'] - emin) / (emax - emin) * h) for e in el]
    line = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in xy)
    area = line + f' L{x0 + w:.1f} {y0 + h + 30:.1f} L{x0:.1f} {y0 + h + 30:.1f} Z'
    return line, area, xy

HC = T['Halenkovice Hill Climb']
el0 = HC['elevation']
el = []
for i in range(len(el0)):
    win = el0[max(0, i - 3):i + 4]
    el.append({'d': el0[i]['d'], 'elevation': sum(e['elevation'] for e in win) / len(win)})

ICON = {
 'map': '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
 'timer': '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
 'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
 'play': '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none"/>',
 'stop': '<rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" stroke="none"/>',
 'chev': '<path d="m9 18 6-6-6-6"/>',
 'nav': '<polygon points="12 2 19 21 12 17 5 21 12 2" fill="currentColor" stroke="none"/>',
 'again': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
 'list': '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
}
def ic(n, s=20, style=''):
    return f'<svg class="ic" width="{s}" height="{s}" viewBox="0 0 24 24" style="{style}">{ICON[n]}</svg>'

# ---------- Direction A: Timing monitor ----------
def a_nav(on):
    it = lambda k, n, l: f'<div class="a-nit {"on" if on==k else ""}">{ic(n,20)}<span>{l}</span></div>'
    return f'<div class="a-nav">{it("t","list","TRACKS")}<div class="a-drive">{ic("timer",18)}DRIVE</div>{it("m","user","ME")}</div>'

rows = [
    ('Mladcová', '2.96', '2:04.128', 'P1', '—', 'pb'),
    ('Barák', '4.67', '—', '', '3:10.870', ''),
    ('Halenk. climb', '2.00', '—', '', '—', ''),
    ('Halenk. down', '2.00', '—', '', '—', ''),
    ('Komárov', '7.29', '—', '', '—', ''),
    ('Otrokovice', '7.65', '—', '', '—', ''),
    ('Troják', '10.43', '—', '', '—', ''),
]
a_rows = ''.join(
    f'<tr><td class="a-tn">{n}<span>{km} KM</span></td><td class="a-num {c}">{t}</td><td class="a-pos">{p}</td><td class="a-num dim">{r}</td></tr>'
    for n, km, t, p, r, c in rows)

A1 = f'''<div class="phone a">
  <div class="a-top"><div class="a-h">TRACKS</div><div class="a-gps"><i></i>GPS 4 M</div></div>
  <div class="a-near"><div><div class="a-k">NEAREST · 180 M</div><div class="a-nn">MLADCOVÁ</div></div><div class="a-go">{ic("play",14)}DRIVE</div></div>
  <table class="a-t"><tr><th>TRACK</th><th>YOU</th><th>POS</th><th>RECORD</th></tr>{a_rows}</table>
  <div class="a-legend"><span class="pu">■</span> overall best <span class="gr">■</span> your best <span class="ye">■</span> slower</div>
  {a_nav("t")}
</div>'''

A2 = f'''<div class="phone a">
  <div class="a-top"><div class="a-h">MLADCOVÁ</div><div class="a-gps"><i></i>GPS 4 M</div></div>
  <div class="a-k" style="text-align:center;margin-top:22px">LAP</div>
  <div class="a-lap">1:12.4</div>
  <div class="a-k" style="text-align:center;margin-top:18px">VS YOUR BEST</div>
  <div class="a-bar"><div class="a-zero"></div><div class="a-fill" style="left:24%;width:26%"></div></div>
  <div class="a-delta gr">−0.42</div>
  <div class="a-secs"><div class="a-sec pu"><b>S1</b>41.36</div><div class="a-sec gr"><b>S2</b>−0.31</div><div class="a-sec off"><b>S3</b>—</div></div>
  <div class="a-prog"><div class="a-pf" style="width:62%"></div><i style="left:33.3%"></i><i style="left:66.6%"></i></div>
  <div class="a-pl"><span>1.84 KM</span><span>94 KM/H</span><span>2.96 KM</span></div>
  <div class="a-stop">{ic("stop",14)}STOP</div>
</div>'''

A3 = f'''<div class="phone a">
  <div class="a-top"><div class="a-h">CLASSIFICATION</div><div class="a-k" style="margin:0">MLADCOVÁ</div></div>
  <div class="a-res"><div class="a-p">P1</div><div><div class="a-k">YOUR TIME</div><div class="a-rt pu">2:03.710</div><div class="a-k gr" style="margin:2px 0 0">−0.418 PERSONAL BEST</div></div></div>
  <table class="a-t a-cls"><tr><th></th><th>S1</th><th>S2</th><th>S3</th></tr>
    <tr><td class="a-tn">THIS RUN</td><td class="a-num pu">41.20</td><td class="a-num pu">47.10</td><td class="a-num ye">35.41</td></tr>
    <tr><td class="a-tn">YOUR BEST</td><td class="a-num dim">41.36</td><td class="a-num dim">47.32</td><td class="a-num dim">34.04</td></tr>
    <tr><td class="a-tn">P2 MÁRA</td><td class="a-num dim">43.39</td><td class="a-num dim">47.47</td><td class="a-num dim">50.16</td></tr></table>
  <div class="a-btns" style="position:static;margin:22px 18px 0"><div class="a-go big">{ic("again",18)}DRIVE AGAIN</div><div class="a-sec2">COMPARE WITH P2</div></div>
  {a_nav("")}
</div>'''

# ---------- Direction B: Stage book ----------
stages = [('SS1', 'Mladcová', 2.96, '2:04.128', 'P1 of 2'), ('SS2', 'Halenkovice Hill Climb', 2.00, None, None), ('SS3', 'Barák', 4.67, None, 'Record 3:10.870'), ('SS4', 'Troják', 10.43, None, None)]
def b_card(code, name, km, best, sub):
    d, _ = proj(T[name]['geometry'], (0, 0, 92, 92), pad=8)
    extra = ''
    if name == 'Halenkovice Hill Climb':
        extra = '<div class="b-climb">+130 m climb</div>'
    t = f'<div class="b-time">{best}</div><div class="b-sub">{sub}</div>' if best else f'<div class="b-none">{sub or "No time yet"}</div>'
    return f'''<div class="b-card"><svg width="92" height="92" class="b-route"><path d="{d}" /></svg>
      <div class="b-mid"><div class="b-code">{code}</div><div class="b-name">{name}</div><div class="b-km">{km:.2f} km</div>{extra}</div>
      <div class="b-right">{t}</div></div>'''

def b_nav(on):
    it = lambda k, n, l: f'<div class="b-nit {"on" if on==k else ""}">{ic(n,20)}<span>{l}</span></div>'
    return f'<div class="b-nav">{it("t","map","Stages")}<div class="b-drive">{ic("timer",18)}Drive</div>{it("m","user","Me")}</div>'

B1 = f'''<div class="phone b">
  <div class="b-head"><div class="b-kick">Zlín hills · 7 stages</div><div class="b-h">Stages</div></div>
  <div class="b-near">At the start of <b>SS1 Mladcová</b><span class="b-go">{ic("play",12)}Drive</span></div>
  {''.join(b_card(*s) for s in stages)}
  {b_nav("t")}
</div>'''

line, area, pxy = profile(el, (18, 120, 354, 150))
idx = int(len(pxy) * 0.58); gidx = int(len(pxy) * 0.52)
me = pxy[idx]; gh = pxy[gidx]
B2 = f'''<div class="phone b dark">
  <div class="b-dtop"><span>SS2 · Halenkovice Hill Climb</span><span class="b-ok">GPS 4 m</span></div>
  <svg width="390" height="300" class="b-prof">
    <path d="{area}" class="b-area"/><path d="{line}" class="b-line"/>
    <line x1="{18+354/3:.1f}" y1="110" x2="{18+354/3:.1f}" y2="290" class="b-split"/><line x1="{18+2*354/3:.1f}" y1="110" x2="{18+2*354/3:.1f}" y2="290" class="b-split"/>
    <circle cx="{gh[0]:.1f}" cy="{gh[1]:.1f}" r="7" class="b-ghost"/>
    <circle cx="{me[0]:.1f}" cy="{me[1]:.1f}" r="9" class="b-me"/>
    <text x="{me[0]:.1f}" y="{me[1]-18:.1f}" class="b-mel">YOU</text>
    <text x="{gh[0]-6:.1f}" y="{gh[1]+28:.1f}" class="b-ghl">BEST</text>
    <text x="22" y="292" class="b-ax">202 m</text><text x="368" y="108" class="b-ax" text-anchor="end">332 m</text>
  </svg>
  <div class="b-dd"><div class="b-dl">ahead of your best</div><div class="b-dv">−0.42</div></div>
  <div class="b-dt"><span>Stage time</span><b>1:02.4</b></div>
  <div class="b-dt"><span>Next split</span><b>1.33 km</b></div>
  <div class="b-stop">{ic("stop",14)}Stop</div>
</div>'''

B3 = f'''<div class="phone b">
  <div class="b-head"><div class="b-kick">Time card</div><div class="b-h">SS1 Mladcová</div></div>
  <div class="b-card2">
    <div class="b-tc"><span>Stage time</span><b>2:03.710</b></div>
    <div class="b-stamp">Personal best<br>−0.418</div>
    <div class="b-rule"></div>
    <div class="b-tr"><span>Split 1</span><b>41.20</b><i class="gr">−0.16</i></div>
    <div class="b-tr"><span>Split 2</span><b>47.10</b><i class="gr">−0.22</i></div>
    <div class="b-tr"><span>Split 3</span><b>35.41</b><i class="rd">+1.37</i></div>
    <div class="b-rule"></div>
    <div class="b-tr"><span>Leaderboard</span><b>P1</b><i>of 2</i></div>
  </div>
  <div class="b-btns"><div class="b-go big">{ic("again",18)}Run it again</div><div class="b-sec">Where did I gain time?</div></div>
  {b_nav("")}
</div>'''

# ---------- Direction C: Map first ----------
names = list(T.keys())
mp = shared_proj(names, (0, 0, 390, 520), pad=30)
paths = ''.join(f'<path d="{mp[n][0]}" class="c-r {"c-sel" if n=="Mladcová" else ""}"/>' for n in names)
labels = ''
for n in names:
    x, y = mp[n][1][len(mp[n][1]) // 2]
    t = {'Mladcová': '2:04.1'}.get(n)
    short = n.replace('Halenkovice Hill Climb', 'Halenkovice').replace('Halenkovice Downhill', '').replace('Otrokovice Sprint', 'Otrokovice')
    if not short: continue
    text = short + (' · ' + t if t else '')
    wdt = len(text) * 7.4 + 16
    x = min(x, 390 - wdt - 14)
    labels += f'<g transform="translate({x:.0f},{y:.0f})"><rect x="6" y="-12" rx="5" width="{wdt:.0f}" height="24" class="c-lb {"c-lbs" if n=="Mladcová" else ""}"/><text x="14" y="4" class="c-lt">{text}</text></g>'

def c_nav(on):
    it = lambda k, n, l: f'<div class="c-nit {"on" if on==k else ""}">{ic(n,20)}<span>{l}</span></div>'
    return f'<div class="c-nav">{it("t","map","Map")}<div class="c-drive">{ic("timer",18)}Drive</div>{it("m","user","Me")}</div>'

C1 = f'''<div class="phone c">
  <svg width="390" height="560" class="c-map"><defs><pattern id="g" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#1d2126" stroke-width="1"/></pattern></defs><rect width="390" height="560" fill="#111418"/><rect width="390" height="560" fill="url(#g)"/>{paths}{labels}<circle cx="{mp["Mladcová"][1][0][0]:.0f}" cy="{mp["Mladcová"][1][0][1]:.0f}" r="7" fill="#3b82f6" stroke="#fff" stroke-width="2.5"/></svg>
  <div class="c-search">7 tracks around Zlín</div>
  <div class="c-sheet"><div class="c-grab"></div>
    <div class="c-row"><div style="flex:1"><div class="c-k">You are at the start</div><div class="c-n">Mladcová</div><div class="c-m">2.96 km · best <b>2:04.128</b> · P1</div></div><div class="c-go">{ic("play",16)}Drive</div></div>
  </div>
  {c_nav("t")}
</div>'''

dm, dxy = proj(T['Mladcová']['geometry'], (0, 0, 390, 780), pad=-260)
car = dxy[int(len(dxy) * 0.55)]
done = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in dxy[:int(len(dxy) * 0.55) + 1])
C2 = f'''<div class="phone c">
  <svg width="390" height="780" class="c-map" viewBox="{car[0]-195:.0f} {car[1]-470:.0f} 390 780"><rect x="{car[0]-600:.0f}" y="{car[1]-900:.0f}" width="1200" height="1800" fill="#111418"/><path d="{dm}" class="c-ahead"/><path d="{done}" class="c-done"/><g transform="translate({car[0]:.1f},{car[1]:.1f})"><circle r="16" fill="#3b82f6" opacity=".25"/><circle r="9" fill="#3b82f6" stroke="#fff" stroke-width="3"/></g></svg>
  <div class="c-pill gr"><span>vs best</span><b>−0.42</b></div>
  <div class="c-hud"><div><span>Time</span><b>1:12.4</b></div><div><span>Speed</span><b>94</b></div><div><span>Left</span><b>1.12 km</b></div></div>
  <div class="c-stopw">{ic("stop",14)}Stop</div>
</div>'''

segs = ''
xy = dxy
n = len(xy)
pattern = [1,1,0,1,1,1,0,0,1,1,1,0,1,1,1,1,0,1,1,0]
for i in range(len(pattern)):
    a = int(i * (n - 1) / len(pattern)); b = int((i + 1) * (n - 1) / len(pattern))
    d = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in xy[a:b + 1])
    segs += f'<path d="{d}" class="{"c-gain" if pattern[i] else "c-loss"}"/>'
fm, fxy = proj(T['Mladcová']['geometry'], (40, 150, 310, 330), pad=6)
segs2 = ''
for i in range(len(pattern)):
    a = int(i * (len(fxy) - 1) / len(pattern)); b = int((i + 1) * (len(fxy) - 1) / len(pattern))
    d = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in fxy[a:b + 1])
    segs2 += f'<path d="{d}" class="{"c-gain" if pattern[i] else "c-loss"}"/>'
C3 = f'''<div class="phone c">
  <svg width="390" height="560" class="c-map"><rect width="390" height="560" fill="#111418"/><rect width="390" height="560" fill="url(#g)"/>{segs2}</svg>
  <div class="c-top3"><div class="c-k">Mladcová · new personal best</div><div class="c-big">2:03.710</div><div class="c-m"><b class="gr">−0.418</b> · P1 of 2</div></div>
  <div class="c-key"><span><i class="g"></i>gained on your best</span><span><i class="l"></i>lost</span></div>
  <div class="c-sheet"><div class="c-grab"></div><div class="c-row" style="gap:10px"><div class="c-go" style="flex:1;justify-content:center">{ic("again",16)}Drive again</div><div class="c-sec">Replay</div></div></div>
  {c_nav("")}
</div>'''

def section(title, chars, tradeoff, phones, captions):
    caps = ''.join(f'<div><div class="cap">{c}</div>{p}</div>' for c, p in zip(captions, phones))
    return f'''<section><div class="dir"><h2>{title}</h2><div class="chars">{chars}</div><div class="trade"><b>Tradeoff</b> {tradeoff}</div></div><div class="grid">{caps}</div></section>'''

html = open('mock4.css.html').read()
html += section('A · Timing monitor', 'Motorsport pit-wall language. Condensed uppercase type, pure black, dense timing sheet. Colour follows the racing convention: <span class="pu">purple</span> overall best, <span class="gr">green</span> your best, <span class="ye">yellow</span> slower. The interaction that matters: the delta bar grows left (faster) or right (slower) from the centre, readable from the corner of the eye.',
                'Feels like real racing and packs the most information; newcomers must learn the colour code (a legend is always shown).',
                [A1, A2, A3], ['Tracks as a timing sheet', 'Driving: lap, delta bar, sectors, progress', 'Classification after the run'])
html += section('B · Stage book', 'Rally roadbook language. Each track is a numbered stage with its real route shape, length and climb. Light paper for browsing, dark for driving. Editorial headline type, mono numbers. The interaction that matters: you and your best run move along the real elevation profile, so you see where you are and how far ahead.',
                'Most distinctive and built from the tracks themselves; needs a light and a dark theme and more drawing work (profiles exist for every track once elevation is filled in).',
                [B1, B2, B3], ['Stages with real route shapes', 'Driving on the elevation profile, you vs best', 'Time card after the stage'])
html += section('C · Map first', 'The map is the app. Every track is drawn where it really is; the nearest one sits in a bottom sheet with Drive. While driving, the map follows you with the road ahead, and a pill shows the gap. After the run, the route is painted green where you gained and red where you lost.',
                'Easiest to grasp (everyone knows map apps) and shows where to go; the map competes for attention while driving and needs map data, so the numbers are smaller.',
                [C1, C2, C3], ['Map of all tracks, nearest in the sheet', 'Driving: follow map, gap pill, small HUD', 'Result painted on the route'])
html += '</body></html>'
open('mock4.html', 'w').write(html)
print('ok', len(html))
