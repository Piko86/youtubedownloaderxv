import yt_dlp
import re
import json

class YouTubeScraper:
    def __init__(self):
        self.ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
            'force_generic_extractor': False,
        }
    
    def get_video_info(self, url):
        """Get video information using yt-dlp"""
        try:
            with yt_dlp.YoutubeDL(self.ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                
                videos = []
                audios = []
                
                # Get available formats
                if 'formats' in info:
                    for fmt in info['formats']:
                        if fmt.get('acodec') != 'none' and fmt.get('vcodec') != 'none':
                            # Video format
                            videos.append({
                                'quality': self._get_quality_label(fmt),
                                'format': fmt.get('ext', 'mp4'),
                                'size': fmt.get('filesize', 0),
                                'url': fmt.get('url', ''),
                                'has_direct_link': True if fmt.get('url') else False
                            })
                        elif fmt.get('acodec') != 'none' and fmt.get('vcodec') == 'none':
                            # Audio format
                            audios.append({
                                'quality': f"{fmt.get('abr', 0)}kbps" if fmt.get('abr') else 'audio',
                                'format': fmt.get('ext', 'mp3'),
                                'size': fmt.get('filesize', 0),
                                'url': fmt.get('url', ''),
                                'has_direct_link': True if fmt.get('url') else False
                            })
                
                return {
                    'status': 'success',
                    'title': info.get('title', ''),
                    'thumbnail': info.get('thumbnail', ''),
                    'duration': info.get('duration', 0),
                    'videos': videos,
                    'audios': audios,
                    'video_id': info.get('id', '')
                }
                
        except Exception as e:
            raise Exception(f"Error fetching video info: {str(e)}")
    
    def get_download_url(self, url, quality, format_type='mp4'):
        """Get direct download URL for specific quality and format"""
        try:
            with yt_dlp.YoutubeDL(self.ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                
                if 'formats' in info:
                    for fmt in info['formats']:
                        current_quality = self._get_quality_label(fmt)
                        
                        if (format_type.lower() == 'mp4' and 
                            fmt.get('ext') == 'mp4' and 
                            fmt.get('acodec') != 'none' and 
                            fmt.get('vcodec') != 'none' and
                            current_quality == quality):
                            return fmt.get('url')
                        
                        elif (format_type.lower() in ['mp3', 'm4a'] and 
                              fmt.get('acodec') != 'none' and 
                              fmt.get('vcodec') == 'none'):
                            if format_type.lower() == fmt.get('ext'):
                                if quality in current_quality:
                                    return fmt.get('url')
                
                return None
                
        except Exception as e:
            raise Exception(f"Error getting download URL: {str(e)}")
    
    def _get_quality_label(self, fmt):
        """Extract quality label from format"""
        if fmt.get('height'):
            return f"{fmt['height']}p"
        elif fmt.get('quality'):
            return str(fmt['quality'])
        elif fmt.get('format_note'):
            return fmt['format_note']
        else:
            return 'unknown'
