const $ = (id) => document.getElementById(id);

let scanner = null;
let scanTarget = null;
let scannerControls = null;


// ============================================================
// GENERAL HELPERS
// ============================================================

function toast(message) {

    const el = $("toast");

    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    setTimeout(() => {
        el.classList.remove("show");
    }, 2500);
}


function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


async function api(url, options = {}) {

    const response = await fetch(url, options);

    let data;

    try {
        data = await response.json();
    } catch (e) {
        data = {
            ok: false,
            error: "Server returned an invalid response."
        };
    }

    if (!response.ok) {
        throw new Error(
            data.error ||
            data.message ||
            "Request failed."
        );
    }

    return data;
}


function clearInput(id) {

    const input = $(id);

    if (input) {
        input.value = "";
    }
}


// ============================================================
// QR DATA PARSER
// ============================================================

function parsePalletQR(raw) {

    raw = String(raw || "").trim();

    const result = {
        pallet_id: raw,
        lot: "",
        product: "",
        packing: "",
        weight: "",
        qty: "",
        brand: "",
        raw_qr: raw
    };

    /*
        Example QR:

        ip:04730905|qp:1{p}l:2005,d:CARROT,p:BAG,w:0,qb:
    */

    const palletMatch =
        raw.match(/(?:^|\|)ip:([^|]+)/i);

    if (palletMatch) {
        result.pallet_id =
            palletMatch[1].trim();
    }

    const lotMatch =
        raw.match(/(?:\{p\}|^|,)l:([^,|]*)/i);

    if (lotMatch) {
        result.lot =
            lotMatch[1].trim();
    }

    const descriptionMatch =
        raw.match(/(?:^|,)d:([^,|]*)/i);

    if (descriptionMatch) {
        result.product =
            descriptionMatch[1].trim();
    }

    const packingMatch =
        raw.match(/(?:^|,)p:([^,|]*)/i);

    if (packingMatch) {
        result.packing =
            packingMatch[1].trim();
    }

    const weightMatch =
        raw.match(/(?:^|,)w:([^,|]*)/i);

    if (weightMatch) {
        result.weight =
            weightMatch[1].trim();
    }

    const qtyMatch =
        raw.match(/(?:^|,)qb:([^,|]*)/i);

    if (qtyMatch) {
        result.qty =
            qtyMatch[1].trim();
    }

    const brandMatch =
        raw.match(/(?:^|,)b:([^,|]*)/i);

    if (brandMatch) {
        result.brand =
            brandMatch[1].trim();
    }

    return result;
}


// ============================================================
// SCANNER
// ============================================================

async function openScanner(target) {

    scanTarget = target;

    const modal = $("scannerModal");
    const reader = $("reader");

    if (!modal || !reader) {
        alert("Scanner window not found.");
        return;
    }

    modal.classList.add("show");
    reader.innerHTML = "";

    // Stop any old scanner before starting a new one
    if (scanner) {

        try {
            await scanner.stop();
        } catch (e) {}

        try {
            scanner.clear();
        } catch (e) {}

        scanner = null;
    }

    scannerControls = null;

    // Make sure html5-qrcode loaded
    if (typeof Html5Qrcode === "undefined") {

        reader.innerHTML =
            "<div class='error'>" +
            "Scanner library did not load. Refresh the page and try again." +
            "</div>";

        return;
    }

   scanner = new Html5Qrcode("reader");

try {

    await scanner.start(
        { facingMode: "environment" },
        {
            fps: 10,
            qrbox: {
                width: 250,
                height: 250
            }
        },
        decodedText => {
            if (!decodedText) return;
            handleScan(decodedText);
        },
        () => {}
    );

} catch (error) {

        console.error(
            "Scanner startup error:",
            error
        );

        scanner = null;

        reader.innerHTML =
            "<div class='error'>" +
            "Camera could not start: " +
            escapeHtml(
                error && error.message
                    ? error.message
                    : String(error)
            ) +
            "</div>";
    }
}


async function closeScanner() {

    if (scanner) {

        try {
            await scanner.stop();
        } catch (e) {}

        try {
            scanner.clear();
        } catch (e) {}

        scanner = null;
    }

    scannerControls = null;

    const reader = $("reader");

    if (reader) {
        reader.innerHTML = "";
    }

    const modal = $("scannerModal");

    if (modal) {
        modal.classList.remove("show");
    }
}



function handleScan(text) {

    text = String(text || "").trim();

    if (!text || !scanTarget) {
        return;
    }

    const target = $(scanTarget);

    if (!target) {
        closeScanner();
        return;
    }

    /*
        For pallet fields we keep the ENTIRE QR string.

        The server will extract:
        Pallet ID
        Lot
        Description
        Packing
        Weight
        Qty
        Brand
    */

    const palletFields = [
        "inPallet",
        "movePallet",
        "outPallet",
        "findPallet"
    ];

    if (palletFields.includes(scanTarget)) {

        const parsed =
            parsePalletQR(text);

        target.value = text;

        showScannedPalletInfo(
            scanTarget,
            parsed
        );

    } else {

        target.value =
            text.trim().toUpperCase();
    }

    if (navigator.vibrate) {
        navigator.vibrate(100);
    }

    const currentTarget =
        scanTarget;

    closeScanner();

    toast("✓ Scan captured");

    /*
        Automatically move to the next logical step.
    */

    if (currentTarget === "inPallet") {

        setTimeout(() => {

            const location =
                $("inLocation");

            if (location) {
                location.focus();
            }

        }, 250);
    }

    if (currentTarget === "movePallet") {

        setTimeout(() => {

            const location =
                $("moveLocation");

            if (location) {
                location.focus();
            }

        }, 250);
    }

    if (currentTarget === "findPallet") {

        setTimeout(() => {
            findPallet();
        }, 250);
    }
}


// ============================================================
// SCANNED PALLET INFORMATION
// ============================================================

function showScannedPalletInfo(
    targetId,
    parsed
) {

    let containerId = null;

    if (targetId === "inPallet") {
        containerId = "inScanInfo";
    }

    if (targetId === "movePallet") {
        containerId = "moveScanInfo";
    }

    if (targetId === "outPallet") {
        containerId = "outScanInfo";
    }

    if (targetId === "findPallet") {
        containerId = "findScanInfo";
    }

    if (!containerId) {
        return;
    }

    let container =
        $(containerId);

    /*
        If the HTML does not already contain the information
        box, create it automatically.
    */

    if (!container) {

        const target =
            $(targetId);

        if (!target) return;

        const scanRow =
            target.closest(".scanrow");

        if (!scanRow) return;

        container =
            document.createElement("div");

        container.id =
            containerId;

        container.className =
            "scan-data-card";

        scanRow.insertAdjacentElement(
            "afterend",
            container
        );
    }

    container.innerHTML = `
        <div class="scan-data-title">
            ✓ Pallet Read
        </div>

        <div class="scan-data-grid">

            <div>
                <span>Pallet ID</span>
                <b>${escapeHtml(parsed.pallet_id || "-")}</b>
            </div>

            <div>
                <span>Lot</span>
                <b>${escapeHtml(parsed.lot || "-")}</b>
            </div>

            <div>
                <span>Description</span>
                <b>${escapeHtml(parsed.product || "-")}</b>
            </div>

            <div>
                <span>Packing</span>
                <b>${escapeHtml(parsed.packing || "-")}</b>
            </div>

            <div>
                <span>Weight</span>
                <b>${escapeHtml(parsed.weight || "-")}</b>
            </div>

        </div>
    `;
}


// ============================================================
// PUT PALLET IN
// ============================================================

async function putIn() {

    const pallet =
        $("inPallet").value.trim();

    const location =
        $("inLocation")
            .value
            .trim()
            .toUpperCase();

    if (!pallet) {
        toast("Scan pallet first.");
        return;
    }

    if (!location) {
        toast("Scan rack location.");
        return;
    }

    try {

        const data =
            await api(
                "/api/in",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        pallet_id: pallet,
                        location: location
                    })
                }
            );

        toast(
            "✓ " +
            data.pallet_id +
            " → " +
            data.location
        );

        clearInput("inPallet");
        clearInput("inLocation");

        const scanInfo =
            $("inScanInfo");

        if (scanInfo) {
            scanInfo.innerHTML = "";
        }

        await loadStats();
        await loadLocations();

        $("inPallet").focus();

    } catch (error) {

        alert(error.message);
    }
}


// ============================================================
// MOVE PALLET
// ============================================================

async function movePallet() {

    const pallet =
        $("movePallet")
            .value
            .trim();

    const location =
        $("moveLocation")
            .value
            .trim()
            .toUpperCase();

    if (!pallet || !location) {

        toast(
            "Scan pallet and new location."
        );

        return;
    }

    try {

        const data =
            await api(
                "/api/move",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        pallet_id: pallet,
                        location: location
                    })
                }
            );

        toast(
            "✓ " +
            data.pallet_id +
            " moved to " +
            data.location
        );

        clearInput("movePallet");
        clearInput("moveLocation");

        const scanInfo =
            $("moveScanInfo");

        if (scanInfo) {
            scanInfo.innerHTML = "";
        }

        await loadStats();
        await loadLocations();

    } catch (error) {

        alert(error.message);
    }
}


// ============================================================
// TAKE PALLET OUT
// ============================================================

async function takeOut() {

    const pallet =
        $("outPallet")
            .value
            .trim();

    if (!pallet) {

        toast("Scan pallet first.");
        return;
    }

    try {

        const data =
            await api(
                "/api/out",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        pallet_id: pallet
                    })
                }
            );

        toast(
            "✓ " +
            data.pallet_id +
            " OUT"
        );

        clearInput("outPallet");

        const scanInfo =
            $("outScanInfo");

        if (scanInfo) {
            scanInfo.innerHTML = "";
        }

        await loadStats();
        await loadLocations();

    } catch (error) {

        alert(error.message);
    }
}


// ============================================================
// FIND PALLET
// ============================================================

async function findPallet() {

    const raw =
        $("findPallet")
            .value
            .trim();

    if (!raw) {

        toast("Scan or enter pallet ID.");
        return;
    }

    const parsed =
        parsePalletQR(raw);

    const palletId =
        parsed.pallet_id;

    const result =
        $("findResult");

    result.innerHTML =
        "<div class='loading'>Searching...</div>";

    try {

        const data =
            await api(
                "/api/find/" +
                encodeURIComponent(
                    palletId
                )
            );

        const pallet =
            data.pallet;

        let statusHtml;

        if (pallet.status === "IN") {

            statusHtml = `
                <div class="status-in">
                    IN WAREHOUSE
                </div>
            `;

        } else {

            statusHtml = `
                <div class="status-out">
                    OUT
                </div>
            `;
        }

        let historyHtml = "";

        if (
            data.history &&
            data.history.length
        ) {

            historyHtml =
                "<h3>History</h3>";

            historyHtml +=
                "<div class='history-list'>";

            data.history.forEach(
                item => {

                    historyHtml += `
                        <div class="history-item">

                            <b>
                                ${escapeHtml(item.action)}
                            </b>

                            <span>
                                ${escapeHtml(item.old_location || "")}
                                ${item.new_location ? " → " + escapeHtml(item.new_location) : ""}
                            </span>

                            <small>
                                ${escapeHtml(item.timestamp || "")}
                            </small>

                        </div>
                    `;
                }
            );

            historyHtml +=
                "</div>";
        }

        result.innerHTML = `

            <div class="pallet-result">

                ${statusHtml}

                <div class="result-location">
                    ${escapeHtml(
                        pallet.location ||
                        "No current location"
                    )}
                </div>

                <div class="result-grid">

                    <div>
                        <span>Pallet ID</span>
                        <b>
                            ${escapeHtml(
                                pallet.pallet_id
                            )}
                        </b>
                    </div>

                    <div>
                        <span>Lot</span>
                        <b>
                            ${escapeHtml(
                                pallet.lot || "-"
                            )}
                        </b>
                    </div>

                    <div>
                        <span>Description</span>
                        <b>
                            ${escapeHtml(
                                pallet.product || "-"
                            )}
                        </b>
                    </div>

                    <div>
                        <span>Packing</span>
                        <b>
                            ${escapeHtml(
                                pallet.packing || "-"
                            )}
                        </b>
                    </div>

                    <div>
                        <span>Weight</span>
                        <b>
                            ${escapeHtml(
                                pallet.weight || "-"
                            )}
                        </b>
                    </div>                             )}
                        </b>
                    </div>

                    <div>
                        <span>Status</span>
                        <b>
                            ${escapeHtml(
                                pallet.status
                            )}
                        </b>
                    </div>

                </div>

                ${historyHtml}

            </div>
        `;

    } catch (error) {

        result.innerHTML = `
            <div class="error">
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}


// ============================================================
// LOCATION SEARCH
// ============================================================

async function findLocation() {

    const location =
        $("locationSearch")
            .value
            .trim()
            .toUpperCase();

    const result =
        $("locationResult");

    if (!location) {

        toast(
            "Scan or enter rack location."
        );

        return;
    }

    result.innerHTML =
        "<div class='loading'>Checking...</div>";

    try {

        const data =
            await api(
                "/api/location/" +
                encodeURIComponent(location)
            );

        if (!data.pallet) {

            result.innerHTML = `

                <div class="location-free">

                    <h3>
                        ${escapeHtml(location)}
                    </h3>

                    <div class="available-badge">
                        AVAILABLE
                    </div>

                </div>
            `;

            return;
        }

        const pallet =
            data.pallet;

        result.innerHTML = `

            <div class="location-occupied">

                <h3>
                    ${escapeHtml(location)}
                </h3>

                <div class="occupied-badge">
                    OCCUPIED
                </div>

                <div class="result-grid">

                    <div>
                        <span>Pallet</span>
                        <b>
                            ${escapeHtml(
                                pallet.pallet_id
                            )}
                        </b>
                    </div>

                    <div>
                        <span>Lot</span>
                        <b>
                            ${escapeHtml(
                                pallet.lot || "-"
                            )}
                        </b>
                    </div>

                    <div>
                        <span>Description</span>
                        <b>
                            ${escapeHtml(
                                pallet.product || "-"
                            )}
                        </b>
                    </div>

                    <div>
                        <span>Packing</span>
                        <b>
                            ${escapeHtml(
                                pallet.packing || "-"
                            )}
                        </b>
                    </div>

                </div>

            </div>
        `;

    } catch (error) {

        result.innerHTML = `
            <div class="error">
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}


// ============================================================
// ADVANCED INVENTORY SEARCH
// ============================================================

async function searchInventory() {

    const params =
        new URLSearchParams();

    const fields = {

        searchPallet:
            "pallet_id",

        searchLot:
            "lot",

        searchProduct:
            "product",

        searchPacking:
            "packing",

        searchWeight:
            "weight",

        searchLocation:
            "location",

        searchStatus:
            "status"
    };

    Object.entries(fields)
        .forEach(
            ([elementId, parameter]) => {

                const element =
                    $(elementId);

                if (!element) {
                    return;
                }

                const value =
                    element.value.trim();

                if (value) {

                    params.append(
                        parameter,
                        value
                    );
                }
            }
        );

    const result =
        $("inventoryResults");

    if (!result) {
        return;
    }

    result.innerHTML =
        "<div class='loading'>Searching inventory...</div>";

    try {

        const data =
            await api(
                "/api/search?" +
                params.toString()
            );

        renderInventoryResults(
            data.pallets || []
        );

    } catch (error) {

        result.innerHTML = `
            <div class="error">
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}


function renderInventoryResults(
    pallets
) {

    const result =
        $("inventoryResults");

    if (!result) {
        return;
    }

   result.style.display = "block";

if (!pallets.length) {

    result.innerHTML = `
            <div class="empty-result">
                No pallets found.
            </div>
        `;

        return;
    }

    let html = `

        <div class="inventory-count">
            ${pallets.length}
            pallet${pallets.length === 1 ? "" : "s"} found
        </div>

        <div class="inventory-list">
    `;

    pallets.forEach(
        pallet => {

            html += `

                <div class="inventory-card">

                    <div class="inventory-card-top">

                        <div>
                            <span class="inventory-label">
                                PALLET
                            </span>

                            <b class="inventory-pallet">
                                ${escapeHtml(
                                    pallet.pallet_id
                                )}
                            </b>
                        </div>

                        <div class="inventory-location">
                            ${escapeHtml(
                                pallet.location ||
                                "OUT"
                            )}
                        </div>

                    </div>

                    <div class="inventory-details">

                        <div>
                            <span>Lot</span>
                            <b>
                                ${escapeHtml(
                                    pallet.lot || "-"
                                )}
                            </b>
                        </div>

                        <div>
                            <span>Description</span>
                            <b>
                                ${escapeHtml(
                                    pallet.product || "-"
                                )}
                            </b>
                        </div>

                        <div>
                            <span>Packing</span>
                            <b>
                                ${escapeHtml(
                                    pallet.packing || "-"
                                )}
                            </b>
                        </div>

                        <div>
                            <span>Weight</span>
                            <b>
                                ${escapeHtml(
                                    pallet.weight || "-"
                                )}
                            </b>
                        </div>

                    </div>

                </div>
            `;
        }
    );

    html += "</div>";

    result.innerHTML =
        html;
}


function clearInventorySearch() {

    [
        "searchPallet",
        "searchLot",
        "searchProduct",
        "searchPacking",
        "searchWeight",
        "searchLocation"
    ].forEach(
        id => {

            const element =
                $(id);

            if (element) {
                element.value = "";
            }
        }
    );

    const status =
        $("searchStatus");

    if (status) {
        status.value = "IN";
    }

    searchInventory();
}


// ============================================================
// STATS
// ============================================================

async function loadStats() {

    try {

        const data =
            await api(
                "/api/stats"
            );

        if ($("occupied")) {
            $("occupied").textContent =
                data.occupied;
        }

        if ($("available")) {
            $("available").textContent =
                data.available;
        }

        if ($("total")) {
            $("total").textContent =
                data.total_locations;
        }

    } catch (error) {

        console.error(
            "Stats error:",
            error
        );
    }
}


// ============================================================
// LOCATION GRID
// ============================================================

async function loadLocations() {

    const grid =
        $("locationGrid");

    if (!grid) {
        return;
    }

    try {

        const locations =
            await api(
                "/api/locations"
            );

        let html = "";

        let currentRoom = null;
        let currentRack = null;

        locations.forEach(
            location => {

                if (
                    currentRoom !==
                    location.room
                ) {

                    if (
                        currentRack !== null
                    ) {

                        html +=
                            "</div></div>";
                    }

                    if (
                        currentRoom !== null
                    ) {

                        html +=
                            "</div>";
                    }

                    currentRoom =
                        location.room;

                    currentRack = null;

                    html += `

                        <div class="room-section">

                            <h3>
                                Room ${location.room}
                            </h3>
                    `;
                }

                if (
                    currentRack !==
                    location.rack
                ) {

                    if (
                        currentRack !== null
                    ) {

                        html +=
                            "</div></div>";
                    }

                    currentRack =
                        location.rack;

                    html += `

                        <div class="rack-section">

                            <h4>
                                Rack ${location.rack}
                            </h4>

                            <div class="rack-grid">
                    `;
                }

                const occupied =
                    Boolean(
                        location.pallet_id
                    );

                html += `

                    <button
                        class="location-cell ${occupied ? "occupied" : "available"}"
                        onclick="openLocationFromGrid('${escapeHtml(location.location_id)}')"
                    >

                        <b>
                            ${escapeHtml(
                                location.location_id
                            )}
                        </b>

                        <span>
                            ${
                                occupied
                                ? escapeHtml(
                                    location.pallet_id
                                )
                                : "Available"
                            }
                        </span>

                    </button>
                `;
            }
        );

        if (
            currentRack !== null
        ) {

            html +=
                "</div></div>";
        }

        if (
            currentRoom !== null
        ) {

            html +=
                "</div>";
        }

        grid.innerHTML =
            html;

    } catch (error) {

        grid.innerHTML = `
            <div class="error">
                Could not load warehouse locations.
            </div>
        `;
    }
}


function openLocationFromGrid(
    location
) {

    const search =
        $("locationSearch");

    if (search) {

        search.value =
            location;
    }

    findLocation();

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}// ============================================================
// TABS
// ============================================================

function initializeTabs() {

    document
        .querySelectorAll(".tab")
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        document
                            .querySelectorAll(".tab")
                            .forEach(
                                tab => {
                                    tab.classList.remove(
                                        "active"
                                    );
                                }
                            );

                        document
                            .querySelectorAll(".page")
                            .forEach(
                                page => {
                                    page.classList.remove(
                                        "active"
                                    );
                                }
                            );

                        button.classList.add(
                            "active"
                        );

                        const pageId =
                            button.dataset.page;

                        const page =
                            $(pageId);

                        if (page) {

                            page.classList.add(
                                "active"
                            );
                        }

                        if (
                            pageId ===
                            "locations"
                        ) {

                            loadLocations();
                        }

                        if (
                            pageId ===
                            "inventory"
                        ) {

                            searchInventory();
                        }
                    }
                );
            }
        );
}


// ============================================================
// HARDWARE BARCODE SCANNERS
// ============================================================

/*
    Zebra / Android handheld scanners normally behave
    like keyboards and press ENTER after the barcode.

    This lets the warehouse use those scanners without
    opening the phone camera.
*/

document.addEventListener(
    "keydown",
    event => {

        if (
            event.key !==
            "Enter"
        ) {
            return;
        }

        const active =
            document.activeElement;

        if (!active) {
            return;
        }

        const id =
            active.id;

        if (
            id === "inPallet"
        ) {

            event.preventDefault();

            $("inLocation")
                ?.focus();

            return;
        }

        if (
            id === "inLocation"
        ) {

            event.preventDefault();

            putIn();

            return;
        }

        if (
            id === "movePallet"
        ) {

            event.preventDefault();

            $("moveLocation")
                ?.focus();

            return;
        }

        if (
            id === "moveLocation"
        ) {

            event.preventDefault();

            movePallet();

            return;
        }

        if (
            id === "outPallet"
        ) {

            event.preventDefault();

            takeOut();

            return;
        }

        if (
            id === "findPallet"
        ) {

            event.preventDefault();

            findPallet();

            return;
        }

        if (
            id === "locationSearch"
        ) {

            event.preventDefault();

            findLocation();

            return;
        }

        if (
            id &&
            id.startsWith(
                "search"
            )
        ) {

            event.preventDefault();

            searchInventory();
        }
    }
);


// ============================================================
// CLOSE SCANNER BY CLICKING BACKDROP
// ============================================================

document.addEventListener(
    "click",
    event => {

        const modal =
            $("scannerModal");

        if (
            modal &&
            event.target === modal
        ) {

            closeScanner();
        }
    }
);


// ============================================================
// PAGE START
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        initializeTabs();

        await loadStats();
        await loadLocations();

        /*
            If the inventory page exists,
            load current inventory.
        */

        if (
            $("inventoryResults")
        ) {

            searchInventory();
        }
    }
);


// ============================================================
// SERVICE WORKER
// ============================================================

/*
    IMPORTANT:

    We intentionally unregister old service workers during
    development so the phone does not keep loading an old
    cached version of app.js.
*/

if (
    "serviceWorker" in navigator
) {

    navigator
        .serviceWorker
        .getRegistrations()
        .then(
            registrations => {

                registrations.forEach(
                    registration => {

                        registration.unregister();
                    }
                );
            }
        )
        .catch(
            error => {

                console.log(
                    "Service worker cleanup:",
                    error
                );
            }
        );
}
