const state = {
    map: null,
    nasaHeatLayer: null, // Sustituido nasaClusterGroup por nasaHeatLayer
    cv112LayerGroup: null,
    nasaRawData: [],
    cv112RawData: [],
    filters: {
        nasaEnabled: true,
        cv112Enabled: true,
        confidence: 'all',
        minFrp: 0,
        searchQuery: ''
    }
};

const ENDPOINTS = {
    NASA: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/e5b0c56d0b059dbd11c8dfe53dea278f/VIIRS_SNPP_NRT/world/1/',
    CV112: '/api/cv112'
};

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupEventListeners();
    loadAllData();
});

function initMap() {
    state.map = L.map('map', {
        center: [39.8, -0.4],
        zoom: 8,
        zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(state.map);

    // Capa de calor con colores de alerta máxima e intensos
    state.nasaHeatLayer = L.heatLayer([], {
        radius: 25,         // Radio ligeramente mayor para que tenga más presencia visual
        blur: 12,           // Borde un poco más definido para que resalte
        maxZoom: 14,
        minOpacity: 0.5,    // Mayor opacidad base para que no quede apagado sobre el fondo oscuro
        gradient: {
            0.1: '#ffff00', // Amarillo neón / eléctrico (perímetro o calor bajo)
            0.4: '#ff5500', // Naranja vivo / incandescente
            0.7: '#ff0000', // Rojo puro / Fuego brillante (alerta)
            1.0: '#ffffff'  // Núcleo blanco incandescente (máximo FRP)
        }
    });

    state.cv112LayerGroup = L.layerGroup();

    // Añadimos las capas al mapa
    state.map.addLayer(state.nasaHeatLayer);
    state.map.addLayer(state.cv112LayerGroup);
}

async function loadAllData() {
    updateStatus('Cargando datos...', 'info');

    try {
        await Promise.all([fetchNASAData(), fetchCV112Data()]);
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
    } catch (e) {
        // En caso de restricciones CORS o red
    }
}

function processNASAData(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length <= 1) return;

    const headers = lines[0].split(',');
    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const frpIdx = headers.indexOf('frp');
    const confIdx = headers.indexOf('confidence');
    const dateIdx = headers.indexOf('acq_date');
    const timeIdx = headers.indexOf('acq_time');
    const brightIdx = headers.indexOf('bright_ti4');

    state.nasaRawData = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < headers.length) continue;

        const lat = parseFloat(cols[latIdx]);
        const lon = parseFloat(cols[lonIdx]);

        // Filtrar área de España / Península Ibérica
        if (lat >= 35.0 && lat <= 44.0 && lon >= -10.0 && lon <= 4.0) {
            state.nasaRawData.push({
                lat: lat,
                lon: lon,
                frp: parseFloat(cols[frpIdx]) || 0,
                confidence: cols[confIdx],
                date: cols[dateIdx],
                time: cols[timeIdx],
                brightness: cols[brightIdx]
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

        // FILTRO ESTRICTO: Solo incluir incidentes de INCENDIO
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
                    descriptionVa: descVa,
                    asociadas: props.asociadas || 0,
                    created: props.created || '',
                    lat: lat,
                    lon: lon
                });
            }
        }
    });
}

function renderData() {
    // Limpiamos capas
    state.nasaHeatLayer.setLatLngs([]);
    state.cv112LayerGroup.clearLayers();

    let countNasa = 0;
    let countCv112 = 0;
    let maxFrp = 0;

    // 1. Procesar y renderizar datos NASA en el Heatmap
    if (state.filters.nasaEnabled) {
        const heatPoints = [];

        state.nasaRawData.forEach(item => {
            if (state.filters.confidence !== 'all' && item.confidence !== state.filters.confidence) return;
            if (item.frp < state.filters.minFrp) return;

            if (item.frp > maxFrp) maxFrp = item.frp;
            countNasa++;

            // Calculamos la intensidad para el mapa de calor basándonos en el FRP
            const intensity = Math.min(Math.max(item.frp / 20, 0.2), 1.0);
            heatPoints.push([item.lat, item.lon, intensity]);
        });

        // Actualizamos los puntos de la capa de calor
        state.nasaHeatLayer.setLatLngs(heatPoints);

        if (!state.map.hasLayer(state.nasaHeatLayer)) {
            state.map.addLayer(state.nasaHeatLayer);
        }
    } else {
        if (state.map.hasLayer(state.nasaHeatLayer)) {
            state.map.removeLayer(state.nasaHeatLayer);
        }
    }

    // 2. Renderizar 112CV como marcadores puntuales
    const incidentListContainer = document.getElementById('incidents-list');
    incidentListContainer.innerHTML = '';

    if (state.filters.cv112Enabled) {
        state.cv112RawData.forEach(item => {
            const searchLower = state.filters.searchQuery.toLowerCase();
            const matchesSearch = item.municipio.toLowerCase().includes(searchLower) || item.direccion.toLowerCase().includes(searchLower);
            if (!matchesSearch) return;

            countCv112++;

            const customIcon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="cv112-marker-pulse"><i class="fa-solid fa-triangle-exclamation"></i></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            const popupContent = `
                <div class="custom-popup">
                    <div class="popup-header cv112">
                        <i class="fa-solid fa-truck-medical"></i>
                        <h3>112 Comunitat Valenciana</h3>
                    </div>
                    <div class="popup-body">
                        <div class="popup-row"><span class="popup-label">Tipo:</span><span class="popup-value"><strong>${item.descriptionEs}</strong></span></div>
                        <div class="popup-row"><span class="popup-label">Municipio:</span><span class="popup-value">${item.municipio}</span></div>
                        <div class="popup-row"><span class="popup-label">Dirección:</span><span class="popup-value">${item.direccion}</span></div>
                        <div class="popup-row"><span class="popup-label">Llamadas 112:</span><span class="popup-value">${item.asociadas}</span></div>
                        <div class="popup-row"><span class="popup-label">Fecha alta:</span><span class="popup-value">${item.created}</span></div>
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
                <div class="incident-item-sub"><i class="fa-solid fa-phone"></i> ${item.asociadas} llamadas asociadas</div>
            `;
            listItem.addEventListener('click', () => {
                state.map.setView([item.lat, item.lon], 13);
                marker.openPopup();
            });
            incidentListContainer.appendChild(listItem);
        });
    }

    // Actualización de contadores
    document.getElementById('count-nasa').textContent = countNasa;
    document.getElementById('count-cv112').textContent = countCv112;
    document.getElementById('stat-total').textContent = countNasa + countCv112;
    document.getElementById('stat-max-frp').textContent = maxFrp > 0 ? maxFrp.toFixed(1) : '0';
}

function setupEventListeners() {
    document.getElementById('toggle-nasa').addEventListener('change', (e) => { state.filters.nasaEnabled = e.target.checked; renderData(); });
    document.getElementById('toggle-cv112').addEventListener('change', (e) => { state.filters.cv112Enabled = e.target.checked; renderData(); });
    document.getElementById('nasa-confidence').addEventListener('change', (e) => { state.filters.confidence = e.target.value; renderData(); });
    document.getElementById('frp-range').addEventListener('input', (e) => {
        state.filters.minFrp = parseFloat(e.target.value);
        document.getElementById('frp-val').textContent = e.target.value;
        renderData();
    });
    document.getElementById('search-input').addEventListener('input', (e) => { state.filters.searchQuery = e.target.value; renderData(); });
    document.getElementById('btn-refresh').addEventListener('click', loadAllData);
}

function updateStatus(text, type = 'info') {
    const statusEl = document.getElementById('status-message');
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${text}`;
}