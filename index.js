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

// Filter only opus/webm audio formats
function filterOpusFormats(formats) {
    return formats.filter(format => {
        // Check for opus format (itag 249, 250, 251)
        const isOpus = format.itag === 249 || format.itag === 250 || format.itag === 251;
        // OR check for opus in mimeType
        const hasOpusInMime = format.mimeType && format.mimeType.includes('opus');
        // OR check for webm audio
        const isWebmAudio = format.ext === 'opus' || 
                           (format.mimeType && format.mimeType.includes('audio/webm'));
        
        return (isOpus || hasOpusInMime || isWebmAudio) && format.type === 'audio';
    });
}

// Sort opus formats by quality (highest first)
function sortOpusFormatsByQuality(formats) {
    return formats.sort((a, b) => {
        // Priority: itag 251 > 250 > 249 (higher itag = better quality for opus)
        if (a.itag && b.itag) {
            return b.itag - a.itag;
        }
        
        // Fallback: sort by bitrate
        const bitrateA = a.bitrate || 0;
        const bitrateB = b.bitrate || 0;
        return bitrateB - bitrateA;
    });
}

// Main API endpoint
app.post('/api/youtube', async (req, res) => {
    try {
        const { url } = req.body;
        
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
            // Filter only opus/webm audio formats
            let opusFormats = filterOpusFormats(data.medias);
            
            // If no opus formats found, check for any audio with webm
            if (opusFormats.length === 0) {
                opusFormats = data.medias.filter(format => 
                    format.type === 'audio' && 
                    (format.mimeType && format.mimeType.includes('webm'))
                );
            }
            
            // Sort by quality
            opusFormats = sortOpusFormatsByQuality(opusFormats);
            
            // If still no formats, return error
            if (opusFormats.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "No opus/webm audio formats available"
                });
            }

            // Prepare response - return only opus formats
            const result = {
                success: true,
                url: data.url,
                source: "youtube",
                title: data.title,
                author: data.author,
                thumbnail: data.thumbnail,
                duration: data.duration,
                medias: opusFormats,
                type: "audio",
                error: false,
                format: "opus/webm"
            };

            return res.json(result);
        } else {
            return res.status(404).json({
                success: false,
                error: "No media formats found"
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

// GET endpoint - opus format only
app.get('/api/url', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: "URL parameter is required"
            });
        }

        // Extract video ID for direct access
        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({
                success: false,
                error: "Invalid YouTube URL"
            });
        }

        // Call clipto API directly
        const response = await axios.post('https://www.clipto.com/api/youtube', 
            { url },
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        const data = response.data;
        
        if (data.success && data.medias) {
            // Filter only opus formats
            let opusFormats = filterOpusFormats(data.medias);
            
            // Sort by quality (highest first)
            opusFormats = sortOpusFormatsByQuality(opusFormats);
            
            // Get the best quality opus (first in array after sorting)
            const bestOpus = opusFormats.length > 0 ? opusFormats[0] : null;
            
            // If no opus found, check for any webm audio
            if (!bestOpus) {
                const webmAudio = data.medias.find(format => 
                    format.type === 'audio' && format.ext === 'webm'
                );
                if (webmAudio) {
                    opusFormats = [webmAudio];
                }
            }
            
            if (opusFormats.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "No opus/webm audio available"
                });
            }

            // Return only opus formats
            const result = {
                success: true,
                url: data.url,
                source: "youtube",
                title: data.title,
                author: data.author,
                thumbnail: data.thumbnail,
                duration: data.duration,
                medias: opusFormats,  // Only opus formats
                type: "audio",
                error: false,
                recommended_format: "opus/webm",
                note: "Only opus/webm audio formats are returned"
            };

            return res.json(result);
            
        } else {
            return res.status(404).json({
                success: false,
                error: "Video not found or unavailable"
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

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'YouTube Opus Audio Downloader'
    });
});

// Simple homepage
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>YouTube Opus Audio Downloader</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                    code { background: #f4f4f4; padding: 5px; border-radius: 3px; }
                    .endpoint { margin: 20px 0; }
                </style>
            </head>
            <body>
                <h1>YouTube Opus Audio Downloader API</h1>
                <p>This API returns only opus/webm audio formats from YouTube videos.</p>
                
                <div class="endpoint">
                    <h3>GET Endpoint:</h3>
                    <code>GET /api/url?url=YOUTUBE_URL</code>
                    <p>Example: <code>https://your-api.com/api/url?url=https://youtu.be/OJDHmHYW2PU</code></p>
                </div>
                
                <div class="endpoint">
                    <h3>POST Endpoint:</h3>
                    <code>POST /api/youtube</code>
                    <pre>Content-Type: application/json
{
    "url": "https://youtu.be/VIDEO_ID"
}</pre>
                </div>
                
                <p><strong>Note:</strong> Only opus/webm audio formats are returned. No m4a formats.</p>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API Endpoints:`);
    console.log(`GET  /api/url?url=YOUTUBE_URL`);
    console.log(`POST /api/youtube`);
    console.log(`\nThis API returns only OPUS/WEBM audio formats.`);
});
