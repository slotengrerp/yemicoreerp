#!/usr/bin/env python3
"""
Convert the FLOPENG LOGISTICS transaction register into a SLOT ERP
Terminal Containers import file.

WHY THIS EXISTS
---------------
The source is a human spreadsheet, not an export. Five things stop it being
importable as-is, and all five are handled here:

  1. Line 1 is a title banner ("FLOPENG LOGISTICS LTD TRANSACTION RECORD"),
     so any importer reads that as the header row. Real headers are line 2.
  2. Column names are human labels ("CONTAINER Nos", "NAME OF CONSIGNEE"),
     not the field names the importer expects.
  3. Dates are day-first (13/1/2026). Read as US month-first they are either
     wrong or invalid. 2,383 values have a day above 12, which is what
     proves the format.
  4. Merged Excel cells: when a Bill of Lading covers several containers the
     BoL number is written once and the rows beneath are blank. Those must
     be forward-filled or the containers import with no parent.
  5. Two typos in the source: a year "10126" and a letter O used as a zero.

Run:  python tools/convert_flopeng_register.py <input.csv> <output.csv>

Prints a reconciliation summary. Nothing is written unless parsing succeeds.
"""

import csv
import re
import sys
from collections import Counter

# Source label → importer field. Trailing spaces in the source headers are
# stripped before lookup, so "DATE OF RELEASE " matches "DATE OF RELEASE".
COLUMN_MAP = {
    'DATE OF TRANSIRE APPLICATION':  'transireDate',
    'BILL OF LADING No.':            'billOfLading',
    'No. OF CONTAINERS BILL/LADDING': 'noOfContainers',
    'SIZES OF CONTAINERS':           'size',
    'CONTAINER Nos':                 'containerNo',
    'MATERIAL DESCRIPTION/PACKAGE':  'materialDescription',
    'NAME OF CONSIGNEE':             'consigneeName',
    'SHIPPING COY':                  'shippingCompany',
    'SHIPPING VESSEL':               'shippingVessel',
    'DATE OF RECIPT INTO WAREHOUSE': 'warehouseReceiptDate',
    'DATE OF EXAMINATION':           'examinationDate',
    'DATE OF RELEASE':               'releaseDate',
    'REMARK':                        'remark',
}

OUTPUT_COLUMNS = [
    'containerNo', 'containerType', 'size', 'portType',
    'shippingCompany', 'shippingVessel', 'consigneeName',
    'materialDescription', 'billOfLading', 'noOfContainers', 'status',
    'transireDate', 'warehouseReceiptDate', 'examinationDate',
    'releaseDate', 'remark',
]

# Values that carry down a merged block. Anything NOT here is per-container
# and must never be inherited — inheriting a container number would silently
# duplicate boxes, which is the worst outcome available here.
INHERITED = [
    'billOfLading', 'noOfContainers', 'transireDate', 'materialDescription',
    'consigneeName', 'shippingCompany', 'shippingVessel', 'size',
]

problems = []


def clean_date(value, row_no, field):
    """Day-first date → ISO. Returns '' for blanks, flags anything odd."""
    v = (value or '').strip()
    if not v:
        return ''

    # Letter O typed for a zero: "1O/6/2026". Only inside an otherwise
    # numeric date, so real text is never mangled.
    if re.fullmatch(r'[\dOo]{1,2}/[\dOo]{1,2}/[\dOo]{2,5}', v) and ('O' in v or 'o' in v):
        fixed = v.replace('O', '0').replace('o', '0')
        problems.append(f"row {row_no} {field}: '{v}' → '{fixed}' (letter O read as zero)")
        v = fixed

    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{2,5})', v)
    if not m:
        problems.append(f"row {row_no} {field}: '{v}' not a recognisable date — left blank")
        return ''

    day, month, year = int(m.group(1)), int(m.group(2)), m.group(3)

    if len(year) > 4:                       # "10126" — a slipped keystroke
        problems.append(f"row {row_no} {field}: year '{year}' is not valid — left blank, please correct by hand")
        return ''
    year = int(year)
    if year < 100:                          # "26" → 2026
        year += 2000

    # A 3-digit year is a dropped keystroke ("23/7/206" for 2026), and a
    # 4-digit year far outside the register's era is equally wrong. Guessing
    # the intended value would be inventing data, so flag it and leave the
    # cell blank for a human to fill. Caught by the reconciliation check:
    # two rows produced the year 0206 before this guard existed.
    if not (2000 <= year <= 2035):
        problems.append(
            f"row {row_no} {field}: '{v}' gives year {year}, outside 2000–2035 "
            f"— left blank, please correct by hand"
        )
        return ''

    if month > 12:
        problems.append(f"row {row_no} {field}: '{v}' has month {month} — left blank")
        return ''
    if day > 31 or day == 0 or month == 0:
        problems.append(f"row {row_no} {field}: '{v}' out of range — left blank")
        return ''

    return f"{year:04d}-{month:02d}-{day:02d}"


def size_to_type(size):
    """'40FT' → '40ft DV', the container-type vocabulary the app uses."""
    s = (size or '').strip().upper().replace(' ', '')
    if s.startswith('40'):
        return '40ft DV'
    if s.startswith('20'):
        return '20ft DV'
    return ''


def normalise_size(size):
    s = (size or '').strip().upper().replace(' ', '')
    if s.startswith('40'):
        return '40ft'
    if s.startswith('20'):
        return '20ft'
    return (size or '').strip()


def status_from(remark, release_date):
    """The register's REMARK column is the closest thing to a status."""
    r = (remark or '').strip().upper()
    if 'RELEASE' in r or release_date:
        return 'Released'
    if 'RECEIV' in r:
        return 'In Warehouse'
    if 'EXAMIN' in r:
        return 'Under Examination'
    return 'Arrived'


def convert(src_path, out_path):
    with open(src_path, encoding='utf-8-sig', errors='replace', newline='') as fh:
        raw = list(csv.reader(fh))

    if len(raw) < 3:
        sys.exit("File has no data rows.")

    header = [h.strip() for h in raw[1]]
    unmapped = [h for h in header if h and h not in COLUMN_MAP and h != 'S/N']
    if unmapped:
        print(f"  ! unmapped source columns (ignored): {unmapped}")

    idx = {COLUMN_MAP[h]: i for i, h in enumerate(header) if h in COLUMN_MAP}
    missing = [f for f in ('containerNo', 'billOfLading') if f not in idx]
    if missing:
        sys.exit(f"Required column(s) not found in the file: {missing}")

    out_rows = []
    carried = {}
    seen_containers = Counter()
    bols = set()
    skipped_blank = 0

    for n, row in enumerate(raw[2:], start=3):
        if not any((c or '').strip() for c in row):
            skipped_blank += 1
            continue

        def cell(field):
            i = idx.get(field)
            return (row[i].strip() if i is not None and i < len(row) else '')

        # Forward-fill the merged-cell values, then remember them for the
        # rows below. A value present on this row always wins.
        vals = {}
        for field in INHERITED:
            v = cell(field)
            if v:
                carried[field] = v
            vals[field] = v or carried.get(field, '')

        container_no = cell('containerNo')
        if not container_no:
            skipped_blank += 1
            continue

        container_no = container_no.upper().replace(' ', '')
        seen_containers[container_no] += 1

        release = clean_date(cell('releaseDate'), n, 'DATE OF RELEASE')
        remark = cell('remark')
        if vals['billOfLading']:
            bols.add(vals['billOfLading'].strip().upper())

        out_rows.append({
            'containerNo':          container_no,
            'containerType':        size_to_type(vals['size']),
            'size':                 normalise_size(vals['size']),
            'portType':             'Sea',
            'shippingCompany':      vals['shippingCompany'],
            'shippingVessel':       vals['shippingVessel'],
            'consigneeName':        vals['consigneeName'],
            'materialDescription':  vals['materialDescription'],
            'billOfLading':         vals['billOfLading'],
            'noOfContainers':       vals['noOfContainers'],
            'status':               status_from(remark, release),
            'transireDate':         clean_date(vals['transireDate'], n, 'DATE OF TRANSIRE APPLICATION'),
            'warehouseReceiptDate': clean_date(cell('warehouseReceiptDate'), n, 'DATE OF RECIPT INTO WAREHOUSE'),
            'examinationDate':      clean_date(cell('examinationDate'), n, 'DATE OF EXAMINATION'),
            'releaseDate':          release,
            'remark':               remark,
        })

    with open(out_path, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=OUTPUT_COLUMNS)
        w.writeheader()
        w.writerows(out_rows)

    dupes = {c: n for c, n in seen_containers.items() if n > 1}

    print(f"\n  containers written : {len(out_rows)}")
    print(f"  distinct BoLs      : {len(bols)}")
    print(f"  blank rows skipped : {skipped_blank}")
    print(f"  repeated container numbers: {len(dupes)}")
    if dupes:
        for c, k in list(dupes.items())[:10]:
            print(f"      {c} appears {k}x")
    if problems:
        print(f"\n  {len(problems)} value(s) needed attention:")
        for p in problems[:20]:
            print(f"      {p}")
    print(f"\n  written to {out_path}")
    return out_rows


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    convert(sys.argv[1], sys.argv[2])
