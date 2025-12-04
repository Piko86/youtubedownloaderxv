const axios = require('axios');
const express = require('express');
const app = express();

const BASE_URL = 'https://ytdown.to';
const PROCESSING_BASE = 'https://s7.ytcontent.net/v3';

// Function to extract video ID
function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
        /^([A-Za-z0-9_-]{11})$/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// Wait for processing to complete
async function waitForProcessing(processingUrl, maxRetries = 15, delay = 1500) {
    const headers = {
        'authority': 's7.ytcontent.net',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'en-US',
        'cache-control': 'max-age=0',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'cross-site',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'
    };
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios.get(processingUrl, { 
                headers,
                timeout: 10000 
            });
            
            const data = response.data;
            
            if (data.percent === "Completed" && data.fileUrl) {
                return {
                    success: true,
                    fileName: data.fileName,
                    fileSize: data.fileSize,
                    fileUrl: data.fileUrl
                };
            } else if (data.percent && data.percent !== "Completed") {
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                return data;
            }
        } catch (error) {
            if (i === maxRetries - 1) {
                throw new Error(`Processing failed after ${maxRetries} attempts`);
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw new Error('Processing timeout');
}

// Get video metadata
async function getVideoMetadata(youtubeUrl) {
    const headers = {
        'authority': 'ytdown.to',
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'origin': 'https://ytdown.to',
        'referer': 'https://ytdown.to/en2/',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
        'x-requested-with': 'XMLHttpRequest'
    };
    
    const data = new URLSearchParams({ 'url': youtubeUrl });
    
    const response = await axios.post(
        `${BASE_URL}/proxy.php`,
        data.toString(),
        { headers, timeout: 20000 }
    );
    
    return response.data.api;
}

// Main API endpoint
app.get('/api/download', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        const quality = req.query.quality; // e.g., "720p", "1080p", "audio48", "audio128"
        
        if (!youtubeUrl) {
            return res.status(400).json({ 
                success: false,
                error: 'YouTube URL is required',
                example: '/api/download?url=https://youtu.be/VIDEO_ID&quality=720p'
            });
        }
        
        const videoId = extractVideoId(youtubeUrl);
        
        if (!videoId) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid YouTube URL' 
            });
        }
        
        // Get metadata
        const metadata = await getVideoMetadata(youtubeUrl);
        
        // If no quality specified, return available qualities
        if (!quality) {
            return getAvailableQualities(res, metadata, videoId);
        }
        
        // If quality specified, get that specific quality
        return await getSpecificQuality(res, metadata, quality, videoId);
        
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Failed to process video',
            details: error.message 
        });
    }
});

// Get available qualities (no processing)
function getAvailableQualities(res, metadata, videoId) {
    const mediaItems = metadata.mediaItems || [];
    
    // Organize by type
    const videoQualities = [];
    const audioQualities = [];
    
    mediaItems.forEach(item => {
        if (item.type === 'Video') {
            videoQualities.push({
                id: `video_${item.mediaQuality.toLowerCase().replace('p', '')}`,
                label: `${item.mediaQuality} (${item.mediaRes})`,
                quality: item.mediaQuality,
                resolution: item.mediaRes,
                size: item.mediaFileSize,
                duration: item.mediaDuration,
                extension: item.mediaExtension,
                exampleUrl: `/api/download?url=https://youtu.be/${videoId}&quality=${item.mediaQuality}`,
                directExample: `${req.protocol}://${req.get('host')}/api/download?url=https://youtu.be/${videoId}&quality=${item.mediaQuality}`
            });
        } else if (item.type === 'Audio') {
            audioQualities.push({
                id: `audio_${item.mediaQuality.toLowerCase().replace('k', '')}`,
                label: `Audio ${item.mediaQuality}`,
                quality: item.mediaQuality,
                size: item.mediaFileSize,
                duration: item.mediaDuration,
                extension: item.mediaExtension,
                exampleUrl: `/api/download?url=https://youtu.be/${videoId}&quality=audio${item.mediaQuality.replace('K', '')}`,
                directExample: `${req.protocol}://${req.get('host')}/api/download?url=https://youtu.be/${videoId}&quality=audio${item.mediaQuality.replace('K', '')}`
            });
        }
    });
    
    // Sort video qualities from highest to lowest
    videoQualities.sort((a, b) => {
        const getResValue = (quality) => {
            const match = quality.match(/(\d+)/);
            return match ? parseInt(match[1]) : 0;
        };
        return getResValue(b.quality) - getResValue(a.quality);
    });
    
    res.json({
        success: true,
        videoId: videoId,
        title: metadata.title,
        thumbnail: metadata.imagePreviewUrl,
        duration: videoQualities[0]?.duration || 'N/A',
        channel: metadata.userInfo?.name || 'Unknown',
        availableFormats: {
            video: videoQualities,
            audio: audioQualities
        },
        usage: {
            getSpecificVideo: '/api/download?url=YOUTUBE_URL&quality=QUALITY',
            getSpecificAudio: '/api/download?url=YOUTUBE_URL&quality=audioQUALITY',
            examples: {
                video_720p: `/api/download?url=https://youtu.be/${videoId}&quality=720p`,
                audio_128k: `/api/download?url=https://youtu.be/${videoId}&quality=audio128`,
                allQualities: `/api/download?url=https://youtu.be/${videoId}`
            }
        }
    });
}

// Get specific quality
async function getSpecificQuality(res, metadata, quality, videoId) {
    const mediaItems = metadata.mediaItems || [];
    
    // Find the requested quality
    let targetItem = null;
    
    // Check for video qualities
    if (quality.includes('p') || ['144', '240', '360', '480', '720', '1080', '1440', '2160'].some(q => quality.includes(q))) {
        targetItem = mediaItems.find(item => 
            item.type === 'Video' && 
            (item.mediaQuality === quality || 
             item.mediaQuality.includes(quality) ||
             quality.includes(item.mediaQuality.replace('p', '')))
        );
    } 
    // Check for audio qualities
    else if (quality.includes('audio') || quality.includes('k') || quality.includes('K')) {
        const audioQuality = quality.replace('audio', '').replace('k', 'K');
        targetItem = mediaItems.find(item => 
            item.type === 'Audio' && 
            (item.mediaQuality === audioQuality || 
             item.mediaQuality.includes(audioQuality))
        );
    }
    
    if (!targetItem) {
        // List available qualities in error response
        const availableQualities = mediaItems.map(item => ({
            type: item.type,
            quality: item.mediaQuality,
            size: item.mediaFileSize
        }));
        
        return res.status(404).json({
            success: false,
            error: `Quality '${quality}' not found`,
            availableQualities: availableQualities,
            suggestions: {
                video: mediaItems.filter(item => item.type === 'Video').map(item => item.mediaQuality),
                audio: mediaItems.filter(item => item.type === 'Audio').map(item => `audio${item.mediaQuality.replace('K', '')}`)
            }
        });
    }
    
    // Process the selected quality
    try {
        const downloadInfo = await waitForProcessing(targetItem.mediaUrl);
        
        res.json({
            success: true,
            videoId: videoId,
            title: metadata.title,
            thumbnail: metadata.imagePreviewUrl,
            quality: targetItem.mediaQuality,
            resolution: targetItem.mediaRes || 'N/A',
            type: targetItem.type,
            size: targetItem.mediaFileSize,
            duration: targetItem.mediaDuration,
            extension: targetItem.mediaExtension,
            downloadUrl: downloadInfo.fileUrl,
            fileName: downloadInfo.fileName,
            expires: 'Link expires after some time. Download quickly.',
            otherFormats: `/api/download?url=https://youtu.be/${videoId}`
        });
        
    } catch (error) {
        throw error;
    }
}

// Simple list endpoint for frontend
app.get('/api/formats', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        
        if (!youtubeUrl) {
            return res.status(400).json({ 
                success: false,
                error: 'YouTube URL is required' 
            });
        }
        
        const videoId = extractVideoId(youtubeUrl);
        const metadata = await getVideoMetadata(youtubeUrl);
        const mediaItems = metadata.mediaItems || [];
        
        // Simple format list for frontend
        const formats = mediaItems.map(item => {
            const isVideo = item.type === 'Video';
            const qualityId = isVideo ? 
                item.mediaQuality.toLowerCase() : 
                `audio${item.mediaQuality.replace('K', '')}`;
            
            return {
                id: qualityId,
                type: item.type,
                label: isVideo ? 
                    `${item.mediaQuality} Video (${item.mediaRes})` : 
                    `Audio ${item.mediaQuality}`,
                quality: item.mediaQuality,
                resolution: item.mediaRes,
                size: item.mediaFileSize,
                duration: item.mediaDuration,
                downloadUrl: `/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=${qualityId}`,
                apiUrl: `${req.protocol}://${req.get('host')}/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=${qualityId}`
            };
        });
        
        res.json({
            success: true,
            videoId: videoId,
            title: metadata.title,
            thumbnail: metadata.imagePreviewUrl,
            formats: formats
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Direct download with HTML page
app.get('/download', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        const quality = req.query.quality;
        
        if (!youtubeUrl) {
            return res.send(`
                <html>
                    <head><title>YouTube Downloader</title></head>
                    <body>
                        <h1>YouTube Video Downloader</h1>
                        <form method="GET">
                            <input type="text" name="url" placeholder="Enter YouTube URL" size="50">
                            <button type="submit">Get Formats</button>
                        </form>
                    </body>
                </html>
            `);
        }
        
        const videoId = extractVideoId(youtubeUrl);
        
        if (!quality) {
            // Show available formats
            const metadata = await getVideoMetadata(youtubeUrl);
            const mediaItems = metadata.mediaItems || [];
            
            let html = `
                <html>
                    <head>
                        <title>Download: ${metadata.title}</title>
                        <style>
                            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                            .video-info { background: #f5f5f5; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
                            .thumbnail { max-width: 100%; border-radius: 8px; }
                            .format-list { display: grid; gap: 10px; }
                            .format-item { 
                                background: white; 
                                padding: 15px; 
                                border-radius: 8px; 
                                border: 1px solid #ddd;
                                display: flex; 
                                justify-content: space-between;
                                align-items: center;
                            }
                            .download-btn { 
                                background: #ff0000; 
                                color: white; 
                                padding: 8px 16px; 
                                border-radius: 4px; 
                                text-decoration: none;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="video-info">
                            <h2>${metadata.title}</h2>
                            <img src="${metadata.imagePreviewUrl}" class="thumbnail" width="400">
                            <p>Channel: ${metadata.userInfo?.name || 'Unknown'}</p>
                        </div>
                        
                        <h3>Available Formats:</h3>
                        <div class="format-list">
            `;
            
            // Video formats
            html += `<h4>Video Formats:</h4>`;
            mediaItems.filter(item => item.type === 'Video').forEach(item => {
                html += `
                    <div class="format-item">
                        <div>
                            <strong>${item.mediaQuality}</strong> (${item.mediaRes})<br>
                            <small>${item.mediaFileSize} • ${item.mediaDuration}</small>
                        </div>
                        <a href="/download?url=${encodeURIComponent(youtubeUrl)}&quality=${item.mediaQuality}" 
                           class="download-btn" target="_blank">
                            Download
                        </a>
                    </div>
                `;
            });
            
            // Audio formats
            html += `<h4>Audio Formats:</h4>`;
            mediaItems.filter(item => item.type === 'Audio').forEach(item => {
                const audioQuality = `audio${item.mediaQuality.replace('K', '')}`;
                html += `
                    <div class="format-item">
                        <div>
                            <strong>${item.mediaQuality} Audio</strong><br>
                            <small>${item.mediaFileSize} • ${item.mediaDuration}</small>
                        </div>
                        <a href="/download?url=${encodeURIComponent(youtubeUrl)}&quality=${audioQuality}" 
                           class="download-btn" target="_blank">
                            Download
                        </a>
                    </div>
                `;
            });
            
            html += `
                        </div>
                    </body>
                </html>
            `;
            
            return res.send(html);
        }
        
        // Download specific quality
        const metadata = await getVideoMetadata(youtubeUrl);
        const downloadInfo = await getSpecificQualityForDownload(metadata, quality);
        
        // Redirect to download URL
        res.redirect(downloadInfo.fileUrl);
        
    } catch (error) {
        res.send(`
            <html>
                <head><title>Error</title></head>
                <body>
                    <h1>Error</h1>
                    <p>${error.message}</p>
                    <a href="/download">Go Back</a>
                </body>
            </html>
        `);
    }
});

async function getSpecificQualityForDownload(metadata, quality) {
    const mediaItems = metadata.mediaItems || [];
    let targetItem = null;
    
    if (quality.includes('audio')) {
        const audioQuality = quality.replace('audio', '') + 'K';
        targetItem = mediaItems.find(item => 
            item.type === 'Audio' && item.mediaQuality === audioQuality
        );
    } else {
        targetItem = mediaItems.find(item => 
            item.type === 'Video' && item.mediaQuality === quality
        );
    }
    
    if (!targetItem) {
        throw new Error(`Quality ${quality} not found`);
    }
    
    return await waitForProcessing(targetItem.mediaUrl);
}

// Health check
app.get('/', (req, res) => {
    res.json({
        message: 'YouTube Downloader API',
        version: '2.0',
        endpoints: {
            getFormats: '/api/formats?url=YOUTUBE_URL',
            downloadSpecific: '/api/download?url=YOUTUBE_URL&quality=QUALITY',
            webInterface: '/download?url=YOUTUBE_URL',
            examples: {
                video_720p: '/api/download?url=https://youtu.be/GdtNy-3pKM4&quality=720p',
                audio_128k: '/api/download?url=https://youtu.be/GdtNy-3pKM4&quality=audio128',
                allFormats: '/api/formats?url=https://youtu.be/GdtNy-3pKM4'
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Web Interface: http://localhost:${PORT}/download`);
    console.log(`📡 API: http://localhost:${PORT}/api/formats?url=https://youtu.be/GdtNy-3pKM4`);
});
