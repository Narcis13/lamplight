"""Inlines src/styles.css, src/engine.js and src/ui.js into one self-contained HTML file."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
html = (src / 'index.html').read_text(encoding='utf-8')
css = (src / 'styles.css').read_text(encoding='utf-8')
js = (src / 'engine.js').read_text(encoding='utf-8') + '\n' + (src / 'ui.js').read_text(encoding='utf-8')
out = root / 'lamplight-holdem.html'
out.write_text(html.replace('/*__STYLES__*/', css).replace('/*__SCRIPT__*/', js), encoding='utf-8')
print(f'wrote {out} ({out.stat().st_size:,} bytes)')
