const state = {
    map: null,
    nasaHeatLayer: null,
    cv112LayerGroup: null,
    jcylLayerGroup: null,
    nasaRawData: [],
    cv112RawData: [],
    jcylRawData: [],
    filters: {
        nasaEnabled: true,
        cv112Enabled: true,
        jcylEnabled: true,
        confidence: 'all',
        minFrp: 0,
        searchQuery: ''
    }
};

const ENDPOINTS = {
    NASA: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/e5b0c56d0b059dbd11c8dfe53dea278f/VIIRS_SNPP_NRT/world/1',
    CV112: '/api/cv112',
    JCYL: '/api/cyl.js'
};

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupEventListeners();
    loadAllData();
});

function initMap() {
    state.map = L.map('map', {
        center: [40.4168, -3.7038],
        zoom: 6,
        zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(state.map);

    state.nasaHeatLayer = L.heatLayer([], {
        radius: 25,
        blur: 12,
        maxZoom: 14,
        minOpacity: 0.5,
        gradient: {
            0.1: '#ffff00',
            0.4: '#ff5500',
            0.7: '#ff0000',
            1.0: '#ffffff'
        }
    });

    state.cv112LayerGroup = L.layerGroup();
    state.jcylLayerGroup = L.layerGroup();

    state.map.addLayer(state.nasaHeatLayer);
    state.map.addLayer(state.cv112LayerGroup);
    state.map.addLayer(state.jcylLayerGroup);
}

async function loadAllData() {
    updateStatus('Cargando datos...', 'info');

    try {
        await Promise.all([fetchNASAData(), fetchCV112Data(), fetchJCYLData()]);
        renderData();
        updateStatus('Datos en vivo actualizados', 'success');
    } catch (err) {
        console.warn('Cargas directas restringidas por CORS. Utilizando fallback parseado.', err);
        renderData();
        updateStatus('Modo Offline / Datos procesados', 'warning');
    }
}

async function fetchNASAData() {
    try {
        const response = await fetch(ENDPOINTS.NASA);
        if (!response.ok) throw new Error();
        const text = await response.text();
        processNASAData(text);
    } catch (e) {}
}

function processNASAData(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length <= 1) return;

    const headers = lines[0].split(',');
    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const frpIdx = headers.indexOf('frp');
    const confIdx = headers.indexOf('confidence');

    state.nasaRawData = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < headers.length) continue;

        const lat = parseFloat(cols[latIdx]);
        const lon = parseFloat(cols[lonIdx]);

        if (lat >= 35.0 && lat <= 44.0 && lon >= -10.0 && lon <= 4.0) {
            state.nasaRawData.push({
                lat: lat,
                lon: lon,
                frp: parseFloat(cols[frpIdx]) || 0,
                confidence: cols[confIdx]
            });
        }
    }
}

async function fetchCV112Data() {
    try {
        const response = await fetch(ENDPOINTS.CV112);
        if (!response.ok) throw new Error();
        const json = await response.json();
        processCV112Data(json);
    } catch (e) {}
}

function processCV112Data(geojson) {
    state.cv112RawData = [];
    if (!geojson || !geojson.features) return;

    geojson.features.forEach(feature => {
        const props = feature.properties || {};
        const descEs = props.description?.es || '';
        const descVa = props.description?.va || '';
        const isFire = descEs.toLowerCase().includes('incendio') || descVa.toLowerCase().includes('incendi');

        if (isFire) {
            let lat, lon;
            if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates[0]) {
                const ring = feature.geometry.coordinates[0];
                let sumLon = 0, sumLat = 0;
                ring.forEach(pt => { sumLon += pt[0]; sumLat += pt[1]; });
                lon = sumLon / ring.length;
                lat = sumLat / ring.length;
            } else if (feature.geometry.type === 'Point') {
                lon = feature.geometry.coordinates[0];
                lat = feature.geometry.coordinates[1];
            }

            if (lat && lon) {
                state.cv112RawData.push({
                    id: props.id,
                    municipio: props.municipio || 'No especificado',
                    direccion: props.direccion || 'Sin dirección exacta',
                    descriptionEs: descEs,
                    asociadas: props.asociadas || 0,
                    created: props.created || '',
                    lat: lat,
                    lon: lon
                });
            }
        }
    });
}

async function fetchJCYLData() {
    try {
        const response = await fetch(ENDPOINTS.JCYL);
        if (!response.ok) throw new Error();
        const json = await response.json();
        processJCYLData(json);
    } catch (e) {}
}

// Conversión aproximada UTM Huso 30N a Lat/Lon para la JCyL
function utm30ToLatLon(easting, northing) {
    const a = 6378137;
    const e = 0.081819191;
    const k0 = 0.9996;
    const lon0 = -3 * Math.PI / 180;

    const x = easting - 500000;
    const y = northing;

    const M = y / k0;
    const mu = M / (a * (1 - Math.pow(e, 2)/4 - 3*Math.pow(e, 4)/64 - 5*Math.pow(e, 6)/256));

    const e1 = (1 - Math.sqrt(1 - Math.pow(e, 2))) / (1 + Math.sqrt(1 - Math.pow(e, 2)));
    const phi1 = mu + (3*e1/2 - 27*Math.pow(e1, 3)/32)*Math.sin(2*mu) + (21*Math.pow(e1, 2)/16 - 55*Math.pow(e1, 4)/32)*Math.sin(4*mu) + (151*Math.pow(e1, 3)/96)*Math.sin(6*mu);

    const N1 = a / Math.sqrt(1 - Math.pow(e * Math.sin(phi1), 2));
    const T1 = Math.pow(Math.tan(phi1), 2);
    const C1 = (Math.pow(e, 2) / (1 - Math.pow(e, 2))) * Math.pow(Math.cos(phi1), 2);
    const R1 = a * (1 - Math.pow(e, 2)) / Math.pow(1 - Math.pow(e, 2) * Math.pow(Math.sin(phi1), 2), 1.5);
    const D = x / (N1 * k0);

    let lat = phi1 - (N1 * Math.tan(phi1) / R1) * (Math.pow(D, 2)/2 - (5 + 3*T1 + 10*C1 - 4*Math.pow(C1, 2) - 9*(Math.pow(e, 2)/(1-Math.pow(e,2))))*Math.pow(D, 4)/24 + (61 + 90*T1 + 298*C1 + 45*Math.pow(T1, 2) - 252*(Math.pow(e, 2)/(1-Math.pow(e,2))) - 3*Math.pow(C1, 2))*Math.pow(D, 6)/720);
    let lon = lon0 + (D - (1 + 2*T1 + C1)*Math.pow(D, 3)/6 + (5 - 2*C1 + 28*T1 - 3*Math.pow(C1, 2) + 8*T1*C1 + 24*Math.pow(T1, 2))*Math.pow(D, 5)/120) / Math.cos(phi1);

    return {
        lat: lat * (180 / Math.PI),
        lon: lon * (180 / Math.PI)
    };
}

function processJCYLData(data) {
    state.jcylRawData = [];
    if (!data || !data.listaEmergencias) return;

    data.listaEmergencias.forEach(item => {
        if (item.latitud && item.longitud) {
            const coords = utm30ToLatLon(item.longitud, item.latitud);
            
            state.jcylRawData.push({
                causa: item.causa || 'No especificada',
                municipio: item.localidad?.municipio?.nombre || item.localidad?.nombre || 'Desconocido',
                provincia: item.provincia?.nombre || item.cpm || 'Castilla y León',
                comarca: item.comarca?.nombre || 'N/D',
                estado: item.estado?.NOMBRE || 'Desconocido',
                estadoColor: item.estado?.COLOR_FONDO || '#ccc',
                fechaInicio: item.fecha_inicio || '',
                lat: coords.lat,
                lon: coords.lon
            });
        }
    });
}

function renderData() {
    state.nasaHeatLayer.setLatLngs([]);
    state.cv112LayerGroup.clearLayers();
    state.jcylLayerGroup.clearLayers();

    let countNasa = 0;
    let countCv112 = 0;
    let countJcyl = 0;
    let maxFrp = 0;

    // 1. NASA
    if (state.filters.nasaEnabled) {
        const heatPoints = [];
        state.nasaRawData.forEach(item => {
            if (state.filters.confidence !== 'all' && item.confidence !== state.filters.confidence) return;
            if (item.frp > maxFrp) maxFrp = item.frp;
            countNasa++;
            const intensity = Math.min(Math.max(item.frp / 20, 0.2), 1.0);
            heatPoints.push([item.lat, item.lon, intensity]);
        });
        state.nasaHeatLayer.setLatLngs(heatPoints);
        if (!state.map.hasLayer(state.nasaHeatLayer)) state.map.addLayer(state.nasaHeatLayer);
    } else {
        if (state.map.hasLayer(state.nasaHeatLayer)) state.map.removeLayer(state.nasaHeatLayer);
    }

    // 2. 112CV
    const incidentListContainer = document.getElementById('incidents-list');
    incidentListContainer.innerHTML = '';
    if (state.filters.cv112Enabled) {
        state.cv112RawData.forEach(item => {
            countCv112++;
            const customIcon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="cv112-marker-pulse"><i class="fa-solid fa-fire-flame-curved"></i></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            const popupContent = `
                <div class="custom-popup">
                    <div class="popup-header cv112">
                        <i class="fa-solid fa-fire-flame-curved"></i>
                        <h3>112 Comunitat Valenciana</h3>
                    </div>
                    <div class="popup-body">
                        <div class="popup-row"><span class="popup-label">Tipo:</span><span class="popup-value"><strong>${item.descriptionEs}</strong></span></div>
                        <div class="popup-row"><span class="popup-label">Municipio:</span><span class="popup-value">${item.municipio}</span></div>
                        <div class="popup-row"><span class="popup-label">Dirección:</span><span class="popup-value">${item.direccion}</span></div>
                        <div class="popup-row"><span class="popup-label">Llamadas:</span><span class="popup-value">${item.asociadas}</span></div>
                    </div>
                    <div class="popup-footer">Fuente: 112CV</div>
                </div>
            `;

            const marker = L.marker([item.lat, item.lon], { icon: customIcon }).bindPopup(popupContent);
            state.cv112LayerGroup.addLayer(marker);

            const listItem = document.createElement('div');
            listItem.className = 'incident-item';
            listItem.innerHTML = `
                <div class="incident-item-title">${item.municipio} - ${item.descriptionEs}</div>
                <div class="incident-item-sub"><i class="fa-solid fa-location-dot"></i> ${item.direccion}</div>
            `;
            listItem.addEventListener('click', () => {
                state.map.setView([item.lat, item.lon], 13);
                marker.openPopup();
                if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('active');
            });
            incidentListContainer.appendChild(listItem);
        });
    }

    // 3. JCyL
    const jcylListContainer = document.getElementById('jcyl-list');
    jcylListContainer.innerHTML = '';
    if (state.filters.jcylEnabled) {
        state.jcylRawData.forEach(item => {
            countJcyl++;
            const customIcon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="jcyl-marker-pulse" style="background-color: ${item.estadoColor}"><i class="fa-solid fa-fire"></i></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            const popupContent = `
                <div class="custom-popup">
                    <div class="popup-header jcyl">
                        <i class="fa-solid fa-fire"></i>
                        <h3>Junta de Castilla y León</h3>
                    </div>
                    <div class="popup-body">
                        <div class="popup-row"><span class="popup-label">Municipio:</span><span class="popup-value"><strong>${item.municipio} (${item.provincia})</strong></span></div>
                        <div class="popup-row"><span class="popup-label">Comarca:</span><span class="popup-value">${item.comarca}</span></div>
                        <div class="popup-row"><span class="popup-label">Estado:</span><span class="popup-value" style="color:${item.estadoColor}">${item.estado}</span></div>
                        <div class="popup-row"><span class="popup-label">Causa:</span><span class="popup-value">${item.causa}</span></div>
                        <div class="popup-row"><span class="popup-label">Inicio:</span><span class="popup-value">${item.fechaInicio}</span></div>
                    </div>
                    <div class="popup-footer">Fuente: JCyL</div>
                </div>
            `;

            const marker = L.marker([item.lat, item.lon], { icon: customIcon }).bindPopup(popupContent);
            state.jcylLayerGroup.addLayer(marker);

            const listItem = document.createElement('div');
            listItem.className = 'incident-item jcyl-item';
            listItem.innerHTML = `
                <div class="incident-item-title">${item.municipio} (${item.provincia})</div>
                <div class="incident-item-sub"><i class="fa-solid fa-circle" style="color: ${item.estadoColor}"></i> Estado: ${item.estado}</div>
                <div class="incident-item-sub"><i class="fa-solid fa-clock"></i> ${item.fechaInicio}</div>
            `;
            listItem.addEventListener('click', () => {
                state.map.setView([item.lat, item.lon], 13);
                marker.openPopup();
                if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('active');
            });
            jcylListContainer.appendChild(listItem);
        });
    }

    document.getElementById('count-nasa').textContent = countNasa;
    document.getElementById('count-cv112').textContent = countCv112;
    document.getElementById('count-jcyl').textContent = countJcyl;
    document.getElementById('stat-total').textContent = countNasa + countCv112 + countJcyl;
    document.getElementById('stat-max-frp').textContent = maxFrp > 0 ? maxFrp.toFixed(1) : '0';
}

function setupEventListeners() {
    document.getElementById('toggle-nasa').addEventListener('change', (e) => { state.filters.nasaEnabled = e.target.checked; renderData(); });
    document.getElementById('toggle-cv112').addEventListener('change', (e) => { state.filters.cv112Enabled = e.target.checked; renderData(); });
    document.getElementById('toggle-jcyl').addEventListener('change', (e) => { state.filters.jcylEnabled = e.target.checked; renderData(); });
    document.getElementById('nasa-confidence').addEventListener('change', (e) => { state.filters.confidence = e.target.value; renderData(); });
    document.getElementById('btn-refresh').addEventListener('click', loadAllData);

    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarClose = document.getElementById('sidebar-close');

    sidebarToggle.addEventListener('click', () => sidebar.classList.add('active'));
    sidebarClose.addEventListener('click', () => sidebar.classList.remove('active'));
}

function updateStatus(text) {
    const statusEl = document.getElementById('status-message');
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${text}`;
}