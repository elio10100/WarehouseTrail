let scanTarget=null, scanner=null;

const $ = id => document.getElementById(id);

function toast(msg){
  const t=$("toast");
  t.textContent=msg;
  t.style.display="block";
  clearTimeout(window.tt);
  window.tt=setTimeout(()=>t.style.display="none",2800);
}

async function api(url,method="GET",body=null){
  const r=await fetch(url,{
    method,
    headers:body?{"Content-Type":"application/json"}:{},
    body:body?JSON.stringify(body):null
  });
  return await r.json();
}

function clearFields(...ids){
  ids.forEach(id=>$(id).value="");
}

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  $(b.dataset.page).classList.add("active");
});

async function putIn(){
  const r=await api("/api/in","POST",{
    pallet_id:$("inPallet").value,
    location:$("inLocation").value
  });

  toast(r.ok?"✓ "+r.message:"⚠ "+r.error);

  if(r.ok){
    clearFields("inPallet","inLocation");
    $("inPallet").focus();
    refreshStats();
    loadLocations();
  }
}

async function movePallet(){
  const r=await api("/api/move","POST",{
    pallet_id:$("movePallet").value,
    location:$("moveLocation").value
  });

  toast(r.ok?"✓ "+r.message:"⚠ "+r.error);

  if(r.ok){
    clearFields("movePallet","moveLocation");
    $("movePallet").focus();
    refreshStats();
    loadLocations();
  }
}

async function takeOut(){
  const r=await api("/api/out","POST",{
    pallet_id:$("outPallet").value
  });

  toast(r.ok?"✓ "+r.message:"⚠ "+r.error);

  if(r.ok){
    clearFields("outPallet");
    $("outPallet").focus();
    refreshStats();
    loadLocations();
  }
}

async function findPallet(){
  const id=encodeURIComponent(
    $("findPallet").value.trim()
  );

  if(!id)return;

  const r=await api("/api/find/"+id);
  const el=$("findResult");

  if(!r.ok){
    el.innerHTML=`<div class="error">${r.error}</div>`;
    return;
  }

  const p=r.pallet;

  const hist=r.history.map(x=>
    `<tr>
      <td>${x.action}</td>
      <td>${x.old_location||"—"}</td>
      <td>${x.new_location||"—"}</td>
      <td>${x.timestamp}</td>
    </tr>`
  ).join("");

  el.innerHTML=`
    <div class="ok detail">
      <strong>📦 ${p.pallet_id}</strong><br>
      Status: <b>${p.status}</b><br>
      📍 Location: <b>${p.location||"OUT"}</b><br>
      Product: ${p.product||"—"}<br>
      Lot: ${p.lot||"—"} &nbsp;
      Qty: ${p.qty||"—"} &nbsp;
      Brand: ${p.brand||"—"}

      <table>
        <tr>
          <th>Action</th>
          <th>From</th>
          <th>To</th>
          <th>Time</th>
        </tr>
        ${hist}
      </table>
    </div>`;
}

async function findLocation(){
  const loc=encodeURIComponent(
    $("locationSearch").value.trim().toUpperCase()
  );

  if(!loc)return;

  const r=await api("/api/location/"+loc);
  const el=$("locationResult");

  if(!r.ok){
    el.innerHTML=`<div class="error">${r.error}</div>`;
    return;
  }

  const x=r.location;
  const p=r.pallet;

  el.innerHTML=p
    ? `<div class="ok detail">
        <strong>${x.location_id}</strong><br>
        Room ${x.room} • Rack ${x.rack} • Level ${x.level} • Position ${x.position}
        <hr>
        📦 Pallet: <b>${p.pallet_id}</b><br>
        ${p.product||""}
        ${p.lot?"• Lot "+p.lot:""}
      </div>`
    : `<div class="ok detail">
        <strong>${x.location_id}</strong><br>
        Room ${x.room} • Rack ${x.rack} • Level ${x.level} • Position ${x.position}
        <hr>
        ✅ <b>EMPTY</b>
      </div>`;
}

async function loadLocations(){
  const rows=await api("/api/locations");

  $("locationGrid").innerHTML=
    `<div class="locgrid">`+
    rows.map(x=>
      `<div class="loc ${x.pallet_id?"occupied":""}">
        <b>${x.location_id}</b><br>
        ${x.pallet_id?"📦 "+x.pallet_id:"✅ Empty"}
      </div>`
    ).join("")+
    `</div>`;
}

async function refreshStats(){
  const s=await api("/api/stats");

  $("occupied").textContent=s.occupied;
  $("available").textContent=s.available;
  $("total").textContent=s.total_locations;
}


/* =========================================
   IMPROVED PHONE BARCODE SCANNER
   ========================================= */

async function openScanner(target){

  scanTarget=target;

  $("scannerModal").classList.add("show");

  if(scanner) return;

  scanner=new Html5Qrcode("reader",{

    formatsToSupport:[

      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,

      Html5QrcodeSupportedFormats.CODABAR,

      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,

      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,

      Html5QrcodeSupportedFormats.ITF,

      Html5QrcodeSupportedFormats.QR_CODE

    ],

    verbose:false

  });

  try{

    await scanner.start(

      {
        facingMode:{
          ideal:"environment"
        }
      },

      {

        fps:20,

        /*
        Wide rectangular scan area.
        Better for warehouse pallet barcodes.
        */

        qrbox:(viewfinderWidth,viewfinderHeight)=>{

          const width=
            Math.floor(viewfinderWidth*0.92);

          const height=
            Math.min(
              180,
              Math.floor(viewfinderHeight*0.38)
            );

          return{
            width:width,
            height:height
          };

        },

        aspectRatio:1.777778,

        disableFlip:true

      },

      text=>{

        if(!scanTarget)return;

        const scannedValue=
          String(text).trim();

        $(scanTarget).value=
          scannedValue;

        /*
        Vibrate phone when barcode
        is successfully captured.
        */

        if(navigator.vibrate){
          navigator.vibrate(80);
        }

        closeScanner();

        toast(
          "✓ Scan captured: "+
          scannedValue
        );

        $(scanTarget).focus();

      },

      errorMessage=>{
        /*
        Ignore individual failed frames.
        Camera continues looking for barcode.
        */
      }

    );

  }catch(e){

    console.error(
      "Scanner error:",
      e
    );

    $("reader").innerHTML=
      "<div class='error'>Camera could not start. Check camera permission and try again.</div>";

  }
}


async function closeScanner(){

  if(scanner){

    try{
      await scanner.stop();
    }catch(e){}

    try{
      scanner.clear();
    }catch(e){}

    scanner=null;

  }

  $("reader").innerHTML="";

  $("scannerModal")
    .classList.remove("show");
}


/*
Prevent scanner/keyboard Enter key
from accidentally submitting forms.
*/

document
  .querySelectorAll("input")
  .forEach(i=>
    i.addEventListener(
      "keydown",
      e=>{

        if(e.key==="Enter"){
          e.preventDefault();
        }

      }
    )
  );


refreshStats();

loadLocations();


if("serviceWorker" in navigator){

  navigator
    .serviceWorker
    .register("/static/sw.js")
    .catch(()=>{});

}
