window.addEventListener('load', () => {
    // Enhanced file management for dashboard
    const workspaceContainer = document.getElementById('files-container');
    
    // Add stats and categorization
    async function loadEnhancedFiles() {
        try {
            const response = await fetch('/api/files');
            const files = await response.json();
            workspaceContainer.innerHTML = '';

            if (files.length === 0) {
                workspaceContainer.innerHTML = '<p class="text-gray-400 italic">No files yet. Upload your work product here.</p>';
                return;
            }

            // Create file stats
            const stats = calculateStats(files);
            const statsHtml = createStatsBar(stats);
            
            // Create categorized display
            const categorized = categorizeFiles(files);
            const categorizedHtml = createCategorizedDisplay(categorized, stats);
            
            workspaceContainer.innerHTML = statsHtml + categorizedHtml;
        } catch (err) {
            console.error('Enhanced file loading failed:', err);
        }
    }

    function calculateStats(files) {
        const stats = {
            total: files.length,
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
            categories: {}
        };
        
        files.forEach(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            const category = getFileCategory(ext);
            if (!stats.categories[category]) stats.categories[category] = 0;
            stats.categories[category]++;
        });
        
        return stats;
    }

    function getFileCategory(ext) {
        const categories = {
            documents: ['pdf', 'doc', 'docx', 'txt', 'md'],
            presentations: ['ppt', 'pptx', 'key'],
            spreadsheets: ['xls', 'xlsx', 'csv'],
            code: ['js', 'py', 'java', 'cpp', 'html', 'css', 'ts', 'json'],
            designs: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'sketch']
        };
        
        for (const [category, extensions] of Object.entries(categories)) {
            if (extensions.includes(ext)) return category;
        }
        return 'other';
    }

    function createStatsBar(stats) {
        return `
            <div class="flex gap-4 mb-4 text-sm">
                <span class="text-pp-green">📊 ${stats.total} files</span>
                <span class="text-pp-green">💾 ${formatBytes(stats.totalSize)}</span>
                ${Object.entries(stats.categories).map(([cat, count]) => 
                    cat === 'other' ? '' : `<span class="text-gray-300">${getCategoryEmoji(cat)} ${count}</span>`
                ).join('')}
            </div>
        `;
    }

    function createCategorizedDisplay(categorized, stats) {
        let html = '';
        ['documents', 'presentations', 'spreadsheets', 'code', 'designs', 'other'].forEach(category => {
            if (categorized[category] && categorized[category].length > 0) {
                const emoji = getCategoryEmoji(category) + ' ' + category.charAt(0).toUpperCase() + category.slice(1);
                html += `<div class="mb-4"><h3 class="text-pp-green font-semibold mb-2">${emoji} (${categorized[category].length})</h3>`;
                html += categorized[category].map(file => createFileRow(file)).join('');
                html += `</div>`;
            }
        });
        
        if (categorized.workspace && categorized.workspace.length > 0) {
            html += `<div class="mb-4"><h3 class="text-pp-green font-semibold mb-2">📁 Shared Workspace</h3>`;
            html += categorized.workspace.map(file => createFileRow(file)).join('');
            html += `</div>`;
        }

        return html;
    }

    function createFileRow(file) {
        return `
            <div class="file-item">
                <div class="flex items-center">
                    <span class="file-icon">${file.type}</span>
                    <span class="file-name" title="${file.name}">${file.name}</span>
                    <span class="text-gray-400 text-sm ml-auto">${formatBytes(file.size)}</span>
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
        `;
    }

    function getCategoryEmoji(category) {
        const emojis = {
            documents: '📄', presentations: '📊', spreadsheets: '📈',
            code: '💻', designs: '🎨', other: '📎'
        };
        return emojis[category] || '📁';
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function categorizeFiles(files) {
        const categorized = {};
        
        files.forEach(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            const category = getFileCategory(ext);
            
            if (file.name.includes('workspace') || file.path && file.path.includes('workspace')) {
                if (!categorized.workspace) categorized.workspace = [];
                categorized.workspace.push(file);
            } else {
                if (!categorized[category]) categorized[category] = [];
                categorized[category].push(file);
            }
        });
        
        return categorized;
    }

    // Auto-refresh every 10 seconds
    loadEnhancedFiles();
    setInterval(loadEnhancedFiles, 10000);
});

// Place this in workspace.js or inline
(function() {
    const originalLoadFiles = window.loadFiles;
    if (originalLoadFiles) {
        window.loadFiles = loadEnhancedFiles;
    }
})();