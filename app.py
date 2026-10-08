import io, os, secrets, sqlite3, time, warnings
from pathlib import Path
from contextlib import contextmanager
from functools import wraps
from datetime import timedelta
from threading import Lock
from flask import Flask, request, session, abort, jsonify, render_template, send_file
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import HTTPException

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True
password, secret = os.getenv('ADMIN_PASSWORD', ''), os.getenv('SECRET_KEY', '')
if len(password) < 12 or len(secret) < 32:
    raise RuntimeError('ADMIN_PASSWORD needs 12+ characters; SECRET_KEY needs 32+.')
app.config.update(SECRET_KEY=secret, MAX_CONTENT_LENGTH=120*1024*1024,
    SESSION_COOKIE_SECURE=os.getenv('COOKIE_SECURE','true').lower()=='true',
    SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12))
data = Path(os.getenv('DATA_DIR','data')).resolve()
images = data/'images'
images.mkdir(parents=True, exist_ok=True)
Image.MAX_IMAGE_PIXELS=40_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)
@contextmanager
def db():
    c=sqlite3.connect(data/'gallery.sqlite', timeout=30)
    c.row_factory=sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    try:
        with c:
            yield c
    finally:
        c.close()
with db() as c:
    c.executescript('''CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,token TEXT UNIQUE NOT NULL,shared INTEGER NOT NULL,created REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,project TEXT REFERENCES projects(id) ON DELETE CASCADE,comment TEXT NOT NULL,position INTEGER NOT NULL);''')
def admin(fn):
    @wraps(fn)
    def wrapped(*a,**kw):
        if not session.get('admin'): abort(401,'Please log in.')
        if request.method!='GET' and not secrets.compare_digest(request.headers.get('X-CSRF-Token',''),session.get('csrf','missing')):
            abort(403,'Refresh the page and log in again.')
        return fn(*a,**kw)
    return wrapped
def project(c,pid):
    p=c.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone()
    if not p: abort(404,'Project not found.')
    return p
def fields():
    b=request.get_json(silent=True) or {}
    n,d=str(b.get('name','')).strip(),str(b.get('description','')).strip()
    if not n or len(n)>150 or len(d)>3000: abort(400,'Enter a name under 150 characters and description under 3,000.')
    return n,d
@app.errorhandler(Exception)
def error(e):
    if isinstance(e,HTTPException): return jsonify(error=e.description),e.code
    app.logger.exception('Request failed')
    return jsonify(error='Something went wrong. Please try again.'),500
@app.after_request
def headers(r):
    r.headers.update({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"})
    return r
@app.get('/health')
def health(): return {'ok':True}
@app.get('/')
@app.get('/admin')
@app.get('/p/<token>')
def index(token=None): return render_template('index.html')
lock=Lock()
attempts=[]
@app.post('/api/login')
def login():
    with lock:
        now=time.monotonic()
        attempts[:]=[t for t in attempts if now-t<60]
        if len(attempts)>=10: abort(429,'Too many attempts. Wait one minute.')
        supplied=str((request.get_json(silent=True) or {}).get('password',''))
        if not secrets.compare_digest(supplied.encode(),password.encode()):
            attempts.append(now)
            abort(401,'Incorrect password.')
    session.clear()
    session.update(admin=True,csrf=secrets.token_urlsafe(32))
    session.permanent=True
    return {'csrf':session['csrf']}
@app.get('/api/session')
def status(): return {'admin':bool(session.get('admin')),'csrf':session.get('csrf','')}
@app.post('/api/logout')
@admin
def logout():
    session.clear()
    return {'ok':True}
@app.route('/api/projects',methods=['GET','POST'])
@admin
def projects():
    with db() as c:
        if request.method=='POST':
            n,d=fields(); pid=secrets.token_hex(16)
            c.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)',(pid,n,d,secrets.token_urlsafe(32),1,time.time()))
            return {'id':pid},201
        return jsonify([dict(p) for p in c.execute('SELECT p.*, (SELECT COUNT(*) FROM images WHERE project=p.id) AS count FROM projects p ORDER BY created DESC')])
@app.route('/api/projects/<pid>',methods=['GET','PATCH','DELETE'])
@admin
def detail(pid):
    with db() as c:
        p=project(c,pid)
        if request.method=='PATCH':
            n,d=fields()
            c.execute('UPDATE projects SET name=?,description=? WHERE id=?',(n,d,pid))
            return {'ok':True}
        if request.method=='DELETE':
            ids=[r[0] for r in c.execute('SELECT id FROM images WHERE project=?',(pid,))]
            c.execute('DELETE FROM projects WHERE id=?',(pid,)); c.commit()
            for iid in ids: (images/(iid+'.jpg')).unlink(missing_ok=True)
            return {'ok':True}
        result=dict(p)
        result['images']=[dict(r) for r in c.execute('SELECT * FROM images WHERE project=? ORDER BY position,id',(pid,))]
        return result
@app.post('/api/projects/<pid>/sharing')
@admin
def sharing(pid):
    action=(request.get_json(silent=True) or {}).get('action')
    with db() as c:
        project(c,pid)
        if action=='disable': c.execute('UPDATE projects SET shared=0 WHERE id=?',(pid,))
        elif action=='replace': c.execute('UPDATE projects SET shared=1,token=? WHERE id=?',(secrets.token_urlsafe(32),pid))
        else: abort(400,'Unknown action.')
    return {'ok':True}
@app.post('/api/projects/<pid>/images')
@admin
def upload(pid):
    files=request.files.getlist('images'); prepared=[]; written=[]
    if not files: abort(400,'Select at least one image.')
    try:
        for f in files:
            raw=f.read(20*1024*1024+1)
            if len(raw)>20*1024*1024: abort(400,'Each image must be 20 MB or smaller.')
            try:
                with Image.open(io.BytesIO(raw)) as im:
                    if im.format not in ('JPEG','PNG','WEBP','GIF'): abort(400,'Use JPG, PNG, WebP or GIF.')
                    im.load(); im=ImageOps.exif_transpose(im).convert('RGB'); im.thumbnail((3000,3000))
                    out=io.BytesIO(); im.save(out,'JPEG',quality=88)
                    prepared.append((secrets.token_hex(16),out.getvalue()))
            except (UnidentifiedImageError,OSError,Image.DecompressionBombError,Image.DecompressionBombWarning):
                abort(400,'An image is invalid or has too many pixels.')
        with db() as c:
            project(c,pid)
            pos=c.execute('SELECT COALESCE(MAX(position),-1)+1 FROM images WHERE project=?',(pid,)).fetchone()[0]
            for i,(iid,raw) in enumerate(prepared):
                (images/(iid+'.jpg')).write_bytes(raw); written.append(iid)
                c.execute('INSERT INTO images VALUES(?,?,?,?)',(iid,pid,'',pos+i))
    except Exception:
        for iid in written: (images/(iid+'.jpg')).unlink(missing_ok=True)
        raise
    finally:
        for f in files: f.close()
    return {'ok':True},201
@app.route('/api/images/<iid>',methods=['PATCH','DELETE'])
@admin
def edit_image(iid):
    with db() as c:
        if not c.execute('SELECT id FROM images WHERE id=?',(iid,)).fetchone(): abort(404)
        if request.method=='DELETE':
            c.execute('DELETE FROM images WHERE id=?',(iid,)); c.commit()
            (images/(iid+'.jpg')).unlink(missing_ok=True)
        else:
            comment=str((request.get_json(silent=True) or {}).get('comment',''))
            if len(comment)>5000: abort(400,'Comment must be under 5,000 characters.')
            c.execute('UPDATE images SET comment=? WHERE id=?',(comment,iid))
    return {'ok':True}
@app.post('/api/projects/<pid>/order')
@admin
def order(pid):
    ids=(request.get_json(silent=True) or {}).get('ids',[])
    with db() as c:
        project(c,pid)
        actual=[r[0] for r in c.execute('SELECT id FROM images WHERE project=?',(pid,))]
        if not isinstance(ids,list) or any(not isinstance(x,str) for x in ids) or len(ids)!=len(actual) or set(ids)!=set(actual): abort(400,'Refresh and try again.')
        for pos,iid in enumerate(ids): c.execute('UPDATE images SET position=? WHERE id=? AND project=?',(pos,iid,pid))
    return {'ok':True}
@app.get('/api/gallery/<token>')
def gallery(token):
    with db() as c:
        p=c.execute('SELECT * FROM projects WHERE token=? AND shared=1',(token,)).fetchone()
        if not p: abort(404,'This gallery link is unavailable.')
        return {'name':p['name'],'description':p['description'],'images':[dict(r) for r in c.execute('SELECT id,comment FROM images WHERE project=? ORDER BY position,id',(p['id'],))]}
@app.get('/media/<iid>')
def media(iid):
    with db() as c:
        r=c.execute('SELECT p.token,p.shared FROM images i JOIN projects p ON i.project=p.id WHERE i.id=?',(iid,)).fetchone()
        if not r: abort(404)
        if not session.get('admin') and not (r['shared'] and secrets.compare_digest(request.args.get('token',''),r['token'])): abort(404)
    return send_file(images/(iid+'.jpg'),mimetype='image/jpeg')



@app.patch('/api/projects/<pid>/comments')
@admin
def save_comments(pid):
    updates=(request.get_json(silent=True) or {}).get('comments')
    if not isinstance(updates,list): abort(400,'Invalid comments.')
    with db() as c:
        project(c,pid)
        valid={r[0] for r in c.execute('SELECT id FROM images WHERE project=?',(pid,))}
        seen=set()
        for item in updates:
            if not isinstance(item,dict): abort(400,'Invalid comment.')
            iid,comment=item.get('id'),item.get('comment')
            if not isinstance(iid,str) or iid not in valid or iid in seen: abort(400,'Refresh the project and try again.')
            if not isinstance(comment,str) or len(comment)>5000: abort(400,'Comments must be under 5,000 characters.')
            seen.add(iid)
        for item in updates:
            c.execute('UPDATE images SET comment=? WHERE id=? AND project=?',(item['comment'],item['id'],pid))
    return {'ok':True}

