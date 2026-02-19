<script>
// Add at bottom of index.html
const fileInput = document.getElementById('fileInput');
const progressEl = document.createElement('div');
progressEl.innerHTML = '<div style="color:var(--accent)">Uploading...<div style="display:inline-block;width:12px;height:12px;border:2px solid;var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin-left:8px"></div></div>';
progressEl.style.display = 'none';
document.querySelector('.file-controls').appendChild(progressEl);

async function uploadFiles(files) {
  if (!files.length) return;
  progressEl.style.display = 'block';
  const data = new FormData();
  Array.from(files).forEach(f => data.append('file', f));
  try {
    await fetch('/api/files', { method: 'POST', body: data });
    loadFiles();
  } catch(e) { 
    console.error('Upload failed:', e) 
  } finally {
    progressEl.style.display = 'none';
  }
}

async function loadFiles() {
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    const files = data.files || [];
    document.getElementById('fileList').innerHTML = files.length 
      ? files.map(f => `<div class=file-item>
          <div>${generateIcon(f.name)} ${f.name}</div>
          <div style="font-size:11px;color:var(--text-dim)">${formatSize(f.size)} • ${new Date(f.modified).toLocaleDateString()}</div>
          <div style="margin-top:8px">
            <a href="/api/files/${encodeURIComponent(f.name)}" style="color:var(--accent);font-size:11px;margin-right:8px">Download</a>
            <button onclick="deleteFile('${encodeURIComponent(f.name)}')" style="color:#f85149;font-size:11px;background:none;border:none;cursor:pointer">Delete</button>
          </div>
        </div>`).join('')
      : '<div style="color:var(--text-dim);text-align:center;padding:40px">No files uploaded yet</div>';
  } catch (e) {
    console.error('Failed to load files:', e);
    document.getElementById('fileList').innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:40px">[ERROR]</div>';
  }
}

async function deleteFile(filename) {
  if (!confirm('Delete this file?')) return;
  await fetch(`/api/files/${filename}`, { method: 'DELETE' });
  loadFiles();
}

function generateIcon(name) {
  const icons = {pdf:'📕', docx:'📄', doc:'📄', pptx:'📽️', ppt:'📽️', xlsx:'📊', xls:'📊', txt:'📝', md:'📝', png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', webp:'🖼️', svg:'🖼️', json:'💻', html:'💻', css:'💻', js:'💻', zip:'📦'}
  return icons[name.split('.').pop().toLowerCase()] || '📎';
}

function formatSize(bytes){
  if(bytes<1024) return bytes+' B'; 
  if(bytes<1048576) return(bytes/1024).toFixed(1)+' KB';
  return(bytes/1048576).toFixed(1)+' MB';
}

document.ondragover = e => e.preventDefault();
document.ondrop = e => e.preventDefault();

document.getElementById('fileInput').addEventListener('dragover', e => e.preventDefault());
document.getElementById('fileInput').addEventListener('drop', e => e.preventDefault());
</script>