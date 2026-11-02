const main=document.querySelector('#main'),notice=document.querySelector('#notice');
let csrf='',current=null,selected=[],noticeTimer;
const drafts=new Map();
const evaluationDrafts=new Map();
window.addEventListener('beforeunload',e=>{if(drafts.size||evaluationDrafts.size){e.preventDefault();e.returnValue='';}});
async function saveComments(){const ids=new Set(current.images.map(im=>im.id));const comments=Array.from(drafts,([id,comment])=>({id,comment})).filter(im=>ids.has(im.id));if(!comments.length){tell('All comments are saved.');return;}await api('/api/projects/'+current.id+'/comments','PATCH',{comments});for(const im of comments){if(drafts.get(im.id)===im.comment)drafts.delete(im.id);const saved=current.images.find(x=>x.id===im.id);if(saved)saved.comment=im.comment;}tell('All comments saved.');}
const token=location.pathname.startsWith('/p/')?location.pathname.slice(3):null;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
function tell(message){notice.textContent=message;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,6000)}
async function api(path,method='GET',body){const r=await fetch(path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed.');return data}
function button(text,action,cls){const b=el('button',text,cls);b.type='button';b.onclick=async()=>{b.disabled=true;try{await action()}catch(e){tell(e.message)}finally{b.disabled=false}};return b}
function toolbar(){return el('div',undefined,'toolbar')}
function field(form,label,value='',area=false){const id='f'+Math.random().toString(36).slice(2),l=el('label',label),input=el(area?'textarea':'input');l.htmlFor=id;input.id=id;input.value=value;form.append(l,input);return input}

const richPrefix='jd-rich-v1:';
function richRuns(value){
    if(typeof value!=='string')return [];
    if(value.startsWith(richPrefix)){
        try{const runs=JSON.parse(value.slice(richPrefix.length));if(Array.isArray(runs)&&runs.every(r=>r&&typeof r.text==='string'&&typeof r.bold==='boolean'))return runs;}catch{}
    }
    return [{text:value,bold:false}];
}
function paintRich(node,value){node.replaceChildren();for(const run of richRuns(value)){if(run.bold){const strong=el('strong',run.text);node.append(strong);}else node.append(document.createTextNode(run.text));}return node;}
function richText(tag,value,cls){return paintRich(el(tag,undefined,cls),value);}
function extractRuns(node){
    const runs=[];
    function add(text,bold=false){if(!text)return;const last=runs[runs.length-1];if(last&&last.bold===bold)last.text+=text;else runs.push({text,bold});}
    function walk(n,bold=false){
        if(n.nodeType===3){add(n.nodeValue,bold);return;}
        if(n.nodeType!==1)return;
        const tag=n.tagName;
        if(['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH','NOSCRIPT'].includes(tag))return;
        if(tag==='BR'){add('\n');return;}
        const block=['P','DIV','LI','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','TR'].includes(tag);
        if(block&&runs.length&&!runs[runs.length-1].text.endsWith('\n'))add('\n');
        if(tag==='LI')add('• ');
        const weight=n.style?.fontWeight||'';
        const nextBold=bold||tag==='B'||tag==='STRONG'||weight==='bold'||weight==='bolder'||Number(weight)>=600;
        for(const child of n.childNodes)walk(child,nextBold);
        if(block&&n.nextSibling&& !runs[runs.length-1]?.text.endsWith('\n'))add('\n');
    }
    for(const child of node.childNodes)walk(child);
    return runs;
}
function encodeRuns(runs){if(!runs.some(r=>r.bold))return runs.map(r=>r.text).join('');return richPrefix+JSON.stringify(runs);}
function richField(form,label,value=''){
    const wrap=el('div',undefined,'rich-field'),id='rich-'+Math.random().toString(36).slice(2),lab=el('label',label),editor=el('div',undefined,'rich-editor');
    lab.htmlFor=id;editor.id=id;editor.contentEditable='true';editor.setAttribute('role','textbox');editor.setAttribute('aria-label',label);editor.setAttribute('aria-multiline','true');editor.spellcheck=true;
    editor.maxLength=20000;let previous=value;
    Object.defineProperty(editor,'value',{get:()=>encodeRuns(extractRuns(editor)),set:v=>{paintRich(editor,v);previous=v;}});
    Object.defineProperty(editor,'placeholder',{set:v=>editor.dataset.placeholder=v});editor.value=value;
    const tools=el('div',undefined,'rich-tools'),bold=button('B',()=>{editor.focus();document.execCommand('bold');editor.dispatchEvent(new Event('input',{bubbles:true}));},'rich-bold');
    bold.setAttribute('aria-label','Bold text');bold.title='Bold (Ctrl+B / ⌘B)';bold.onmousedown=e=>e.preventDefault();tools.append(bold);
    editor.addEventListener('input',()=>{if(editor.value.length>editor.maxLength){editor.value=previous;tell('This text is too long. Please shorten it.');}else previous=editor.value;});
    editor.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='b'){e.preventDefault();document.execCommand('bold');editor.dispatchEvent(new Event('input',{bubbles:true}));}});
    editor.addEventListener('paste',e=>{
        e.preventDefault();const html=e.clipboardData.getData('text/html'),text=e.clipboardData.getData('text/plain');let runs;
        if(html){const doc=new DOMParser().parseFromString(html,'text/html');runs=extractRuns(doc.body);}else runs=[{text,bold:false}];
        const holder=el('div');paintRich(holder,encodeRuns(runs));
        // Only our own text/strong nodes are serialized, never clipboard HTML.
        if(editor.value.length+encodeRuns(runs).length>editor.maxLength){tell('Pasted text is too long.');return;}
        document.execCommand('insertHTML',false,holder.innerHTML.replace(/\n/g,'<br>'));editor.dispatchEvent(new Event('input',{bubbles:true}));
    });
    wrap.append(lab,tools,editor);form.append(wrap);return editor;
}

function mediaUrl(id){return '/media/'+id+(token?'?token='+encodeURIComponent(token):'')}
function zoom(im,index){document.querySelector('#large').src=mediaUrl(im.id);document.querySelector('#large').alt='Project image '+(index+1);const c=document.querySelector('#large-comment');paintRich(c,im.comment);c.hidden=!im.comment;document.querySelector('#lightbox').showModal()}
document.querySelector('#close-lightbox').onclick=()=>document.querySelector('#lightbox').close();
document.querySelector('#logout').onclick=async()=>{try{await api('/api/logout','POST');location.href='/admin'}catch(e){tell(e.message)}};
function login(){main.replaceChildren();const f=el('form',undefined,'form login');f.append(el('h1','Admin login'),el('p','Manage your projects and client galleries.','muted'));const pass=field(f,'Password');pass.type='password';pass.required=true;pass.autocomplete='current-password';const b=el('button','Log in','primary');b.type='submit';f.append(el('br'),el('br'),b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{csrf=(await api('/api/login','POST',{password:pass.value})).csrf;await list()}catch(err){tell(err.message)}finally{b.disabled=false}};main.append(f)}
async function list(){current=null;document.querySelector('#logout').hidden=false;const projects=await api('/api/projects');main.replaceChildren();const top=el('div',undefined,'topline');top.append(el('h1','Projects'),button('+ New Project',()=>projectForm(), 'primary'));main.append(top,el('p','Upload images, add your notes, and share a gallery.','muted'));if(!projects.length){main.append(el('div','No projects yet. Create your first project to get started.','empty'));return}const grid=el('div',undefined,'grid');projects.forEach(p=>{const card=el('section',undefined,'card card-body');card.append(el('h2',p.name),el('p',p.count+' image'+(p.count===1?'':'s')+' · '+(p.shared?'Sharing on':'Sharing off'),'muted'));if(p.description)card.append(el('p',p.description,'description'));card.append(button('Open project',()=>openProject(p.id)));grid.append(card)});main.append(grid)}
function projectForm(p=null){main.replaceChildren();main.append(button('← Back',()=>p?openProject(p.id):list()));const f=el('form',undefined,'form');f.append(el('h1',p?'Edit project':'New project'));const name=field(f,'Project name',p?.name||'');name.required=true;name.maxLength=150;const desc=field(f,'Description (optional)',p?.description||'',true);desc.maxLength=3000;const bar=toolbar(),save=el('button','Save project','primary');save.type='submit';bar.append(save);f.append(bar);f.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const result=await api('/api/projects'+(p?'/'+p.id:''),p?'PATCH':'POST',{name:name.value,description:desc.value});await openProject(p?.id||result.id)}catch(err){tell(err.message)}finally{save.disabled=false}};main.append(f)}
async function openProject(pid){selected=[];const p=await api('/api/projects/'+pid);current=p;main.replaceChildren();main.append(button('← All projects',list),el('br'),el('br'),el('h1',p.name));if(p.description)main.append(el('p',p.description,'description'));const bar=toolbar();bar.append(button('Edit project',()=>projectForm(p)),button('Copy Client Link',async()=>{if(!p.shared)throw Error('Create a new link to enable sharing.');const link=location.origin+'/p/'+p.token;try{await navigator.clipboard.writeText(link);tell('Client link copied.')}catch{window.prompt('Copy this client link:',link)}},'primary'));if(p.shared){const a=el('a','Preview Gallery','button');a.href='/p/'+p.token;a.target='_blank';a.rel='noopener';bar.append(a,button('Disable link',async()=>{if(confirm('Disable this gallery link?')){await api('/api/projects/'+pid+'/sharing','POST',{action:'disable'});await openProject(pid)}}))}bar.append(button(p.shared?'Replace link':'Create new link',async()=>{if(confirm('Create a new link? Any previous link will stop working.')){await api('/api/projects/'+pid+'/sharing','POST',{action:'replace'});await openProject(pid)}}));main.append(bar,el('p',p.shared?'Anyone with the client link can view this project.':'Sharing is disabled.','muted small'));renderEvaluation(p,true);const up=el('section',undefined,'upload');up.append(el('h2','Upload images'),el('p','Choose images, up to 20 MB each. Add your comments after uploading.','muted small'));const picker=el('input');picker.type='file';picker.multiple=true;picker.accept='image/jpeg,image/png,image/webp,image/gif';picker.setAttribute('aria-label','Choose images');const previews=el('div',undefined,'previews'),progress=el('progress');progress.max=100;progress.value=0;progress.hidden=true;progress.setAttribute('aria-label','Upload progress');picker.onchange=()=>{selected=Array.from(picker.files);previews.replaceChildren();selected.forEach(f=>{const img=el('img');const u=URL.createObjectURL(f);img.src=u;img.alt=f.name;img.onload=()=>URL.revokeObjectURL(u);previews.append(img)})};up.append(picker,previews,progress,button('Upload selected images',async()=>{if(!selected.length)throw Error('Select at least one image.');if(selected.some(f=>f.size>20*1024*1024))throw Error('Each image must be 20 MB or smaller.');progress.hidden=false;const queue=[...selected];let completed=0;for(const file of queue){const form=new FormData();form.append('images',file);await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/projects/'+pid+'/images');xhr.setRequestHeader('X-CSRF-Token',csrf);xhr.upload.onprogress=e=>{if(e.lengthComputable)progress.value=(completed+e.loaded/e.total)/queue.length*100};xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve();else{try{reject(Error(JSON.parse(xhr.responseText).error))}catch{reject(Error('Upload failed.'))}}};xhr.onerror=()=>reject(Error('Connection lost. Please try again.'));xhr.send(form)}).catch(error=>{selected=queue.slice(completed);throw Error(completed+' of '+queue.length+' images uploaded. '+error.message+' Click Upload to retry the remaining images.');});completed++;}await openProject(pid);tell('Images uploaded. Add your comments below.');},'primary'));main.append(up);renderImages(p.images,true);if(p.images.length){const saves=el('div',undefined,'save-comments');saves.append(button('Save all comments',saveComments,'primary'));main.append(saves);}const bottom=toolbar();bottom.append(button('Delete project',async()=>{if(confirm('Delete this project and all its images? This cannot be undone.')){await api('/api/projects/'+pid,'DELETE');await list()}},'danger'));main.append(bottom)}
function renderImages(images,editing=false){if(!images.length){main.append(el('div','No images uploaded yet.','empty'));return}const grid=el('div',undefined,'grid');images.forEach((im,i)=>{const card=el('article',undefined,'card'),open=button('',()=>zoom(im,i),'image-button'),img=el('img');img.src=mediaUrl(im.id);img.alt='Project image '+(i+1);img.loading='lazy';open.setAttribute('aria-label','Enlarge image '+(i+1));open.append(img);card.append(open);if(editing){const box=el('div',undefined,'comment-editor'),comment=richField(box,'Comment',im.comment);comment.maxLength=5000;comment.value=drafts.get(im.id)??im.comment;comment.oninput=()=>{if(comment.value===im.comment)drafts.delete(im.id);else drafts.set(im.id,comment.value);};card.append(box);const bar=toolbar();for(const [label,delta] of [['Move earlier',-1],['Move later',1]]){const b=button(label,async()=>{const ids=images.map(x=>x.id);[ids[i],ids[i+delta]]=[ids[i+delta],ids[i]];await api('/api/projects/'+current.id+'/order','POST',{ids});await openProject(current.id)});b.disabled=i+delta<0||i+delta>=images.length;bar.append(b)}bar.append(button('Delete',async()=>{if(confirm('Delete this image?')){await api('/api/images/'+im.id,'DELETE');await openProject(current.id)}},'danger'));card.append(bar)}else if(im.comment)card.append(richText('p',im.comment,'comment'));grid.append(card)});main.append(grid)}
async function start(){try{if(token){const p=await api('/api/gallery/'+encodeURIComponent(token));document.title=p.name+' | John Dillon';renderClientPage(p);return}const s=await api('/api/session');csrf=s.csrf;if(s.admin)await list();else login()}catch(e){main.replaceChildren(el('h1','Gallery unavailable'),el('p',e.message))}}




function renderEvaluation(p,editing=false){
    if(!editing&&!p.evaluation)return;
    const section=el('section',undefined,'evaluation');
    section.append(el('h2','Business Evaluation'));
    if(!editing){
        const rating=el('p','★'.repeat(p.evaluation.rating)+'☆'.repeat(5-p.evaluation.rating),'evaluation-rating');
        rating.setAttribute('aria-label',p.evaluation.rating+' out of 5 stars');
        section.append(rating,el('p',p.evaluation.rating+' out of 5','muted small'));
        for(const [key,title] of [['comments','Comments'],['suggestions','Suggestions']]){
            if(p.evaluation[key])section.append(el('h3',title),richText('p',p.evaluation[key],'evaluation-text'));
        }
        for(const area of p.evaluation.areas||[]){const card=el('article',undefined,'evaluation-area');card.append(el('h3',area.title));for(const key of ['comments','suggestions']){if(area[key]){const box=el('div',undefined,'area-box pastel-'+area[key+'Color']);box.append(el('h4',key==='comments'?'Comments':'Suggestions'),richText('p',area[key],'evaluation-text'));card.append(box);}}section.append(card);}main.append(section);return;
    }
    const saved={...(p.evaluation||{rating:null,comments:'',suggestions:''}),areas:p.evaluation?.areas||[]};
    const draft=structuredClone(evaluationDrafts.get(p.id)||saved);
    const form=el('form');
    const group=el('fieldset',undefined,'star-picker');
    group.append(el('legend','Overall rating'));
    const choices=[];
    for(let value=1;value<=5;value++){
        const label=el('label'),radio=el('input'),star=el('span','★');
        radio.type='radio';radio.name='overall-rating';radio.value=value;
        radio.required=true;radio.checked=draft.rating===value;
        radio.setAttribute('aria-label',value+' star'+(value===1?'':'s'));
        label.append(radio,star);group.append(label);choices.push({radio,star,value});
        radio.onchange=()=>{draft.rating=value;changed();paint();};
    }
    const ratingText=el('p',undefined,'muted small');
    function paint(){for(const choice of choices)choice.star.classList.toggle('selected',choice.value<=draft.rating);ratingText.textContent=draft.rating?draft.rating+' out of 5':'Choose 1–5 stars';}
    function changed(){if(JSON.stringify(draft)===JSON.stringify(saved))evaluationDrafts.delete(p.id);else evaluationDrafts.set(p.id,structuredClone(draft));}
    paint();form.append(group,ratingText);
    const comments=richField(form,'Comments',draft.comments),suggestions=richField(form,'Suggestions',draft.suggestions);
    comments.placeholder='Your findings about the website, logo, Google Business Profile, SEO, and other areas.';
    suggestions.placeholder='Recommended improvements and next steps.';
    comments.maxLength=suggestions.maxLength=20000;
    comments.oninput=()=>{draft.comments=comments.value;changed();};
    suggestions.oninput=()=>{draft.suggestions=suggestions.value;changed();};
    const areaList=el('div');
    function drawAreas(focusIndex=null){
        areaList.replaceChildren();
        draft.areas.forEach((area,index)=>{
            const card=el('article',undefined,'evaluation-area');
            const title=field(card,'Area title',area.title);title.required=true;title.maxLength=150;
            title.placeholder='Website, logo, Google Business Profile, SEO…';
            title.oninput=()=>{area.title=title.value;changed();};
            for(const key of ['comments','suggestions']){
                const row=el('div',undefined,'area-edit-row'),box=el('div',undefined,'area-edit-text');
                const text=richField(box,key==='comments'?'Comments':'Suggestions',area[key]);text.maxLength=20000;
                text.classList.add('pastel-'+area[key+'Color']);text.oninput=()=>{area[key]=text.value;changed();};
                const palette=el('div',undefined,'area-palette');palette.setAttribute('role','group');palette.setAttribute('aria-label',(key==='comments'?'Comments':'Suggestions')+' background color');
                for(const color of ['peach','blue','mint','lavender','yellow']){
                    const swatch=button('',()=>{area[key+'Color']=color;changed();for(const c of ['peach','blue','mint','lavender','yellow'])text.classList.remove('pastel-'+c);text.classList.add('pastel-'+color);for(const b of palette.children)b.setAttribute('aria-pressed',String(b===swatch));},'color-swatch pastel-'+color);
                    swatch.setAttribute('aria-label',color);swatch.title=color;swatch.setAttribute('aria-pressed',String(area[key+'Color']===color));palette.append(swatch);
                }
                row.append(box,palette);card.append(row);
            }
            const actions=toolbar();
            for(const [label,delta] of [['↑ Move up',-1],['↓ Move down',1]]){
                const move=button(label,()=>{[draft.areas[index],draft.areas[index+delta]]=[draft.areas[index+delta],draft.areas[index]];changed();drawAreas(index+delta);});move.disabled=index+delta<0||index+delta>=draft.areas.length;actions.append(move);
            }
            actions.append(button('Remove area',()=>{if(confirm('Remove this area? Save Evaluation to apply the change.')){draft.areas.splice(index,1);changed();drawAreas();}},'danger'));
            card.append(actions);areaList.append(card);
            if(index===focusIndex)title.focus();
        });
    }
    drawAreas();form.append(areaList,button('Add new area',()=>{draft.areas.push({title:'',comments:'',suggestions:'',commentsColor:'peach',suggestionsColor:'blue'});changed();drawAreas(draft.areas.length-1);}));
    const bar=toolbar(),save=el('button','Save Evaluation','primary');save.type='submit';bar.append(save);form.append(bar);
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;const payload=structuredClone(draft);try{await api('/api/projects/'+p.id+'/evaluation','PUT',payload);p.evaluation={...payload};Object.assign(saved,payload);if(JSON.stringify(evaluationDrafts.get(p.id))===JSON.stringify(payload))evaluationDrafts.delete(p.id);tell('Evaluation saved. Clients can view it through their project link.');}catch(error){tell(error.message);}finally{save.disabled=false;}};
    section.append(form);main.append(section);
}

function renderClientPage(p){
    document.body.classList.add('client-canvas');
    main.replaceChildren();
    const hero=el('section',undefined,'client-hero'),intro=el('div',undefined,'client-intro');
    intro.append(el('p','CLIENT REVIEW','client-eyebrow'),el('h1',p.name));
    if(p.description)intro.append(el('p',p.description,'description'));
    hero.append(intro);
    if(p.evaluation){
        const score=el('div',undefined,'client-score');
        score.append(el('p','Overall evaluation','client-score-label'));
        const stars=el('div','★'.repeat(p.evaluation.rating)+'☆'.repeat(5-p.evaluation.rating),'client-stars');
        stars.setAttribute('aria-label',p.evaluation.rating+' out of 5 stars');
        score.append(stars,el('p',p.evaluation.rating+' out of 5','client-score-value'));hero.append(score);
    }
    main.append(hero);
    if(p.evaluation){
        const section=el('section',undefined,'client-evaluation');section.append(el('h2','Business evaluation','client-section-title'));
        if(p.evaluation.comments||p.evaluation.suggestions){
            const summary=el('article',undefined,'client-summary');
            summary.append(el('h3','Overall review'));
            const notes=el('div',undefined,'client-summary-notes');
            for(const [key,label,color] of [['comments','Comments','lavender'],['suggestions','Suggestions','peach']]){
                if(p.evaluation[key]){const box=el('div',undefined,'area-box pastel-'+color);box.append(el('h4',label),richText('p',p.evaluation[key],'evaluation-text'));notes.append(box);}
            }
            summary.append(notes);section.append(summary);
        }
        const areas=el('div',undefined,'client-areas');
        (p.evaluation.areas||[]).forEach((area,index)=>{
            const card=el('article',undefined,'evaluation-area');
            card.append(el('span','AREA '+String(index+1).padStart(2,'0'),'client-area-label'),el('h3',area.title));
            for(const [key,label] of [['comments','Comments'],['suggestions','Suggestions']]){
                if(area[key]){const box=el('div',undefined,'area-box pastel-'+area[key+'Color']);box.append(el('h4',label),richText('p',area[key],'evaluation-text'));card.append(box);}
            }
            areas.append(card);
        });
        section.append(areas);main.append(section);
    }
    const heading=el('div',undefined,'client-gallery-heading');heading.append(el('h2','Design review','client-section-title'),el('span',p.images.length+' image'+(p.images.length===1?'':'s'),'muted small'));main.append(heading);
    renderImages(p.images);
    main.append(el('footer','Prepared by John Dillon','client-footer'));
}

start();
