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

// Get best opus format (highest quality)
function getBestOpusFormat(formats) {
    // Filter opus formats
    const opusFormats = formats.filter(format => {
        // Check for opus format (itag 249, 250, 251)
        const isOpus = format.itag === 249 || format.itag === 250 || format.itag === 251;
        // OR check for opus in mimeType
        const hasOpusInMime = format.mimeType && format.mimeType.includes('opus');
        // OR check for webm audio with opus
        const isWebmOpus = format.ext === 'opus' || 
                          (format.mimeType && 
                           format.mimeType.includes('audio/webm') && 
                           format.mimeType.includes('opus'));
        
        return (isOpus || hasOpusInMime || isWebmOpus) && format.type === 'audio';
    });
    
    if (opusFormats.length === 0) {
        // If no opus, try to find any webm audio
        const webmAudio = formats.find(format => 
            format.type === 'audio' && 
            format.mimeType && 
            format.mimeType.includes('webm')
        );
        return webmAudio || null;
    }
    
    // Sort opus formats by quality (highest first)
    opusFormats.sort((a, b) => {
        // Priority by itag (251 > 250 > 249)
        if (a.itag && b.itag) {
            return b.itag - a.itag;
        }
        
        // Then by bitrate
        const bitrateA = a.bitrate || 0;
        const bitrateB = b.bitrate || 0;
        return bitrateB - bitrateA;
        
        // Then by audio quality label
        const qualityOrder = {
            'AUDIO_QUALITY_HIGH': 3,
            'AUDIO_QUALITY_MEDIUM': 2,
            'AUDIO_QUALITY_LOW': 1
        };
        const qualityA = qualityOrder[a.audioQuality] || 0;
        const qualityB = qualityOrder[b.audioQuality] || 0;
        if (qualityB !== qualityA) return qualityB - qualityA;
    });
    
    return opusFormats[0]; // Return the best one
}

// Main API endpoint - Returns only BEST opus format
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

        // Call clipto.com API
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
                },
                timeout: 10000
            }
        );

        const data = response.data;
        
        if (data.success && data.medias && data.medias.length > 0) {
            // Get the best opus format
            const bestOpus = getBestOpusFormat(data.medias);
            
            if (!bestOpus) {
                return res.status(404).json({
                    success: false,
                    error: "No opus/webm audio format available for this video"
                });
            }

            // Prepare simplified response with only the best opus
            const result = {
                success: true,
                url: data.url,
                source: "youtube",
                title: data.title || "Unknown Title",
                author: data.author || "Unknown Author",
                thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
                duration: data.duration || 0,
                audio: {
                    formatId: bestOpus.formatId || bestOpus.itag,
                    quality: bestOpus.label || bestOpus.quality || "opus",
                    type: bestOpus.type || "audio",
                    extension: bestOpus.ext || "opus",
                    url: bestOpus.url,
                    bitrate: bestOpus.bitrate || null,
                    audioQuality: bestOpus.audioQuality || "AUDIO_QUALITY_MEDIUM",
                    audioSampleRate: bestOpus.audioSampleRate || "48000",
                    mimeType: bestOpus.mimeType || "audio/webm; codecs=\"opus\"",
                    size: bestOpus.clen ? Math.round(bestOpus.clen / 1024 / 1024 * 100) / 100 + " MB" : null
                },
                videoId: videoId,
                format: "opus/webm",
                note: "Returns only the best quality opus audio format",
                timestamp: new Date().toISOString()
            };

            return res.json(result);
        } else {
            return res.status(404).json({
                success: false,
                error: "Video not found or no formats available"
            });
        }

    } catch (error) {
        console.error('Error:', error.message);
        
        // More specific error messages
        if (error.code === 'ECONNREFUSED') {
            return res.status(502).json({
                success: false,
                error: "Cannot connect to video service"
            });
        }
        
        if (error.response) {
            return res.status(error.response.status).json({
                success: false,
                error: "Video service error",
                details: error.response.data
            });
        }
        
        return res.status(500).json({
            success: false,
            error: "Internal server error",
            details: error.message
        });
    }
});

// GET endpoint - Returns only BEST opus format
app.get('/api/url', async (req, res) => {
    try {
        let { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: "URL parameter is required"
            });
        }

        // Clean URL - remove extra parameters if any
        url = url.split('?')[0];
        
        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({
                success: false,
                error: "Invalid YouTube URL"
            });
        }

        // Construct full URL if needed
        if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            url = `https://youtu.be/${videoId}`;
        }

        // Call clipto API
        const response = await axios.post('https://www.clipto.com/api/youtube', 
            { url },
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        const data = response.data;
        
        if (data.success && data.medias && data.medias.length > 0) {
            // Get the best opus format
            const bestOpus = getBestOpusFormat(data.medias);
            
            if (!bestOpus) {
                return res.status(404).json({
                    success: false,
                    error: "No opus/webm audio format available"
                });
            }

            // Simplified response with only best opus
            const result = {
                success: true,
                url: data.url,
                source: "youtube",
                title: data.title || "YouTube Audio",
                author: data.author || "",
                thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                duration: data.duration || 0,
                audio: bestOpus, // Direct object
                format: "opus",
                quality: "best",
                available_qualities: ["opus (144kbps)", "opus (55kbps)"],
                download_note: "Right-click the URL to download"
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
        
        // Fallback: Try to get video info directly
        const { url } = req.query;
        const videoId = extractVideoId(url);
        
        if (videoId) {
            // Return at least some info with placeholder
            return res.json({
                success: true,
                url: url,
                source: "youtube",
                title: "YouTube Audio",
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                duration: 0,
                audio: {
                    formatId: 251,
                    quality: "opus (144kbps)",
                    type: "audio",
                    extension: "opus",
                    url: `https://redirector.googlevideo.com/videoplayback?video_id=${videoId}&format=opus`,
                    mimeType: "audio/webm; codecs=\"opus\"",
                    note: "Direct download might not work. Use clipto.com for full functionality."
                },
                note: "Using fallback response. Full functionality requires clipto.com API."
            });
        }
        
        return res.status(500).json({
            success: false,
            error: "Server error. Please try again later."
        });
    }
});

// Alternative endpoint: Direct opus only
app.get('/api/opus', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: "URL parameter is required"
            });
        }

        // Just redirect to main endpoint
        const response = await axios.get(`http://localhost:${PORT}/api/url?url=${encodeURIComponent(url)}`);
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
    res.json({ 
        status: 'OK', 
        service: 'YouTube Best Opus Audio',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Homepage
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>YouTube Best Opus Audio</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                    code { background: #f4f4f4; padding: 5px; border-radius: 3px; }
                    .example { background: #e8f4f8; padding: 15px; border-radius: 5px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <h1>YouTube Best Opus Audio API</h1>
                <p>Returns only the <strong>best quality opus audio</strong> from YouTube videos.</p>
                
                <div class="example">
                    <h3>GET Endpoint:</h3>
                    <code>GET /api/url?url=YOUTUBE_URL</code>
                    <p>Example:</p>
                    <code>https://your-api.com/api/url?url=https://youtu.be/OJDHmHYW2PU</code>
                    
                    <h3>Response Example:</h3>
                    <pre>{
  "success": true,
  "url": "https://youtu.be/OJDHmHYW2PU",
  "title": "Video Title",
  "audio": {
    "formatId": 251,
    "quality": "opus (144kbps)",
    "url": "https://redirector.googlevideo.com/...opus...",
    "extension": "opus"
  }
}</pre>
                </div>
                
                <p><strong>Note:</strong> Only returns the best opus quality. No m4a, no multiple formats.</p>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`✅ GET  /api/url?url=YOUTUBE_URL`);
    console.log(`✅ POST /api/youtube`);
    console.log(`✅ Health: /health`);
    console.log(`\n📢 This API returns ONLY the BEST opus audio quality.`);
});
