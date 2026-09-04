#!/usr/bin/env python3
"""Colosseum Copilot pull for DarkBook pivot research. Writes raw JSON + prints summary."""
import json, os, re, sys, urllib.request

OUT = '/Users/kamal/Desktop/solana/research/pivot/raw'
os.makedirs(OUT, exist_ok=True)
B = 'https://copilot.colosseum.com/api/v1'
T = re.search(r'COLOSSEUM_COPILOT_PAT=["\']?([^"\'\s]+)', open(os.path.expanduser('~/.zshrc')).read()).group(1)

def call(path, body=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': 'Bearer ' + T, 'content-type': 'application/json', 'User-Agent': 'curl/8.7.1'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)

def save(name, obj):
    json.dump(obj, open(f'{OUT}/{name}.json', 'w'), indent=1)

what = sys.argv[1] if len(sys.argv) > 1 else 'all'

if what in ('all', 'similar'):
    q = sys.argv[2] if len(sys.argv) > 2 else 'size-private perpetuals order book on Solana, hidden order size commitment, MagicBlock ephemeral rollup matching, MEV protection for large traders'
    d = call('/search/projects', {'query': q, 'limit': 12, 'diversify': True})
    save('similar-' + re.sub(r'\W+', '-', q[:30]), d)
    print('=== SIMILAR keys', list(d.keys()))
    for p in d.get('results') or d.get('projects') or []:
        print(f"{str(p.get('name','?'))[:28]:<28} sim={p.get('similarity', p.get('score','?'))} | {str(p.get('hackathon', p.get('hackathonName','')))[:20]:<20} | prize={p.get('prize') or p.get('prizeInfo') or p.get('placement') or p.get('winner') or '-'} | {str(p.get('oneLiner') or p.get('tagline') or p.get('description',''))[:100]}")
    print('meta', {k: v for k, v in d.items() if k not in ('results', 'projects')})

if what in ('all', 'compare'):
    c = call('/compare', {'cohortA': {'winnersOnly': True}, 'cohortB': {}, 'dimensions': ['problemTags', 'solutionTags', 'primitives'], 'topK': 10})
    save('compare-winners', c)
    print('=== COMPARE'); print(json.dumps(c, indent=0)[:3000])

if what in ('all', 'filters'):
    f = call('/filters')
    save('filters', f)
    print('=== FILTERS keys', list(f.keys()))
    cl = f.get('clusters') or []
    print(json.dumps(cl[:40], indent=0)[:3500])
