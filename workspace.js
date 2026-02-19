// Enhanced workspace.js for file management with categorization
async function loadFiles() {
    try {
        const response = await fetch('/api/files');
        const files = await response.json();
        const container = document.getElementById('files-container');
        
        if (files.length === 0) {
            container.innerHTML = '<p class="text-gray-400 italic">No files yet. Upload your work product here.</p>';
            return;
        }

        // Calculate stats
        const stats = calculateStats(files);
        updateStatsDisplay(stats);

        // Categorize files
        const categorized = categorizeFiles(files);
        const html = buildCategorizedDisplay(categorized);
        container.innerHTML = html;

    } catch (err) {
        console.error('Failed to load files:', err);
    }
}

function calculateStats(files) {
    return {
        total: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
        categories: categorizeByType(files)
    };
}

function categorizeByType(files) {
    const categories = {};
    files.forEach(file => {
        const ext = file.name.split('.').pop().toLowerCase();
        const category = getFileCategory(ext);
        if (!categories[category]) categories[category] = [];
        categories[category].push(file);
    });
    return categories;
}

function categorizeFiles(files) {
    const categorized = {};
    const categories = categorizeByType(files);
    
    // Sort each category by date
    Object.keys(categories).forEach(cat => {
        categorized[cat] = categories[cat].sort((a,b) => new Date(b.date) - new Date(a.date));
    });
    
    return categorized;
}

function updateStatsDisplay(stats) {
    const totalFilesEl = document.getElementById('total-files');
    const totalSizeEl = document.getElementById('total-size');
    
    if (totalFilesEl) totalFilesEl.textContent = `${stats.total} files`;
    if (totalSizeEl) totalSizeEl.textContent = `${formatBytes(stats.totalSize)}`;
}

function buildCategorizedDisplay(categorized) {
    let html = '';
    
    const categoryNames = {
        documents: '📄 Documents',
        presentations: '📊 Presentations', 
        spreadsheets: '📈 Spreadsheets',
        code: '💻 Code Files',
        designs: '🎨 Designs',
        other: '📎 Other'
    };

    Object.entries(categorized).forEach(([category, files]) => {
        if (files.length === 0) return;
        
        html += `
            <div class="mb-4">
                <h3 class="text-pp-green font-semibold mb-2">${categoryNames[category]} (${files.length})</h3>
                ${files.map(file => `
                    <div class="file-item">
                        <div class="flex items-center">
                            <span class="file-icon">${file.type}</span>
                            <span class="file-name" title="${file.name}">${file.name}</span>
                            <span class="text-gray-400 text-sm ml-auto">${formatBytes(file.size)} • ${new Date(file.date).toLocaleDateString()}</span>
                        </div>
                        <div class="file-actions">
                            <a href="/api/files/download/${encodeURIComponent(file.name)}" class="btn-primary" download>
                                Download
                            </a>
                            <button onclick="deleteFile('${file.name}')" class="btn-secondary">
                                Delete
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    });

    return html || '<p class="text-gray-400 italic">No files to display.</p>';
}

function getFileCategory(ext) {
    ext = ext.toLowerCase();
    const categories = {
        documents: ['pdf', 'doc', 'docx', 'txt', 'md'],
        presentations: ['ppt', 'pptx', 'key'],
        spreadsheets: ['xls', 'xlsx', 'csv'],
        code: ['js', 'py', 'java', 'cpp', 'c', 'html', 'css', 'ts', 'json', 'sql', 'sh', 'go', 'rs'],
        designs: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'sketch', 'fig', 'psd']
    };
    
    for (const [category, extensions] of Object.entries(categories)) {
        if (extensions.includes(ext)) return category;
    }
    return 'other';
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function deleteFile(filename) {
    if (!confirm('Delete this file?')) return;
    
    try {
        const response = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            loadFiles();
        }
    } catch (err) {
        console.error('Failed to delete file:', err);
    }
}

// Enhanced upload with progress
async function handleEnhancedUpload(e) {
    const files = e.target.files;
    if (!files.length) return;

    for (const file of files) {
        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            alert(`${file.name} is too large (max 50MB)`);
            continue;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            await fetch('/api/files/upload', {
                method: 'POST',
                body: formData
            });
        } catch (err) {
            console.error('Upload failed:', file.name, err);
        }
    }
    
    loadFiles();
}

// Enhanced file upload notifications
function showUploadNotification(fileName, success = true) {
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 right-4 bg-pp-green text-white p-3 rounded-lg shadow-lg';
    notification.textContent = success ? `✅ ${fileName} uploaded successfully` : `❌ Failed to upload ${fileName}`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// Auto-refresh and drop zone support
let dropZoneActive = false;

function addDropZone() {
    const workspace = document.getElementById('files-container');
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, unhighlight, false);
    });
    
    workspace.addEventListener('drop', handleDrop, false);
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight(e) {
    if (!dropZoneActive) {
        document.getElementById('files-container').classList.add('bg-pp-highlight');
        dropZoneActive = true;
    }
}

function unhighlight(e) {
    document.getElementById('files-container').classList.remove('bg-pp-highlight');
    dropZoneActive = false;
}

async function handleDrop(e) {
    const files = e.dataTransfer.files;
    for (const file of files) {
        await handleSingleUpload(file);
    }
}

async function handleSingleUpload(file) {
    if (file.size > 50 * 1024 * 1024) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        await fetch('/api/files/upload', {
            method: 'POST',
            body: formData
        });
        showUploadNotification(file.name, true);
    } catch (err) {
        showUploadNotification(file.name, false);
    }
    
    loadFiles();
}

// Initialize enhanced workspace
document.addEventListener('DOMContentLoaded', () => {
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');
    
    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleEnhancedUpload);
        
        // Override original event handlers
        fileInput.removeEventListener('change', window.handleFileUpload || (() => {}));
        uploadBtn.removeEventListener('click', window.handleUploadBtn || (() => {}));
    }
    
    loadFiles();
    setInterval(loadFiles, 10000); // Auto-refresh every 10s
    
    // Add drop zone functionality
    addDropZone();
});