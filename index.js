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
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>YouTube Opus Audio API</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }
                
                body {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: #333;
                    min-height: 100vh;
                    padding: 20px;
                }
                
                .container {
                    max-width: 1200px;
                    margin: 0 auto;
                }
                
                .header {
                    text-align: center;
                    padding: 40px 20px;
                    color: white;
                }
                
                .header h1 {
                    font-size: 3rem;
                    margin-bottom: 15px;
                    text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
                }
                
                .header p {
                    font-size: 1.2rem;
                    max-width: 800px;
                    margin: 0 auto 30px;
                    opacity: 0.9;
                }
                
                .card {
                    background: white;
                    border-radius: 20px;
                    padding: 40px;
                    margin-bottom: 30px;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                    transition: transform 0.3s ease;
                }
                
                .card:hover {
                    transform: translateY(-5px);
                }
                
                .card h2 {
                    color: #667eea;
                    margin-bottom: 20px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 1.8rem;
                }
                
                .card h2 i {
                    color: #764ba2;
                }
                
                .endpoint-container {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                    gap: 30px;
                    margin-top: 40px;
                }
                
                .endpoint {
                    background: #f8f9fa;
                    border-radius: 15px;
                    padding: 25px;
                    border-left: 5px solid #667eea;
                }
                
                .endpoint h3 {
                    color: #333;
                    margin-bottom: 15px;
                    font-size: 1.3rem;
                }
                
                .method {
                    display: inline-block;
                    background: #667eea;
                    color: white;
                    padding: 5px 15px;
                    border-radius: 20px;
                    font-weight: bold;
                    margin-bottom: 15px;
                    font-size: 0.9rem;
                }
                
                .method.get {
                    background: #10b981;
                }
                
                .method.post {
                    background: #f59e0b;
                }
                
                .code-block {
                    background: #1a1a1a;
                    color: #f8f8f8;
                    padding: 20px;
                    border-radius: 10px;
                    overflow-x: auto;
                    margin: 20px 0;
                    font-family: 'Courier New', monospace;
                    font-size: 0.95rem;
                    word-wrap: break-word;
                    word-break: break-all;
                }
                
                .code-block .highlight {
                    color: #00d9ff;
                }
                
                .example {
                    background: #eef2ff;
                    border-radius: 10px;
                    padding: 20px;
                    margin-top: 20px;
                    border: 1px dashed #667eea;
                }
                
                .example h4 {
                    color: #667eea;
                    margin-bottom: 10px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                
                .features {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                    margin-top: 40px;
                }
                
                .feature {
                    text-align: center;
                    padding: 25px;
                    background: rgba(255,255,255,0.9);
                    border-radius: 15px;
                    transition: all 0.3s ease;
                }
                
                .feature:hover {
                    background: white;
                    box-shadow: 0 10px 20px rgba(0,0,0,0.1);
                }
                
                .feature i {
                    font-size: 2.5rem;
                    color: #667eea;
                    margin-bottom: 15px;
                }
                
                .feature h3 {
                    color: #333;
                    margin-bottom: 10px;
                }
                
                .feature p {
                    color: #666;
                    font-size: 0.95rem;
                }
                
                .try-it {
                    text-align: center;
                    padding: 40px;
                    background: white;
                    border-radius: 20px;
                    margin-top: 40px;
                }
                
                .try-it h2 {
                    color: #667eea;
                    margin-bottom: 20px;
                }
                
                .input-group {
                    display: flex;
                    max-width: 600px;
                    margin: 30px auto;
                }
                
                .input-group input {
                    flex: 1;
                    padding: 15px 20px;
                    border: 2px solid #667eea;
                    border-radius: 50px 0 0 50px;
                    font-size: 1rem;
                    outline: none;
                }
                
                .input-group button {
                    background: #667eea;
                    color: white;
                    border: none;
                    padding: 0 30px;
                    border-radius: 0 50px 50px 0;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 1rem;
                    transition: background 0.3s;
                }
                
                .input-group button:hover {
                    background: #5a67d8;
                }
                
                .response-area {
                    background: #1a1a1a;
                    color: white;
                    border-radius: 10px;
                    padding: 20px;
                    margin-top: 20px;
                    text-align: left;
                    display: none;
                    overflow-x: auto;
                }
                
                .response-area pre {
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                    font-family: 'Courier New', monospace;
                    font-size: 0.9rem;
                    line-height: 1.5;
                    margin: 0;
                }
                
                /* Long URL specific styles */
                .long-url {
                    word-break: break-all;
                    overflow-wrap: break-word;
                    white-space: normal;
                    display: block;
                    padding: 5px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 3px;
                    margin: 5px 0;
                }
                
                .copy-btn {
                    background: #667eea;
                    color: white;
                    border: none;
                    padding: 5px 10px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 0.8rem;
                    margin-left: 10px;
                    transition: background 0.3s;
                }
                
                .copy-btn:hover {
                    background: #5a67d8;
                }
                
                .footer {
                    text-align: center;
                    color: white;
                    padding: 40px 20px;
                    margin-top: 40px;
                    opacity: 0.8;
                }
                
                @media (max-width: 768px) {
                    .header h1 {
                        font-size: 2.2rem;
                    }
                    
                    .card {
                        padding: 25px;
                    }
                    
                    .input-group {
                        flex-direction: column;
                    }
                    
                    .input-group input {
                        border-radius: 50px;
                        margin-bottom: 10px;
                    }
                    
                    .input-group button {
                        border-radius: 50px;
                        padding: 15px;
                    }
                    
                    .response-area pre {
                        font-size: 0.8rem;
                    }
                }
                
                /* Animation */
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                .fade-in {
                    animation: fadeIn 0.8s ease-out;
                }
                
                /* JSON syntax highlighting */
                .json-key { color: #c792ea; }
                .json-string { color: #00d9ff; }
                .json-number { color: #f78c6c; }
                .json-boolean { color: #ff5874; }
                .json-null { color: #ae81ff; }
                .json-punctuation { color: #ffffff; }
            </style>
        </head>
        <body>
            <div class="container">
                <!-- Header -->
                <div class="header fade-in">
                    <h1><i class="fas fa-music"></i> YouTube Opus Audio API</h1>
                    <p>High-quality opus audio extraction from YouTube videos. Simple, fast, and reliable API service.</p>
                </div>
                
                <!-- Main Card -->
                <div class="card fade-in" style="animation-delay: 0.2s">
                    <h2><i class="fas fa-info-circle"></i> API Overview</h2>
                    <p>This API extracts the best quality opus audio from YouTube videos. It returns a single audio stream URL in opus/webm format, optimized for download and playback.</p>
                    
                    <div class="features">
                        <div class="feature">
                            <i class="fas fa-bolt"></i>
                            <h3>Fast & Efficient</h3>
                            <p>Direct audio stream extraction without video processing overhead.</p>
                        </div>
                        <div class="feature">
                            <i class="fas fa-file-audio"></i>
                            <h3>Opus Format</h3>
                            <p>High-quality opus audio with excellent compression and sound quality.</p>
                        </div>
                        <div class="feature">
                            <i class="fas fa-code"></i>
                            <h3>Simple Integration</h3>
                            <p>Easy-to-use REST API with straightforward JSON responses.</p>
                        </div>
                        <div class="feature">
                            <i class="fas fa-shield-alt"></i>
                            <h3>Reliable</h3>
                            <p>Built on proven technology with error handling and fallbacks.</p>
                        </div>
                    </div>
                </div>
                
                <!-- API Endpoints -->
                <div class="card fade-in" style="animation-delay: 0.4s">
                    <h2><i class="fas fa-plug"></i> API Endpoints</h2>
                    
                    <div class="endpoint-container">
                        <div class="endpoint">
                            <span class="method get">GET</span>
                            <h3>Get Audio URL</h3>
                            <p>Retrieve the best quality opus audio URL for a YouTube video.</p>
                            
                            <div class="code-block">
                                <span class="highlight">GET</span> /api/url?url=<span class="highlight">YOUTUBE_URL</span>
                            </div>
                            
                            <div class="example">
                                <h4><i class="fas fa-link"></i> Example Request</h4>
                                <p>https://your-api.com/api/url?url=https://youtu.be/OJDHmHYW2PU</p>
                            </div>
                        </div>
                        
                        <div class="endpoint">
                            <span class="method post">POST</span>
                            <h3>Get Audio URL (POST)</h3>
                            <p>Alternative POST method for retrieving audio URL.</p>
                            
                            <div class="code-block">
                                <span class="highlight">POST</span> /api/youtube<br>
                                Content-Type: application/json<br><br>
                                {<br>
                                &nbsp;&nbsp;"url": "<span class="highlight">YOUTUBE_URL</span>"<br>
                                }
                            </div>
                            
                            <div class="example">
                                <h4><i class="fas fa-code"></i> Example cURL</h4>
                                <p>curl -X POST https://your-api.com/api/youtube \<br>
                                &nbsp;&nbsp;-H "Content-Type: application/json" \<br>
                                &nbsp;&nbsp;-d '{"url":"https://youtu.be/OJDHmHYW2PU"}'</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Response Example -->
                <div class="card fade-in" style="animation-delay: 0.6s">
                    <h2><i class="fas fa-reply"></i> Response Format</h2>
                    
                    <div class="code-block">
                        {<br>
                        &nbsp;&nbsp;<span class="highlight">"success"</span>: true,<br>
                        &nbsp;&nbsp;<span class="highlight">"url"</span>: "https://youtu.be/OJDHmHYW2PU",<br>
                        &nbsp;&nbsp;<span class="highlight">"title"</span>: "Official Music Video",<br>
                        &nbsp;&nbsp;<span class="highlight">"thumbnail"</span>: "https://i.ytimg.com/vi/OJDHmHYW2PU/sddefault.jpg",<br>
                        &nbsp;&nbsp;<span class="highlight">"duration"</span>: 164,<br>
                        &nbsp;&nbsp;<span class="highlight">"audio"</span>: {<br>
                        &nbsp;&nbsp;&nbsp;&nbsp;"formatId": 251,<br>
                        &nbsp;&nbsp;&nbsp;&nbsp;"quality": "opus (144kbps)",<br>
                        &nbsp;&nbsp;&nbsp;&nbsp;"url": "https://redirector.googlevideo.com/...",<br>
                        &nbsp;&nbsp;&nbsp;&nbsp;"extension": "opus",<br>
                        &nbsp;&nbsp;&nbsp;&nbsp;"mimeType": "audio/webm; codecs=\"opus\""<br>
                        &nbsp;&nbsp;},<br>
                        &nbsp;&nbsp;<span class="highlight">"format"</span>: "opus/webm"<br>
                        }
                    </div>
                    
                    <div class="example">
                        <h4><i class="fas fa-lightbulb"></i> Key Points</h4>
                        <ul style="margin-left: 20px; color: #555;">
                            <li>Returns only the <strong>best quality opus audio</strong></li>
                            <li>No multiple formats - single audio object</li>
                            <li>Direct download URL provided</li>
                            <li>Video metadata included (title, thumbnail, duration)</li>
                            <li>Error handling with descriptive messages</li>
                        </ul>
                    </div>
                </div>
                
                <!-- Try It Out -->
                <div class="try-it fade-in" style="animation-delay: 0.8s">
                    <h2><i class="fas fa-play-circle"></i> Try It Out</h2>
                    <p>Enter a YouTube URL to test the API:</p>
                    
                    <div class="input-group">
                        <input type="text" id="youtubeUrl" placeholder="https://youtu.be/VIDEO_ID">
                        <button onclick="testAPI()">
                            <i class="fas fa-paper-plane"></i> Test API
                        </button>
                    </div>
                    
                    <div id="responseArea" class="response-area">
                        <pre id="responseText">Response will appear here...</pre>
                    </div>
                </div>
                
                <!-- Instructions -->
                <div class="card fade-in" style="animation-delay: 1s">
                    <h2><i class="fas fa-graduation-cap"></i> How to Use</h2>
                    
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-top: 20px;">
                        <div style="text-align: center; padding: 15px;">
                            <div style="background: #667eea; color: white; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; margin: 0 auto 15px; font-weight: bold;">1</div>
                            <h4>Copy YouTube URL</h4>
                            <p style="font-size: 0.9rem; color: #666;">Get any YouTube video URL</p>
                        </div>
                        
                        <div style="text-align: center; padding: 15px;">
                            <div style="background: #667eea; color: white; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; margin: 0 auto 15px; font-weight: bold;">2</div>
                            <h4>Make API Call</h4>
                            <p style="font-size: 0.9rem; color: #666;">Use GET or POST endpoint</p>
                        </div>
                        
                        <div style="text-align: center; padding: 15px;">
                            <div style="background: #667eea; color: white; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; margin: 0 auto 15px; font-weight: bold;">3</div>
                            <h4>Get Audio URL</h4>
                            <p style="font-size: 0.9rem; color: #666;">Receive opus audio URL</p>
                        </div>
                        
                        <div style="text-align: center; padding: 15px;">
                            <div style="background: #667eea; color: white; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; margin: 0 auto 15px; font-weight: bold;">4</div>
                            <h4>Download/Use</h4>
                            <p style="font-size: 0.9rem; color: #666;">Use the URL in your app</p>
                        </div>
                    </div>
                    
                    <div class="example" style="margin-top: 30px;">
                        <h4><i class="fas fa-exclamation-circle"></i> Important Notes</h4>
                        <ul style="margin-left: 20px; color: #555;">
                            <li>Only returns opus/webm format audio</li>
                            <li>Returns the highest available quality</li>
                            <li>URLs are temporary (Google's redirector)</li>
                            <li>Use the audio URL within a few hours</li>
                            <li>For production, implement proper error handling</li>
                        </ul>
                    </div>
                </div>
                
                <!-- Footer -->
                <div class="footer fade-in" style="animation-delay: 1.2s">
                    <p>Made with <i class="fas fa-heart" style="color: #ff4757;"></i> for developers</p>
                    <p style="margin-top: 10px; font-size: 0.9rem;">
                        <i class="fas fa-code"></i> Node.js API | 
                        <i class="fas fa-headphones"></i> Opus Audio | 
                        <i class="fas fa-youtube"></i> YouTube Integration
                    </p>
                </div>
            </div>
            
            <script>
                async function testAPI() {
                    const urlInput = document.getElementById('youtubeUrl');
                    const responseArea = document.getElementById('responseArea');
                    const responseText = document.getElementById('responseText');
                    
                    if (!urlInput.value.trim()) {
                        alert('Please enter a YouTube URL');
                        return;
                    }
                    
                    // Show loading
                    responseText.innerHTML = 'Loading...';
                    responseArea.style.display = 'block';
                    
                    try {
                        const apiUrl = \`/api/url?url=\${encodeURIComponent(urlInput.value)}\`;
                        const response = await fetch(apiUrl);
                        const data = await response.json();
                        
                        // Format the response with special handling for long URLs
                        let formattedResponse = JSON.stringify(data, null, 2);
                        
                        // Process for display
                        formattedResponse = formattedResponse
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;');
                        
                        // Apply JSON syntax highlighting
                        formattedResponse = formattedResponse.replace(
                            /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
                            function(match) {
                                let cls = 'json-number';
                                if (/^"/.test(match)) {
                                    if (/:$/.test(match)) {
                                        cls = 'json-key';
                                    } else {
                                        // Check if this is a very long URL
                                        if (match.length > 100 && match.includes('http')) {
                                            return \`<span class="json-string long-url">\${match}</span>\`;
                                        }
                                        cls = 'json-string';
                                    }
                                } else if (/true|false/.test(match)) {
                                    cls = 'json-boolean';
                                } else if (/null/.test(match)) {
                                    cls = 'json-null';
                                }
                                return \`<span class="\${cls}">\${match}</span>\`;
                            }
                        );
                        
                        // Add punctuation highlighting
                        formattedResponse = formattedResponse.replace(
                            /([\{\}\[\],:])/g,
                            '<span class="json-punctuation">$1</span>'
                        );
                        
                        responseText.innerHTML = formattedResponse;
                        
                        // Scroll to response
                        responseArea.scrollIntoView({ behavior: 'smooth' });
                        
                    } catch (error) {
                        responseText.innerHTML = '<span class="json-string">Error: ' + error.message + '</span>';
                    }
                }
                
                // Add copy URL functionality
                document.addEventListener('click', function(e) {
                    if (e.target.classList.contains('copy-btn')) {
                        const urlToCopy = e.target.getAttribute('data-url');
                        navigator.clipboard.writeText(urlToCopy).then(() => {
                            const originalText = e.target.textContent;
                            e.target.textContent = 'Copied!';
                            setTimeout(() => {
                                e.target.textContent = originalText;
                            }, 2000);
                        });
                    }
                });
                
                // Add example URL on click
                document.getElementById('youtubeUrl').addEventListener('click', function() {
                    if (!this.value) {
                        this.value = 'https://youtu.be/OJDHmHYW2PU';
                    }
                });
                
                // Auto-resize response area
                function autoResizeResponseArea() {
                    const responseArea = document.getElementById('responseArea');
                    if (responseArea.style.display !== 'none') {
                        responseArea.style.maxHeight = '500px';
                        responseArea.style.overflowY = 'auto';
                    }
                }
                
                // Call auto-resize when response area is shown
                const observer = new MutationObserver(function(mutations) {
                    mutations.forEach(function(mutation) {
                        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                            autoResizeResponseArea();
                        }
                    });
                });
                
                const responseArea = document.getElementById('responseArea');
                if (responseArea) {
                    observer.observe(responseArea, { attributes: true });
                }
            </script>
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
