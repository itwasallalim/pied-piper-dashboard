window.addEventListener('load', async () => {
  // Inject workspace into dashboard
  const targetSection = document.getElementById('feed-container')?.parentElement?.previousElementSibling;
  if (targetSection) {
    const workspaceHTML = `
      <section class="workspace mt-8 bg-pp-card border border-pp-border rounded-xl p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-pp-green">📁 Shared Workspace</h2>
          <div class="flex gap-2">
            <input type="file" id="file-input" class="hidden" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.json,.png,.jpg,.jpeg,.gif,.svg,.zip"/>
            <button id="upload-btn" class="px-4 py-2 bg-pp-green text-white rounded-lg hover:bg-opacity-90 transition">
              📤 Upload Files
            </button>
          </div>
        </div>
        <div id="files-container" class="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
          <p class="text-gray-400 italic">Loading files...</p>
        </div>
      </section>
    `;
    
    targetSection.insertAdjacentHTML('afterend', workspaceHTML);
  }

  // Load files if workspace is added
  if (document.getElementById('files-container')) {
    loadFiles();
  }

  // Add file upload functionality
  document.getElementById('upload-btn')?.addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.getElementById('file-input')?.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length) return;

    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        loadFiles();
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }
  });
});