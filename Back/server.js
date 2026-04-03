const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const ODOO_URL = "http://localhost:8069";
const DB = "SportPE";          // ⚠ cambia esto
const USER = "smit26012005@gmail.com";        // ⚠ tu usuario
const PASSWORD = "N3g0c10s";    // ⚠ tu password

let uid = null;

// 🔐 LOGIN
async function login() {
  const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "common",
      method: "login",
      args: [DB, USER, PASSWORD]
    }
  });

  uid = response.data.result;
  console.log("UID:", uid);
}

// 📌 CREAR LEAD EN CRM
app.post("/crear-lead", async (req, res) => {
  try {
    const { nombre, email, telefono, producto } = req.body;

    const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "crm.lead",
          "create",
          [{
            name: `Interes en ${producto}`,
            contact_name: nombre,
            email_from: email,
            phone: telefono
          }]
        ]
      }
    });

    res.json({ success: true, lead_id: response.data.result });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creando lead" });
  }
});

// 🚀 INICIAR SERVER
app.listen(3000, async () => {
  console.log("Servidor en http://localhost:3000");
  await login();
});
