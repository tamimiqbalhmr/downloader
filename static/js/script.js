document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const urlInput = document.getElementById('urlInput');
    const fetchBtn = document.getElementById('fetchBtn');
    const videoInfoSection = document.getElementById('videoInfoSection');
    const videoThumbnail = document.getElementById('videoThumbnail');
    const videoTitle = document.getElementById('videoTitle');
    const videoDuration = document.getElementById('videoDuration');
    const uploaderBadge = document.getElementById('uploaderBadge');
    const viewsBadge = document.getElementById('viewsBadge');
    
    // Download Panel Elements
    const floatingDownloadBtn = document.getElementById('floatingDownloadBtn');
    const downloadPanel = document.getElementById('downloadPanel');
    const closePanelBtn = document.getElementById('closePanelBtn');
    const panelThumbnail = document.getElementById('panelThumbnail');
    const panelTitle = document.getElementById('panelTitle');
    const panelDuration = document.getElementById('panelDuration');
    const panelQuality = document.getElementById('panelQuality');
    const videoFormatsContainer = document.getElementById('videoFormatsContainer');
    const audioFormatsContainer = document.getElementById('audioFormatsContainer');
    const downloadProgress = document.getElementById('downloadProgress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const speedText = document.getElementById('speedText');
    const timeLeft = document.getElementById('timeLeft');
    const serverDownloadBtn = document.getElementById('serverDownloadBtn');
    
    // State
    let currentVideoInfo = null;
    let selectedFormat = null;
    let downloadInProgress = false;
    
    // Event Listeners
    fetchBtn.addEventListener('click', fetchVideoInfo);
    urlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') fetchVideoInfo();
    });
    
    closePanelBtn.addEventListener('click', hideDownloadPanel);
    serverDownloadBtn.addEventListener('click', startServerDownload);
    
    // Initialize floating button
    setTimeout(() => {
        floatingDownloadBtn.classList.add('show');
    }, 1000);
    
    // Show download panel when floating button is clicked
    floatingDownloadBtn.addEventListener('click', function() {
        if (!currentVideoInfo) {
            showAlert('No video detected. Play a YouTube video or paste a URL.', 'warning');
            return;
        }
        showDownloadPanel();
    });
    
    // Check for YouTube video playing
    setInterval(checkForYouTubeVideo, 3000);
    
    // Functions
    function fetchVideoInfo() {
        const url = urlInput.value.trim();
        if (!url) {
            showAlert('Please enter a YouTube URL or video ID', 'warning');
            return;
        }
        
        const videoId = extractVideoId(url) || url;
        const fullUrl = url.startsWith('http') ? url : `https://www.youtube.com/watch?v=${videoId}`;
        
        fetch('/get_info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: fullUrl
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            
            currentVideoInfo = data;
            updateVideoInfoUI(data);
            populateFormatOptions(data);
            showDownloadPanel();
        })
        .catch(error => {
            showAlert(error.message, 'danger');
        });
    }
    
    function updateVideoInfoUI(data) {
        videoThumbnail.src = data.thumbnail || 'https://via.placeholder.com/640x360';
        videoTitle.textContent = data.title || 'Untitled Video';
        videoDuration.textContent = formatDuration(data.duration);
        uploaderBadge.textContent = data.uploader || 'Unknown uploader';
        viewsBadge.textContent = data.view_count ? formatNumber(data.view_count) + ' views' : '';
        videoInfoSection.style.display = 'block';
    }
    
    function populateFormatOptions(data) {
        videoFormatsContainer.innerHTML = '';
        audioFormatsContainer.innerHTML = '';
        
        data.video_formats.forEach(format => {
            const formatCard = createFormatCard(format, 'video');
            videoFormatsContainer.appendChild(formatCard);
        });
        
        data.audio_formats.forEach(format => {
            const formatCard = createFormatCard(format, 'audio');
            audioFormatsContainer.appendChild(formatCard);
        });
    }
    
    function createFormatCard(format, type) {
        const card = document.createElement('div');
        card.className = 'col-12 format-card';
        card.addEventListener('click', () => selectFormat(card, format));
        
        if (type === 'video') {
            card.innerHTML = `
                <div class="format-name">${format.height}p${format.fps ? ` ${format.fps}fps` : ''}</div>
                <div class="format-details">
                    ${format.vcodec ? format.vcodec.split('.')[0] : ''} 
                    ${format.has_audio ? 'with audio' : ''} • 
                    ${format.filesize ? formatBytes(format.filesize) : 'Unknown size'}
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="format-name">${format.ext.toUpperCase()} • ${format.abr}kbps</div>
                <div class="format-details">
                    ${format.acodec ? format.acodec.split('.')[0] : ''} • 
                    ${format.filesize ? formatBytes(format.filesize) : 'Unknown size'}
                </div>
            `;
        }
        
        return card;
    }
    
    function selectFormat(card, format) {
        document.querySelectorAll('.format-card').forEach(c => {
            c.classList.remove('selected');
        });
        
        card.classList.add('selected');
        selectedFormat = format;
        
        panelThumbnail.src = currentVideoInfo.thumbnail;
        panelTitle.textContent = currentVideoInfo.title;
        panelDuration.textContent = formatDuration(currentVideoInfo.duration);
        
        if (format.height) {
            panelQuality.textContent = `${format.height}p${format.fps ? ` ${format.fps}fps` : ''}`;
        } else {
            panelQuality.textContent = `${format.ext.toUpperCase()} ${format.abr}kbps`;
        }
        
        document.getElementById('videoInfo').style.display = 'flex';
    }
    
    function showDownloadPanel() {
        if (!currentVideoInfo) return;
        
        panelThumbnail.src = currentVideoInfo.thumbnail;
        panelTitle.textContent = currentVideoInfo.title;
        downloadPanel.classList.add('show');
    }
    
    function hideDownloadPanel() {
        downloadPanel.classList.remove('show');
    }
    
    function startServerDownload() {
        if (!selectedFormat || !currentVideoInfo) {
            showAlert('Please select a format first', 'warning');
            return;
        }
        
        if (downloadInProgress) {
            showAlert('A download is already in progress', 'warning');
            return;
        }
        
        downloadInProgress = true;
        downloadProgress.style.display = 'block';
        
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        speedText.textContent = '0 KB/s';
        timeLeft.textContent = '--:--';
        
        fetch('/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: currentVideoInfo.url || urlInput.value.trim(),
                format_id: selectedFormat.format_id,
                title: currentVideoInfo.title
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            
            pollDownloadProgress(data.client_id);
        })
        .catch(error => {
            showAlert(error.message, 'danger');
            downloadInProgress = false;
            downloadProgress.style.display = 'none';
        });
    }
    
    function pollDownloadProgress(clientId) {
        fetch(`/progress/${clientId}`)
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    throw new Error(data.error);
                }
                
                progressBar.style.width = data.percent;
                progressText.textContent = data.percent;
                speedText.textContent = formatSpeed(data.speed);
                timeLeft.textContent = data.eta;
                
                if (data.status === 'completed') {
                    downloadInProgress = false;
                    showAlert('Download completed!', 'success');
                    fetchDownloadedFile(clientId);
                } else if (data.status === 'error' || data.status === 'stopped') {
                    downloadInProgress = false;
                    showAlert(`Download ${data.status}`, 'danger');
                } else {
                    setTimeout(() => pollDownloadProgress(clientId), 1000);
                }
            })
            .catch(error => {
                console.error('Progress check error:', error);
                downloadInProgress = false;
                showAlert('Error checking download progress', 'danger');
            });
    }
    
    function fetchDownloadedFile(clientId) {
    // Show loading state
    progressText.textContent = 'Preparing download...';
    
    fetch(`/get_file/${clientId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('File transfer failed');
            }
            return response.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            
            // Get filename from content disposition or use video title
            let filename = currentVideoInfo.title || 'youtube_video';
            if (selectedFormat.ext) {
                filename += `.${selectedFormat.ext}`;
            } else {
                filename += selectedFormat.height ? '.mp4' : '.mp3';
            }
            
            a.download = sanitizeFilename(filename);
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            downloadProgress.style.display = 'none';
        })
        .catch(error => {
            console.error('Download error:', error);
            showAlert('Download failed: ' + error.message, 'danger');
            downloadProgress.style.display = 'none';
        });
}

function sanitizeFilename(filename) {
    return filename.replace(/[\\/*?:"<>|]/g, "");
}
    
    function checkForYouTubeVideo() {
        if (window.location.hostname.includes('youtube.com') || 
            window.location.hostname.includes('youtu.be')) {
            
            const videoId = extractVideoId(window.location.href);
            if (!videoId) return;
            
            let title = '';
            const titleElement = document.querySelector('h1.title yt-formatted-string') || 
                              document.querySelector('.title.style-scope.ytd-video-primary-info-renderer');
            if (titleElement) {
                title = titleElement.textContent.trim();
            }
            
            if (videoId && (!currentVideoInfo || currentVideoInfo.id !== videoId)) {
                currentVideoInfo = {
                    id: videoId,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    title: title || 'YouTube Video',
                    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
                };
                
                floatingDownloadBtn.classList.add('show');
            }
        }
    }
    
    // Helper functions
    function extractVideoId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }
    
    function formatDuration(seconds) {
        if (!seconds) return 'N/A';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor(seconds % 3600 / 60);
        const s = Math.floor(seconds % 3600 % 60);
        return [h, m > 9 ? m : (h ? '0' + m : m || '0'), s > 9 ? s : '0' + s]
            .filter(Boolean)
            .join(':');
    }
    
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    function formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    
    function formatSpeed(speedStr) {
        if (!speedStr) return '0 KB/s';
        return speedStr.replace('KiB/s', 'KB/s').replace('MiB/s', 'MB/s');
    }
    
    function showAlert(message, type) {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
        alert.style.top = '20px';
        alert.style.right = '20px';
        alert.style.zIndex = '1100';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.body.appendChild(alert);
        
        setTimeout(() => {
            alert.classList.remove('show');
            setTimeout(() => alert.remove(), 150);
        }, 5000);
    }
});