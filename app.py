
from flask import Flask, render_template, request, jsonify, send_file, session, redirect, url_for
import sqlite3, csv, io, re, os
from datetime import datetime

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret-key")
DB = os.environ.get("DATABASE_PATH", "warehouse.db")

# TEST CONFIGURATION:
# 3 rooms x 10 racks x 3 levels x 4 positions = 360 locations.
ROOMS, RACKS_PER_ROOM, LEVELS, POSITIONS = 3, 10, 3, 4

def db():
    con = sqlite3.connect(DB, timeout=20)
    con.row_factory = sqlite3.Row
    return con

def now():
    return datetime.now().isoformat(timespec="seconds")

def init_db():
    con = db()
    con.executescript("""
    CREATE TABLE IF NOT EXISTS locations (
        location_id TEXT PRIMARY KEY,
        room INTEGER NOT NULL,
        rack INTEGER NOT NULL,
        level INTEGER NOT NULL,
        position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pallets (
        pallet_id TEXT PRIMARY KEY,
        location TEXT,
        status TEXT NOT NULL DEFAULT 'IN',
        product TEXT DEFAULT '',
        lot TEXT DEFAULT '',
        packing TEXT DEFAULT '',
        qty TEXT DEFAULT '',
        brand TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pallet_id TEXT NOT NULL,
        action TEXT NOT NULL,
        old_location TEXT DEFAULT '',
        new_location TEXT DEFAULT '',
        timestamp TEXT NOT NULL
    );
    """)
    if con.execute("SELECT COUNT(*) AS c FROM locations").fetchone()["c"] == 0:
        for room in range(1, ROOMS + 1):
            for rack in range(1, RACKS_PER_ROOM + 1):
                for level in range(1, LEVELS + 1):
                    for pos in range(1, POSITIONS + 1):
                        loc = f"R{room}R{rack}L{level}P{pos}"
                        con.execute(
                            "INSERT INTO locations VALUES (?, ?, ?, ?, ?)",
                            (loc, room, rack, level, pos)
                        )
    con.commit()
    con.close()

def clean_pallet_id(raw):
    raw = (raw or "").strip()
    # Supports the QR format in the supplied pallet label:
    # ip:04730701|qp:1{p}l:1998,d:BROCCOLI,s:CROWNS,p:CARTON,b:Ji Ping Green,w:0,qb:
    m = re.search(r'(?:^|\|)ip:([^|]+)', raw)
    return m.group(1).strip() if m else raw

def parse_pallet(raw):
    raw = (raw or "").strip()
    result = {"pallet_id": clean_pallet_id(raw)}
    if "|" in raw and "ip:" in raw:
        parts = raw.split("|", 1)[1].split(",")
        for part in parts:
            if ":" in part:
                k, v = part.split(":", 1)
                result[k.strip()] = v.strip()
        result["product"] = result.get("d", "")
        result["lot"] = result.get("l", "")
        result["packing"] = result.get("p", "")
        result["brand"] = result.get("b", "")
        result["qty"] = result.get("qb", "")
    return result

def location_exists(con, loc):
    return con.execute("SELECT 1 FROM locations WHERE location_id=?", (loc,)).fetchone() is not None

@app.route("/")
def index():
    return render_template("index.html")

@app.get("/api/stats")
def stats():
    con = db()
    total = con.execute("SELECT COUNT(*) AS c FROM locations").fetchone()["c"]
    occupied = con.execute("SELECT COUNT(*) AS c FROM pallets WHERE status='IN'").fetchone()["c"]
    con.close()
    return jsonify(total_locations=total, occupied=occupied, available=total-occupied)

@app.post("/api/in")
def put_in():
    body = request.get_json(force=True)
    parsed = parse_pallet(body.get("pallet_id", ""))
    pallet_id = parsed["pallet_id"]
    location = (body.get("location") or "").strip().upper()

    if not pallet_id or not location:
        return jsonify(ok=False, error="Scan a pallet and a rack location."), 400

    con = db()
    if not location_exists(con, location):
        con.close()
        return jsonify(ok=False, error=f"Location {location} does not exist."), 400

    existing = con.execute("SELECT * FROM pallets WHERE pallet_id=?", (pallet_id,)).fetchone()
    if existing and existing["status"] == "IN":
        con.close()
        return jsonify(ok=False, error=f"Pallet {pallet_id} is already at {existing['location']}."), 409

    occupied = con.execute(
        "SELECT pallet_id FROM pallets WHERE location=? AND status='IN'",
        (location,)
    ).fetchone()
    if occupied:
        con.close()
        return jsonify(ok=False, error=f"{location} is occupied by pallet {occupied['pallet_id']}."), 409

    t = now()
    con.execute("""
        INSERT INTO pallets
        (pallet_id, location, status, product, lot, packing, qty, brand, created_at, updated_at)
        VALUES (?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pallet_id) DO UPDATE SET
            location=excluded.location, status='IN',
            product=excluded.product, lot=excluded.lot,
            packing=excluded.packing, qty=excluded.qty,
            brand=excluded.brand, updated_at=excluded.updated_at
    """, (
        pallet_id, location, parsed.get("product",""), parsed.get("lot",""),
        parsed.get("packing",""), parsed.get("qty",""), parsed.get("brand",""), t, t
    ))
    con.execute(
        "INSERT INTO history (pallet_id, action, old_location, new_location, timestamp) VALUES (?, 'IN', ?, ?, ?)",
        (pallet_id, existing["location"] if existing else "", location, t)
    )
    con.commit()
    con.close()
    return jsonify(ok=True, message=f"{pallet_id} stored at {location}", pallet_id=pallet_id, location=location)

@app.post("/api/move")
def move():
    body = request.get_json(force=True)
    pallet_id = clean_pallet_id(body.get("pallet_id", ""))
    location = (body.get("location") or "").strip().upper()
    con = db()
    row = con.execute("SELECT * FROM pallets WHERE pallet_id=?", (pallet_id,)).fetchone()

    if not row or row["status"] != "IN":
        con.close()
        return jsonify(ok=False, error="Pallet is not currently IN the warehouse."), 404
    if not location_exists(con, location):
        con.close()
        return jsonify(ok=False, error=f"Location {location} does not exist."), 400
    if location == row["location"]:
        con.close()
        return jsonify(ok=False, error="That pallet is already at this location."), 409

    occupied = con.execute(
        "SELECT pallet_id FROM pallets WHERE location=? AND status='IN' AND pallet_id<>?",
        (location, pallet_id)
    ).fetchone()
    if occupied:
        con.close()
        return jsonify(ok=False, error=f"{location} is occupied by pallet {occupied['pallet_id']}."), 409

    t = now()
    con.execute("UPDATE pallets SET location=?, updated_at=? WHERE pallet_id=?", (location, t, pallet_id))
    con.execute(
        "INSERT INTO history (pallet_id, action, old_location, new_location, timestamp) VALUES (?, 'MOVE', ?, ?, ?)",
        (pallet_id, row["location"], location, t)
    )
    con.commit()
    con.close()
    return jsonify(ok=True, message=f"{pallet_id} moved to {location}", pallet_id=pallet_id, location=location)

@app.post("/api/out")
def take_out():
    body = request.get_json(force=True)
    pallet_id = clean_pallet_id(body.get("pallet_id", ""))
    con = db()
    row = con.execute("SELECT * FROM pallets WHERE pallet_id=?", (pallet_id,)).fetchone()
    if not row or row["status"] != "IN":
        con.close()
        return jsonify(ok=False, error="Pallet is not currently IN the warehouse."), 404
    t = now()
    con.execute("UPDATE pallets SET status='OUT', location=NULL, updated_at=? WHERE pallet_id=?", (t, pallet_id))
    con.execute(
        "INSERT INTO history (pallet_id, action, old_location, new_location, timestamp) VALUES (?, 'OUT', ?, '', ?)",
        (pallet_id, row["location"], t)
    )
    con.commit()
    con.close()
    return jsonify(ok=True, message=f"{pallet_id} taken OUT", pallet_id=pallet_id, old_location=row["location"])

@app.get("/api/find/<path:pallet_id>")
def find_pallet(pallet_id):
    pallet_id = clean_pallet_id(pallet_id)
    con = db()
    row = con.execute("SELECT * FROM pallets WHERE pallet_id=?", (pallet_id,)).fetchone()
    history = con.execute(
        "SELECT action, old_location, new_location, timestamp FROM history WHERE pallet_id=? ORDER BY id DESC",
        (pallet_id,)
    ).fetchall()
    con.close()
    if not row:
        return jsonify(ok=False, error="Pallet not found."), 404
    return jsonify(ok=True, pallet=dict(row), history=[dict(x) for x in history])

@app.get("/api/pallets")
def pallets():
    con = db()
    rows = con.execute(
        "SELECT * FROM pallets WHERE status='IN' ORDER BY location, pallet_id"
    ).fetchall()
    con.close()
    return jsonify([dict(x) for x in rows])

@app.get("/api/location/<path:loc>")
def location_detail(loc):
    loc = loc.strip().upper()
    con = db()
    location = con.execute("SELECT * FROM locations WHERE location_id=?", (loc,)).fetchone()
    pallet = con.execute(
        "SELECT * FROM pallets WHERE location=? AND status='IN'", (loc,)
    ).fetchone()
    con.close()
    if not location:
        return jsonify(ok=False, error="Location not found."), 404
    return jsonify(ok=True, location=dict(location), pallet=dict(pallet) if pallet else None)

@app.get("/api/locations")
def locations():
    con = db()
    rows = con.execute("""
        SELECT l.*,
               p.pallet_id, p.product, p.lot, p.qty, p.brand
        FROM locations l
        LEFT JOIN pallets p ON p.location=l.location_id AND p.status='IN'
        ORDER BY l.room, l.rack, l.level, l.position
    """).fetchall()
    con.close()
    return jsonify([dict(x) for x in rows])

@app.get("/api/export")
def export():
    con = db()
    rows = con.execute("""
        SELECT pallet_id, location, status, product, lot, packing, qty, brand, created_at, updated_at
        FROM pallets ORDER BY pallet_id
    """).fetchall()
    con.close()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Pallet ID","Location","Status","Product","Lot","Packing","Qty","Brand","Created","Updated"])
    for r in rows:
        writer.writerow(list(r))
    return send_file(
        io.BytesIO(out.getvalue().encode("utf-8-sig")),
        mimetype="text/csv",
        as_attachment=True,
        download_name="warehouse_pallet_locations.csv"
    )

@app.get("/health")
def health():
    return "OK", 200

init_db()
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
