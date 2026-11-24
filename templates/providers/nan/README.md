# NaN en Pi

NaN expone una API compatible con OpenAI:

- Base URL: `https://api.nan.builders/v1`
- Auth: `Authorization: Bearer sk-...`
- API: `openai-completions`

No hace falta `/login`. Se configura en `~/.pi/agent/models.json`.

## 1. API key

Generala en la plataforma de NaN: ajustes de usuario → API Keys.

```bash
export NAN_API_KEY="sk-tu-clave"
```

Agregalo a `~/.bashrc` o `~/.zshrc` si querés que persista.

## 2. models.json

Si no tenés `~/.pi/agent/models.json`:

```bash
mkdir -p ~/.pi/agent
cp models.json ~/.pi/agent/models.json
```

Si ya existe, agregá el bloque `nan` dentro de `providers`; no reemplaces el archivo entero.

## 3. settings.json

Agregá estas dos claves a `~/.pi/agent/settings.json` sin borrar las que ya hay:

```json
{
  "defaultProvider": "nan",
  "defaultModel": "glm5.3-flash"
}
```

Sin `defaultProvider` y `defaultModel`, Pi sigue usando su proveedor de fábrica y devuelve 401.

## 4. Probar

```bash
pi --list-models | grep nan
pi
```

Dentro de Pi:

```text
/model
```

Elegí `nan/glm5.3-flash` y mandá un mensaje corto.

## 5. Usar po-shell

```bash
po-shell
```

po-shell usa el mismo home de Pi, así que toma esta configuración automáticamente.
