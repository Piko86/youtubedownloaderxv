const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Main audio-only endpoint
app.get('/api/', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        
        if (!youtubeUrl) {
            return res.status(400).json({
                status: 0,
                message: 'Please provide YouTube URL in query parameter',
                example: `http://yourhostname/api/?url=https://youtu.be/VIDEO_ID`
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
                message: 'Failed to fetch audio data from source'
            });
        }

        const videoData = responseData.data;
        
        // Format the response - only audio formats
        const result = {
            status: 1,
            title: videoData.title,
            thumbnail: videoData.thumbnail,
            duration: videoData.duration,
            audio_formats: []
        };

        // Process resources - filter only audio with download_url
        if (videoData.resources && Array.isArray(videoData.resources)) {
            videoData.resources.forEach(resource => {
                // Only include audio type with download_url
                if (resource.type === 'audio' && (resource.download_url || resource.download_mode === 'check_download')) {
                    const formatInfo = {
                        quality: resource.quality,
                        format: resource.format,
                        size: resource.size,
                        type: resource.type,
                        download_url: resource.download_url || ''
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
            // Extract bitrate number for comparison
            const getBitrate = (quality) => parseInt(quality) || 0;
            return getBitrate(b.quality) - getBitrate(a.quality);
        });

        // If no audio formats found, return error
        if (result.audio_formats.length === 0) {
            return res.status(404).json({
                status: 0,
                message: 'No downloadable audio formats found. The video might be restricted or unavailable.'
            });
        }

        // Return only the best audio format by default, or all if requested
        const returnAll = req.query.all === 'true';
        
        if (!returnAll && result.audio_formats.length > 0) {
            // Return only the best quality audio (first after sorting)
            res.json({
                status: 1,
                title: result.title,
                duration: result.duration,
                best_audio: result.audio_formats[0],
                available_formats: result.audio_formats.length
            });
        } else {
            // Return all audio formats
            res.json(result);
        }

    } catch (error) {
        console.error('Error:', error.message);
        
        res.status(500).json({
            status: 0,
            message: 'Failed to fetch audio information',
            error: error.response?.data?.message || error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'YouTube Audio Downloader API',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Test endpoint
app.get('/test', (req, res) => {
    res.json({
        status: 1,
        message: 'API is working',
        endpoints: {
            audio: '/api/?url=YOUTUBE_URL',
            audio_all_formats: '/api/?url=YOUTUBE_URL&all=true',
            health: '/health'
        }
    });
});

// Root endpoint - redirect to test
app.get('/', (req, res) => {
    res.redirect('/test');
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🎵 Audio endpoint: http://localhost:${PORT}/api/?url=YOUTUBE_URL`);
    console.log(`🎵 All audio formats: http://localhost:${PORT}/api/?url=YOUTUBE_URL&all=true`);
    console.log(`💚 Health check: http://localhost:${PORT}/health`);
});
