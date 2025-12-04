const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// YouTube video ID extract function
function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/,
        /youtube\.com\/v\/([^&?/]+)/,
        /youtube\.com\/shorts\/([^&?/]+)/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

// Format quality filter
function filterFormatsByQuality(formats, quality) {
    if (!quality) return formats;
    
    const audioQualities = {
        'low': 'AUDIO_QUALITY_LOW',
        'medium': 'AUDIO_QUALITY_MEDIUM',
        'high': 'AUDIO_QUALITY_HIGH'
    };
    
    const selectedQuality = audioQualities[quality.toLowerCase()];
    if (selectedQuality) {
        return formats.filter(format => 
            format.audioQuality === selectedQuality && format.type === 'audio'
        );
    }
    return formats;
}

// Main API endpoint
app.post('/api/youtube', async (req, res) => {
    try {
        const { url, audioquality } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: "URL is required"
            });
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({
                success: false,
                error: "Invalid YouTube URL"
            });
        }

        // Simulate clipto.com API request
        const response = await axios.post('https://www.clipto.com/api/youtube', 
            { url },
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Origin': 'https://www.clipto.com',
                    'Referer': `https://www.clipto.com/media-downloader/youtube-downloader?videoUrl=${encodeURIComponent(url)}`,
                    'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
                    'sec-ch-ua-mobile': '?1',
                    'sec-ch-ua-platform': '"Android"',
                    'sec-fetch-site': 'same-origin',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-dest': 'empty'
                }
            }
        );

        const data = response.data;
        
        if (data.success && data.medias) {
            // Filter only audio formats (webm format for best audio)
            let audioFormats = data.medias.filter(format => 
                format.type === 'audio' || 
                (format.ext === 'webm' && format.type === 'audio') ||
                format.ext === 'opus' ||
                format.ext === 'm4a'
            );

            // Apply quality filter if specified
            if (audioquality) {
                audioFormats = filterFormatsByQuality(audioFormats, audioquality);
            }

            // If webm audio not found, try to find best audio format
            if (audioFormats.length === 0) {
                audioFormats = data.medias.filter(format => 
                    format.type === 'audio' || 
                    (format.mimeType && format.mimeType.includes('audio'))
                );
            }

            // Sort by quality/bitrate (highest first)
            audioFormats.sort((a, b) => {
                const bitrateA = a.bitrate || 0;
                const bitrateB = b.bitrate || 0;
                return bitrateB - bitrateA;
            });

            // Prepare response
            const result = {
                success: true,
                url: data.url,
                source: "youtube",
                title: data.title,
                author: data.author,
                thumbnail: data.thumbnail,
                duration: data.duration,
                medias: audioFormats,
                type: "audio",
                error: false
            };

            return res.json(result);
        } else {
            return res.status(404).json({
                success: false,
                error: "No audio formats found"
            });
        }

    } catch (error) {
        console.error('Error:', error.message);
        return res.status(500).json({
            success: false,
            error: "Internal server error",
            details: error.message
        });
    }
});

// GET endpoint alternative
app.get('/api/url', async (req, res) => {
    try {
        const { url, audioquality } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: "URL parameter is required"
            });
        }

        // Forward to POST endpoint
        const response = await axios.post(`http://localhost:${PORT}/api/youtube`, 
            { url, audioquality },
            { headers: { 'Content-Type': 'application/json' } }
        );
        
        return res.json(response.data);
        
    } catch (error) {
        console.error('Error:', error.message);
        return res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API Endpoints:`);
    console.log(`POST /api/youtube`);
    console.log(`GET  /api/url?url=YOUTUBE_URL&audioquality=quality`);
});
