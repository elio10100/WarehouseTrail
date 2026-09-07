
WAREHOUSE PALLET TRACKER
========================

This is a standalone web application for your rack-position database.

TEST WAREHOUSE
--------------
3 Rooms
10 Racks per room
3 Levels per rack
4 Positions per level
= 360 unique positions

LOCATION FORMAT
---------------
R1R2L2P4
Room 1 / Rack 2 / Level 2 / Position 4

CORE WORKFLOW
-------------
IN:
  Scan pallet tag -> scan rack barcode -> SAVE

MOVE:
  Scan pallet tag -> scan new rack barcode -> MOVE

OUT:
  Scan pallet tag -> TAKE OUT

FIND:
  Scan pallet tag -> see current location + history

The app also prevents two pallets from occupying the same position.

PHONE SCANNING
--------------
The web page has a camera button. It uses html5-qrcode from a CDN.
For camera scanning, the site should be served over HTTPS when hosted.
A Zebra/Android scanner that types barcode data like a keyboard also works.

YOUR SAMPLE PALLET
------------------
The supplied pallet label has a Code 128 barcode that reads:
04730701

Its QR code contains the pallet ID plus additional product/lot information.
The app accepts either the simple barcode value or the full QR payload.

RUN LOCALLY
-----------
1. Install Python 3.11+
2. Open a command prompt in this folder
3. pip install -r requirements.txt
4. python app.py
5. Visit http://localhost:5000

HOST FOR PHONE USE
------------------
To use it from your phone anywhere, host the app on a service such as Render,
Railway, Fly.io, or another Python host. You need HTTPS for camera scanning.

For a small test, you can run it on a Windows PC on the same Wi-Fi and visit
http://YOUR-PC-IP:5000 from the phone. Some mobile browsers will block camera
access over plain HTTP; in that case use the scanner's keyboard mode or HTTPS.

DATABASE
--------
SQLite is used for the prototype. For production with multiple phones/users,
use a hosted PostgreSQL database and automatic backups.

PRODUCTION TODO
---------------
- User login / roles
- PostgreSQL
- Automatic backups
- HTTPS
- Audit log with user names
- Admin page to change room/rack/level/position counts
- Printable rack barcode labels
- Optional integration/import from your existing WMS
- Optional offline queue for warehouse dead zones
