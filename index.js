const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Main endpoint - Audio Only
app.get('/', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        
        if (!youtubeUrl) {
            return res.status(400).json({
                status: 0,
                message: 'Please provide YouTube URL in query parameter',
                example: 'http://localhost:3000/?url=https://youtu.be/VIDEO_ID'
            });
        }

        // Validate YouTube URL
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
        if (!youtubeRegex.test(youtubeUrl)) {
            return res.status(400).json({
                status: 0,
                message: 'Invalid YouTube URL'
            });
        }

        // Headers from vidssave
        const headers = {
            'authority': 'vidssave.com',
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.5',
            'content-type': 'application/json',
            'origin': 'https://vidssave.com',
            'referer': 'https://vidssave.com/yt',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
            'cookie': `uid=0417972-8ddd4f4-9ce78912-175a2ae7%3D1764696672487; _ga_B0QF996KX2=GS2.1.s1764696677$o1$g0$t1764696677$j60$l0$h0; _ga=GA1.1.2104826205.1764696678; _clck=19aebme%5E2%5Eg1i%5E0%5E2162; _clsk=uolpw8%5E1764696697960%5E1%5E1%5Ek.clarity.ms%2Fcollect`
        };

        // Request body
        const requestBody = {
            url: "/media/parse",
            data: {
                origin: "source",
                link: youtubeUrl
            },
            token: ""
        };

        // Make POST request to vidssave API
        const response = await axios.post('https://vidssave.com/api/proxy', requestBody, {
            headers: headers,
            timeout: 30000 // 30 seconds timeout
        });

        const responseData = response.data;

        if (responseData.status !== 1 || !responseData.data) {
            return res.status(500).json({
                status: 0,
                message: 'Failed to fetch video data from source'
            });
        }

        const videoData = responseData.data;
        
        // Format the response - Only Audio
        const result = {
            status: 1,
            title: videoData.title,
            thumbnail: videoData.thumbnail,
            duration: videoData.duration,
            audio_formats: []
        };

        // Process resources - Only audio formats
        if (videoData.resources && Array.isArray(videoData.resources)) {
            videoData.resources.forEach(resource => {
                // Only include AUDIO formats with download_url
                if (resource.type === 'audio' && (resource.download_url || resource.download_mode === 'check_download')) {
                    const formatInfo = {
                        quality: resource.quality,
                        format: resource.format || 'mp3',
                        size: resource.size,
                        bitrate: extractBitrate(resource.quality),
                        download_url: resource.download_url || '',
                        type: 'audio'
                    };

                    // Remove download_mode from response if it's empty
                    if (resource.download_mode && resource.download_mode !== '') {
                        formatInfo.download_mode = resource.download_mode;
                    }

                    result.audio_formats.push(formatInfo);
                }
            });
        }

        // Sort audio formats by bitrate (highest first)
        result.audio_formats.sort((a, b) => {
            return (b.bitrate || 0) - (a.bitrate || 0);
        });

        // If no audio formats found, return error
        if (result.audio_formats.length === 0) {
            return res.status(404).json({
                status: 0,
                message: 'No downloadable audio formats found. The video might be restricted or unavailable.',
                suggestion: 'Try a different YouTube video'
            });
        }

        res.json(result);

    } catch (error) {
        console.error('Error:', error.message);
        
        res.status(500).json({
            status: 0,
            message: 'Failed to fetch audio information',
            error: error.response?.data?.message || error.message
        });
    }
});

// Helper function to extract bitrate from quality string
function extractBitrate(quality) {
    if (!quality) return 0;
    
    // Extract numbers from strings like "128kbps", "320k", "48kbps"
    const match = quality.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

// Alternative endpoint for direct audio download
app.get('/api/audio', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        const format = req.query.format || 'highest'; // highest, lowest, or specific bitrate
        
        if (!youtubeUrl) {
            return res.status(400).json({
                status: 0,
                message: 'Please provide YouTube URL'
            });
        }

        // Get audio info
        const response = await axios.get(`http://localhost:${PORT}/?url=${encodeURIComponent(youtubeUrl)}`, {
            timeout: 10000
        });
        
        const audioData = response.data;
        
        if (audioData.status !== 1 || audioData.audio_formats.length === 0) {
            return res.status(404).json({
                status: 0,
                message: 'No audio formats available'
            });
        }

        // Select format based on preference
        let selectedAudio;
        if (format === 'highest') {
            selectedAudio = audioData.audio_formats[0]; // Already sorted highest first
        } else if (format === 'lowest') {
            selectedAudio = audioData.audio_formats[audioData.audio_formats.length - 1];
        } else {
            // Try to match specific bitrate
            const targetBitrate = parseInt(format);
            selectedAudio = audioData.audio_formats.find(audio => 
                audio.bitrate === targetBitrate || 
                audio.quality.includes(format)
            ) || audioData.audio_formats[0];
        }

        res.json({
            status: 1,
            title: audioData.title,
            duration: audioData.duration,
            selected_format: selectedAudio,
            all_formats: audioData.audio_formats
        });
        
    } catch (error) {
        res.status(500).json({
            status: 0,
            message: 'Failed to process audio request'
        });
    }
});

// Direct download endpoint (stream audio to client)
app.get('/download/audio', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        const bitrate = req.query.bitrate || 'highest';
        
        if (!youtubeUrl) {
            return res.status(400).json({
                status: 0,
                message: 'Please provide YouTube URL'
            });
        }

        // Get audio info first
        const infoResponse = await axios.get(`http://localhost:${PORT}/?url=${encodeURIComponent(youtubeUrl)}`);
        
        if (infoResponse.data.status !== 1) {
            return res.status(404).json({
                status: 0,
                message: 'Audio not found'
            });
        }

        const audioFormats = infoResponse.data.audio_formats;
        if (audioFormats.length === 0) {
            return res.status(404).json({
                status: 0,
                message: 'No audio available for download'
            });
        }

        // Select audio format
        let selectedAudio;
        if (bitrate === 'highest') {
            selectedAudio = audioFormats[0];
        } else if (bitrate === 'lowest') {
            selectedAudio = audioFormats[audioFormats.length - 1];
        } else {
            const targetBitrate = parseInt(bitrate);
            selectedAudio = audioFormats.find(audio => audio.bitrate === targetBitrate) || audioFormats[0];
        }

        // Check if we have a direct download URL
        if (!selectedAudio.download_url) {
            return res.json({
                status: 1,
                message: 'Use this URL to download audio',
                download_url: selectedAudio.download_url,
                audio_info: selectedAudio
            });
        }

        // If download_url exists, redirect to it
        res.redirect(selectedAudio.download_url);
        
    } catch (error) {
        console.error('Download error:', error.message);
        res.status(500).json({
            status: 0,
            message: 'Download failed',
            error: error.message
        });
    }
});

// Simple MP3 download endpoint
app.get('/mp3', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        
        if (!youtubeUrl) {
            return res.status(400).json({
                status: 0,
                message: 'Please provide YouTube URL',
                example: 'http://localhost:3000/mp3?url=https://youtu.be/VIDEO_ID'
            });
        }

        // Get audio info
        const response = await axios.get(`http://localhost:${PORT}/?url=${encodeURIComponent(youtubeUrl)}`);
        
        if (response.data.status !== 1) {
            return res.status(404).json({
                status: 0,
                message: 'Could not fetch audio'
            });
        }

        // Find the best MP3 format (highest bitrate)
        const mp3Formats = response.data.audio_formats.filter(audio => 
            audio.format === 'mp3' || audio.format.includes('audio')
        );

        if (mp3Formats.length === 0) {
            return res.status(404).json({
                status: 0,
                message: 'No MP3 format available'
            });
        }

        const bestMp3 = mp3Formats[0]; // Already sorted by bitrate

        res.json({
            status: 1,
            title: response.data.title,
            duration: response.data.duration,
            download_url: bestMp3.download_url,
            quality: bestMp3.quality,
            size: bestMp3.size,
            format: 'mp3'
        });

    } catch (error) {
        res.status(500).json({
            status: 0,
            message: 'Failed to get MP3'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'YouTube Audio Downloader API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            main: '/?url=YOUTUBE_URL',
            audio: '/api/audio?url=YOUTUBE_URL',
            download: '/download/audio?url=YOUTUBE_URL',
            mp3: '/mp3?url=YOUTUBE_URL',
            health: '/health'
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎵 YouTube Audio Downloader API`);
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`\n📋 Available Endpoints:`);
    console.log(`├─ 🎧 Main: http://localhost:${PORT}/?url=YOUTUBE_URL`);
    console.log(`├─ 🔊 Audio Info: http://localhost:${PORT}/api/audio?url=YOUTUBE_URL`);
    console.log(`├─ ⬇️ Download: http://localhost:${PORT}/download/audio?url=YOUTUBE_URL`);
    console.log(`├─ 🎵 MP3: http://localhost:${PORT}/mp3?url=YOUTUBE_URL`);
    console.log(`└─ 💚 Health: http://localhost:${PORT}/health`);
    console.log(`\n💡 Examples:`);
    console.log(`- http://localhost:${PORT}/?url=https://youtu.be/dQw4w9WgXcQ`);
    console.log(`- http://localhost:${PORT}/mp3?url=https://youtu.be/dQw4w9WgXcQ`);
});
