let scanTarget = null;
let scannerControls = null;
let scannerStream = null;
let scanning = false;

const $ = id => document.getElementById(id);


/* =========================
   TOAST
========================= */

function toast(msg) {
  const t = $("toast");

  t.textContent = msg;
  t.style.display = "block";

  clearTimeout(window.tt);

  window.tt = setTimeout(() => {
    t.style.display = "none";
  }, 2800);
}


/* =========================
   API
========================= */

async function api(url, method = "GET", body = null) {

  const r = await fetch(url, {
    method: method,

    headers: body
      ? { "Content-Type": "application/json" }
      : {},

    body: body
      ? JSON.stringify(body)
      : null
  });

  return await r.json();
}


/* =========================
   CLEAR FIELDS
========================= */

function clearFields(...ids) {

  ids.forEach(id => {

    const el = $(id);

    if (el) {
      el.value = "";
    }

  });
}


/* =========================
   TABS
========================= */

document
  .querySelectorAll(".tab")
  .forEach(button => {

    button.onclick = () => {

      document
        .querySelectorAll(".tab")
        .forEach(x => {
          x.classList.remove("active");
        });

      document
        .querySelectorAll(".page")
        .forEach(x => {
          x.classList.remove("active");
        });

      button.classList.add("active");

      $(button.dataset.page)
        .classList.add("active");
    };

  });


/* =========================
   PALLET IN
========================= */

async function putIn() {

  const r = await api(
    "/api/in",
    "POST",
    {
      pallet_id:
        $("inPallet").value.trim(),

      location:
        $("inLocation")
          .value
          .trim()
          .toUpperCase()
    }
  );


  toast(
    r.ok
      ? "✓ " + r.message
      : "⚠ " + r.error
  );


  if (r.ok) {

    clearFields(
      "inPallet",
      "inLocation"
    );

    $("inPallet").focus();

    refreshStats();

    loadLocations();
  }
}


/* =========================
   MOVE PALLET
========================= */

async function movePallet() {

  const r = await api(
    "/api/move",
    "POST",
    {
      pallet_id:
        $("movePallet").value.trim(),

      location:
        $("moveLocation")
          .value
          .trim()
          .toUpperCase()
    }
  );


  toast(
    r.ok
      ? "✓ " + r.message
      : "⚠ " + r.error
  );


  if (r.ok) {

    clearFields(
      "movePallet",
      "moveLocation"
    );

    $("movePallet").focus();

    refreshStats();

    loadLocations();
  }
}


/* =========================
   PALLET OUT
========================= */

async function takeOut() {

  const r = await api(
    "/api/out",
    "POST",
    {
      pallet_id:
        $("outPallet").value.trim()
    }
  );


  toast(
    r.ok
      ? "✓ " + r.message
      : "⚠ " + r.error
  );


  if (r.ok) {

    clearFields(
      "outPallet"
    );

    $("outPallet").focus();

    refreshStats();

    loadLocations();
  }
}


/* =========================
   FIND PALLET
========================= */

async function findPallet() {

  const value =
    $("findPallet")
      .value
      .trim();


  if (!value) {
    return;
  }


  const id =
    encodeURIComponent(value);


  const r =
    await api(
      "/api/find/" + id
    );


  const el =
    $("findResult");


  if (!r.ok) {

    el.innerHTML = `
      <div class="error">
        ${r.error}
      </div>
    `;

    return;
  }


  const p =
    r.pallet;


  const hist =
    r.history.map(x => `

      <tr>

        <td>
          ${x.action}
        </td>

        <td>
          ${x.old_location || "—"}
        </td>

        <td>
          ${x.new_location || "—"}
        </td>

        <td>
          ${x.timestamp}
        </td>

      </tr>

    `).join("");


  el.innerHTML = `

    <div class="ok detail">

      <strong>
        📦 ${p.pallet_id}
      </strong>

      <br>

      Status:
      <b>
        ${p.status}
      </b>

      <br>

      📍 Location:
      <b>
        ${p.location || "OUT"}
      </b>

      <br>

      Product:
      ${p.product || "—"}

      <br>

      Lot:
      ${p.lot || "—"}

      &nbsp;

      Qty:
      ${p.qty || "—"}

      &nbsp;

      Brand:
      ${p.brand || "—"}


      <table>

        <tr>

          <th>
            Action
          </th>

          <th>
            From
          </th>

          <th>
            To
          </th>

          <th>
            Time
          </th>

        </tr>

        ${hist}

      </table>

    </div>

  `;
}


/* =========================
   FIND LOCATION
========================= */

async function findLocation() {

  const value =
    $("locationSearch")
      .value
      .trim()
      .toUpperCase();


  if (!value) {
    return;
  }


  const loc =
    encodeURIComponent(value);


  const r =
    await api(
      "/api/location/" + loc
    );


  const el =
    $("locationResult");


  if (!r.ok) {

    el.innerHTML = `
      <div class="error">
        ${r.error}
      </div>
    `;

    return;
  }


  const x =
    r.location;

  const p =
    r.pallet;


  if (p) {

    el.innerHTML = `

      <div class="ok detail">

        <strong>
          ${x.location_id}
        </strong>

        <br>

        Room ${x.room}
        • Rack ${x.rack}
        • Level ${x.level}
        • Position ${x.position}

        <hr>

        📦 Pallet:

        <b>
          ${p.pallet_id}
        </b>

        <br>

        ${p.product || ""}

        ${
          p.lot
            ? "• Lot " + p.lot
            : ""
        }

      </div>

    `;

  } else {

    el.innerHTML = `

      <div class="ok detail">

        <strong>
          ${x.location_id}
        </strong>

        <br>

        Room ${x.room}
        • Rack ${x.rack}
        • Level ${x.level}
        • Position ${x.position}

        <hr>

        ✅ <b>EMPTY</b>

      </div>

    `;

  }
}


/* =========================
   LOAD LOCATIONS
========================= */

async function loadLocations() {

  const rows =
    await api(
      "/api/locations"
    );


  $("locationGrid").innerHTML =

    `<div class="locgrid">`

    +

    rows.map(x => `

      <div
        class="loc ${
          x.pallet_id
            ? "occupied"
            : ""
        }"
      >

        <b>
          ${x.location_id}
        </b>

        <br>

        ${
          x.pallet_id
            ? "📦 " + x.pallet_id
            : "✅ Empty"
        }

      </div>

    `).join("")

    +

    `</div>`;
}


/* =========================
   STATS
========================= */

async function refreshStats() {

  const s =
    await api(
      "/api/stats"
    );


  $("occupied").textContent =
    s.occupied;

  $("available").textContent =
    s.available;

  $("total").textContent =
    s.total_locations;
}


/* =========================================
   ZXING CAMERA BARCODE SCANNER
========================================= */

async function openScanner(target) {

  /*
    Save which input should receive
    the barcode.
  */

  scanTarget =
    target;


  /*
    Open scanner popup.
  */

  $("scannerModal")
    .classList
    .add("show");


  /*
    Do not start a second scanner.
  */

  if (scanning) {
    return;
  }


  scanning =
    true;


  const reader =
    $("reader");


  /*
    Create video preview.
  */

  reader.innerHTML = `

    <div
      style="
        position:relative;
        width:100%;
        background:#000;
        overflow:hidden;
        border-radius:10px;
      "
    >

      <video
        id="barcodeVideo"
        autoplay
        playsinline
        muted

        style="
          display:block;
          width:100%;
          height:auto;
          max-height:65vh;
          object-fit:cover;
          background:#000;
        "
      >
      </video>


      <!-- Visual scan guide -->

      <div
        style="
          position:absolute;
          left:5%;
          right:5%;
          top:40%;
          height:20%;
          border:3px solid #00ff66;
          border-radius:8px;
          pointer-events:none;
          box-sizing:border-box;
        "
      >
      </div>

    </div>


    <div
      style="
        text-align:center;
        padding:12px 5px 4px;
        font-size:15px;
        font-weight:600;
      "
    >

      Put ONE barcode inside the green box

    </div>

  `;


  try {

    /*
      Make sure ZXing loaded.
    */

    if (
      !window.ZXingBrowser
    ) {

      throw new Error(
        "ZXing barcode library did not load."
      );
    }


    const video =
      $("barcodeVideo");


    /*
      Ask for rear camera.
    */

    const constraints = {

      video: {

        facingMode: {
          ideal: "environment"
        },


        width: {
          ideal: 1920
        },


        height: {
          ideal: 1080
        }

      },


      audio: false

    };


    /*
      ZXing Multi Format Reader.

      This supports common warehouse
      barcode formats including:

      Code 128
      Code 39
      Code 93
      ITF
      EAN
      UPC
      QR
      Data Matrix
      and others.
    */

    const codeReader =
      new ZXingBrowser
        .BrowserMultiFormatReader();


    /*
      Begin continuous camera scanning.
    */

    scannerControls =
      await codeReader
        .decodeFromConstraints(

          constraints,

          video,

          async (
            result,
            error,
            controls
          ) => {

            /*
              No barcode yet.

              This happens constantly
              while the camera is looking.
            */

            if (!result) {
              return;
            }


            /*
              Barcode found.
            */

            let text = "";


            try {

              text =
                result.getText();

            }

            catch (e) {

              text =
                result.text || "";

            }


            text =
              String(text)
                .trim();


            if (!text) {
              return;
            }


            /*
              Stop scanner immediately
              so the same barcode does
              not scan repeatedly.
            */

            try {

              if (controls) {
                controls.stop();
              }

            }

            catch (e) {}


            scannerControls =
              null;


            scanning =
              false;


            /*
              Put scanned value into
              correct warehouse field.
            */

            const input =
              $(scanTarget);


            if (input) {

              input.value =
                text;

            }


            /*
              Vibrate phone.
            */

            try {

              if (
                navigator.vibrate
              ) {

                navigator.vibrate(
                  [100, 40, 100]
                );

              }

            }

            catch (e) {}


            /*
              Show success.
            */

            toast(
              "✓ Barcode scanned: " +
              text
            );


            /*
              Close camera.
            */

            await closeScanner();


            /*
              Return focus to input.
            */

            if (input) {

              input.focus();

            }

          }

        );


    /*
      Store camera stream.
    */

    scannerStream =
      video.srcObject;


    /*
      Try to improve focus on supported
      phone cameras.
    */

    try {

      if (scannerStream) {

        const tracks =
          scannerStream
            .getVideoTracks();


        if (
          tracks &&
          tracks.length
        ) {

          const track =
            tracks[0];


          const capabilities =
            track.getCapabilities
              ? track.getCapabilities()
              : {};


          /*
            Continuous autofocus.
          */

          if (
            capabilities.focusMode &&
            capabilities.focusMode
              .includes("continuous")
          ) {

            await track
              .applyConstraints({

                advanced: [
                  {
                    focusMode:
                      "continuous"
                  }
                ]

              });

          }


          /*
            Prefer higher resolution
            when supported.
          */

          try {

            await track
              .applyConstraints({

                width: {
                  ideal: 1920
                },

                height: {
                  ideal: 1080
                }

              });

          }

          catch (e) {}

        }

      }

    }

    catch (e) {

      console.log(
        "Advanced camera controls unavailable",
        e
      );

    }

  }

  catch (e) {

    console.error(
      "SCANNER ERROR:",
      e
    );


    scanning =
      false;


    let message =
      e && e.message
        ? e.message
        : String(e);


    reader.innerHTML = `

      <div class="error">

        <b>
          Scanner could not start
        </b>

        <br><br>

        ${message}

        <br><br>

        Make sure Safari has camera
        permission for this website.

      </div>

    `;

  }

}


/* =========================================
   CLOSE SCANNER
========================================= */

async function closeScanner() {

  /*
    Stop ZXing.
  */

  try {

    if (
      scannerControls
    ) {

      scannerControls.stop();

    }

  }

  catch (e) {}


  scannerControls =
    null;


  /*
    Stop stored camera stream.
  */

  try {

    if (
      scannerStream
    ) {

      scannerStream
        .getTracks()
        .forEach(track => {

          track.stop();

        });

    }

  }

  catch (e) {}


  scannerStream =
    null;


  /*
    Stop video element stream.
  */

  try {

    const video =
      $("barcodeVideo");


    if (
      video &&
      video.srcObject
    ) {

      video.srcObject
        .getTracks()
        .forEach(track => {

          track.stop();

        });


      video.srcObject =
        null;

    }

  }

  catch (e) {}


  scanning =
    false;


  /*
    Remove camera preview.
  */

  const reader =
    $("reader");


  if (reader) {

    reader.innerHTML =
      "";

  }


  /*
    Close modal.
  */

  $("scannerModal")
    .classList
    .remove("show");

}


/* =========================
   INPUT BEHAVIOR
========================= */

document
  .querySelectorAll("input")
  .forEach(input => {

    input.addEventListener(
      "keydown",
      event => {

        /*
          Hardware Zebra / Android
          scanners often send ENTER
          after scanning.

          We prevent normal form
          submission.
        */

        if (
          event.key === "Enter"
        ) {

          event.preventDefault();

        }

      }
    );

  });


/* =========================
   INITIAL LOAD
========================= */

refreshStats();

loadLocations();


/* =========================
   SERVICE WORKER
========================= */

if (
  "serviceWorker" in navigator
) {

  navigator
    .serviceWorker
    .register(
      "/static/sw.js"
    )
    .catch(error => {

      console.log(
        "Service worker:",
        error
      );

    });

}
