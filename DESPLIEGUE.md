# Despliegue de Milpa en un VPS

Guía paso a paso para poner Milpa en internet (fase 115). Todo corre en Docker:

| Contenedor | Qué hace |
|---|---|
| Caddy | HTTPS con Let's Encrypt |
| Nginx | Sirve el frontend y hace de proxy de la API |
| API | El servidor de la aplicación |
| PostgreSQL | La base de datos |

Los respaldos se cifran con restic y se guardan fuera del servidor.

> Antes de recibir pacientes reales: el aviso de privacidad y los términos (datos de salud =
> datos sensibles en la LFPDPPP). Ver «Antes de abrir» al final.

## 0. Lo que necesitas (Hostinger)

El VPS y el dominio se contratan en Hostinger y se administran en el mismo panel, hPanel. Los
nombres exactos de los menús pueden cambiar; aquí va qué buscar.

### El VPS
- **Plan:** uno de 2 vCPU y 4 GB de RAM como mínimo; KVM 2 o superior. El build de las imágenes se hace en el servidor y ocupa memoria.
- **Ubicación:** el centro de datos de EE. UU., por la latencia desde México.
- **Sistema:** la plantilla **Ubuntu 24.04 sin panel**. Las plantillas con panel o con Docker preinstalado no hacen falta: `server-setup.sh` instala Docker desde el repositorio oficial.
- **Llave SSH:** agrégala en la configuración del VPS en hPanel; así queda en `/root/.ssh/authorized_keys`, que el script necesita. Si no tienes una, créala en tu computadora con `ssh-keygen -t ed25519` y pega el contenido de `~/.ssh/id_ed25519.pub`.
- **Contraseña de root:** Hostinger la pide al crear el VPS. Guárdala en tu gestor de contraseñas. El script cierra el SSH de root, pero la **terminal del navegador** de hPanel sigue funcionando con ella: es tu acceso de emergencia si algún día te quedas sin SSH.
- **Firewall de hPanel:** si lo activas, permite 22/TCP, 80/TCP, 443/TCP y 443/UDP. El servidor tiene además su propio firewall (ufw).
- **Respaldos o snapshots de Hostinger:** si tu plan los incluye, déjalos activos como capa extra y toma un snapshot antes de cambios grandes. Los respaldos principales son los de restic (paso 4), que viven fuera de Hostinger.

### El dominio
En la zona DNS del dominio en hPanel, para el nombre que vas a usar (`app` → `app.tudominio.mx`, o `@` para el dominio solo):

1. Crea un registro **A** que apunte a la IP del VPS, con un TTL corto (300) mientras haces pruebas.
2. **Borra los registros A y AAAA que Hostinger crea por defecto para ese mismo nombre**, los que apuntan a su página de estacionamiento. Si queda un AAAA viejo, Let's Encrypt intenta por IPv6, no encuentra el servidor y el certificado falla.
3. Comprueba desde tu computadora, antes de desplegar, que la IP sea la del VPS y que no salga ningún AAAA:

   ```bash
   dig +short app.tudominio.mx A
   dig +short app.tudominio.mx AAAA
   ```

### Los respaldos
- **Recomendado:** un bucket privado de **Backblaze B2**, con una «application key» que solo tenga acceso a ese bucket.
- **Por qué fuera de Hostinger:** si se pierde el VPS o la cuenta, los respaldos siguen a salvo.

### Aviso de privacidad
- **Datos fuera de México:** el VPS en EE. UU. aloja datos de salud fuera del país. El aviso de privacidad tiene que decirlo (ver «Antes de abrir»).

## 1. Preparar el servidor (una vez)

Entra como root con tu llave y corre el script después de leerlo:

```bash
ssh root@IP-DEL-SERVIDOR
curl -fsSL https://raw.githubusercontent.com/MrKrypthon/NutriStudio/main/deploy/server-setup.sh -o server-setup.sh
less server-setup.sh
bash server-setup.sh
```

Qué deja configurado:
- Las actualizaciones de seguridad automáticas.
- Docker, con un tope en el tamaño de los registros.
- El usuario `milpa`, con tu misma llave SSH.
- SSH solo con llave y sin acceso como root, y fail2ban contra intentos de fuerza bruta.
- El firewall, con solo los puertos 22, 80 y 443 abiertos.
- 2 GB de swap.
- El temporizador del respaldo diario.

**Antes de cerrar la sesión de root, abre otra terminal y comprueba que entras:** `ssh milpa@IP-DEL-SERVIDOR`.
Si algo sale mal con SSH, entra con la terminal del navegador de hPanel, como root y con la contraseña de root.

## 2. Código y variables

```bash
ssh milpa@IP-DEL-SERVIDOR
git clone https://github.com/MrKrypthon/NutriStudio.git /opt/milpa
cd /opt/milpa
cp .env.docker.example .env.docker
chmod 600 .env.docker
nano .env.docker
```

En `.env.docker`:

- **Contraseña de PostgreSQL:** `POSTGRES_PASSWORD`, y la misma dentro de `DATABASE_URL`.
- **Sin `$` en los valores:** Docker Compose lo interpreta como variable y corrompe el valor sin avisar. Los secretos generados con los comandos de abajo no lo usan.
- **Secretos de los tokens:** `JWT_SECRET` y `ADMIN_JWT_SECRET`, distintos entre sí. Genera cada uno con:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Si el servidor no
  tiene Node, usa `openssl rand -base64 48 | tr -d '/+='`.
- **Dominio y certificados:** `MILPA_DOMAIN=app.milpa.mx` y `MILPA_ACME_EMAIL=tu@correo.mx`, el correo al que Let's Encrypt manda sus avisos.
- **Dirección pública:** `APP_URL=https://app.milpa.mx`.
- **Google y Stripe**, cuando estén listos (paso 6).

## 3. Primer despliegue

```bash
deploy/deploy.sh
```

Qué hace el script:
1. Construye las imágenes.
2. Levanta el stack; las migraciones se aplican solas.
3. Caddy pide el certificado.
4. Verifica el sitio con `deploy/smoke.sh`.

Si el certificado falla, revisa que el DNS ya apunte al servidor (`dig +short app.milpa.mx`) y
los registros de Caddy: `docker compose -f docker-compose.app.yml -f docker-compose.prod.yml logs caddy`.

Después, una sola vez, carga el catálogo y crea el administrador:

```bash
alias milpa='docker compose --env-file .env.docker -f docker-compose.app.yml -f docker-compose.prod.yml'
milpa run --rm migrate npm run catalog:import
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
milpa run --rm -e ADMIN_EMAIL=tu@correo.mx -e ADMIN_PASSWORD migrate npm run admin:create
unset ADMIN_PASSWORD
```

Entra a `https://app.milpa.mx/admin` con ese correo y esa contraseña.

## 4. Respaldos diarios fuera del servidor

Crea `/etc/milpa/restic.env`, solo legible por root:

```bash
sudo install -m 600 /dev/null /etc/milpa/restic.env
sudo nano /etc/milpa/restic.env
```

```
RESTIC_REPOSITORY=b2:NOMBRE-DEL-BUCKET:milpa
RESTIC_PASSWORD=una-clave-larga-y-aleatoria
B2_ACCOUNT_ID=keyID-de-la-application-key
B2_ACCOUNT_KEY=applicationKey
```

**Guarda `RESTIC_PASSWORD` también fuera del servidor, en tu gestor de contraseñas.** Sin ella, los
respaldos no se pueden leer.

Prueba el respaldo una vez a mano y luego activa el diario, a las 03:30 hora del centro de México:

```bash
sudo systemctl start milpa-backup.service && sudo journalctl -u milpa-backup -n 20
sudo systemctl enable --now milpa-backup.timer
```

Cómo funcionan:
- Cada respaldo guarda la base (`pg_dump`) y todos los archivos: documentos, estudios, logos y fotos.
- Se conservan 7 diarios, 4 semanales y 12 mensuales.
- Cada domingo se verifica una muestra de los datos guardados.

### Restaurar

Los scripts leen ellos mismos `/etc/milpa/restic.env`, sin ejecutarlo, así que la clave no aparece en la línea de comandos:

```bash
cd /opt/milpa
sudo MILPA_RESTIC_ENV=/etc/milpa/restic.env MILPA_ENV_FILE=/opt/milpa/.env.docker deploy/restore-offsite.sh --lista
sudo MILPA_RESTIC_ENV=/etc/milpa/restic.env MILPA_ENV_FILE=/opt/milpa/.env.docker deploy/restore-offsite.sh --si-reemplazar            # el más reciente
sudo MILPA_RESTIC_ENV=/etc/milpa/restic.env MILPA_ENV_FILE=/opt/milpa/.env.docker deploy/restore-offsite.sh 57e3bda1 --si-reemplazar   # uno en particular
```

**Haz un simulacro de restauración al menos cada 3 meses**, en un servidor de prueba. Un respaldo que
nunca se ha restaurado no está comprobado.

## 5. Actualizar

```bash
cd /opt/milpa && deploy/deploy.sh
```

Qué hace el script:
1. Respalda en `respaldos/antes-de-desplegar/`; se conservan los 5 más recientes.
2. Trae `origin/main`, reconstruye y migra.
3. Verifica el sitio.

Si algo falla, el script imprime el comando para volver a la versión anterior (`deploy/deploy.sh <commit>`).

## 6. Integraciones

- **Google:** en Google Cloud Console (APIs y servicios → Credenciales), en tu ID de cliente de OAuth:
  1. Agrega `https://app.milpa.mx` a «Orígenes de JavaScript autorizados».
  2. Pon el ID en `GOOGLE_CLIENT_ID`.
  3. Corre `deploy/deploy.sh`.
- **Stripe:**
  1. Crea un endpoint de webhook en `https://app.milpa.mx/api/v1/stripe/webhook`, con los eventos de suscripción y de factura.
  2. Copia su secreto a `STRIPE_WEBHOOK_SECRET`.
  3. Empieza con las llaves de prueba (`sk_test_…`). Cambia a las reales cuando el flujo completo funcione.
- **Monitoreo:** crea un monitor gratuito en UptimeRobot o Better Stack contra
  `https://app.milpa.mx/health`. Responde 200 solo si la API y la base funcionan.

## 7. Antes de abrir

- [ ] **Aviso de privacidad y términos de servicio**, revisados por un abogado. Los datos de salud son sensibles: hace falta el consentimiento expreso que pide la LFPDPPP, y avisar que los datos se alojan fuera de México si el VPS está en EE. UU.
- [ ] **Respaldo restaurado con éxito** en un servidor de prueba.
- [ ] **Monitor de disponibilidad** activo.
- [ ] **`RESTIC_PASSWORD` y `.env.docker`** guardados en tu gestor de contraseñas.
- [ ] **Stripe en modo real** y un pago de prueba reembolsado.
