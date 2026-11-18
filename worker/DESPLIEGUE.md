# Cerrar el proxy de CSS — pasos de despliegue (18/11/2026)

**Problema:** el Worker `css-inspector-proxy` reenviaba a Anthropic cualquier petición, de cualquier
origen y sin credencial. Su URL es pública (está en el HTML del repo), así que cualquiera podía gastar la clave.
**Solución:** `proxy.js` (código de acceso + origen + modelo permitido + tope de tokens) y la app envía el código.
Probado en local con 9 casos (Anthropic simulado): sin código / código erróneo / origen ajeno / modelo distinto → bloqueado.

## Orden (importante: la app nueva y el Worker nuevo van juntos; entre medias CSS no analiza)

### 1 · Anthropic: clave nueva y acotada (consola)
1. Espacios de trabajo → **Crear** «CSS» → **Límites de gasto**: p. ej. 5 US$/mes.
2. Claves de API → **Crear clave** → ámbito «CSS» → nombre «css-proxy» → caducidad 90 días → **copiar**.
3. **No borres todavía** la clave antigua «css-field-inspector» (paso 4).

### 2 · Código de acceso
Inventa una cadena larga y aleatoria (mínimo 24 caracteres; por ejemplo, genera una contraseña con tu gestor).
Es lo que se pegará una vez en la app de cada dispositivo. Guárdala en tu gestor de contraseñas.

### 3 · Cloudflare (dash.cloudflare.com → Workers & Pages → `css-inspector-proxy`)
1. **Settings → Variables and Secrets**:
   - `ANTHROPIC_API_KEY` → tipo **Secret** → la clave nueva del paso 1 (sustituye a la que haya).
   - `CODIGO_ACCESO` → tipo **Secret** → el código del paso 2.
2. **Edit code** → borrar todo → pegar el contenido de `worker/proxy.js` → **Deploy**.
3. Comprobación rápida: abrir la URL del Worker en el navegador → debe responder «Método no permitido».

### 4 · Anthropic: borrar la clave antigua
Claves de API → «css-field-inspector» (espacio Default) → **Eliminar**. Hasta que no se borre, sigue siendo válida
para quien la hubiera copiado.

### 5 · App
Publicar la app (`css_field_inspector_v3.html` + `sw.js` v2). Al abrirla, pedirá el **código de acceso** una vez
por dispositivo (⚙ Config). Si se escribe mal: «Código de acceso incorrecto: revísalo en ⚙ Config».

## Si se cambia el modelo de la app
`MODEL` en la app y `MODELOS` en `proxy.js` tienen que coincidir; si no, el proxy responde «Modelo no permitido».
