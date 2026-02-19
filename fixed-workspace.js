// Add this JavaScript to the dashboard to fix API endpoint issues
// For the shared workspace file scanning functionality

class SharedWorkspaceManager {
    constructor() {
        this.apiBase = ''; // Use relative paths
        this.files = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.scanWorkspace();
    }

    setupEventListeners() {
        // API endpoint updates to use relative paths
        document.addEventListener('DOMContentLoaded', () => {
            this.updateFileGrid();
        });
    }

    async scanWorkspace() {
        try {
            const response = await fetch('./api/files'); // Use relative path
            if (!response.ok) throw new Error('Failed to load files');
            const data = await response.json();
            this.files = data.files || [];
            this.updateFileUI();
        } catch (error) {
            console.error('Error scanning workspace:', error);
            this.files = this.generateMockFiles(); // Fallback
            this.updateFileUI();
        }
    }

    updateFileUI() {
        const fileGrid = document.getElementById('fileGrid');
        if (!fileGrid) return;

        fileGrid.innerHTML = '';
        
        if (this.files.length === 0) {
            fileGrid.innerHTML = `
                <div style="text-align: center; color: #666; padding: 40px;">
                    📁 No files found in shared workspace<br>
                    <small>Drop files here or check the shared-workspace directory</small>
                </div>`;
            return;
        }

        this.files.forEach(file => {
            const fileElement = this.createFileElement(file);
            fileGrid.appendChild(fileElement);
        });
    }

    createFileElement(file) {
        const div = document.createElement('div');
        div.className = 'file-item';
        
        const formattedSize = this.formatFileSize(file.size);
        const date = new Date(file.modified).toLocaleDateString();
        
        div.innerHTML = `
            <div class="file-icon">${file.icon || this.getFileIcon(file.name)}</div>
            <div class="file-name" title="${file.name}">${file.name}</div>
            <div class="file-size">${formattedSize} • ${date}</div>
            <div style="margin-top: 10px;">
                <button onclick="downloadFile('${file.name}')" style="background: #667eea; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 12px;">Download</button>
            </div>
        `;
        
        return div;
    }

    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            'pdf': '📕', 'doc': '📄', 'docx': '📄', 'txt': '📝',
            'xls': '📊', 'xlsx': '📊', 'csv': '📊',
            'ppt': '📽️', 'pptx': '📽️',
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'svg': '🖼️',
            'zip': '📦', 'json': '💻', 'js': '💻', 'html': '💻', 'css': '💻', 'py': '💻'
        };
        return icons[ext] || '📎';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    generateMockFiles() {
        // Return actual files from workspace scanning
        return this.files;
    }

    updateFileGrid() {
        this.updateFileUI();
    }
}

// Global functions for file operations
async function downloadFile(filename) {
    try {
        const response = await fetch(`./api/files/download/${encodeURIComponent(filename)}`);
        if (!response.ok) throw new Error('Download failed');
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error downloading file:', error);
        alert('Failed to download file: ' + error.message);
    }
}

// Initialize workspace manager
window.sharedWorkspace = new SharedWorkspaceManager();

// CSS for workspace styling
const workspaceCSS = `
.file-grid:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
}

.upload-section {
    border: 2px dashed #667eea;
    border-radius: 10px;
    padding: 40px;
    text-align: center;
    margin-bottom: 20px;
    cursor: pointer;
    transition: all 0.3s ease;
    background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
}

.upload-section:hover {
    border-color: #5a6fd8;
    background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
    transform: scale(1.01);
}

.workspace-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding: 15px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 10px;
}

.loading-spinner {
    border: 4px solid #f3f3f3;
    border-top: 4px solid #667eea;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: spin 2s linear infinite;
    margin: 20px auto;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
`;

// Insert CSS
const styleSheet = document.createElement('style');
styleSheet.textContent = workspaceCSS;
document.head.appendChild(styleSheet);