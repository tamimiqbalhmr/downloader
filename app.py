from flask import Flask, request, send_file, render_template, jsonify
from flask_cors import CORS
import yt_dlp
import os
import threading
import re
import uuid
from urllib.parse import urlparse
import atexit
import glob
import time

app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

# Configuration
DOWNLOAD_FOLDER = 'downloads'
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

# Download management
download_controllers = {}
download_status = {}

class DownloadController:
    def __init__(self, client_id):
        self.client_id = client_id
        self.paused = False
        self.stopped = False
        self.ydl = None

    def pause(self):
        self.paused = True
        if self.ydl:
            self.ydl.params['noprogress'] = True

    def resume(self):
        self.paused = False
        if self.ydl:
            self.ydl.params['noprogress'] = False

    def stop(self):
        self.stopped = True
        if self.ydl:
            self.ydl.break_download()

def sanitize_filename(filename):
    return re.sub(r'[\\/*?:"<>|]', "", filename)

def format_bytes(bytes):
    if not bytes or bytes == 0: return '0 Bytes'
    units = ['Bytes', 'KB', 'MB', 'GB']
    i = 0
    while bytes >= 1024 and i < len(units)-1:
        bytes /= 1024
        i += 1
    return f"{bytes:.2f} {units[i]}"

def format_duration(seconds):
    if not seconds: return 'N/A'
    h = int(seconds / 3600)
    m = int(seconds % 3600 / 60)
    s = int(seconds % 3600 % 60)
    parts = []
    if h > 0:
        parts.append(str(h))
    parts.append(f"{m:02d}")
    parts.append(f"{s:02d}")
    return ":".join(parts)

def cleanup_old_files():
    """Remove files older than 1 hour"""
    now = time.time()
    for filepath in glob.glob(os.path.join(DOWNLOAD_FOLDER, '*')):
        if os.path.getmtime(filepath) < now - 3600:
            try:
                os.remove(filepath)
            except:
                pass

atexit.register(cleanup_old_files)

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/get_info', methods=['POST'])
def get_video_info():
    url = request.json.get('url')
    if not url:
        return jsonify({"error": "Please enter a valid video URL"}), 400

    ydl_opts = {'quiet': True}
    # Use Facebook cookies if Facebook URL and cookies file exists
    if 'facebook.com' in url:
        cookies_path = os.path.join(os.path.dirname(__file__), 'facebook_cookies.txt')
        if os.path.exists(cookies_path):
            ydl_opts['cookiefile'] = cookies_path

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Get best thumbnail
            thumbnail = info.get('thumbnail', '')
            if 'thumbnails' in info:
                thumbnails = sorted(info['thumbnails'], key=lambda x: x.get('width', 0), reverse=True)
                if thumbnails:
                    thumbnail = thumbnails[0]['url']

            # Organize formats
            video_formats = []
            audio_formats = []
            
            for f in info.get('formats', []):
                vcodec = f.get('vcodec', 'none')
                acodec = f.get('acodec', 'none')
                # Video formats: must have format_id and height
                if vcodec != 'none' and f.get('format_id') and f.get('height'):
                    has_audio = acodec != 'none'
                    format_info = {
                        'format_id': f.get('format_id', ''),
                        'ext': f.get('ext', 'mp4'),
                        'filesize': f.get('filesize'),
                        'height': f.get('height'),
                        'fps': f.get('fps'),
                        'vcodec': vcodec,
                        'acodec': acodec,
                        'tbr': f.get('tbr', 0),
                        'has_audio': has_audio
                    }
                    label_parts = []
                    if format_info['height']:
                        label_parts.append(f"{format_info['height']}p")
                    if format_info['fps']:
                        label_parts.append(f"{format_info['fps']}fps")
                    if vcodec:
                        label_parts.append(vcodec.split('.')[0])
                    if has_audio:
                        label_parts.append("with audio")
                    if format_info['filesize']:
                        label_parts.append(format_bytes(format_info['filesize']))
                    else:
                        label_parts.append("Unknown size")
                    format_info['label'] = ' '.join(label_parts)
                    video_formats.append(format_info)
                # Audio formats: must have format_id and abr
                elif acodec != 'none' and f.get('format_id') and f.get('abr'):
                    format_info = {
                        'format_id': f.get('format_id', ''),
                        'ext': f.get('ext', 'mp3'),
                        'filesize': f.get('filesize'),
                        'abr': f.get('abr'),
                        'acodec': acodec
                    }
                    label_parts = []
                    if acodec:
                        label_parts.append(acodec.split('.')[0])
                    if format_info['abr']:
                        label_parts.append(f"{format_info['abr']}kbps")
                    if format_info['filesize']:
                        label_parts.append(format_bytes(format_info['filesize']))
                    else:
                        label_parts.append("Unknown size")
                    format_info['label'] = ' '.join(label_parts)
                    audio_formats.append(format_info)

            # Sort video formats by resolution and fps
            video_formats.sort(key=lambda x: (
                -x['height'] if x['height'] is not None else 0,
                -x['fps'] if x['fps'] is not None else 0
            ))
            
            # Sort audio formats by bitrate
            audio_formats.sort(key=lambda x: -x['abr'] if x['abr'] is not None else 0)

            return jsonify({
                "title": info.get('title', 'Untitled Video'),
                "thumbnail": thumbnail,
                "duration": info.get('duration'),
                "uploader": info.get('uploader', 'Unknown uploader'),
                "view_count": info.get('view_count'),
                "video_formats": video_formats,
                "audio_formats": audio_formats
            })
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

class YoutubeDLProgressHook:
    def __init__(self, client_id):
        self.client_id = client_id
        download_status[client_id] = {
            'status': 'starting',
            'percent': '0%',
            'speed': '0 KiB/s',
            'eta': '--:--',
            'downloaded_bytes': 0,
            'total_bytes': 0
        }

    def __call__(self, d):
        if d['status'] == 'downloading':
            controller = download_controllers.get(self.client_id)
            if controller and controller.paused:
                download_status[self.client_id]['status'] = 'paused'
                return
            if controller and controller.stopped:
                download_status[self.client_id]['status'] = 'stopped'
                return
                
            download_status[self.client_id].update({
                'status': 'downloading',
                'percent': d.get('_percent_str', '0%').strip(),
                'speed': d.get('_speed_str', '0 KiB/s').strip(),
                'eta': d.get('_eta_str', '--:--').strip(),
                'downloaded_bytes': d.get('downloaded_bytes', 0),
                'total_bytes': d.get('total_bytes', 0)
            })
        elif d['status'] == 'finished':
            download_status[self.client_id]['status'] = 'completed'
        elif d['status'] == 'error':
            download_status[self.client_id]['status'] = 'error'

@app.route('/download', methods=['POST'])
def download_video():
    url = request.json.get('url')
    format_id = request.json.get('format_id')
    title = request.json.get('title', 'youtube_video')
    
    if not url or not format_id:
        return jsonify({"error": "Missing URL or format_id"}), 400

    # Validate format_id against available formats for this video
    ydl_opts = {'quiet': True}
    if 'facebook.com' in url:
        cookies_path = os.path.join(os.path.dirname(__file__), 'facebook_cookies.txt')
        if os.path.exists(cookies_path):
            ydl_opts['cookiefile'] = cookies_path
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            available_format_ids = set()
            for f in info.get('formats', []):
                if f.get('format_id'):
                    available_format_ids.add(str(f['format_id']))
            if format_id not in available_format_ids:
                return jsonify({"error": "Requested format is not available for this video. Please select another format."}), 400
    except Exception as e:
        return jsonify({"error": f"Could not validate format: {str(e)}"}), 500

    client_id = str(uuid.uuid4())
    controller = DownloadController(client_id)
    download_controllers[client_id] = controller

    def download_thread():
        try:
            sanitized_title = sanitize_filename(title)
            output_template = f"{sanitized_title}.%(ext)s"
            output_path = os.path.join(DOWNLOAD_FOLDER, output_template)
            is_audio_only = format_id.startswith('ba') or format_id.startswith('140') or format_id.startswith('251')
            ydl_opts_dl = {
                'format': format_id,
                'outtmpl': output_path,
                'progress_hooks': [YoutubeDLProgressHook(client_id)],
                'quiet': True,
                'noplaylist': True,
                'no_warnings': True,
                'ignoreerrors': False,
                'retries': 3,
                'fragment_retries': 3,
                'keepvideo': False
            }
            if 'facebook.com' in url:
                cookies_path = os.path.join(os.path.dirname(__file__), 'facebook_cookies.txt')
                if os.path.exists(cookies_path):
                    ydl_opts_dl['cookiefile'] = cookies_path
            if is_audio_only:
                ydl_opts_dl.update({
                    'format': 'bestaudio/best',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '192',
                    }],
                    'extractaudio': True
                })
            else:
                ydl_opts_dl.update({
                    'format': f'{format_id}+bestaudio',
                    'merge_output_format': 'mp4',
                    'postprocessors': [{
                        'key': 'FFmpegVideoConvertor',
                        'preferedformat': 'mp4',
                    }]
                })
            with yt_dlp.YoutubeDL(ydl_opts_dl) as ydl:
                controller.ydl = ydl
                if not controller.stopped:
                    info = ydl.extract_info(url, download=True)
                    final_filename = ydl.prepare_filename(info)
                    # Use the actual file path returned by yt-dlp
                    download_status[client_id].update({
                        'status': 'completed',
                        'filename': os.path.basename(final_filename),
                        'final_path': final_filename
                    })
        except Exception as e:
            download_status[client_id].update({
                'status': 'error',
                'error': str(e)
            })
    threading.Thread(target=download_thread).start()
    return jsonify({
        "client_id": client_id,
        "message": "Download started"
    })

@app.route('/progress/<client_id>', methods=['GET'])
def check_progress(client_id):
    if client_id not in download_status:
        return jsonify({"error": "Download not found"}), 404
    
    return jsonify(download_status[client_id])

@app.route('/control/<client_id>', methods=['POST'])
def control_download(client_id):
    if client_id not in download_controllers:
        return jsonify({"error": "Download not found"}), 404
    
    action = request.json.get('action')
    controller = download_controllers[client_id]
    
    if action == 'pause':
        controller.pause()
        download_status[client_id]['status'] = 'paused'
        return jsonify({"message": "Download paused"})
    
    elif action == 'resume':
        controller.resume()
        download_status[client_id]['status'] = 'downloading'
        return jsonify({"message": "Download resumed"})
    
    elif action == 'stop':
        controller.stop()
        download_status[client_id]['status'] = 'stopped'
        return jsonify({"message": "Download stopped"})
    
    return jsonify({"error": "Invalid action"}), 400

@app.route('/get_file/<client_id>', methods=['GET'])
def get_file(client_id):
    if client_id not in download_status:
        return jsonify({"error": "Download not found"}), 404
    
    status = download_status[client_id]
    
    if status['status'] != 'completed':
        return jsonify({"error": "Download not completed"}), 400
    
    if 'final_path' not in status or not os.path.exists(status['final_path']):
        return jsonify({"error": "File not found"}), 404
    
    try:
        return send_file(
            status['final_path'],
            as_attachment=True,
            download_name=os.path.basename(status['final_path'])
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)