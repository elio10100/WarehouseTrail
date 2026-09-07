from flask import Flask, render_template, request, jsonify, send_file
import sqlite3
import csv
import io
import re
import os
from datetime import datetime

app = Flask(__name__)

app.secret_key = os.environ.get(
    "SECRET_KEY",
    "change-this-secret-key"
)

DB = os.environ.get(
    "DATABASE_PATH",
    "warehouse.db"
)


# ============================================================
# WAREHOUSE CONFIGURATION
# ============================================================

# 3 Rooms
# 10 Racks per Room
# 3 Levels per Rack
# 4 Positions per Level
#
# TOTAL = 360 locations

ROOMS = 3
RACKS_PER_ROOM = 10
LEVELS = 3
POSITIONS = 4


# ============================================================
# DATABASE
# ============================================================

def db():
    con = sqlite3.connect(DB, timeout=20)
    con.row_factory = sqlite3.Row
    return con


def now():
    return datetime.now().isoformat(timespec="seconds")


def column_exists(con, table, column):
    rows = con.execute(
        f"PRAGMA table_info({table})"
    ).fetchall()

    return any(
        row["name"] == column
        for row in rows
    )


def add_column_if_missing(
    con,
    table,
    column,
    definition
):
    if not column_exists(
        con,
        table,
        column
    ):
        con.execute(
            f"""
            ALTER TABLE {table}
            ADD COLUMN {column} {definition}
            """
        )


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
            weight TEXT DEFAULT '',
            qty TEXT DEFAULT '',
            brand TEXT DEFAULT '',

            raw_qr TEXT DEFAULT '',

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

    # --------------------------------------------------------
    # SAFE DATABASE UPGRADE
    # --------------------------------------------------------
    #
    # If warehouse.db already exists, CREATE TABLE will NOT
    # add new columns. These checks add them automatically.
    #
    # This means you DO NOT need to delete your database.
    # --------------------------------------------------------

    add_column_if_missing(
        con,
        "pallets",
        "product",
        "TEXT DEFAULT ''"
    )

    add_column_if_missing(
        con,
        "pallets",
        "lot",
        "TEXT DEFAULT ''"
    )

    add_column_if_missing(
        con,
        "pallets",
        "packing",
        "TEXT DEFAULT ''"
    )

    add_column_if_missing(
        con,
        "pallets",
        "weight",
        "TEXT DEFAULT ''"
    )

    add_column_if_missing(
        con,
        "pallets",
        "qty",
        "TEXT DEFAULT ''"
    )

    add_column_if_missing(
        con,
        "pallets",
        "brand",
        "TEXT DEFAULT ''"
    )

    add_column_if_missing(
        con,
        "pallets",
        "raw_qr",
        "TEXT DEFAULT ''"
    )

    # --------------------------------------------------------
    # CREATE WAREHOUSE LOCATIONS
    # --------------------------------------------------------

    count = con.execute(
        """
        SELECT COUNT(*) AS c
        FROM locations
        """
    ).fetchone()["c"]

    if count == 0:

        for room in range(
            1,
            ROOMS + 1
        ):

            for rack in range(
                1,
                RACKS_PER_ROOM + 1
            ):

                for level in range(
                    1,
                    LEVELS + 1
                ):

                    for position in range(
                        1,
                        POSITIONS + 1
                    ):

                        location_id = (
                            f"R{room}"
                            f"R{rack}"
                            f"L{level}"
                            f"P{position}"
                        )

                        con.execute(
                            """
                            INSERT INTO locations
                            (
                                location_id,
                                room,
                                rack,
                                level,
                                position
                            )
                            VALUES (?, ?, ?, ?, ?)
                            """,
                            (
                                location_id,
                                room,
                                rack,
                                level,
                                position
                            )
                        )

    con.commit()
    con.close()


# ============================================================
# QR / BARCODE PARSING
# ============================================================

def clean_pallet_id(raw):

    raw = (raw or "").strip()

    # Example:
    #
    # ip:04730905|qp:1{p}l:2005,d:CARROT,p:BAG,w:0,qb:
    #
    # Result:
    # 04730905

    match = re.search(
        r'(?:^|\|)ip:([^|]+)',
        raw,
        re.IGNORECASE
    )

    if match:
        return match.group(1).strip()

    return raw


def parse_pallet(raw):

    raw = (raw or "").strip()

    result = {
        "pallet_id": clean_pallet_id(raw),
        "product": "",
        "lot": "",
        "packing": "",
        "weight": "",
        "qty": "",
        "brand": "",
        "raw_qr": raw
    }

    # --------------------------------------------------------
    # EXPECTED QR EXAMPLE
    # --------------------------------------------------------
    #
    # ip:04730905|qp:1{p}l:2005,d:CARROT,p:BAG,w:0,qb:
    #
    # ip = Pallet ID
    # l  = Lot
    # d  = Description / Product
    # p  = Packing
    # w  = Weight
    # b  = Brand
    # qb = Quantity
    # --------------------------------------------------------

    if "ip:" not in raw.lower():
        return result

    # Everything after the first |
    if "|" in raw:

        details = raw.split(
            "|",
            1
        )[1]

        # Some QR codes include:
        #
        # qp:1{p}l:2005
        #
        # We specifically extract l: after {p}
        # before normal comma parsing.

        lot_match = re.search(
            r'(?:\{p\}|^|,)l:([^,|]*)',
            details,
            re.IGNORECASE
        )

        if lot_match:
            result["lot"] = (
                lot_match
                .group(1)
                .strip()
            )

        parts = details.split(",")

        for part in parts:

            part = part.strip()

            if ":" not in part:
                continue

            key, value = part.split(
                ":",
                1
            )

            key = key.strip().lower()
            value = value.strip()

            # The first section can contain:
            #
            # qp:1{p}l:2005
            #
            # so don't treat the entire thing
            # as one normal field.

            if key == "d":
                result["product"] = value

            elif key == "l":
                result["lot"] = value

            elif key == "p":
                result["packing"] = value

            elif key == "w":
                result["weight"] = value

            elif key == "qb":
                result["qty"] = value

            elif key == "b":
                result["brand"] = value

    return result


# ============================================================
# LOCATION HELPERS
# ============================================================

def location_exists(
    con,
    location
):

    row = con.execute(
        """
        SELECT 1
        FROM locations
        WHERE location_id=?
        """,
        (location,)
    ).fetchone()

    return row is not None


# ============================================================
# MAIN PAGE
# ============================================================

@app.route("/")
def index():
    return render_template(
        "index.html"
    )


# ============================================================
# STATS
# ============================================================

@app.get("/api/stats")
def stats():

    con = db()

    total = con.execute(
        """
        SELECT COUNT(*) AS c
        FROM locations
        """
    ).fetchone()["c"]

    occupied = con.execute(
        """
        SELECT COUNT(*) AS c
        FROM pallets
        WHERE status='IN'
        """
    ).fetchone()["c"]

    con.close()

    return jsonify(
        total_locations=total,
        occupied=occupied,
        available=total - occupied
    )


# ============================================================
# PUT PALLET IN
# ============================================================

@app.post("/api/in")
def put_in():

    body = request.get_json(
        force=True
    )

    raw_pallet = body.get(
        "pallet_id",
        ""
    )

    parsed = parse_pallet(
        raw_pallet
    )

    pallet_id = parsed[
        "pallet_id"
    ]

    location = (
        body.get(
            "location"
        )
        or ""
    ).strip().upper()

    if not pallet_id or not location:

        return jsonify(
            ok=False,
            error=(
                "Scan a pallet "
                "and a rack location."
            )
        ), 400

    con = db()

    # --------------------------------------------------------
    # VALID LOCATION?
    # --------------------------------------------------------

    if not location_exists(
        con,
        location
    ):

        con.close()

        return jsonify(
            ok=False,
            error=(
                f"Location {location} "
                "does not exist."
            )
        ), 400

    # --------------------------------------------------------
    # PALLET ALREADY IN?
    # --------------------------------------------------------

    existing = con.execute(
        """
        SELECT *
        FROM pallets
        WHERE pallet_id=?
        """,
        (pallet_id,)
    ).fetchone()

    if (
        existing
        and existing["status"] == "IN"
    ):

        con.close()

        return jsonify(
            ok=False,
            error=(
                f"Pallet {pallet_id} "
                f"is already at "
                f"{existing['location']}."
            )
        ), 409

    # --------------------------------------------------------
    # LOCATION OCCUPIED?
    # --------------------------------------------------------

    occupied = con.execute(
        """
        SELECT pallet_id
        FROM pallets
        WHERE location=?
        AND status='IN'
        """,
        (location,)
    ).fetchone()

    if occupied:

        con.close()

        return jsonify(
            ok=False,
            error=(
                f"{location} is occupied "
                f"by pallet "
                f"{occupied['pallet_id']}."
            )
        ), 409

    timestamp = now()

    # --------------------------------------------------------
    # SAVE PALLET + QR INFORMATION
    # --------------------------------------------------------

    con.execute(
        """
        INSERT INTO pallets
        (
            pallet_id,
            location,
            status,

            product,
            lot,
            packing,
            weight,
            qty,
            brand,

            raw_qr,

            created_at,
            updated_at
        )

        VALUES
        (
            ?,
            ?,
            'IN',

            ?,
            ?,
            ?,
            ?,
            ?,
            ?,

            ?,

            ?,
            ?
        )

        ON CONFLICT(pallet_id)
        DO UPDATE SET

            location=excluded.location,
            status='IN',

            product=excluded.product,
            lot=excluded.lot,
            packing=excluded.packing,
            weight=excluded.weight,
            qty=excluded.qty,
            brand=excluded.brand,

            raw_qr=excluded.raw_qr,

            updated_at=excluded.updated_at
        """,
        (
            pallet_id,
            location,

            parsed.get(
                "product",
                ""
            ),

            parsed.get(
                "lot",
                ""
            ),

            parsed.get(
                "packing",
                ""
            ),

            parsed.get(
                "weight",
                ""
            ),

            parsed.get(
                "qty",
                ""
            ),

            parsed.get(
                "brand",
                ""
            ),

            parsed.get(
                "raw_qr",
                ""
            ),

            timestamp,
            timestamp
        )
    )

    old_location = ""

    if existing:
        old_location = (
            existing["location"]
            or ""
        )

    con.execute(
        """
        INSERT INTO history
        (
            pallet_id,
            action,
            old_location,
            new_location,
            timestamp
        )
        VALUES
        (
            ?,
            'IN',
            ?,
            ?,
            ?
        )
        """,
        (
            pallet_id,
            old_location,
            location,
            timestamp
        )
    )

    con.commit()
    con.close()

    return jsonify(
        ok=True,

        message=(
            f"{pallet_id} stored "
            f"at {location}"
        ),

        pallet_id=pallet_id,
        location=location,

        product=parsed.get(
            "product",
            ""
        ),

        lot=parsed.get(
            "lot",
            ""
        ),

        packing=parsed.get(
            "packing",
            ""
        ),

        weight=parsed.get(
            "weight",
            ""
        ),

        qty=parsed.get(
            "qty",
            ""
        ),

        brand=parsed.get(
            "brand",
            ""
        )
    )


# ============================================================
# MOVE PALLET
# ============================================================

@app.post("/api/move")
def move():

    body = request.get_json(
        force=True
    )

    pallet_id = clean_pallet_id(
        body.get(
            "pallet_id",
            ""
        )
    )

    location = (
        body.get(
            "location"
        )
        or ""
    ).strip().upper()

    con = db()

    row = con.execute(
        """
        SELECT *
        FROM pallets
        WHERE pallet_id=?
        """,
        (pallet_id,)
    ).fetchone()

    if (
        not row
        or row["status"] != "IN"
    ):

        con.close()

        return jsonify(
            ok=False,
            error=(
                "Pallet is not currently "
                "IN the warehouse."
            )
        ), 404

    if not location_exists(
        con,
        location
    ):

        con.close()

        return jsonify(
            ok=False,
            error=(
                f"Location {location} "
                "does not exist."
            )
        ), 400

    if location == row["location"]:

        con.close()

        return jsonify(
            ok=False,
            error=(
                "That pallet is already "
                "at this location."
            )
        ), 409

    occupied = con.execute(
        """
        SELECT pallet_id
        FROM pallets
        WHERE location=?
        AND status='IN'
        AND pallet_id<>?
        """,
        (
            location,
            pallet_id
        )
    ).fetchone()

    if occupied:

        con.close()

        return jsonify(
            ok=False,
            error=(
                f"{location} is occupied "
                f"by pallet "
                f"{occupied['pallet_id']}."
            )
        ), 409

    timestamp = now()

    con.execute(
        """
        UPDATE pallets
        SET location=?,
            updated_at=?
        WHERE pallet_id=?
        """,
        (
            location,
            timestamp,
            pallet_id
        )
    )

    con.execute(
        """
        INSERT INTO history
        (
            pallet_id,
            action,
            old_location,
            new_location,
            timestamp
        )
        VALUES
        (
            ?,
            'MOVE',
            ?,
            ?,
            ?
        )
        """,
        (
            pallet_id,
            row["location"],
            location,
            timestamp
        )
    )

    con.commit()
    con.close()

    return jsonify(
        ok=True,

        message=(
            f"{pallet_id} moved "
            f"to {location}"
        ),

        pallet_id=pallet_id,
        location=location
    )


# ============================================================
# TAKE PALLET OUT
# ============================================================

@app.post("/api/out")
def take_out():

    body = request.get_json(
        force=True
    )

    pallet_id = clean_pallet_id(
        body.get(
            "pallet_id",
            ""
        )
    )

    con = db()

    row = con.execute(
        """
        SELECT *
        FROM pallets
        WHERE pallet_id=?
        """,
        (pallet_id,)
    ).fetchone()

    if (
        not row
        or row["status"] != "IN"
    ):

        con.close()

        return jsonify(
            ok=False,
            error=(
                "Pallet is not currently "
                "IN the warehouse."
            )
        ), 404

    timestamp = now()

    old_location = row[
        "location"
    ]

    con.execute(
        """
        UPDATE pallets
        SET
            status='OUT',
            location=NULL,
            updated_at=?
        WHERE pallet_id=?
        """,
        (
            timestamp,
            pallet_id
        )
    )

    con.execute(
        """
        INSERT INTO history
        (
            pallet_id,
            action,
            old_location,
            new_location,
            timestamp
        )
        VALUES
        (
            ?,
            'OUT',
            ?,
            '',
            ?
        )
        """,
        (
            pallet_id,
            old_location,
            timestamp
        )
    )

    con.commit()
    con.close()

    return jsonify(
        ok=True,

        message=(
            f"{pallet_id} taken OUT"
        ),

        pallet_id=pallet_id,
        old_location=old_location
    )


# ============================================================
# FIND ONE PALLET
# ============================================================

@app.get("/api/find/<path:pallet_id>")
def find_pallet(
    pallet_id
):

    pallet_id = clean_pallet_id(
        pallet_id
    )

    con = db()

    row = con.execute(
        """
        SELECT *
        FROM pallets
        WHERE pallet_id=?
        """,
        (pallet_id,)
    ).fetchone()

    history = con.execute(
        """
        SELECT
            action,
            old_location,
            new_location,
            timestamp

        FROM history

        WHERE pallet_id=?

        ORDER BY id DESC
        """,
        (pallet_id,)
    ).fetchall()

    con.close()

    if not row:

        return jsonify(
            ok=False,
            error="Pallet not found."
        ), 404

    return jsonify(
        ok=True,
        pallet=dict(row),
        history=[
            dict(x)
            for x in history
        ]
    )


# ============================================================
# ADVANCED INVENTORY SEARCH / FILTER
# ============================================================

@app.get("/api/search")
def search_inventory():

    pallet_id = (
        request.args.get(
            "pallet_id",
            ""
        )
        .strip()
    )

    lot = (
        request.args.get(
            "lot",
            ""
        )
        .strip()
    )

    product = (
        request.args.get(
            "product",
            ""
        )
        .strip()
    )

    packing = (
        request.args.get(
            "packing",
            ""
        )
        .strip()
    )

    weight = (
        request.args.get(
            "weight",
            ""
        )
        .strip()
    )

    location = (
        request.args.get(
            "location",
            ""
        )
        .strip()
    )

    status = (
        request.args.get(
            "status",
            "IN"
        )
        .strip()
        .upper()
    )

    con = db()

    query = """
        SELECT *
        FROM pallets
        WHERE 1=1
    """

    params = []

    # --------------------------------------------------------
    # STATUS
    # --------------------------------------------------------

    if status in (
        "IN",
        "OUT"
    ):

        query += """
            AND status=?
        """

        params.append(
            status
        )

    # status=ALL will return both

    # --------------------------------------------------------
    # PALLET ID
    # --------------------------------------------------------

    if pallet_id:

        query += """
            AND pallet_id
            LIKE ?
        """

        params.append(
            f"%{pallet_id}%"
        )

    # --------------------------------------------------------
    # LOT
    # --------------------------------------------------------

    if lot:

        query += """
            AND lot
            LIKE ?
        """

        params.append(
            f"%{lot}%"
        )

    # --------------------------------------------------------
    # PRODUCT / DESCRIPTION
    # --------------------------------------------------------

    if product:

        query += """
            AND product
            LIKE ?
        """

        params.append(
            f"%{product}%"
        )

    # --------------------------------------------------------
    # PACKING
    # --------------------------------------------------------

    if packing:

        query += """
            AND packing
            LIKE ?
        """

        params.append(
            f"%{packing}%"
        )

    # --------------------------------------------------------
    # WEIGHT
    # --------------------------------------------------------

    if weight:

        query += """
            AND weight
            LIKE ?
        """

        params.append(
            f"%{weight}%"
        )

    # --------------------------------------------------------
    # LOCATION
    # --------------------------------------------------------

    if location:

        query += """
            AND location
            LIKE ?
        """

        params.append(
            f"%{location.upper()}%"
        )

    query += """
        ORDER BY
            CASE
                WHEN location IS NULL
                THEN 1
                ELSE 0
            END,
            location,
            pallet_id
    """

    rows = con.execute(
        query,
        params
    ).fetchall()

    con.close()

    return jsonify(
        ok=True,
        count=len(rows),
        pallets=[
            dict(row)
            for row in rows
        ]
    )


# ============================================================
# ALL CURRENT PALLETS
# ============================================================

@app.get("/api/pallets")
def pallets():

    con = db()

    rows = con.execute(
        """
        SELECT *
        FROM pallets
        WHERE status='IN'
        ORDER BY
            location,
            pallet_id
        """
    ).fetchall()

    con.close()

    return jsonify(
        [
            dict(row)
            for row in rows
        ]
    )


# ============================================================
# LOCATION DETAIL
# ============================================================

@app.get(
    "/api/location/<path:loc>"
)
def location_detail(
    loc
):

    loc = (
        loc
        .strip()
        .upper()
    )

    con = db()

    location = con.execute(
        """
        SELECT *
        FROM locations
        WHERE location_id=?
        """,
        (loc,)
    ).fetchone()

    pallet = con.execute(
        """
        SELECT *
        FROM pallets
        WHERE location=?
        AND status='IN'
        """,
        (loc,)
    ).fetchone()

    con.close()

    if not location:

        return jsonify(
            ok=False,
            error="Location not found."
        ), 404

    return jsonify(
        ok=True,

        location=dict(
            location
        ),

        pallet=(
            dict(pallet)
            if pallet
            else None
        )
    )


# ============================================================
# ALL LOCATIONS
# ============================================================

@app.get("/api/locations")
def locations():

    con = db()

    rows = con.execute(
        """
        SELECT

            l.*,

            p.pallet_id,
            p.product,
            p.lot,
            p.packing,
            p.weight,
            p.qty,
            p.brand

        FROM locations l

        LEFT JOIN pallets p
            ON p.location=l.location_id
            AND p.status='IN'

        ORDER BY
            l.room,
            l.rack,
            l.level,
            l.position
        """
    ).fetchall()

    con.close()

    return jsonify(
        [
            dict(row)
            for row in rows
        ]
    )


# ============================================================
# CSV EXPORT
# ============================================================

@app.get("/api/export")
def export():

    con = db()

    rows = con.execute(
        """
        SELECT

            pallet_id,
            location,
            status,

            product,
            lot,
            packing,
            weight,
            qty,
            brand,

            raw_qr,

            created_at,
            updated_at

        FROM pallets

        ORDER BY
            pallet_id
        """
    ).fetchall()

    con.close()

    output = io.StringIO()

    writer = csv.writer(
        output
    )

    writer.writerow(
        [
            "Pallet ID",
            "Location",
            "Status",
            "Description",
            "Lot",
            "Packing",
            "Weight",
            "Qty",
            "Brand",
            "Raw QR",
            "Created",
            "Updated"
        ]
    )

    for row in rows:
        writer.writerow(
            list(row)
        )

    return send_file(
        io.BytesIO(
            output
            .getvalue()
            .encode(
                "utf-8-sig"
            )
        ),

        mimetype="text/csv",

        as_attachment=True,

        download_name=(
            "warehouse_inventory.csv"
        )
    )


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():
    return "OK", 200


# ============================================================
# START DATABASE
# ============================================================

init_db()


# ============================================================
# LOCAL SERVER
# ============================================================

if __name__ == "__main__":

    app.run(
        host="0.0.0.0",
        port=int(
            os.environ.get(
                "PORT",
                5000
            )
        ),
        debug=False
    )
