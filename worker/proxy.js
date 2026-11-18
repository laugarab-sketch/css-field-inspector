/**
 * proxy.js — Cloudflare Worker «css-inspector-proxy» (CSS Field Inspector → API de Anthropic).
 *
 * Antes (hasta 18/11/2026): reenviaba a Anthropic CUALQUIER petición, de cualquier origen y sin
 * credencial → cualquiera con la URL (pública en el repo) podía gastar la clave.
 *
 * Ahora, una petición solo llega a Anthropic si cumple TODO:
 *   1. Método POST (OPTIONS solo para el preflight CORS del navegador).
 *   2. Cabecera «X-Codigo-Acceso» igual al secreto CODIGO_ACCESO (comparación en tiempo constante).
 *      Es la barrera real: el origen se puede falsificar fuera del navegador.
 *   3. Origen permitido (si viene cabecera Origin): solo la web publicada y el servidor local de pruebas.
 *   4. Cuerpo JSON de tamaño acotado, con modelo de la lista blanca.
 *   5. Solo se reenvían los campos que usa la app (model, max_tokens, system, messages) y
 *      max_tokens se recorta a un tope: no sirve como «API gratis» para otros usos.
 *
 * Secretos (Cloudflare → Worker → Settings → Variables and Secrets, tipo «Secret»):
 *   ANTHROPIC_API_KEY  clave de un espacio de trabajo propio de CSS, con límite de gasto y caducidad
 *   CODIGO_ACCESO      cadena aleatoria larga; se pega una vez en la app (Config) de cada dispositivo
 */

const ORIGENES = ["https://laugarab-sketch.github.io", "http://localhost:3000"];
const MODELOS = ["claude-sonnet-4-5"];          // los que usa la app; añadir aquí si se cambia MODEL en la app
const MAX_TOKENS_TOPE = 1500;                   // la app pide 1000
const MAX_BYTES = 8 * 1024 * 1024;              // foto comprimida en base64 + texto, con margen
const URL_API = "https://api.anthropic.com/v1/messages";

/** Cabeceras CORS: solo se devuelve el origen si está en la lista. */
function cors(origen) {
  const h = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Codigo-Acceso", "Vary": "Origin" };
  if (ORIGENES.includes(origen)) h["Access-Control-Allow-Origin"] = origen;
  return h;
}
/** Respuesta de error con el mismo formato que la API de Anthropic (la app ya sabe leerlo). */
function error(estado, mensaje, origen) {
  return new Response(JSON.stringify({ type: "error", error: { type: "proxy_error", message: mensaje } }),
    { status: estado, headers: { "Content-Type": "application/json", ...cors(origen) } });
}
/** Comparación en tiempo constante (no revela cuántos caracteres coinciden). */
function iguales(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] || 0) ^ (y[i] || 0);
  return dif === 0;
}

export default {
  async fetch(request, env) {
    const origen = request.headers.get("Origin") || "";

    // Preflight del navegador
    if (request.method === "OPTIONS") {
      return new Response(null, { status: ORIGENES.includes(origen) ? 204 : 403, headers: cors(origen) });
    }
    if (request.method !== "POST") return error(405, "Método no permitido.", origen);

    // Configuración del propio Worker
    if (!env.ANTHROPIC_API_KEY || !env.CODIGO_ACCESO) return error(500, "Proxy sin configurar.", origen);

    // 1) Código de acceso
    if (!iguales(request.headers.get("X-Codigo-Acceso") || "", env.CODIGO_ACCESO)) {
      return error(401, "Código de acceso incorrecto o ausente.", origen);
    }
    // 2) Origen (si lo hay: los navegadores siempre lo envían en peticiones de otro dominio)
    if (origen && !ORIGENES.includes(origen)) return error(403, "Origen no permitido.", origen);

    // 3) Cuerpo acotado y válido
    const largo = Number(request.headers.get("Content-Length") || 0);
    if (largo > MAX_BYTES) return error(413, "Petición demasiado grande.", origen);
    const texto = await request.text();
    if (texto.length > MAX_BYTES) return error(413, "Petición demasiado grande.", origen);
    let cuerpo;
    try { cuerpo = JSON.parse(texto); } catch { return error(400, "JSON no válido.", origen); }
    if (!MODELOS.includes(cuerpo.model)) return error(400, "Modelo no permitido.", origen);
    if (!Array.isArray(cuerpo.messages) || !cuerpo.messages.length) return error(400, "Faltan mensajes.", origen);

    // 4) Solo los campos que usa la app, con tope de salida
    const limpio = {
      model: cuerpo.model,
      max_tokens: Math.min(Number(cuerpo.max_tokens) || 1000, MAX_TOKENS_TOPE),
      messages: cuerpo.messages,
      ...(typeof cuerpo.system === "string" ? { system: cuerpo.system } : {}),
    };

    // 5) Reenvío a Anthropic con la clave del Worker
    const r = await fetch(URL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(limpio),
    });
    return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json", ...cors(origen) } });
  },
};
