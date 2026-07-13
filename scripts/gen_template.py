"""Generate the blank ACORD 25 template assets from the supplied sample PDF.

Strips the sample's variable data (white rectangles) while leaving the official
ACORD 25 form structure untouched, then writes:
  public/acord25-blank.pdf  -> used by lib/acordPdf.js to produce output PDFs
  public/acord25-blank.png  -> on-screen background for components/AcordOverlay.js

Requires: pip install pymupdf
Run from the project root:  python scripts/gen_template.py
"""

import os
import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "COI TRUCK SOLUTION .PDF")
PUB = os.path.join(ROOT, "public")

# Tight rectangles (x0,y0,x1,y1) in PDF points covering ONLY the sample's
# variable data — the static ACORD 25 form structure is left untouched.
DATA_RECTS = [
    [515, 50.5, 591, 64],       # date
    [55, 145, 305, 183],        # producer name + address
    [354, 135.5, 483, 147],     # contact name
    [354, 148, 483, 159],       # phone
    [512, 148, 588, 159],       # fax
    [354, 160, 485, 171.5],     # email
    [350, 184, 534, 196],       # insurer A name
    [538, 184, 591, 196],       # insurer A naic
    [350, 196.5, 534, 208],     # insurer B name
    [538, 196.5, 591, 208],     # insurer B naic
    [258, 256.5, 360, 265.8],   # certificate number
    [510, 256.5, 546, 265.8],   # revision number
    [55, 205, 305, 243],        # insured name + address
    [20, 412.5, 33, 424],       # INSR LTR (auto)
    [213, 412.5, 309, 424],     # auto policy number
    [331, 413, 377, 424],       # auto eff
    [379, 413, 424, 424],       # auto exp
    [106, 436, 116, 448],       # X scheduled autos
    [524, 412.5, 591, 424],     # auto combined single limit
    [20, 555, 33, 567],         # INSR LTR (motor cargo)
    [36, 555, 101, 567],        # "Motor Cargo" type text
    [213, 555, 309, 567],       # motor cargo policy number
    [331, 556, 377, 567],       # motor cargo eff
    [379, 556, 424, 567],       # motor cargo exp
    [455, 555, 591, 567],       # motor cargo limit
    [20, 600, 591, 660],        # description of operations (vehicles)
    [55, 697, 305, 736],        # certificate holder name + address
    [305, 727, 578, 758],       # authorized-rep signature
    [559, 748, 591, 758],       # footer (MAR)
    [430, 771.5, 591, 782],     # footer "Printed by MAR on ..."
]

d = fitz.open(SRC)
p = d[0]
for r in DATA_RECTS:
    p.draw_rect(fitz.Rect(*r), color=None, fill=(1, 1, 1), width=0)

os.makedirs(PUB, exist_ok=True)
d.save(os.path.join(PUB, "acord25-blank.pdf"))

# High-res PNG for crisp on-screen rendering
pix = p.get_pixmap(matrix=fitz.Matrix(2.6, 2.6), alpha=False)
pix.save(os.path.join(PUB, "acord25-blank.png"))
print("saved blank pdf + png; png size:", pix.width, "x", pix.height)
