from flask import Flask, request, jsonify, render_template, redirect, send_file
from flask_cors import CORS
import requests
import json
import base64
import re
import os
from urllib.parse import urlparse, parse_qs, quote
import time
from utils.scraper import YouTubeScraper
import tempfile
import io

app = Flask(__name__)
CORS(app)

# Initialize scraper
scraper = YouTubeScraper()

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/info')
def get_video_info():
    """Get video information and available formats"""
    youtube_url = request.args.get('url')
    
    if not youtube_url:
        return jsonify({
            'status': 'error',
            'message': 'URL parameter is required'
        }), 400
    
    try:
        # Extract video ID
        video_id = extract_video_id(youtube_url)
        
        if not video_id:
            return jsonify({
                'status': 'error',
                'message': 'Invalid YouTube URL'
            }), 400
        
        # Use vidssave.com API to get download links
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Origin': 'https://vidssave.com',
            'Referer': 'https://vidssave.com/yt'
        }
        
        cookies = {
            'uid': '0417972-8ddd4f4-9ce78912-175a2ae7%3D1764696672487',
            '_ga_B0QF996KX2': 'GS2.1.s1764696677$o1$g0$t1764696677$j60$l0$h0',
            '_ga': 'GA1.1.2104826205.1764696678',
            '_clck': '19aebme%5E2%5Eg1i%5E0%5E2162',
            '_clsk': 'uolpw8%5E1764696697960%5E1%5E1%5Ek.clarity.ms%2Fcollect'
        }
        
        payload = {
            "url": "/media/parse",
            "data": {
                "origin": "source",
                "link": youtube_url
            },
            "token": ""
        }
        
        response = requests.post(
            'https://vidssave.com/api/proxy',
            headers=headers,
            cookies=cookies,
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get('status') == 1 and 'data' in data:
                video_data = data['data']
                
                # Process resources
                videos = []
                audios = []
                
                for resource in video_data.get('resources', []):
                    if resource['type'] == 'video':
                        videos.append({
                            'quality': resource['quality'],
                            'format': resource['format'],
                            'size': resource['size'],
                            'download_url': resource.get('download_url', ''),
                            'resource_id': resource['resource_id'],
                            'has_direct_link': resource.get('download_mode') == 'check_download'
                        })
                    elif resource['type'] == 'audio':
                        audios.append({
                            'quality': resource['quality'],
                            'format': resource['format'],
                            'size': resource['size'],
                            'download_url': resource.get('download_url', ''),
                            'resource_id': resource['resource_id'],
                            'has_direct_link': resource.get('download_mode') == 'check_download'
                        })
                
                return jsonify({
                    'status': 'success',
                    'title': video_data.get('title'),
                    'thumbnail': video_data.get('thumbnail'),
                    'duration': video_data.get('duration'),
                    'videos': videos,
                    'audios': audios,
                    'video_id': video_id
                })
        
        # Alternative method using yt-dlp
        return get_video_info_alternative(youtube_url)
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

def get_video_info_alternative(youtube_url):
    """Alternative method using direct scraping"""
    try:
        video_info = scraper.get_video_info(youtube_url)
        return jsonify(video_info)
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Failed to fetch video info: {str(e)}'
        }), 500

@app.route('/api/download')
def download_video():
    """Download video/audio by quality and format"""
    youtube_url = request.args.get('url')
    quality = request.args.get('quality')
    format_type = request.args.get('format', 'mp4')
    
    if not youtube_url or not quality:
        return jsonify({
            'status': 'error',
            'message': 'URL and quality parameters are required'
        }), 400
    
    try:
        # Get video info first
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Origin': 'https://vidssave.com',
            'Referer': 'https://vidssave.com/yt'
        }
        
        cookies = {
            'uid': '0417972-8ddd4f4-9ce78912-175a2ae7%3D1764696672487',
            '_ga_B0QF996KX2': 'GS2.1.s1764696677$o1$g0$t1764696677$j60$l0$h0',
            '_ga': 'GA1.1.2104826205.1764696678',
            '_clck': '19aebme%5E2%5Eg1i%5E0%5E2162',
            '_clsk': 'uolpw8%5E1764696697960%5E1%5E1%5Ek.clarity.ms%2Fcollect'
        }
        
        payload = {
            "url": "/media/parse",
            "data": {
                "origin": "source",
                "link": youtube_url
            },
            "token": ""
        }
        
        response = requests.post(
            'https://vidssave.com/api/proxy',
            headers=headers,
            cookies=cookies,
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get('status') == 1 and 'data' in data:
                video_data = data['data']
                
                # Find the requested resource
                for resource in video_data.get('resources', []):
                    if (resource['type'] == 'video' and resource['quality'] == quality and 
                        resource['format'].lower() == format_type.lower()):
                        
                        if resource.get('download_mode') == 'check_download' and resource.get('download_url'):
                            # Redirect to direct download URL
                            return redirect(resource['download_url'])
                        
                        elif resource.get('resource_content'):
                            # Try to decode resource_content
                            try:
                                # The resource_content might be encoded
                                decoded_content = base64.b64decode(resource['resource_content'])
                                # Save to temporary file and serve
                                temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=f'.{format_type}')
                                temp_file.write(decoded_content)
                                temp_file.close()
                                
                                return send_file(
                                    temp_file.name,
                                    as_attachment=True,
                                    download_name=f"{video_data.get('title', 'video')}_{quality}.{format_type}"
                                )
                            except:
                                pass
        
        # If no direct link found, use alternative method
        return download_video_alternative(youtube_url, quality, format_type)
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

def download_video_alternative(youtube_url, quality, format_type):
    """Alternative download method using yt-dlp"""
    try:
        download_url = scraper.get_download_url(youtube_url, quality, format_type)
        
        if download_url:
            # Stream the file
            response = requests.get(download_url, stream=True)
            
            if response.status_code == 200:
                # Create a file-like object
                file_stream = io.BytesIO()
                
                for chunk in response.iter_content(chunk_size=8192):
                    file_stream.write(chunk)
                
                file_stream.seek(0)
                
                # Get video title for filename
                video_info = scraper.get_video_info(youtube_url)
                filename = f"{video_info.get('title', 'video')}_{quality}.{format_type}"
                filename = re.sub(r'[^\w\s-]', '', filename).strip()
                filename = re.sub(r'[-\s]+', '-', filename)
                
                return send_file(
                    file_stream,
                    as_attachment=True,
                    download_name=filename,
                    mimetype='video/mp4' if format_type == 'mp4' else 'audio/mpeg'
                )
        
        return jsonify({
            'status': 'error',
            'message': 'Could not download video'
        }), 400
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/stream')
def stream_video():
    """Stream video for direct playback"""
    youtube_url = request.args.get('url')
    quality = request.args.get('quality', '360p')
    
    if not youtube_url:
        return jsonify({'error': 'URL required'}), 400
    
    try:
        download_url = scraper.get_download_url(youtube_url, quality, 'mp4')
        
        if download_url:
            # Proxy the stream
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Range': request.headers.get('Range', ''),
                'Referer': 'https://www.youtube.com/'
            }
            
            response = requests.get(download_url, headers=headers, stream=True)
            
            # Forward headers
            headers = {}
            if 'Content-Type' in response.headers:
                headers['Content-Type'] = response.headers['Content-Type']
            if 'Content-Length' in response.headers:
                headers['Content-Length'] = response.headers['Content-Length']
            if 'Content-Range' in response.headers:
                headers['Content-Range'] = response.headers['Content-Range']
            if 'Accept-Ranges' in response.headers:
                headers['Accept-Ranges'] = response.headers['Accept-Ranges']
            
            return response.content, response.status_code, headers
        
        return jsonify({'error': 'Stream not available'}), 404
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def extract_video_id(url):
    """Extract YouTube video ID from URL"""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/e\/|youtube\.com\/watch\?.*v=)([^&\?\/]+)',
        r'youtube\.com\/shorts\/([^&\?\/]+)',
        r'youtube\.com\/live\/([^&\?\/]+)'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    
    return None

@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
