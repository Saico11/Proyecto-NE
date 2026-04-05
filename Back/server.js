const express = require("express");
const cors = require("cors");
const xmlrpc = require("xmlrpc");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ======================================================
// CONFIG ODOO
// ======================================================
const ODOO_URL = "http://localhost:8069";
const ODOO_DB = "SportPE";          // cambia si tu BD tiene otro nombre
const ODOO_USERNAME = "smit26012005@gmail.com";   // cambia si usas otro usuario
const ODOO_PASSWORD = "N3g0c10s";   // cambia si usas otra contraseña

const common = xmlrpc.createClient({
  url: `${ODOO_URL}/xmlrpc/2/common`
});

const models = xmlrpc.createClient({
  url: `${ODOO_URL}/xmlrpc/2/object`
});

// ======================================================
// HELPERS
// ======================================================
function odooAuthenticate() {
  return new Promise((resolve, reject) => {
    common.methodCall(
      "authenticate",
      [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}],
      (err, uid) => {
        if (err) {
          reject(err);
        } else if (!uid) {
          reject(new Error("No se pudo autenticar en Odoo"));
        } else {
          resolve(uid);
        }
      }
    );
  });
}

function odooExecute(model, method, args = [], kwargs = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const uid = await odooAuthenticate();

      models.methodCall(
        "execute_kw",
        [ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs],
        (err, value) => {
          if (err) {
            reject(err);
          } else {
            resolve(value);
          }
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function buildPartnerName(nombres, apellidos) {
  return `${String(nombres || "").trim()} ${String(apellidos || "").trim()}`.trim();
}

// ======================================================
// HEALTHCHECK
// ======================================================
app.get("/health", async (req, res) => {
  try {
    const uid = await odooAuthenticate();
    res.json({
      ok: true,
      message: "Backend conectado correctamente con Odoo",
      uid
    });
  } catch (error) {
    console.error("Error en /health:", error.message);
    res.status(500).json({
      ok: false,
      message: "No se pudo conectar con Odoo",
      error: error.message
    });
  }
});

// ======================================================
// REGISTER
// Crea un res.partner en Odoo
// ======================================================

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        message: "Email y contraseña son obligatorios"
      });
    }

    const emailNormalized = normalizeEmail(email);

    const users = await odooExecute(
      "res.partner",
      "search_read",
      [[["email", "=", emailNormalized]]],
      {
        fields: ["id", "name", "email", "phone", "comment"],
        limit: 1
      }
    );

    if (!users || users.length === 0) {
      return res.status(401).json({
        ok: false,
        message: "Usuario no encontrado"
      });
    }

    const user = users[0];

    const cleanComment = stripHtml(user.comment || "");
    const savedPassword = cleanComment.replace("APP_PASSWORD:", "").trim();

    console.log("LOGIN DEBUG:");
    console.log("Email recibido:", emailNormalized);
    console.log("Comment raw:", user.comment);
    console.log("Comment limpio:", cleanComment);
    console.log("Password guardado:", savedPassword);
    console.log("Password recibido:", password);

    if (savedPassword !== String(password).trim()) {
      return res.status(401).json({
        ok: false,
        message: "Credenciales no válidas"
      });
    }

    const fullName = String(user.name || "").trim();
    const parts = fullName.split(" ");
    const nombres = parts.slice(0, 1).join(" ");
    const apellidos = parts.slice(1).join(" ");

    res.json({
      ok: true,
      message: "Login correcto",
      user: {
        id: user.id,
        nombres,
        apellidos,
        name: user.name,
        email: user.email,
        telefono: user.phone || ""
      }
    });
  } catch (error) {
    console.error("Error en /login:", error);
    res.status(500).json({
      ok: false,
      message: "Error al iniciar sesión",
      error: error.message
    });
  }
});

app.post("/register", async (req, res) => {
  try {
    const { nombres, apellidos, email, telefono, password } = req.body;

    if (!nombres || !apellidos || !email || !telefono || !password) {
      return res.status(400).json({
        ok: false,
        message: "Todos los campos son obligatorios"
      });
    }

    const emailNormalized = normalizeEmail(email);
    const fullName = buildPartnerName(nombres, apellidos);

    // Verificar si ya existe
    const existingPartners = await odooExecute(
      "res.partner",
      "search_read",
      [[["email", "=", emailNormalized]]],
      {
        fields: ["id", "name", "email", "phone", "comment"],
        limit: 1
      }
    );

    if (existingPartners.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "Este correo ya está registrado"
      });
    }

    // Guardamos la password solo para demo en el campo comment.
    // En producción esto NO se hace así.
    const partnerId = await odooExecute(
      "res.partner",
      "create",
      [[{
        name: fullName,
        email: emailNormalized,
        phone: telefono,
        comment: `APP_PASSWORD:${String(password).trim()}`
      }]]
    );

    const createdPartner = await odooExecute(
      "res.partner",
      "read",
      [partnerId],
      {
        fields: ["id", "name", "email", "phone"]
      }
    );

    const user = createdPartner[0];

    res.status(201).json({
      ok: true,
      message: "Usuario registrado correctamente en Odoo",
      user: {
        id: user.id,
        nombres,
        apellidos,
        name: user.name,
        email: user.email,
        telefono: user.phone || ""
      }
    });
  } catch (error) {
    console.error("Error en /register:", error);
    res.status(500).json({
      ok: false,
      message: "Error al registrar usuario en Odoo",
      error: error.message
    });
  }
});

// ======================================================
// LOGIN
// Busca el usuario por email y valida password desde comment
// ======================================================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        message: "Email y contraseña son obligatorios"
      });
    }

    const emailNormalized = normalizeEmail(email);

    const users = await odooExecute(
      "res.partner",
      "search_read",
      [[["email", "=", emailNormalized]]],
      {
        fields: ["id", "name", "email", "phone", "comment"],
        limit: 1
      }
    );

    if (!users || users.length === 0) {
      return res.status(401).json({
        ok: false,
        message: "Usuario no encontrado"
      });
    }

    const user = users[0];
    const savedPassword = String(user.comment || "").replace("APP_PASSWORD:", "").trim();

    if (savedPassword !== password) {
      return res.status(401).json({
        ok: false,
        message: "Contraseña incorrecta"
      });
    }

    const parts = String(user.name || "").trim().split(" ");
    const nombres = parts.slice(0, 1).join(" ");
    const apellidos = parts.slice(1).join(" ");

    res.json({
      ok: true,
      message: "Login correcto",
      user: {
        id: user.id,
        nombres,
        apellidos,
        name: user.name,
        email: user.email,
        telefono: user.phone || ""
      }
    });
  } catch (error) {
    console.error("Error en /login:", error);
    res.status(500).json({
      ok: false,
      message: "Error al iniciar sesión",
      error: error.message
    });
  }
});


// ======================================================
// BUY
// Crea sale.order y una línea simple
// ======================================================

app.post("/buy", async (req, res) => {
  try {
    const { user_id, carrito, metodoPago } = req.body;

    if (!user_id || !Array.isArray(carrito) || carrito.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Datos de compra incompletos"
      });
    }

    const partner = await odooExecute(
      "res.partner",
      "read",
      [user_id],
      { fields: ["id", "name", "email", "phone"] }
    );

    if (!partner || partner.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Cliente no encontrado en Odoo"
      });
    }

    const cliente = partner[0];

    const total = carrito.reduce((sum, item) => {
      return sum + Number(item.precio || 0) * Number(item.cantidad || 1);
    }, 0);

    const detalleProductos = carrito.map(item => {
      return `- ${item.nombre} | Cantidad: ${item.cantidad} | Precio: S/ ${Number(item.precio).toFixed(2)}`;
    }).join("\n");

    const descripcion = `
Compra registrada desde la tienda web.

Cliente: ${cliente.name}
Correo: ${cliente.email || ""}
Teléfono: ${cliente.phone || ""}
Método de pago: ${metodoPago || "No especificado"}

Productos:
${detalleProductos}

Total estimado: S/ ${total.toFixed(2)}
    `.trim();

    const leadId = await odooExecute(
      "crm.lead",
      "create",
      [[{
        name: `Nueva compra web - ${cliente.name}`,
        partner_id: cliente.id,
        contact_name: cliente.name,
        email_from: cliente.email || "",
        phone: cliente.phone || "",
        description: descripcion
      }]]
    );

    const leadData = await odooExecute(
      "crm.lead",
      "read",
      [leadId],
      {
        fields: ["id", "name", "partner_id"]
      }
    );

    const lead = leadData[0];

    res.status(201).json({
      ok: true,
      message: "Compra registrada correctamente en el CRM de Odoo",
      order: {
        id: lead.id,
        codigo: `LEAD-${lead.id}`,
        total: total,
        estado: "registrado en CRM"
      }
    });
  } catch (error) {
    console.error("Error en /buy:", error);
    res.status(500).json({
      ok: false,
      message: "Error al registrar la compra en Odoo CRM",
      error: error.message
    });
  }
});

// ======================================================
// LISTAR PEDIDOS DE UN USUARIO
// ======================================================

app.get("/orders/:partnerId", async (req, res) => {
  try {
    const partnerId = Number(req.params.partnerId);

    const leads = await odooExecute(
      "crm.lead",
      "search_read",
      [[["partner_id", "=", partnerId]]],
      {
        fields: ["id", "name", "create_date"],
        order: "id desc"
      }
    );

    const orders = leads.map(lead => ({
      id: lead.id,
      name: `LEAD-${lead.id}`,
      amount_total: 0,
      state: "registrado en CRM",
      date_order: lead.create_date
    }));

    res.json({
      ok: true,
      orders
    });
  } catch (error) {
    console.error("Error en /orders/:partnerId:", error);
    res.status(500).json({
      ok: false,
      message: "Error al obtener registros del CRM",
      error: error.message
    });
  }
});

// ======================================================
// INICIO DEL SERVIDOR
// ======================================================
app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
  console.log(`Odoo URL: ${ODOO_URL}`);
  console.log(`Base de datos: ${ODOO_DB}`);
});
