#!/usr/bin/env python3
import re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROBE = "<script>window.addEventListener('load',()=>setTimeout(()=>{const out=[];document.querySelectorAll('.pg').forEach((p,i)=>{const pr=p.getBoundingClientRect();let worst=0;p.querySelectorAll('*').forEach(e=>{if(e.closest('.run'))return;const r=e.getBoundingClientRect();if(r.height===0)return;const over=r.bottom-(pr.bottom-12*3.78);if(over>worst)worst=over;});if(worst>1)out.push((i+1)+':'+Math.round(worst));});document.body.setAttribute('data-over',out.join(' ')||'none');},500));</script>"

html = (HERE / 'doc.html').read_text().replace('</body>', PROBE + '</body>')
out = HERE / 'doc-overflow-probe.html'
out.write_text(html)
dom = subprocess.run(['google-chrome', '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1123,794', '--virtual-time-budget=8000', '--dump-dom', out.as_uri()], capture_output=True, text=True).stdout
out.unlink()
m = re.search(r'data-over="([^"]*)"', dom)
print('overflow:', m.group(1) if m else 'probe failed')
sys.exit(0 if m and m.group(1) == 'none' else 1)
