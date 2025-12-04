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
async function waitForProcessing(processingUrl, maxRetries = 10, delay = 2000) {
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
            console.log(`Checking processing status (Attempt ${i + 1}/${maxRetries})...`);
            
            const response = await axios.get(processingUrl, { 
                headers,
                timeout: 10000 
            });
            
            const data = response.data;
            
            // Check if processing is complete
            if (data.percent === "Completed" && data.fileUrl) {
                console.log('Processing completed!');
                return {
                    success: true,
                    fileName: data.fileName,
                    fileSize: data.fileSize,
                    fileUrl: data.fileUrl
                };
            } else if (data.percent && data.percent !== "Completed") {
                console.log(`Processing: ${data.percent}`);
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // If no percent info, assume it's ready
                return data;
            }
        } catch (error) {
            console.log(`Error checking status: ${error.message}`);
            
            if (i === maxRetries - 1) {
                throw new Error(`Processing failed after ${maxRetries} attempts`);
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw new Error('Processing timeout');
}

// Main API endpoint with automatic waiting
app.get('/api/download', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        const quality = req.query.quality || '720p';
        
        if (!youtubeUrl) {
            return res.status(400).json({ error: 'YouTube URL is required' });
        }
        
        const videoId = extractVideoId(youtubeUrl);
        
        if (!videoId) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        
        console.log(`Processing video: ${videoId}`);
        
        // Step 1: Get initial metadata
        const metadata = await getVideoMetadata(youtubeUrl);
        
        // Step 2: Find requested quality
        const targetItem = findQuality(metadata.mediaItems, quality);
        
        if (!targetItem) {
            return res.status(404).json({ 
                error: 'Requested quality not available',
                availableQualities: getAvailableQualities(metadata.mediaItems)
            });
        }
        
        // Step 3: Wait for processing and get final link
        console.log('Waiting for processing to complete...');
        const downloadInfo = await waitForProcessing(targetItem.mediaUrl);
        
        // Step 4: Return final result
        res.json({
            success: true,
            videoId: videoId,
            title: metadata.title,
            thumbnail: metadata.imagePreviewUrl,
            duration: targetItem.mediaDuration,
            quality: targetItem.mediaQuality,
            resolution: targetItem.mediaRes,
            size: targetItem.mediaFileSize,
            downloadUrl: downloadInfo.fileUrl,
            directDownload: downloadInfo.fileUrl,
            fileName: downloadInfo.fileName
        });
        
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ 
            error: 'Failed to process video',
            details: error.message 
        });
    }
});

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
        { headers, timeout: 15000 }
    );
    
    return response.data.api;
}

// Find quality in media items

function findQuality(mediaItems, quality) {
  const qualityMap = {
    // Video qualities
    '144p': ['144p'],
    '240p': ['240p'],
    '360p': ['360p'],
    '480p': ['480p'],
    '720p': ['720p', 'HD'],
    '1080p': ['1080p', 'FHD'],
    // Audio qualities
    'audio': ['128K', '48K'],  // Accept any audio
    'audio_128k': ['128K'],
    'audio_48k': ['48K']
  };
  
  const targetKeywords = qualityMap[quality] || [quality];
  
  // First, try to find exact match
  if (quality.includes('p')) {
    // For video qualities, try exact resolution first
    const exactMatch = mediaItems.find(item => {
      if (item.type === 'Video' && !quality.includes('audio')) {
        return item.mediaQuality === quality;
      }
      return false;
    });
    
    if (exactMatch) return exactMatch;
  }
  
  // If no exact match, fall back to keyword matching
  // But filter and sort to get the closest quality
  const filteredItems = mediaItems.filter(item => {
    if (item.type === 'Video' && !quality.includes('audio')) {
      return targetKeywords.some(keyword => item.mediaQuality.includes(keyword));
    } else if (item.type === 'Audio' && quality.includes('audio')) {
      if (quality === 'audio') {
        return true;  // Return all audio items
      }
      return targetKeywords.some(keyword => item.mediaQuality.includes(keyword));
    }
    return false;
  });
  
  // For video qualities, sort by resolution (lowest first for SD, highest first for HD)
  if (quality.includes('p') && filteredItems.length > 0) {
    const qualityOrder = ['144p', '240p', '360p', '480p', '720p', '1080p'];
    
    if (['144p', '240p', '360p', '480p'].includes(quality)) {
      // For SD qualities, return the closest but not higher than requested
      filteredItems.sort((a, b) => {
        const aIndex = qualityOrder.findIndex(q => a.mediaQuality.includes(q));
        const bIndex = qualityOrder.findIndex(q => b.mediaQuality.includes(q));
        return aIndex - bIndex; // Ascending order
      });
      
      // Return the highest quality that doesn't exceed requested
      const requestedIndex = qualityOrder.indexOf(quality);
      const bestMatch = filteredItems.find(item => {
        const itemIndex = qualityOrder.findIndex(q => item.mediaQuality.includes(q));
        return itemIndex <= requestedIndex;
      });
      
      return bestMatch || filteredItems[0]; // Fallback to first match if none found
    } else {
      // For HD qualities (720p, 1080p), return exact or closest higher
      filteredItems.sort((a, b) => {
        const aIndex = qualityOrder.findIndex(q => a.mediaQuality.includes(q));
        const bIndex = qualityOrder.findIndex(q => b.mediaQuality.includes(q));
        return bIndex - aIndex; // Descending order for HD
      });
      
      return filteredItems[0];
    }
  }
  
  // For audio, return first match (or sort by bitrate if needed)
  if (quality.includes('audio') && filteredItems.length > 0) {
    if (quality === 'audio_128k') {
      // Try to get 128K specifically
      const exactAudio = filteredItems.find(item => item.mediaQuality.includes('128K'));
      return exactAudio || filteredItems[0];
    } else if (quality === 'audio_48k') {
      // Try to get 48K specifically
      const exactAudio = filteredItems.find(item => item.mediaQuality.includes('48K'));
      return exactAudio || filteredItems[0];
    }
    return filteredItems[0];
  }
  
  return filteredItems[0] || null;
}

// Get available qualities
function getAvailableQualities(mediaItems) {
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
    
    return { videoQualities, audioQualities };
}

// Alternative: Get qualities only (no waiting)
app.get('/api/qualities', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        
        if (!youtubeUrl) {
            return res.status(400).json({ error: 'YouTube URL is required' });
        }
        
        const metadata = await getVideoMetadata(youtubeUrl);
        const qualities = getAvailableQualities(metadata.mediaItems);
        
        res.json({
            success: true,
            videoId: metadata.id,
            title: metadata.title,
            thumbnail: metadata.imagePreviewUrl,
            ...qualities
        });
        
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
