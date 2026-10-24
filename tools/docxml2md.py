"""Convert a Claude Docs read result (XML in JSON) into plain markdown."""
import json, sys, xml.etree.ElementTree as ET

def text_of(el):
    out = []
    for t in el.iter('text'):
        for sub in t.iter():
            if sub is t:
                if t.text:
                    out.append(t.text)
                continue
            s = ''.join(sub.itertext())
            out.append(f"**{s}**" if sub.tag == 'bold' else (f"*{s}*" if sub.tag == 'italic' else s))
    return ''.join(out)

def walk(el, lines, depth=0):
    for ch in el:
        if ch.tag == 'paragraph':
            h = ch.get('heading')
            t = text_of(ch)
            lines.append(('#' * int(h) + ' ' + t) if h else t)
            lines.append('')
        elif ch.tag == 'list':
            for i, li in enumerate(ch):
                sub = []
                walk(li, sub, depth + 1)
                body = [l for l in sub if l != '']
                mark = f"{i+1}." if ch.get('kind') == 'ordered' else '-'
                if body:
                    lines.append('  ' * depth + f"{mark} {body[0]}")
                    lines.extend('  ' * depth + '  ' + l for l in body[1:])
            lines.append('')
        elif ch.tag == 'table':
            rows = []
            for r in ch.iter('row'):
                rows.append([text_of(c).replace('|', '/') for c in r if c.tag == 'cell'])
            if not rows:
                rows = [[text_of(c) for c in r] for r in ch]
            if rows:
                lines.append('| ' + ' | '.join(rows[0]) + ' |')
                lines.append('|' + ' --- |' * len(rows[0]))
                for r in rows[1:]:
                    lines.append('| ' + ' | '.join(r) + ' |')
                lines.append('')
        else:
            walk(ch, lines, depth)

d = json.load(open(sys.argv[1]))
payload = json.loads(d[-1]['text'])
root = ET.fromstring(payload['data']['xml'])
lines = []
walk(root, lines)
open(sys.argv[2], 'w').write('\n'.join(lines))
