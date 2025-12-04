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

// Quality mapping from FHD/HD/SD to resolution
const qualityMapping = {
    'FHD': ['1080p', 'fhd', 'full hd', '1920x1080'],
    'HD': ['720p', 'hd', 'high definition', '1280x720'],
    'SD': ['480p', '360p', '240p', '144p', 'sd', 'standard definition'],
    '48K': ['audio48', '48k', '48', 'audio 48'],
    '128K': ['audio128', '128k', '128', 'audio 128']
};

// Reverse mapping for display
const displayQuality = {
    'FHD': '1080p',
    'HD': '720p', 
    'SD': '480p/360p/240p/144p',
    '48K': '48k Audio',
    '128K': '128k Audio'
};

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
            console.log(`Processing check ${i + 1}/${maxRetries}...`);
            
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
        const quality = req.query.quality; // e.g., "1080p", "720p", "audio128"
        
        if (!youtubeUrl) {
            return res.status(400).json({ 
                success: false,
                error: 'YouTube URL is required',
                example: '/api/download?url=https://youtu.be/VIDEO_ID&quality=1080p'
            });
        }
        
        const videoId = extractVideoId(youtubeUrl);
        
        if (!videoId) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid YouTube URL' 
            });
        }
        
        console.log(`Processing: ${videoId}, Quality: ${quality || 'all'}`);
        
        // Get metadata
        const metadata = await getVideoMetadata(youtubeUrl);
        
        // If no quality specified, return available qualities
        if (!quality) {
            return getAvailableQualities(res, metadata, videoId, req);
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
function getAvailableQualities(res, metadata, videoId, req) {
    const mediaItems = metadata.mediaItems || [];
    
    // Organize by type with better mapping
    const formats = [];
    
    mediaItems.forEach((item, index) => {
        const isVideo = item.type === 'Video';
        let displayName = item.mediaQuality;
        let qualityKey = item.mediaQuality.toLowerCase();
        
        // Map FHD/HD/SD to user-friendly names
        if (item.mediaQuality === 'FHD') {
            displayName = '1080p (FHD)';
            qualityKey = '1080p';
        } else if (item.mediaQuality === 'HD') {
            displayName = '720p (HD)';
            qualityKey = '720p';
        } else if (item.mediaQuality === 'SD') {
            // For SD, we need to check resolution to determine exact quality
            if (item.mediaRes) {
                if (item.mediaRes.includes('480')) {
                    displayName = '480p (SD)';
                    qualityKey = '480p';
                } else if (item.mediaRes.includes('360')) {
                    displayName = '360p (SD)';
                    qualityKey = '360p';
                } else if (item.mediaRes.includes('240')) {
                    displayName = '240p (SD)';
                    qualityKey = '240p';
                } else if (item.mediaRes.includes('144')) {
                    displayName = '144p (SD)';
                    qualityKey = '144p';
                }
            }
        } else if (item.mediaQuality === '48K') {
            displayName = '48k Audio';
            qualityKey = 'audio48';
        } else if (item.mediaQuality === '128K') {
            displayName = '128k Audio';
            qualityKey = 'audio128';
        }
        
        formats.push({
            id: qualityKey,
            type: item.type,
            label: `${displayName}${item.mediaRes ? ` (${item.mediaRes})` : ''}`,
            originalQuality: item.mediaQuality,
            resolution: item.mediaRes,
            size: item.mediaFileSize,
            duration: item.mediaDuration,
            extension: item.mediaExtension,
            downloadUrl: `/api/download?url=https://youtu.be/${videoId}&quality=${qualityKey}`,
            apiUrl: `${req.protocol}://${req.get('host')}/api/download?url=https://youtu.be/${videoId}&quality=${qualityKey}`,
            example: `${req.protocol}://${req.get('host')}/api/download?url=https://youtu.be/${videoId}&quality=${qualityKey}`
        });
    });
    
    // Remove duplicates
    const uniqueFormats = [];
    const seen = new Set();
    
    formats.forEach(format => {
        if (!seen.has(format.id)) {
            seen.add(format.id);
            uniqueFormats.push(format);
        }
    });
    
    res.json({
        success: true,
        videoId: videoId,
        title: metadata.title,
        thumbnail: metadata.imagePreviewUrl,
        duration: metadata.mediaItems[0]?.mediaDuration || 'N/A',
        channel: metadata.userInfo?.name || 'Unknown',
        formats: uniqueFormats,
        usage: {
            get1080p: `/api/download?url=https://youtu.be/${videoId}&quality=1080p`,
            get720p: `/api/download?url=https://youtu.be/${videoId}&quality=720p`,
            getAudio128: `/api/download?url=https://youtu.be/${videoId}&quality=audio128`,
            get480p: `/api/download?url=https://youtu.be/${videoId}&quality=480p`,
            getAll: `/api/download?url=https://youtu.be/${videoId}`
        }
    });
}

// Get specific quality
async function getSpecificQuality(res, metadata, quality, videoId) {
    const mediaItems = metadata.mediaItems || [];
    
    // Normalize quality input
    const normalizedQuality = quality.toLowerCase().trim();
    
    // Find the requested quality with flexible matching
    let targetItem = null;
    
    // Try to find matching item
    for (const item of mediaItems) {
        const itemQuality = item.mediaQuality.toLowerCase();
        
        // Check direct match or mapped match
        if (item.type === 'Video') {
            // Handle FHD -> 1080p mapping
            if (itemQuality === 'fhd' && (normalizedQuality === '1080p' || normalizedQuality === 'fhd')) {
                targetItem = item;
                break;
            }
            // Handle HD -> 720p mapping
            else if (itemQuality === 'hd' && (normalizedQuality === '720p' || normalizedQuality === 'hd')) {
                targetItem = item;
                break;
            }
            // Handle SD with resolution check
            else if (itemQuality === 'sd') {
                // Check resolution for SD items
                if (item.mediaRes) {
                    const res = item.mediaRes.toLowerCase();
                    if ((normalizedQuality === '480p' && res.includes('480')) ||
                        (normalizedQuality === '360p' && res.includes('360')) ||
                        (normalizedQuality === '240p' && res.includes('240')) ||
                        (normalizedQuality === '144p' && res.includes('144')) ||
                        (normalizedQuality === 'sd')) {
                        targetItem = item;
                        break;
                    }
                }
            }
        } 
        // Handle audio
        else if (item.type === 'Audio') {
            if ((normalizedQuality === 'audio48' || normalizedQuality === '48k') && itemQuality === '48k') {
                targetItem = item;
                break;
            }
            if ((normalizedQuality === 'audio128' || normalizedQuality === '128k') && itemQuality === '128k') {
                targetItem = item;
                break;
            }
        }
    }
    
    if (!targetItem) {
        // Generate better suggestions
        const suggestions = [];
        
        mediaItems.forEach(item => {
            if (item.type === 'Video') {
                if (item.mediaQuality === 'FHD') suggestions.push('1080p');
                else if (item.mediaQuality === 'HD') suggestions.push('720p');
                else if (item.mediaQuality === 'SD' && item.mediaRes) {
                    if (item.mediaRes.includes('480')) suggestions.push('480p');
                    else if (item.mediaRes.includes('360')) suggestions.push('360p');
                    else if (item.mediaRes.includes('240')) suggestions.push('240p');
                    else if (item.mediaRes.includes('144')) suggestions.push('144p');
                }
            } else if (item.type === 'Audio') {
                if (item.mediaQuality === '48K') suggestions.push('audio48');
                else if (item.mediaQuality === '128K') suggestions.push('audio128');
            }
        });
        
        return res.status(404).json({
            success: false,
            error: `Quality '${quality}' not found`,
            availableQualities: mediaItems.map(item => ({
                type: item.type,
                originalQuality: item.mediaQuality,
                resolution: item.mediaRes,
                size: item.mediaFileSize,
                suggestedQuality: item.type === 'Video' 
                    ? (item.mediaQuality === 'FHD' ? '1080p' : 
                       item.mediaQuality === 'HD' ? '720p' : 
                       item.mediaRes?.includes('480') ? '480p' :
                       item.mediaRes?.includes('360') ? '360p' :
                       item.mediaRes?.includes('240') ? '240p' :
                       item.mediaRes?.includes('144') ? '144p' : 'SD')
                    : `audio${item.mediaQuality.replace('K', '')}`
            })),
            suggestions: [...new Set(suggestions)], // Remove duplicates
            tryThese: suggestions.slice(0, 3).map(q => 
                `/api/download?url=https://youtu.be/${videoId}&quality=${q}`
            )
        });
    }
    
    // Process the selected quality
    try {
        const downloadInfo = await waitForProcessing(targetItem.mediaUrl);
        
        // Determine display quality name
        let displayQuality = targetItem.mediaQuality;
        if (targetItem.type === 'Video') {
            if (targetItem.mediaQuality === 'FHD') displayQuality = '1080p (FHD)';
            else if (targetItem.mediaQuality === 'HD') displayQuality = '720p (HD)';
            else if (targetItem.mediaQuality === 'SD' && targetItem.mediaRes) {
                if (targetItem.mediaRes.includes('480')) displayQuality = '480p (SD)';
                else if (targetItem.mediaRes.includes('360')) displayQuality = '360p (SD)';
                else if (targetItem.mediaRes.includes('240')) displayQuality = '240p (SD)';
                else if (targetItem.mediaRes.includes('144')) displayQuality = '144p (SD)';
            }
        }
        
        res.json({
            success: true,
            videoId: videoId,
            title: metadata.title,
            thumbnail: metadata.imagePreviewUrl,
            quality: displayQuality,
            originalQuality: targetItem.mediaQuality,
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

// Simple formats endpoint
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
        
        // Generate format list with proper mapping
        const formats = [];
        
        mediaItems.forEach(item => {
            if (item.type === 'Video') {
                if (item.mediaQuality === 'FHD') {
                    formats.push({
                        id: '1080p',
                        label: '1080p (Full HD)',
                        resolution: '1920x1080',
                        size: item.mediaFileSize,
                        duration: item.mediaDuration,
                        url: `/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=1080p`
                    });
                } else if (item.mediaQuality === 'HD') {
                    formats.push({
                        id: '720p',
                        label: '720p (HD)',
                        resolution: '1280x720',
                        size: item.mediaFileSize,
                        duration: item.mediaDuration,
                        url: `/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=720p`
                    });
                } else if (item.mediaQuality === 'SD') {
                    // Add SD formats based on resolution
                    if (item.mediaRes?.includes('480')) {
                        formats.push({
                            id: '480p',
                            label: '480p (SD)',
                            resolution: item.mediaRes,
                            size: item.mediaFileSize,
                            duration: item.mediaDuration,
                            url: `/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=480p`
                        });
                    } else if (item.mediaRes?.includes('360')) {
                        formats.push({
                            id: '360p',
                            label: '360p (SD)',
                            resolution: item.mediaRes,
                            size: item.mediaFileSize,
                            duration: item.mediaDuration,
                            url: `/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=360p`
                        });
                    } else if (item.mediaRes?.includes('240')) {
                        formats.push({
                            id: '240p',
                            label: '240p (SD)',
                            resolution: item.mediaRes,
                            size: item.mediaFileSize,
                            duration: item.mediaDuration,
                            url: `/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=240p`
                        });
                    } else if (item.mediaRes?.includes('144')) {
                        formats.push({
                            id: '144p',
                            label: '144p (SD)',
                            resolution: item.mediaRes,
                            size: item.mediaFileSize,
                            duration: item.mediaDuration,
                            url: `/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=144p`
                        });
                    }
                }
            } else if (item.type === 'Audio') {
                if (item.mediaQuality === '48K') {
                    formats.push({
                        id: 'audio48',
                        label: '48k Audio',
                        resolution: 'Audio Only',
                        size: item.mediaFileSize,
                        duration: item.mediaDuration,
                        url: `/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=audio48`
                    });
                } else if (item.mediaQuality === '128K') {
                    formats.push({
                        id: 'audio128',
                        label: '128k Audio',
                        resolution: 'Audio Only',
                        size: item.mediaFileSize,
                        duration: item.mediaDuration,
                        url: `/api/download?url=${encodeURIComponent(youtubeUrl)}&quality=audio128`
                    });
                }
            }
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

// Health check
app.get('/', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    res.json({
        message: 'YouTube Downloader API',
        version: '3.0',
        note: 'Now supports 1080p, 720p, 480p, audio128, etc.',
        endpoints: {
            getFormats: '/api/formats?url=YOUTUBE_URL',
            download: '/api/download?url=YOUTUBE_URL&quality=QUALITY',
            examples: {
                formats: `${baseUrl}/api/formats?url=https://youtu.be/5Ei6GhRiNmo`,
                download1080p: `${baseUrl}/api/download?url=https://youtu.be/5Ei6GhRiNmo&quality=1080p`,
                download720p: `${baseUrl}/api/download?url=https://youtu.be/5Ei6GhRiNmo&quality=720p`,
                downloadAudio128: `${baseUrl}/api/download?url=https://youtu.be/5Ei6GhRiNmo&quality=audio128`
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Try these examples:`);
    console.log(`   All formats: http://localhost:${PORT}/api/formats?url=https://youtu.be/5Ei6GhRiNmo`);
    console.log(`   1080p video: http://localhost:${PORT}/api/download?url=https://youtu.be/5Ei6GhRiNmo&quality=1080p`);
    console.log(`   720p video: http://localhost:${PORT}/api/download?url=https://youtu.be/5Ei6GhRiNmo&quality=720p`);
    console.log(`   128k audio: http://localhost:${PORT}/api/download?url=https://youtu.be/5Ei6GhRiNmo&quality=audio128`);
});
