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
        const requestedQuality = req.query.quality; // e.g., "128kbps", "48kbps", "192kbps"
        
        if (!youtubeUrl) {
            return res.status(400).json({
                status: 0,
                message: 'Please provide YouTube URL in query parameter',
                example: `http://yourhostname/api/?url=https://youtu.be/VIDEO_ID&quality=128kbps`
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
        
        // Collect all audio formats
        const allAudioFormats = [];

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

                    allAudioFormats.push(formatInfo);
                }
            });
        }

        // Sort audio formats by bitrate (highest first)
        allAudioFormats.sort((a, b) => {
            // Extract bitrate number for comparison
            const getBitrate = (quality) => {
                // Extract numbers from quality string (e.g., "128kbps" -> 128, "48kbps" -> 48)
                const match = quality.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
            };
            return getBitrate(b.quality) - getBitrate(a.quality);
        });

        // If no audio formats found, return error
        if (allAudioFormats.length === 0) {
            return res.status(404).json({
                status: 0,
                message: 'No downloadable audio formats found. The video might be restricted or unavailable.'
            });
        }

        // If quality parameter is specified, find matching quality
        if (requestedQuality) {
            // Normalize the requested quality (remove spaces, convert to lowercase)
            const normalizedQuality = requestedQuality.toLowerCase().replace(/\s/g, '');
            
            // Try different matching strategies
            let matchedFormat = null;
            
            // Strategy 1: Exact match (e.g., "128kbps")
            matchedFormat = allAudioFormats.find(format => 
                format.quality.toLowerCase().replace(/\s/g, '') === normalizedQuality
            );
            
            // Strategy 2: Match just the number (e.g., "128")
            if (!matchedFormat) {
                const qualityNumber = normalizedQuality.match(/(\d+)/);
                if (qualityNumber) {
                    const number = qualityNumber[1];
                    matchedFormat = allAudioFormats.find(format => 
                        format.quality.includes(number)
                    );
                }
            }
            
            // Strategy 3: Find closest match
            if (!matchedFormat) {
                const getBitrateValue = (qualityStr) => {
                    const match = qualityStr.match(/(\d+)/);
                    return match ? parseInt(match[1]) : 0;
                };
                
                const requestedBitrate = getBitrateValue(normalizedQuality);
                if (requestedBitrate > 0) {
                    // Find format with closest bitrate
                    matchedFormat = allAudioFormats.reduce((closest, current) => {
                        const currentBitrate = getBitrateValue(current.quality);
                        const closestBitrate = getBitrateValue(closest.quality);
                        const currentDiff = Math.abs(currentBitrate - requestedBitrate);
                        const closestDiff = Math.abs(closestBitrate - requestedBitrate);
                        return currentDiff < closestDiff ? current : closest;
                    });
                }
            }
            
            if (matchedFormat) {
                // Return the specific quality requested
                res.json({
                    status: 1,
                    title: videoData.title,
                    duration: videoData.duration,
                    thumbnail: videoData.thumbnail,
                    requested_quality: requestedQuality,
                    audio_format: matchedFormat,
                    available_qualities: allAudioFormats.map(f => f.quality)
                });
            } else {
                // Return available qualities if requested quality not found
                res.json({
                    status: 0,
                    message: `Requested quality '${requestedQuality}' not found`,
                    available_qualities: allAudioFormats.map(f => f.quality),
                    recommended: allAudioFormats[0] // Best quality
                });
            }
        } else {
            // If no quality specified, return best quality (first after sorting)
            res.json({
                status: 1,
                title: videoData.title,
                duration: videoData.duration,
                thumbnail: videoData.thumbnail,
                best_audio: allAudioFormats[0],
                available_qualities: allAudioFormats.map(f => f.quality)
            });
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
            best_audio: '/api/?url=YOUTUBE_URL',
            specific_quality: '/api/?url=YOUTUBE_URL&quality=128kbps',
            list_qualities: '/api/?url=YOUTUBE_URL&quality=list'
        }
    });
});

// Endpoint to just list available qualities without downloading
app.get('/api/qualities', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        
        if (!youtubeUrl) {
            return res.status(400).json({
                status: 0,
                message: 'Please provide YouTube URL'
            });
        }

        // Call the main endpoint but modify to only return qualities list
        const response = await axios.get(`http://localhost:${PORT}/api/?url=${encodeURIComponent(youtubeUrl)}`);
        
        if (response.data.status === 1) {
            res.json({
                status: 1,
                title: response.data.title,
                duration: response.data.duration,
                available_qualities: response.data.available_qualities
            });
        } else {
            res.json(response.data);
        }
        
    } catch (error) {
        res.status(500).json({
            status: 0,
            message: 'Failed to fetch available qualities'
        });
    }
});

// Root endpoint - redirect to test
app.get('/', (req, res) => {
    res.redirect('/test');
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🎵 Best audio endpoint: http://localhost:${PORT}/api/?url=YOUTUBE_URL`);
    console.log(`🎵 Specific quality: http://localhost:${PORT}/api/?url=YOUTUBE_URL&quality=128kbps`);
    console.log(`📋 List qualities: http://localhost:${PORT}/api/qualities?url=YOUTUBE_URL`);
    console.log(`💚 Health check: http://localhost:${PORT}/health`);
});
