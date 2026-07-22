export default async function handler(req, res) {

    const response = await fetch(
        "https://servicios.jcyl.es/incyl/json/emergencias"
    );

    const data = await response.text();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    res.send(data);
}