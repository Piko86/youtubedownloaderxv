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
            console.log(`Processing check ${i + 1}/${maxRetries}...`);
            
            const response = await axios.get(processingUrl, { 
                headers,
                timeout: 10000 
            });
            
            const data = response.data;
            
            if (data.percent === "Completed" && data.fileUrl) {
                console.log('✅ Processing completed!');
                return {
                    success: true,
                    fileName: data.fileName,
                    fileSize: data.fileSize,
                    fileUrl: data.fileUrl
                };
            } else if (data.percent && data.percent !== "Completed") {
                console.log(`⏳ ${data.percent}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                return data;
            }
        } catch (error) {
            console.log(`⚠️ Error: ${error.message}`);
            
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

// Main API endpoint - ALL QUALITIES
app.get('/api/download', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        const quality = req.query.quality; // Optional
        
        if (!youtubeUrl) {
            return res.status(400).json({ 
                error: 'YouTube URL is required',
                example: '/api/download?url=https://youtu.be/VIDEO_ID'
            });
        }
        
        const videoId = extractVideoId(youtubeUrl);
        
        if (!videoId) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        
        console.log(`🎬 Processing video: ${videoId}`);
        
        // Step 1: Get initial metadata
        console.log('📥 Fetching metadata...');
        const metadata = await getVideoMetadata(youtubeUrl);
        
        // Step 2: If quality specified, get only that quality
        if (quality) {
            return await handleSingleQuality(req, res, metadata, quality, videoId);
        }
        
        // Step 3: Otherwise, get ALL qualities
        return await handleAllQualities(req, res, metadata, videoId);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Failed to process video',
            details: error.message 
        });
    }
});

// Handle single quality request
async function handleSingleQuality(req, res, metadata, quality, videoId) {
    try {
        console.log(`🎯 Requested quality: ${quality}`);
        
        // Find the specific quality
        const targetItem = findQualityItem(metadata.mediaItems, quality);
        
        if (!targetItem) {
            return res.status(404).json({ 
                success: false,
                error: `Quality '${quality}' not available`,
                availableQualities: getAvailableQualityList(metadata.mediaItems)
            });
        }
        
        // Wait for processing
        console.log(`⏳ Processing ${quality}...`);
        const downloadInfo = await waitForProcessing(targetItem.mediaUrl);
        
        // Return result
        res.json({
            success: true,
            videoId: videoId,
            title: metadata.title,
            thumbnail: metadata.imagePreviewUrl,
            description: metadata.description,
            duration: targetItem.mediaDuration,
            quality: targetItem.mediaQuality,
            resolution: targetItem.mediaRes,
            size: targetItem.mediaFileSize,
            type: targetItem.type,
            downloadUrl: downloadInfo.fileUrl,
            fileName: downloadInfo.fileName,
            note: 'Direct download link - expires after some time'
        });
        
    } catch (error) {
        throw error;
    }
}

// Handle all qualities request
async function handleAllQualities(req, res, metadata, videoId) {
    try {
        console.log('🔍 Getting ALL qualities...');
        
        const mediaItems = metadata.mediaItems;
        
        // Separate video and audio items
        const videoItems = mediaItems.filter(item => item.type === 'Video');
        const audioItems = mediaItems.filter(item => item.type === 'Audio');
        
        // Process video qualities in parallel (with concurrency limit)
        console.log(`📊 Found ${videoItems.length} video qualities`);
        const videoResults = await processMultipleQualities(videoItems);
        
        // Process audio qualities
        console.log(`🎵 Found ${audioItems.length} audio formats`);
        const audioResults = await processMultipleQualities(audioItems);
        
        // Return all results
        res.json({
            success: true,
            videoId: videoId,
            title: metadata.title,
            description: metadata.description,
            thumbnail: metadata.imagePreviewUrl,
            channel: {
                name: metadata.userInfo.name,
                avatar: metadata.userInfo.userAvatar,
                subscribers: metadata.mediaStats.followersCount
            },
            stats: {
                views: metadata.mediaStats.viewsCount,
                likes: metadata.mediaStats.likesCount
            },
            videos: videoResults.map(item => ({
                quality: item.quality,
                resolution: item.resolution,
                size: item.size,
                duration: item.duration,
                extension: item.extension,
                downloadUrl: item.downloadUrl,
                fileName: item.fileName,
                type: 'video'
            })),
            audios: audioResults.map(item => ({
                quality: item.quality,
                size: item.size,
                duration: item.duration,
                extension: item.extension,
                downloadUrl: item.downloadUrl,
                fileName: item.fileName,
                type: 'audio'
            })),
            note: 'Download links expire after some time. Use quickly.',
            totalQualities: videoResults.length + audioResults.length
        });
        
    } catch (error) {
        throw error;
    }
}

// Process multiple qualities in parallel (with concurrency control)
async function processMultipleQualities(items, maxConcurrency = 3) {
    const results = [];
    
    // Process in batches to avoid overwhelming the server
    for (let i = 0; i < items.length; i += maxConcurrency) {
        const batch = items.slice(i, i + maxConcurrency);
        console.log(`🔄 Processing batch ${Math.floor(i/maxConcurrency) + 1}...`);
        
        const batchPromises = batch.map(async (item) => {
            try {
                const downloadInfo = await waitForProcessing(item.mediaUrl);
                return {
                    success: true,
                    quality: item.mediaQuality,
                    resolution: item.mediaRes,
                    size: item.mediaFileSize,
                    duration: item.mediaDuration,
                    extension: item.mediaExtension,
                    downloadUrl: downloadInfo.fileUrl,
                    fileName: downloadInfo.fileName,
                    type: item.type
                };
            } catch (error) {
                console.log(`⚠️ Failed to process ${item.mediaQuality}: ${error.message}`);
                return {
                    success: false,
                    quality: item.mediaQuality,
                    error: error.message
                };
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r.success));
        
        // Small delay between batches
        if (i + maxConcurrency < items.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    return results;
}

// Find specific quality item
function findQualityItem(mediaItems, quality) {
    const qualityMap = {
        '144p': ['144p'],
        '240p': ['240p'],
        '360p': ['360p', 'SD'],
        '480p': ['480p', 'SD'],
        '720p': ['720p', 'HD'],
        '1080p': ['1080p', 'FHD'],
        'audio': ['48K', '128K'],
        'audio48': ['48K'],
        'audio128': ['128K']
    };
    
    const targetKeywords = qualityMap[quality.toLowerCase()] || [quality];
    
    return mediaItems.find(item => {
        if (quality.toLowerCase() === 'audio' && item.type === 'Audio') {
            return true;
        }
        
        return targetKeywords.some(keyword => 
            item.mediaQuality.includes(keyword) ||
            (item.mediaRes && item.mediaRes.includes(keyword))
        );
    });
}

// Get available qualities list
function getAvailableQualityList(mediaItems) {
    const videoQualities = mediaItems
        .filter(item => item.type === 'Video')
        .map(item => ({
            quality: item.mediaQuality,
            resolution: item.mediaRes,
            size: item.mediaFileSize
        }));
    
    const audioQualities = mediaItems
        .filter(item => item.type === 'Audio')
        .map(item => ({
            quality: item.mediaQuality,
            size: item.mediaFileSize
        }));
    
    return {
        video: videoQualities,
        audio: audioQualities
    };
}

// Quick info endpoint (no processing)
app.get('/api/info', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        
        if (!youtubeUrl) {
            return res.status(400).json({ error: 'YouTube URL is required' });
        }
        
        const videoId = extractVideoId(youtubeUrl);
        const metadata = await getVideoMetadata(youtubeUrl);
        const qualities = getAvailableQualityList(metadata.mediaItems);
        
        res.json({
            success: true,
            videoId: videoId,
            title: metadata.title,
            description: metadata.description.substring(0, 200) + '...',
            thumbnail: metadata.imagePreviewUrl,
            duration: metadata.mediaItems[0]?.mediaDuration || 'N/A',
            channel: metadata.userInfo.name,
            availableQualities: qualities,
            note: 'Use /api/download?url=YOUR_URL to get download links'
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({
        message: 'YouTube Downloader API',
        endpoints: {
            getInfo: '/api/info?url=YOUTUBE_URL',
            downloadSingle: '/api/download?url=YOUTUBE_URL&quality=720p',
            downloadAll: '/api/download?url=YOUTUBE_URL',
            examples: {
                singleQuality: 'http://localhost:3000/api/download?url=https://youtu.be/KHRZUbeZZrU&quality=720p',
                allQualities: 'http://localhost:3000/api/download?url=https://youtu.be/KHRZUbeZZrU'
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 API Endpoint: http://localhost:${PORT}/api/download`);
    console.log(`📝 Example: http://localhost:${PORT}/api/download?url=https://youtu.be/KHRZUbeZZrU`);
});
