# John Dillon — Client galleries

A small Flask app with an HTML/CSS/JavaScript interface. Projects and comments use SQLite; images are stored on disk. No external database is required.

## Deploy to Railway

1. Create a GitHub repository and upload the contents of this folder, including `Dockerfile`, `app.py`, `requirements.txt`, `templates/`, and `static/`. Do not upload passwords, `.env`, or local data.
2. In Railway, create a project and deploy from that GitHub repository. Railway detects the Dockerfile. If these files are in a subfolder, set the service Root Directory to that folder.
3. Add a persistent volume to this service and set its mount path to `/data`. This is required: without it, uploads and project data can disappear on redeploy.
4. Add these service variables:
   - `ADMIN_PASSWORD`: a unique password of at least 12 characters.
   - `SECRET_KEY`: a random secret of at least 32 characters. Generate one with `python -c "import secrets; print(secrets.token_hex(32))"`.
   - `DATA_DIR`: `/data`.
   - `COOKIE_SECURE`: `true`.
5. Deploy/redeploy after setting the variables and volume. Generate a public domain under the service Networking settings. Use HTTPS. The app listens on Railway's `PORT` automatically.
6. Open `https://YOUR-DOMAIN/admin` and sign in. Create a project, upload images, add comments, and click **Copy Client Link**.

Use one service replica with this SQLite/volume setup. Configure Railway volume backups before storing important client work. Keep `SECRET_KEY` stable; changing it signs you out. Changing the admin password alone does not revoke existing sessions: also rotate the secret if necessary.

Railway reference: https://docs.railway.com/volumes
Dockerfile reference: https://docs.railway.com/builds/dockerfiles

## Everyday use

- Create or open a project from the dashboard.
- Select any number of images, up to 20 MB each. Images upload one at a time with overall progress to keep large selections manageable. The app verifies actual image content, resizes to a maximum of 3,000 pixels, removes metadata, and stores JPEG copies. PNG transparency is flattened and animated GIFs use the first frame. Keep original files separately.
- Add a comment below each image and click **Save all comments** once. Unsaved drafts stay in the dashboard while navigating; leaving or refreshing the website prompts a warning.
- **Move earlier/later** changes the gallery order.
- **Copy Client Link** copies the project's unlisted, read-only URL. Anyone with this link can view it; there are no client accounts.
- **Disable link** stops gallery and image access for clients. **Replace link** revokes the old URL and creates an active replacement. Previously downloaded images cannot be recalled.
- Deleting a project permanently deletes its images and comments.

## Run locally

Requires Python 3.11+ (Docker uses Python 3.13).

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ADMIN_PASSWORD='choose-a-long-unique-password'
$env:SECRET_KEY='choose-a-random-secret-at-least-32-characters'
$env:COOKIE_SECURE='false'
$env:DATA_DIR='./data'
flask --app app run --port 8080
```

Open http://127.0.0.1:8080/admin. Local data stays in `data/`. The example environment file is a reference; the app reads environment variables, not `.env` automatically. Never use Flask's development server for the public Railway deployment; the Dockerfile uses Gunicorn.

## Files

- `app.py`: authentication, database, uploads, sharing, and API.
- `templates/index.html`: page shell.
- `static/app.js`: dashboard and client gallery.
- `static/style.css`: responsive white/orange design.
- `Dockerfile`: production startup.
- `.env.example`: required configuration examples without real secrets.

