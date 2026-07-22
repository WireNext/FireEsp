export default async function handler(req, res) {

    const response = await fetch(
        "https://wpr.112cv.gva.es/external/api/storage/descargar/geojson/incidentes/incidente.geojson"
    );

    const data = await response.text();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    res.send(data);
}